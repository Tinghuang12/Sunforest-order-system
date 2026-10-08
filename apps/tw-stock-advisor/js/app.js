// 台股顧問 App：讀取 tw-stock-reports 的盤前報告、盤後檢討、戰績表與 PLAYBOOK，整理成手機可讀的畫面。
import { loadSettings, saveSettings, clearCache, cacheSize, DEFAULTS } from './store.js';
import { GitHubSource } from './github.js';
import { classifyFile, parseDoc, KINDS, plain } from './parse.js';
import {
  mdToHtml, tokensToHtml, inline, esc, fmtDate, fmtDateTime, todayTaipei, pct,
  CONF_LABEL, OUTCOME_LABEL, SCENARIO_LABEL,
} from './render.js';
import { renderHitRateChart } from './chart.js';

const TABS = [
  ['today', '盤前'],
  ['review', '盤後'],
  ['scoreboard', '戰績'],
  ['playbook', '準則'],
  ['archive', '歷史'],
];

const state = {
  settings: loadSettings(),
  source: null,
  files: [],
  index: null,
  fetchedAt: null,
  offline: false,
  lastError: null,
  docCache: new Map(),
  renderSeq: 0,
};

const $view = document.getElementById('view');
const $status = document.getElementById('status');
const $tabbar = document.getElementById('tabbar');

// ---------- 資料層 ----------

function makeSource() {
  state.source = new GitHubSource(state.settings);
}

function stripExt(path) {
  return path.replace(/\.(md|pdf)$/i, '');
}

function buildIndex(files) {
  const idx = {
    premarkets: [], postmortems: [], research: [], others: [],
    scoreboard: null, playbook: null, pdfByBase: new Map(), byPath: new Map(),
  };
  for (const f of files) {
    const meta = { ...classifyFile(f.path), sha: f.sha, size: f.size };
    idx.byPath.set(f.path, meta);
    if (meta.ext === 'pdf') {
      idx.pdfByBase.set(stripExt(f.path), meta);
      continue;
    }
    if (meta.ext !== 'md') continue;
    if (meta.kind === 'premarket') idx.premarkets.push(meta);
    else if (meta.kind === 'postmortem') idx.postmortems.push(meta);
    else if (meta.kind === 'research') idx.research.push(meta);
    else if (meta.kind === 'scoreboard') idx.scoreboard = meta;
    else if (meta.kind === 'playbook') idx.playbook = meta;
    else idx.others.push(meta);
  }
  const desc = (a, b) => (b.date || '').localeCompare(a.date || '') || b.path.localeCompare(a.path);
  idx.premarkets.sort(desc);
  idx.postmortems.sort(desc);
  idx.research.sort(desc);
  idx.others.sort((a, b) => a.path.localeCompare(b.path));
  return idx;
}

function pdfFor(meta) {
  return state.index ? state.index.pdfByBase.get(stripExt(meta.path)) || null : null;
}

async function ensureIndex({ force = false } = {}) {
  if (!state.source) makeSource();
  if (state.index && !force) return state.index;
  try {
    const { files, fetchedAt } = await state.source.tree({ force });
    state.files = files;
    state.index = buildIndex(files);
    state.fetchedAt = fetchedAt;
    state.offline = false;
    state.lastError = null;
  } catch (err) {
    const cached = state.source.cachedTree();
    if (!cached) throw err;
    state.files = cached.files;
    state.index = buildIndex(cached.files);
    state.fetchedAt = cached.fetchedAt;
    state.offline = true;
    state.lastError = err;
  }
  updateStatus();
  return state.index;
}

async function loadDoc(meta) {
  const cached = state.docCache.get(meta.path);
  if (cached && cached.sha === meta.sha) return cached;
  const md = await state.source.text(meta.path, meta.sha);
  const entry = { meta, md, parsed: parseDoc(meta.kind, md, meta), sha: meta.sha };
  state.docCache.set(meta.path, entry);
  return entry;
}

function updateStatus() {
  if (!state.fetchedAt) {
    $status.textContent = '';
    return;
  }
  const t = new Date(state.fetchedAt).toLocaleTimeString('zh-TW', { hour: '2-digit', minute: '2-digit', hour12: false });
  $status.textContent = state.offline ? `離線，顯示 ${t} 的快取` : `資料同步 ${t}`;
  $status.classList.toggle('warn', state.offline);
}

// ---------- 共用畫面元件 ----------

function card({ title = '', sub = '', body = '', cls = '', actions = '', id = '' }) {
  return `<section class="card ${cls}" ${id ? `id="${id}"` : ''}>
    ${title ? `<header class="card-head"><div><h2>${title}</h2>${sub ? `<p class="card-sub">${sub}</p>` : ''}</div>${actions ? `<div class="card-actions">${actions}</div>` : ''}</header>` : ''}
    <div class="card-body">${body}</div>
  </section>`;
}

function chip(text, cls = '') {
  return `<span class="chip ${cls}">${esc(text)}</span>`;
}

function confChip(level, text) {
  return chip(text || CONF_LABEL[level] || '–', `conf conf-${level}`);
}

function changeHtml(text, value) {
  const cls = value === null || value === undefined ? '' : value > 0 ? 'num-up' : value < 0 ? 'num-down' : 'num-flat';
  return `<span class="num ${cls}">${esc(text || '–')}</span>`;
}

function loading(text = '載入中…') {
  return `<div class="loading"><div class="spinner" aria-hidden="true"></div><p>${esc(text)}</p></div>`;
}

function errorCard(err) {
  const msg = err && err.message ? err.message : String(err);
  const needSettings = err && (err.status === 401 || err.status === 403 || err.status === 404);
  return card({
    cls: 'error',
    title: '無法載入資料',
    body: `<p>${esc(msg)}</p>
      <div class="btn-row">
        ${needSettings ? '<a class="btn primary" href="#/settings">前往設定</a>' : ''}
        <button class="btn" data-action="refresh">重試</button>
      </div>`,
  });
}

function emptyCard(title, text) {
  return card({ title, body: `<p class="muted">${esc(text)}</p>` });
}

function docActions(meta) {
  if (!meta) return '';
  const pdf = pdfFor(meta);
  return `<div class="btn-row">
    <a class="btn" href="#/doc/${encodeURIComponent(meta.path)}">閱讀完整報告</a>
    ${pdf ? `<button class="btn" data-pdf="${esc(pdf.path)}">下載 PDF</button>` : ''}
    <a class="btn ghost" href="${state.source.blobUrl(meta.path)}" target="_blank" rel="noopener">GitHub</a>
  </div>`;
}

function reportHeader(label, meta, { tag = '', extra = '' } = {}) {
  const today = todayTaipei();
  const isToday = meta.date === today;
  return `<div class="report-head">
    <div>
      <p class="eyebrow">${esc(label)}</p>
      <h2 class="report-date">${esc(fmtDate(meta.date))} <span class="muted small">${esc(meta.date || '')}</span></h2>
    </div>
    <div class="report-tags">
      ${isToday ? chip('今日', 'tag-today') : chip('最新', 'tag-latest')}
      ${tag ? chip(tag, 'tag-note') : ''}
      <span class="muted small" data-commit="${esc(meta.path)}"></span>
      ${extra}
    </div>
  </div>`;
}

async function fillCommitTimes(root) {
  const nodes = root.querySelectorAll('[data-commit]');
  for (const node of nodes) {
    const path = node.dataset.commit;
    const meta = state.index && state.index.byPath.get(path);
    if (!meta) continue;
    try {
      const info = await state.source.lastCommit(path, meta.sha);
      if (info) node.textContent = `更新 ${fmtDateTime(info.date)}`;
    } catch {
      /* 次要資訊，失敗就略過 */
    }
  }
}

function scenarioRows(scenarios, { withResult = false } = {}) {
  if (!scenarios.length) return '<p class="muted">報告中沒有情境表。</p>';
  return `<ul class="scenarios">${scenarios
    .map((s) => {
      const label = SCENARIO_LABEL[s.kind] || s.name;
      const hitCls = withResult ? (s.hit ? 'scn-hit' : 'scn-miss') : '';
      return `<li class="scn scn-${s.kind} ${hitCls}">
        <div class="scn-row">
          <span class="scn-name">${esc(label)}</span>
          <span class="scn-range num">${esc(s.range || '–')}</span>
          <span class="scn-prob num">${s.prob !== null && s.prob !== undefined ? `${s.prob}%` : '–'}</span>
          ${withResult ? `<span class="scn-result">${s.hit ? '✓ 命中' : esc(plain(s.result || '')).slice(0, 10)}</span>` : ''}
        </div>
        <div class="bar"><i style="width:${Math.max(0, Math.min(100, s.prob || 0))}%"></i></div>
        ${s.logic ? `<details class="scn-logic"><summary>條件與邏輯</summary><p>${inline(s.logic)}</p></details>` : ''}
        ${withResult && s.result ? `<p class="scn-note">${inline(s.result)}</p>` : ''}
      </li>`;
    })
    .join('')}</ul>`;
}

function stockList(rows, dir) {
  if (!rows.length) return '<p class="muted">本日無候選。</p>';
  return `<ul class="stocks">${rows
    .map(
      (s) => `<li class="stock stock-${dir}">
      <details>
        <summary>
          <span class="stock-id"><b class="code">${esc(s.code)}</b> <span class="name">${esc(s.name)}</span></span>
          ${confChip(s.level, s.confidence)}
        </summary>
        <dl class="stock-detail">
          <dt>催化劑</dt><dd>${inline(s.catalyst)}</dd>
          <dt>推理邏輯</dt><dd>${inline(s.logic)}</dd>
          <dt>主要風險</dt><dd>${inline(s.risk)}</dd>
        </dl>
      </details>
      <p class="stock-catalyst">${inline(s.catalyst)}</p>
    </li>`,
    )
    .join('')}</ul>`;
}

function statTile(label, value, sub = '', cls = '') {
  return `<div class="tile ${cls}"><p class="tile-label">${esc(label)}</p><p class="tile-value num">${value}</p>${sub ? `<p class="tile-sub">${sub}</p>` : ''}</div>`;
}

function ratioTile(label, r, cls = '') {
  if (!r || r.hit === null || r.hit === undefined || !r.total) return statTile(label, '–', '無樣本', cls);
  return statTile(label, pct(r.pct, r.pct % 1 ? 1 : 0), `${r.hit} / ${r.total}`, cls);
}

// ---------- 各分頁 ----------

async function viewToday(root) {
  const idx = await ensureIndex();
  const meta = idx.premarkets[0];
  if (!meta) {
    root.innerHTML = emptyCard('尚無盤前報告', '「台股每日顧問」Routine 於每個交易日早上 07:23 產出報告並推送到 GitHub。');
    return;
  }
  root.innerHTML = loading('讀取盤前報告…');
  const { parsed: p } = await loadDoc(meta);
  const sameDayReview = idx.postmortems.find((m) => m.date === meta.date);

  const adopted = p.adopted.length
    ? card({ title: '採納的修正建議', sub: '來自最近的盤後檢討', body: `<div class="prose compact">${tokensToHtml(p.adopted)}</div>`, cls: 'accent-note' })
    : '';
  const market = p.market
    ? card({
        title: '大盤情境',
        sub: esc(p.market.heading.replace(/^[一二三四五六七八九十]+、/, '').replace(/^大盤情境\s*/, '')),
        body: `${scenarioRows(p.market.scenarios)}
          ${p.market.prose.length ? `<details class="more"><summary>基礎數據與開盤推測</summary><div class="prose compact">${tokensToHtml(p.market.prose)}</div></details>` : ''}`,
      })
    : '';
  const bull = card({
    title: `看漲候選 <span class="count">${p.bullish.length}</span>`,
    cls: 'edge-up',
    body: stockList(p.bullish, 'up') + (p.bullishExtra.length ? `<div class="prose compact note">${tokensToHtml(p.bullishExtra)}</div>` : ''),
  });
  const bear = card({
    title: `看跌候選 <span class="count">${p.bearish.length}</span>`,
    cls: 'edge-down',
    body: stockList(p.bearish, 'down') + (p.bearishExtra.length ? `<div class="prose compact note">${tokensToHtml(p.bearishExtra)}</div>` : ''),
  });
  const highlights = p.highlights.length
    ? card({ title: '隔夜與今晨重點', body: `<details class="more" open><summary>共 ${p.highlightItems.length || ''} 條</summary><div class="prose compact">${tokensToHtml(p.highlights)}</div></details>` })
    : '';
  const bigshots = p.bigshots.length ? card({ title: '大咖發言', body: `<div class="prose compact">${tokensToHtml(p.bigshots)}</div>` }) : '';
  const intro = p.intro.length ? card({ body: `<details class="more"><summary>報告說明與資料限制</summary><div class="prose compact">${tokensToHtml(p.intro)}</div></details>` }) : '';
  const reviewBanner = sameDayReview
    ? `<a class="banner" href="#/review">本日盤後檢討已產出 → 查看評分</a>`
    : '';

  root.innerHTML = `${reportHeader('盤前顧問報告', meta)}${reviewBanner}${adopted}${market}${bull}${bear}${highlights}${bigshots}${intro}${card({ body: docActions(meta) })}
    <p class="disclaimer">本頁內容為公開資訊整理與推測，非投資建議，投資人應自行判斷。</p>`;
  fillCommitTimes(root);
}

async function viewReview(root) {
  const idx = await ensureIndex();
  const meta = idx.postmortems[0];
  if (!meta) {
    root.innerHTML = emptyCard('尚無盤後檢討', '「台股盤後檢討」Routine 於每個交易日下午 15:00 評分前一份盤前報告。');
    return;
  }
  root.innerHTML = loading('讀取盤後檢討…');
  const { parsed: p } = await loadDoc(meta);
  const base = p.marketCheck.find((s) => s.kind === 'base');
  const samePremarket = idx.premarkets.find((m) => m.date === meta.date);

  const tiles = `<div class="tiles">
    ${ratioTile('看漲命中', p.stats.bullish, 'tile-up')}
    ${ratioTile('看跌命中', p.stats.bearish, 'tile-down')}
    ${ratioTile('個股合計', p.stats.overall)}
    ${statTile('大盤基準區間', base ? (base.hit ? '命中' : '未命中') : '–', base ? esc(base.range) : '', base ? (base.hit ? 'tile-hit' : 'tile-miss') : '')}
  </div>`;

  const summary = p.summary.length
    ? card({ title: '實際結果摘要', body: `<dl class="kv">${p.summary.map((r) => `<dt>${esc(r.item)}</dt><dd>${inline(r.value)}</dd>`).join('')}</dl>` })
    : '';
  const market = card({
    title: '大盤對照',
    body: scenarioRows(p.marketCheck, { withResult: true }) + (p.marketNotes.length ? `<div class="prose compact note">${tokensToHtml(p.marketNotes)}</div>` : ''),
  });
  const scores = card({
    title: `個股評分表 <span class="count">${p.scores.length}</span>`,
    sub: `平盤 ${p.stats.flat} 檔不計分${p.stats.na ? `，未查得 ${p.stats.na} 檔` : ''}`,
    body: `<ul class="scores">${p.scores
      .map(
        (s) => `<li class="score out-${s.outcome}">
          <details>
            <summary>
              <span class="stock-id"><b class="code">${esc(s.code)}</b> <span class="name">${esc(s.name)}</span></span>
              ${chip(s.directionText || (s.direction === 'up' ? '看漲' : '看跌'), `dir dir-${s.direction}`)}
              ${confChip(s.level, s.confidence)}
              ${changeHtml(s.change, s.changePct)}
              ${chip(OUTCOME_LABEL[s.outcome] || s.outcome, `out out-${s.outcome}`)}
            </summary>
            <dl class="stock-detail">
              <dt>收盤</dt><dd class="num">${esc(s.close || '–')}</dd>
              <dt>引用準則</dt><dd>${esc(s.rules || '–')}</dd>
              <dt>結果</dt><dd>${inline(s.result)}</dd>
            </dl>
          </details>
        </li>`,
      )
      .join('')}</ul>${p.scoreNotes.length ? `<div class="prose compact note">${tokensToHtml(p.scoreNotes)}</div>` : ''}`,
  });
  const advice = p.advice.length
    ? card({ title: '明日給盤前顧問的修正建議', cls: 'accent-note', body: `<ol class="advice">${p.advice.map((a) => `<li>${inline(a)}</li>`).join('')}</ol>` })
    : p.adviceTokens.length
      ? card({ title: '修正建議', cls: 'accent-note', body: `<div class="prose compact">${tokensToHtml(p.adviceTokens)}</div>` })
      : '';
  const reflections = p.reflections.length
    ? card({ title: '未命中案例反省', sub: '三問：依據是什麼？市場為何不同？是規律還是雜訊？', body: `<details class="more"><summary>展開反省內容</summary><div class="prose compact">${tokensToHtml(p.reflections)}</div></details>` })
    : '';
  const rules = p.ruleChecks.length
    ? card({
        title: '準則檢驗表',
        body: `<div class="table-wrap"><table class="data"><thead><tr><th>準則</th><th>本日案例</th><th>結論</th>${p.ruleChecks.some((r) => r.tally) ? '<th>累計</th>' : ''}</tr></thead><tbody>${p.ruleChecks
          .map((r) => `<tr><td class="nowrap"><b>${esc(r.rule)}</b></td><td>${inline(r.cases)}</td><td>${esc(r.verdict)}</td>${p.ruleChecks.some((x) => x.tally) ? `<td class="num">${inline(r.tally)}</td>` : ''}</tr>`)
          .join('')}</tbody></table></div>`,
      })
    : '';
  const intro = p.intro.length ? card({ body: `<details class="more"><summary>資料來源與未查得項目</summary><div class="prose compact">${tokensToHtml(p.intro)}</div></details>` }) : '';
  const link = samePremarket ? `<a class="banner" href="#/doc/${encodeURIComponent(samePremarket.path)}">對照同日盤前報告 →</a>` : '';

  root.innerHTML = `${reportHeader('盤後檢討', meta, { tag: p.tag })}${tiles}${link}${advice}${market}${scores}${summary}${reflections}${rules}${intro}${card({ body: docActions(meta) })}
    <p class="disclaimer">本頁為公開資訊整理與事後評分，非投資建議。</p>`;
  fillCommitTimes(root);
}

async function viewScoreboard(root) {
  const idx = await ensureIndex();
  if (!idx.scoreboard) {
    root.innerHTML = emptyCard('尚無戰績表', '盤後檢討 Routine 第一次執行後會建立 scoreboard.md。');
    return;
  }
  root.innerHTML = loading('讀取戰績表…');
  const { parsed: s } = await loadDoc(idx.scoreboard);
  const find = (kw) => s.totals.find((t) => t.item.includes(kw));
  const tiles = `<div class="tiles">
    ${ratioTile('大盤基準區間', (find('大盤') || {}).ratio, 'tile-hit')}
    ${ratioTile('看漲個股', (find('看漲') || {}).ratio, 'tile-up')}
    ${ratioTile('看跌個股', (find('看跌') || {}).ratio, 'tile-down')}
    ${ratioTile('個股合計', (find('合計') || {}).ratio)}
  </div>
  <div class="tiles tiles-3">
    ${ratioTile('高信心', (find('高信心') || {}).ratio)}
    ${ratioTile('中信心', (find('中信心') || {}).ratio)}
    ${ratioTile('低信心', (find('低信心') || {}).ratio)}
  </div>`;
  const chart = card({ title: '每日命中率走勢', sub: `${s.daily.length} 個交易日`, body: '<div id="hit-chart" class="chart-wrap"></div>' });
  const table = card({
    title: '每日明細',
    body: `<div class="table-wrap"><table class="data"><thead><tr><th>日期</th><th>基準區間</th><th>收盤</th><th>區間</th><th>看漲</th><th>看跌</th><th>中信心</th><th>低信心</th></tr></thead><tbody>${[...s.daily]
      .reverse()
      .map(
        (d) => `<tr>
        <td class="nowrap">${esc(fmtDate(d.date, { weekday: false }))}</td>
        <td class="num nowrap">${esc(d.range)}</td>
        <td class="num">${esc(d.close)}</td>
        <td>${d.rangeHit ? '<span class="mark-hit">✓</span>' : '<span class="mark-miss">✗</span>'}</td>
        <td class="num">${d.bullish.hit === null ? '–' : `${d.bullish.hit}/${d.bullish.total}`}</td>
        <td class="num">${d.bearish.hit === null ? '–' : `${d.bearish.hit}/${d.bearish.total}`}</td>
        <td class="num">${d.mid.hit === null ? '–' : `${d.mid.hit}/${d.mid.total}`}</td>
        <td class="num">${d.low.hit === null ? '–' : `${d.low.hit}/${d.low.total}`}</td>
      </tr>`,
      )
      .join('')}</tbody></table></div>${s.totalsNotes.length ? `<div class="prose compact note">${tokensToHtml(s.totalsNotes)}</div>` : ''}`,
  });
  const rules = card({
    body: `<p class="muted small">命中定義：看漲且收盤漲幅 &gt;0、看跌且跌幅 &lt;0 為命中；|漲跌| ≤0.3% 視為平盤不計分。準則需累積 ≥5 個獨立樣本才會升為「有效訊號」（命中率 ≥60%）或降為「無效訊號」（≤40%）。</p>
      <div class="btn-row"><a class="btn" href="#/doc/${encodeURIComponent(idx.scoreboard.path)}">原始戰績表</a><a class="btn ghost" href="${state.source.blobUrl(idx.scoreboard.path)}" target="_blank" rel="noopener">GitHub</a></div>`,
  });
  root.innerHTML = `<div class="report-head"><div><p class="eyebrow">戰績表</p><h2 class="report-date">累計戰績</h2></div><div class="report-tags"><span class="muted small" data-commit="${esc(idx.scoreboard.path)}"></span></div></div>${tiles}${chart}${table}${rules}`;
  renderHitRateChart(root.querySelector('#hit-chart'), s.daily);
  fillCommitTimes(root);
}

function ruleCard(r, samples) {
  const mine = samples.filter((x) => x.id === r.id || x.id.startsWith(`${r.id} `) || x.id.startsWith(`${r.id}（`));
  const dirCls = /多/.test(r.direction) && /空/.test(r.direction) ? 'dir-both' : /多/.test(r.direction) ? 'dir-up' : /空/.test(r.direction) ? 'dir-down' : 'dir-neutral';
  const statusCls = /有效/.test(r.status) ? 'st-valid' : /無效/.test(r.status) ? 'st-invalid' : 'st-pending';
  const sampleHtml = mine.length
    ? `<div class="samples">${mine
        .map((m) => {
          const total = m.support + m.against;
          const sp = total ? Math.round((m.support / total) * 100) : 0;
          return `<div class="sample">
            <div class="sample-row"><span class="sample-id">${esc(m.id.replace(r.id, '').trim() || '樣本')}</span><span class="num">支持 ${m.support}・反證 ${m.against}<span class="muted">／${total}</span></span></div>
            <div class="bar split"><i class="support" style="width:${sp}%"></i><i class="against" style="width:${100 - sp}%"></i></div>
            ${m.notes ? `<p class="sample-note">${inline(m.notes)}</p>` : ''}
          </div>`;
        })
        .join('')}<p class="muted small">累積 5 個樣本後可升降級（目前 ${mine.reduce((a, m) => a + m.support + m.against, 0)} 個）。</p></div>`
    : '<p class="muted small">尚無樣本紀錄。</p>';
  return `<li class="rule">
    <details>
      <summary>
        <span class="rule-id">${esc(r.id)}</span>
        <span class="rule-text">${inline(r.rule)}</span>
        <span class="rule-chips">${chip(r.direction || '–', `dir ${dirCls}`)}${chip(r.status || '–', `st ${statusCls}`)}</span>
      </summary>
      ${sampleHtml}
    </details>
  </li>`;
}

async function viewPlaybook(root) {
  const idx = await ensureIndex();
  if (!idx.playbook) {
    root.innerHTML = emptyCard('尚無 PLAYBOOK', '盤前顧問第一次執行時會建立 docs/stocks/advisor/PLAYBOOK.md。');
    return;
  }
  root.innerHTML = loading('讀取 PLAYBOOK…');
  const { parsed: p } = await loadDoc(idx.playbook);
  const seg = [
    ['pending', `待驗證 ${p.pending.length}`],
    ['valid', `有效 ${p.valid.length}`],
    ['invalid', `無效 ${p.invalid.length}`],
    ['process', `流程 ${p.process.length}`],
  ];
  const panels = {
    pending: p.pending.length ? `<ul class="rules">${p.pending.map((r) => ruleCard(r, p.samples)).join('')}</ul>${p.calibration.length ? `<p class="note muted">${inline(p.calibration.join('；'))}</p>` : ''}` : '<p class="muted">無。</p>',
    valid: p.valid.length ? `<ul class="rules">${p.valid.map((r) => ruleCard(r, p.samples)).join('')}</ul>` : `<div class="prose compact">${tokensToHtml(p.validTokens) || '<p class="muted">尚無有效訊號。</p>'}</div>`,
    invalid: p.invalid.length ? `<ul class="rules">${p.invalid.map((r) => ruleCard(r, p.samples)).join('')}</ul>` : `<div class="prose compact">${tokensToHtml(p.invalidTokens) || '<p class="muted">尚無無效訊號。</p>'}</div>`,
    process: `<ul class="process">${p.process.map((f) => `<li><span class="rule-id">${esc(f.id || '–')}</span><div>${f.note ? `<p class="muted small">${esc(f.note)}</p>` : ''}<p>${inline(f.text)}</p></div></li>`).join('')}</ul>`,
  };
  root.innerHTML = `<div class="report-head"><div><p class="eyebrow">PLAYBOOK ${esc(p.version)}</p><h2 class="report-date">策略準則</h2></div><div class="report-tags"><span class="muted small" data-commit="${esc(idx.playbook.path)}"></span></div></div>
    ${p.versionText ? `<p class="note muted small">${esc(p.versionText)}</p>` : ''}
    <div class="segmented" role="tablist">${seg.map(([k, label], i) => `<button role="tab" data-seg="${k}" aria-selected="${i === 0}" class="${i === 0 ? 'on' : ''}">${esc(label)}</button>`).join('')}</div>
    ${Object.entries(panels).map(([k, html], i) => `<div class="panel" data-panel="${k}" ${i === 0 ? '' : 'hidden'}>${html}</div>`).join('')}
    ${card({ body: `<div class="btn-row"><a class="btn" href="#/doc/${encodeURIComponent(idx.playbook.path)}">完整 PLAYBOOK</a><a class="btn ghost" href="${state.source.blobUrl(idx.playbook.path)}" target="_blank" rel="noopener">GitHub</a></div>` })}`;
  fillCommitTimes(root);
}

async function viewArchive(root, filter = 'all') {
  const idx = await ensureIndex();
  const all = [...idx.premarkets, ...idx.postmortems, ...idx.research];
  const items = all.filter((m) => filter === 'all' || m.kind === filter).sort((a, b) => (b.date || '').localeCompare(a.date || '') || a.kind.localeCompare(b.kind));
  const groups = new Map();
  for (const m of items) {
    const key = m.date || '其他';
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(m);
  }
  const filters = [
    ['all', '全部'],
    ['premarket', '盤前'],
    ['postmortem', '盤後'],
    ['research', '研究'],
  ];
  const row = (m) => {
    const pdf = pdfFor(m);
    return `<li class="file kind-${m.kind}">
      <a class="file-main" href="#/doc/${encodeURIComponent(m.path)}">
        ${chip(KINDS[m.kind] ? KINDS[m.kind].short : '文件', `kind kind-${m.kind}`)}
        <span class="file-title">${esc(m.kind === 'research' ? m.title.replace(/-/g, ' ') : KINDS[m.kind].label)}</span>
      </a>
      ${pdf ? `<button class="btn small" data-pdf="${esc(pdf.path)}">PDF</button>` : ''}
    </li>`;
  };
  root.innerHTML = `<div class="report-head"><div><p class="eyebrow">歷史</p><h2 class="report-date">所有報告</h2></div><div class="report-tags">${chip(`${all.length} 份`, 'tag-latest')}</div></div>
    <div class="segmented">${filters.map(([k, label]) => `<button data-filter="${k}" class="${k === filter ? 'on' : ''}">${label}</button>`).join('')}</div>
    ${items.length ? [...groups.entries()].map(([date, list]) => `<section class="group"><h3 class="group-date">${esc(fmtDate(date))} <span class="muted small">${esc(date)}</span></h3><ul class="files">${list.map(row).join('')}</ul></section>`).join('') : emptyCard('沒有符合的報告', '')}
    ${card({
      title: '其他文件',
      body: `<ul class="files">${[idx.scoreboard, idx.playbook, ...idx.others]
        .filter(Boolean)
        .map((m) => `<li class="file"><a class="file-main" href="#/doc/${encodeURIComponent(m.path)}">${chip(KINDS[m.kind] ? KINDS[m.kind].short : '文件', `kind kind-${m.kind}`)}<span class="file-title">${esc(m.name)}</span></a></li>`)
        .join('')}</ul>`,
    })}`;
}

async function viewDoc(root, path) {
  const idx = await ensureIndex();
  const meta = idx.byPath.get(path);
  if (!meta || meta.ext !== 'md') {
    root.innerHTML = emptyCard('找不到文件', path);
    return;
  }
  root.innerHTML = loading('讀取文件…');
  const { md, parsed } = await loadDoc(meta);
  const pdf = pdfFor(meta);
  const back = meta.kind === 'premarket' ? '#/today' : meta.kind === 'postmortem' ? '#/review' : meta.kind === 'scoreboard' ? '#/scoreboard' : meta.kind === 'playbook' ? '#/playbook' : '#/archive';
  root.innerHTML = `<div class="doc-head">
      <a class="btn ghost" href="${back}">← 返回</a>
      <div class="btn-row">${pdf ? `<button class="btn small" data-pdf="${esc(pdf.path)}">PDF</button>` : ''}<a class="btn small ghost" href="${state.source.blobUrl(meta.path)}" target="_blank" rel="noopener">GitHub</a></div>
    </div>
    <p class="muted small doc-meta">${esc(meta.path)} <span data-commit="${esc(meta.path)}"></span></p>
    <article class="card"><div class="card-body prose">${mdToHtml(md)}</div></article>`;
  if (parsed && parsed.title) document.title = `${parsed.title} · 台股顧問`;
  fillCommitTimes(root);
}

function viewSettings(root) {
  const s = state.settings;
  const kb = Math.round(cacheSize() / 1024);
  root.innerHTML = `<div class="report-head"><div><p class="eyebrow">設定</p><h2 class="report-date">資料來源</h2></div></div>
  ${card({
    body: `<form id="settings-form" class="form">
      <label>GitHub 帳號／組織<input name="owner" value="${esc(s.owner)}" autocomplete="off" required></label>
      <label>Repo<input name="repo" value="${esc(s.repo)}" autocomplete="off" required></label>
      <label>分支<input name="branch" value="${esc(s.branch)}" autocomplete="off" required><small>Routine 把報告推送到 <code>claude/stock-advisor-data</code>；合併後也可改用 <code>main</code>。</small></label>
      <label>報告根目錄<input name="root" value="${esc(s.root)}" autocomplete="off"></label>
      <label>Personal Access Token<span class="token-row"><input name="token" type="password" value="${esc(s.token)}" autocomplete="off" placeholder="github_pat_…"><button type="button" class="btn small ghost" data-action="toggle-token">顯示</button></span>
        <small>私有 repo 需要 Token。只會儲存在這台裝置的瀏覽器裡，不會傳到 GitHub 以外的任何地方。</small></label>
      <div class="btn-row">
        <button class="btn primary" type="submit">儲存並重新載入</button>
        <button class="btn" type="button" data-action="test">測試連線</button>
      </div>
      <p id="test-result" class="small"></p>
    </form>`,
  })}
  ${card({
    title: '如何建立 Token',
    body: `<ol class="steps">
      <li>到 GitHub <a href="https://github.com/settings/personal-access-tokens/new" target="_blank" rel="noopener">Settings → Developer settings → Fine-grained tokens</a>。</li>
      <li>Repository access 選「Only select repositories」，勾選 <b>${esc(s.repo)}</b>。</li>
      <li>Permissions → Repository permissions → <b>Contents</b> 設為 <b>Read-only</b>（Metadata 會自動帶入）。</li>
      <li>產生後把 <code>github_pat_…</code> 貼到上方欄位，按「儲存並重新載入」。</li>
    </ol>`,
  })}
  ${card({
    title: '關於這個 App',
    body: `<p>資料全部來自兩個 Claude Routine 每日推送到 GitHub 的報告：</p>
      <ul class="about">
        <li><b>台股每日顧問</b>：交易日 07:23（台北）產出 <code>YYYY-MM-DD-盤前顧問報告.md</code>，列出看漲／看跌候選與大盤情境。</li>
        <li><b>台股盤後檢討</b>：交易日 15:00（台北）評分當日盤前報告，更新 <code>scoreboard.md</code> 與 <code>PLAYBOOK.md</code>。</li>
      </ul>
      <p class="muted small">App 只讀取 GitHub，不會寫入或修改任何檔案。快取約 ${kb} KB。</p>
      <div class="btn-row"><button class="btn" type="button" data-action="clear-cache">清除快取</button><button class="btn ghost" type="button" data-action="reset">還原預設值</button></div>`,
  })}`;
}

// ---------- 路由 ----------

const ROUTES = {
  today: viewToday,
  review: viewReview,
  scoreboard: viewScoreboard,
  playbook: viewPlaybook,
  archive: viewArchive,
  doc: viewDoc,
  settings: (root) => viewSettings(root),
};

function parseHash() {
  const raw = location.hash.replace(/^#\/?/, '');
  const [route = 'today', ...rest] = raw.split('/');
  const param = rest.length ? decodeURIComponent(rest.join('/')) : undefined;
  return { route: ROUTES[route] ? route : 'today', param };
}

async function render() {
  const { route, param } = parseHash();
  const seq = (state.renderSeq += 1);
  for (const a of $tabbar.querySelectorAll('a')) {
    const on = a.dataset.route === route || (route === 'doc' && false);
    a.classList.toggle('on', on);
    a.setAttribute('aria-current', on ? 'page' : 'false');
  }
  document.title = `${(TABS.find(([k]) => k === route) || [, route === 'settings' ? '設定' : '文件'])[1]} · 台股顧問`;
  $view.scrollTop = 0;
  window.scrollTo(0, 0);
  const root = document.createElement('div');
  root.className = `page page-${route}`;
  root.innerHTML = loading();
  $view.replaceChildren(root);
  try {
    await ROUTES[route](root, param);
  } catch (err) {
    if (seq !== state.renderSeq) return;
    console.error(err);
    root.innerHTML = errorCard(err) + (route !== 'settings' && !state.settings.token ? card({ title: '第一次使用？', body: '<p>這個 App 從 GitHub 私有 repo 讀取報告，需要先在「設定」填入一個只讀 Token。</p><a class="btn primary" href="#/settings">前往設定</a>' }) : '');
  }
}

async function openPdf(path) {
  const win = window.open('', '_blank');
  try {
    const blob = await state.source.blob(path);
    const url = URL.createObjectURL(blob);
    if (win) win.location = url;
    else {
      const a = document.createElement('a');
      a.href = url;
      a.download = path.split('/').pop();
      document.body.appendChild(a);
      a.click();
      a.remove();
    }
    setTimeout(() => URL.revokeObjectURL(url), 60 * 1000);
  } catch (err) {
    if (win) win.location = state.source.blobUrl(path);
    else window.open(state.source.blobUrl(path), '_blank');
    console.warn('PDF 下載失敗，改開 GitHub：', err);
  }
}

async function refresh() {
  const btn = document.getElementById('refresh');
  btn.classList.add('spin');
  try {
    state.docCache.clear();
    await ensureIndex({ force: true });
    await render();
  } catch (err) {
    $view.firstElementChild.innerHTML = errorCard(err);
  } finally {
    btn.classList.remove('spin');
  }
}

document.addEventListener('click', (e) => {
  const pdfBtn = e.target.closest('[data-pdf]');
  if (pdfBtn) {
    e.preventDefault();
    openPdf(pdfBtn.dataset.pdf);
    return;
  }
  const seg = e.target.closest('[data-seg]');
  if (seg) {
    const page = seg.closest('.page');
    for (const b of page.querySelectorAll('[data-seg]')) {
      const on = b === seg;
      b.classList.toggle('on', on);
      b.setAttribute('aria-selected', String(on));
    }
    for (const p of page.querySelectorAll('[data-panel]')) p.hidden = p.dataset.panel !== seg.dataset.seg;
    return;
  }
  const filt = e.target.closest('[data-filter]');
  if (filt) {
    viewArchive(filt.closest('.page'), filt.dataset.filter);
    return;
  }
  const action = e.target.closest('[data-action]');
  if (!action) return;
  const act = action.dataset.action;
  if (act === 'refresh') refresh();
  if (act === 'toggle-token') {
    const input = document.querySelector('input[name="token"]');
    input.type = input.type === 'password' ? 'text' : 'password';
    action.textContent = input.type === 'password' ? '顯示' : '隱藏';
  }
  if (act === 'clear-cache') {
    clearCache();
    state.docCache.clear();
    state.index = null;
    action.textContent = '已清除';
  }
  if (act === 'reset') {
    state.settings = saveSettings({ ...DEFAULTS }) || { ...DEFAULTS };
    makeSource();
    state.index = null;
    render();
  }
  if (act === 'test') {
    const form = document.getElementById('settings-form');
    const cfg = Object.fromEntries(new FormData(form).entries());
    const out = document.getElementById('test-result');
    out.textContent = '測試中…';
    out.className = 'small';
    const src = new GitHubSource({ ...DEFAULTS, ...cfg, root: String(cfg.root || '').replace(/^\/+|\/+$/g, '') });
    src
      .ping()
      .then(async (info) => {
        const { files } = await src.tree({ force: true });
        const reports = files.filter((f) => /盤前顧問報告|盤後檢討/.test(f.path) && f.path.endsWith('.md')).length;
        out.textContent = `連線成功：${info.fullName}（${info.isPrivate ? '私有' : '公開'}），分支 ${cfg.branch}，找到 ${reports} 份報告；API 剩餘 ${info.rate.remaining}/${info.rate.limit}。`;
        out.className = 'small ok';
      })
      .catch((err) => {
        out.textContent = `失敗：${err.message}`;
        out.className = 'small bad';
      });
  }
});

document.addEventListener('submit', (e) => {
  const form = e.target.closest('#settings-form');
  if (!form) return;
  e.preventDefault();
  const cfg = Object.fromEntries(new FormData(form).entries());
  const saved = saveSettings({ ...DEFAULTS, ...cfg });
  if (!saved) {
    alert('無法儲存設定（瀏覽器儲存空間不可用）。');
    return;
  }
  state.settings = saved;
  makeSource();
  state.index = null;
  state.docCache.clear();
  location.hash = '#/today';
  render();
});

document.getElementById('refresh').addEventListener('click', refresh);
window.addEventListener('hashchange', render);
window.addEventListener('online', () => {
  if (state.offline) refresh();
});

$tabbar.innerHTML = TABS.map(([k, label]) => `<a href="#/${k}" data-route="${k}"><span class="tab-icon tab-${k}" aria-hidden="true"></span>${label}</a>`).join('');

if ('serviceWorker' in navigator && /^https?:/.test(location.protocol)) {
  navigator.serviceWorker.register('./sw.js').catch(() => {});
}

makeSource();
render();
