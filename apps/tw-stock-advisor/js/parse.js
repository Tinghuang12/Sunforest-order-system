// 將兩個 Routine 產出的 Markdown 報告解析成結構化資料。
// 只依賴 marked 的 lexer（無 DOM），可在瀏覽器與 Node 測試中共用。
// 報告由 LLM 產出，欄位與段落名稱會隨 PLAYBOOK 演進而變動；這裡的策略是
// 「以關鍵字找欄位／段落，抓得到就結構化，抓不到就保留原文段落讓畫面照常呈現」。
import { marked } from '../vendor/marked.esm.js';

export const KINDS = {
  premarket: { label: '盤前顧問報告', short: '盤前' },
  postmortem: { label: '盤後檢討', short: '盤後' },
  research: { label: '個股研究', short: '研究' },
  scoreboard: { label: '戰績表', short: '戰績' },
  playbook: { label: 'PLAYBOOK', short: '準則' },
  prompt: { label: '提示詞', short: '提示' },
  other: { label: '文件', short: '文件' },
};

const DATE_RE = /(\d{4})-(\d{2})-(\d{2})/;
const NUM = '\\d{1,3}(?:,\\d{3})+(?:\\.\\d+)?|\\d{4,6}(?:\\.\\d+)?';

/** 由路徑判斷文件種類、日期與標題。 */
export function classifyFile(path) {
  const name = path.split('/').pop() || '';
  const base = name.replace(/\.(md|pdf)$/i, '');
  const ext = (name.match(/\.(md|pdf)$/i) || [, ''])[1].toLowerCase();
  const m = base.match(DATE_RE);
  const date = m ? `${m[1]}-${m[2]}-${m[3]}` : null;
  let kind = 'other';
  if (/盤前顧問報告/.test(base)) kind = 'premarket';
  else if (/盤後檢討/.test(base)) kind = 'postmortem';
  else if (/scoreboard/i.test(base)) kind = 'scoreboard';
  else if (/PLAYBOOK/i.test(base)) kind = 'playbook';
  else if (/PROMPT/i.test(base)) kind = 'prompt';
  else if (/\/research\//.test(path)) kind = 'research';
  const title = date ? base.replace(DATE_RE, '').replace(/^[-_\s]+/, '') : base;
  return { path, name, base, ext, date, kind, title: title || base };
}

export function lex(md) {
  return marked.lexer(md || '');
}

/** 去除行內 Markdown 標記，取得純文字。 */
export function plain(text) {
  return String(text || '')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/__([^_]+)__/g, '$1')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/\\([*_`|])/g, '$1')
    .replace(/<\/?[a-zA-Z][^<>]*>/g, '')
    .trim();
}

/** 以 H2（或 H1）切成區段：{ depth, heading, tokens }。第一個區段為標題前的導言。 */
export function splitSections(tokens, depth = 2) {
  const sections = [];
  let current = { depth: 0, heading: '', tokens: [] };
  let title = '';
  for (const tok of tokens) {
    if (tok.type === 'heading' && tok.depth === 1 && !title) {
      title = plain(tok.text);
      continue;
    }
    if (tok.type === 'heading' && tok.depth <= depth) {
      sections.push(current);
      current = { depth: tok.depth, heading: plain(tok.text), tokens: [] };
      continue;
    }
    current.tokens.push(tok);
  }
  sections.push(current);
  return { title, sections };
}

/** 依關鍵字優先序找區段：先找含第一個關鍵字的區段，找不到再試下一個。 */
export function findSection(sections, keywords) {
  const list = Array.isArray(keywords) ? keywords : [keywords];
  for (const k of list) {
    const hit = sections.find((s) => s.heading.includes(k));
    if (hit) return hit;
  }
  return null;
}

export function firstTable(tokens) {
  return (tokens || []).find((t) => t.type === 'table') || null;
}

export function allTables(tokens) {
  return (tokens || []).filter((t) => t.type === 'table');
}

export function firstList(tokens) {
  return (tokens || []).find((t) => t.type === 'list') || null;
}

export function proseOf(tokens) {
  return (tokens || []).filter((t) => t.type !== 'table' && t.type !== 'space');
}

/** 表格 → 物件陣列；欄位以表頭純文字為鍵，值保留原始行內 Markdown。 */
export function tableToObjects(table) {
  if (!table) return [];
  const headers = table.header.map((h) => plain(h.text));
  return table.rows.map((row) => {
    const obj = { _cells: row.map((c) => c.text) };
    headers.forEach((h, i) => {
      obj[h] = row[i] ? row[i].text : '';
    });
    return obj;
  });
}

/** 表格 → { headers, rows }（原始行內 Markdown），供畫面通用渲染。 */
export function tableData(table) {
  if (!table) return null;
  return {
    headers: table.header.map((h) => plain(h.text)),
    rows: table.rows.map((row) => row.map((c) => c.text)),
  };
}

/** 依關鍵字找欄位值（表頭常是「推理邏輯（含準則編號）」等變體）；關鍵字有優先序。 */
export function col(obj, ...keys) {
  for (const k of keys) {
    for (const key of Object.keys(obj)) {
      if (key !== '_cells' && key.includes(k)) return obj[key];
    }
  }
  return '';
}

/** 同 col，但取「最後一個」符合的欄位（例如「10/7 收｜10/8 收」要取後者）。 */
export function colLast(obj, ...keys) {
  let found = '';
  for (const key of Object.keys(obj)) {
    if (key !== '_cells' && keys.some((k) => key.includes(k))) found = obj[key];
  }
  return found;
}

export function parseRatio(text) {
  const t = plain(text);
  const m = t.match(/(\d+)\s*\/\s*(\d+)/);
  const p = t.match(/(-?\d+(?:\.\d+)?)\s*%/);
  if (!m && !p) return { hit: null, total: null, pct: null, raw: t };
  const hit = m ? Number(m[1]) : null;
  const total = m ? Number(m[2]) : null;
  let pct = p ? Number(p[1]) : null;
  if (pct === null && total) pct = Math.round((hit / total) * 1000) / 10;
  return { hit, total, pct, raw: t };
}

export function parsePercent(text) {
  const m = plain(text).match(/(-?\d+(?:\.\d+)?)\s*%/);
  return m ? Number(m[1]) : null;
}

/** 含正負號的百分比（支援 Unicode 減號「−」與「–」）。 */
export function parseSignedPercent(text) {
  const m = plain(text).match(/([+−–-]?)\s*(\d+(?:\.\d+)?)\s*%/);
  if (!m) return null;
  const sign = m[1] && m[1] !== '+' ? -1 : 1;
  return sign * Number(m[2]);
}

export function parseNumber(text) {
  const t = plain(text).replace(/[,，]/g, '').replace(/[−–]/g, '-');
  const m = t.match(/-?\d+(?:\.\d+)?/);
  return m ? Number(m[0]) : null;
}

/** 從文字抓點位區間：「49,300–49,800」或「≥44,920」「<44,000」。 */
export function extractRange(text) {
  const t = plain(text).replace(/\s+/g, ' ');
  let m = t.match(new RegExp(`(${NUM})\\s*[–—-]\\s*(${NUM})`));
  if (m) return `${m[1]}–${m[2]}`;
  m = t.match(new RegExp(`([<>≥≤＜＞]=?)\\s*(${NUM})`));
  if (m) return `${m[1]}${m[2]}`;
  return '';
}

export function confidenceLevel(text) {
  const t = plain(text);
  const lead = t.match(/^[\s*「]*(中高|中低|高|中|低)/);
  const key = lead ? lead[1] : (t.match(/中低|中高|高|中|低/) || [''])[0];
  switch (key) {
    case '高':
    case '中高':
      return 'high';
    case '中低':
      return 'midlow';
    case '中':
      return 'mid';
    case '低':
      return 'low';
    default:
      return 'unknown';
  }
}

export function direction(text) {
  const t = plain(text);
  if (/漲|多/.test(t)) return 'up';
  if (/跌|空/.test(t)) return 'down';
  return 'neutral';
}

export function outcome(text) {
  const t = plain(text);
  if (!t) return 'unknown';
  if (/未命中|落空/.test(t)) return 'miss';
  if (/平盤/.test(t)) return 'flat';
  if (/不計|未查得|不評|無法|不入|不適用/.test(t)) return 'na';
  if (/命中/.test(t)) return 'hit';
  return 'unknown';
}

export function scenarioKind(name) {
  if (/基準|主區間|主判斷/.test(name)) return 'base';
  if (/樂觀|收漲|反彈/.test(name)) return 'bull';
  if (/悲觀|深跌|收跌/.test(name)) return 'bear';
  return 'other';
}

/** 從一段文字抓「主判斷」：{ text, prob }。 */
export function verdictFrom(text) {
  const t = plain(text).replace(/\s+/g, ' ');
  if (!t) return null;
  let m = t.match(/主判斷[^：:\n]{0,12}[：:]\s*([^，,。；;（(\n%]{1,20}?)\s*(?:[（(][^）)]*[）)])?\s*[，,]?\s*(?:機率\s*)?(\d{2,3})\s*%/);
  if (m) return { text: m[1].trim(), prob: Number(m[2]) };
  m = t.match(/主判斷[（(]([^）)]{1,12})[）)]\s*[=＝][^%\n]{0,40}?(\d{2,3})\s*%/);
  if (m) return { text: m[1].trim(), prob: Number(m[2]) };
  m = t.match(/主判斷[^：:\n]{0,12}[：:]\s*([^，,。；;（(\n]{1,40})/);
  if (m) return { text: m[1].trim(), prob: null };
  m = t.match(/^\s*(收跌|收漲|無優勢[^\d（(，,]{0,10})\s*(\d{2,3})\s*%/);
  if (m) return { text: m[1].trim(), prob: Number(m[2]) };
  m = t.match(/(收跌|收漲)[^。\n]{0,40}?機率\s*(\d{2,3})\s*%/);
  if (m) return { text: m[1], prob: Number(m[2]) };
  return null;
}

function flattenListText(tokens, out = []) {
  for (const t of tokens || []) {
    if (t.type === 'list') {
      for (const item of t.items) {
        const own = (item.tokens || []).filter((x) => x.type !== 'list').map((x) => x.raw || x.text || '').join(' ');
        out.push(own || item.text);
        flattenListText(item.tokens, out);
      }
    } else if (t.type === 'paragraph') out.push(t.text);
  }
  return out;
}

function dateFromTitle(title, fallback) {
  const m = (title || '').match(DATE_RE);
  return m ? `${m[1]}-${m[2]}-${m[3]}` : fallback || null;
}

function intro(sections) {
  return sections[0] ? sections[0].tokens : [];
}

function splitName(raw) {
  const t = plain(raw);
  const m = t.match(/^([^（(]+)[（(](.*?)[）)]?\s*$/);
  return m ? { name: m[1].trim(), note: m[2].trim() } : { name: t, note: '' };
}

/** 未被特別處理的區段（保留給畫面以原文呈現）。 */
function leftovers(sections, used) {
  return sections.filter((s, i) => i > 0 && !used.has(s) && s.heading && !/免責/.test(s.heading));
}

function stockRows(table) {
  return tableToObjects(table).map((r) => {
    const conf = col(r, '信心');
    const { name, note } = splitName(col(r, '名稱'));
    return {
      code: plain(col(r, '代碼', '代號')),
      name,
      nameNote: note,
      catalyst: col(r, '催化劑'),
      logic: col(r, '推理', '邏輯'),
      confidence: plain(conf),
      level: confidenceLevel(conf),
      prob: parsePercent(conf),
      target: col(r, '目標', '失效'),
      risk: col(r, '風險'),
    };
  });
}

/** 情境表 → 情境列。支援「情境｜機率｜區間｜條件」與「項目｜內容」兩種寫法。 */
function scenarioRows(table) {
  if (!table) return [];
  const hasScn = table.header.some((h) => /情境/.test(h.text));
  const rows = tableToObjects(table);
  if (hasScn) {
    return rows.map((r) => {
      const name = plain(col(r, '情境'));
      const rangeCell = col(r, '區間', '點位');
      const condCell = col(r, '條件', '邏輯');
      return {
        name: name.replace(/[（(][^）)]*[）)]/g, '').trim(),
        kind: scenarioKind(name),
        prob: parsePercent(col(r, '機率')),
        range: extractRange(rangeCell) || extractRange(condCell) || plain(rangeCell),
        logic: condCell,
      };
    });
  }
  // 項目｜內容：只取基準／悲觀／樂觀列
  return rows
    .filter((r) => /基準|悲觀|樂觀/.test(plain(col(r, '項目', '情境'))))
    .map((r) => {
      const item = plain(col(r, '項目', '情境'));
      const content = col(r, '內容', '說明', '條件');
      return {
        name: item.replace(/[（(][^）)]*[）)]/g, '').trim(),
        kind: scenarioKind(item),
        prob: parsePercent(item) ?? parsePercent(content),
        range: extractRange(content),
        logic: content,
      };
    });
}

/** 沒有情境表時，從條列文字抓「基準 47,500–48,300：48%」這類句子。 */
function scenariosFromText(tokens) {
  const seen = new Set();
  const out = [];
  for (const line of flattenListText(tokens)) {
    const t = plain(line);
    const m = t.match(/^(基準|悲觀|樂觀)[^：:]{0,30}?[：:]?\s*[^%]{0,20}?(\d{2,3})\s*%/);
    if (!m || seen.has(m[1])) continue;
    seen.add(m[1]);
    out.push({ name: m[1], kind: scenarioKind(m[1]), prob: Number(m[2]), range: extractRange(t), logic: t.replace(/^[^：:]*[：:]\s*/, '') });
  }
  return out;
}

/** 盤前顧問報告 */
export function parsePremarket(md, meta = {}) {
  const tokens = lex(md);
  const { title, sections } = splitSections(tokens);
  const used = new Set();
  const pick = (keys) => {
    const s = findSection(sections, keys);
    if (s) used.add(s);
    return s;
  };
  const adopted = pick(['採納']);
  const highlights = pick(['隔夜', '今晨', '重點']);
  const bigshots = pick(['大咖']);
  const sectors = pick(['產業族群', '族群']);
  const reasoning = pick(['推理摘要']);
  const bull = pick(['看漲']);
  const bear = pick(['看跌']);
  const market = pick(['大盤情境', '大盤']);
  const searchLog = pick(['搜尋紀錄']);
  const notes = pick(['附註']);
  const disclaimer = pick(['免責']);

  let marketInfo = null;
  if (market) {
    const table = firstTable(market.tokens);
    const kv = table && !table.header.some((h) => /情境/.test(h.text)) ? tableToObjects(table) : [];
    const kvRow = (re) => {
      const r = kv.find((x) => re.test(plain(col(x, '項目', '情境'))));
      return r ? col(r, '內容', '說明', '條件') : '';
    };
    const text = flattenListText(market.tokens).map(plain).join('\n');
    const verdictSec = findSection(sections, ['主判斷']);
    const candidates = [
      verdictFrom(text),
      verdictFrom(kvRow(/主判斷/)),
      verdictSec ? verdictFrom(flattenListText(verdictSec.tokens).map(plain).join('\n')) : null,
    ].filter(Boolean);
    const verdict = candidates.find((v) => v.prob !== null) || candidates[0] || null;
    let scenarios = scenarioRows(table);
    if (scenarios.length < 3) scenarios = scenariosFromText(market.tokens).length >= scenarios.length ? scenariosFromText(market.tokens) : scenarios;
    const o = text.match(/開盤(?:預估|區間|方向推測|方向|預測)[^：:\n]*[：:]\s*([^\n]{1,120})/);
    marketInfo = {
      heading: market.heading,
      tokens: market.tokens,
      scenarios,
      prose: proseOf(market.tokens),
      verdict,
      opening: o ? o[1].trim() : plain(kvRow(/開盤/)).slice(0, 120),
    };
  }

  return {
    kind: 'premarket',
    title,
    date: dateFromTitle(title, meta.date),
    intro: intro(sections),
    adopted: adopted ? adopted.tokens : [],
    highlights: highlights ? highlights.tokens : [],
    highlightItems: highlights && firstList(highlights.tokens) ? firstList(highlights.tokens).items.map((i) => i.text) : [],
    bigshots: bigshots ? bigshots.tokens : [],
    sectors: sectors ? sectors.tokens : [],
    reasoning: reasoning ? reasoning.tokens : [],
    bullish: bull ? stockRows(firstTable(bull.tokens)) : [],
    bearish: bear ? stockRows(firstTable(bear.tokens)) : [],
    bullishExtra: bull ? proseOf(bull.tokens) : [],
    bearishExtra: bear ? proseOf(bear.tokens) : [],
    market: marketInfo,
    searchLog: searchLog ? searchLog.tokens : [],
    notes: notes ? notes.tokens : [],
    disclaimer: disclaimer ? disclaimer.tokens : [],
    others: leftovers(sections, used),
    sections,
  };
}

/** 盤後檢討 */
export function parsePostmortem(md, meta = {}) {
  const tokens = lex(md);
  const { title, sections } = splitSections(tokens);
  const used = new Set();
  const pick = (keys) => {
    const s = findSection(sections, keys);
    if (s) used.add(s);
    return s;
  };
  const summarySec = pick(['實際結果', '摘要']);
  const marketSec = pick(['大盤對照', '大盤']);
  const scoreSec = pick(['個股評分', '評分']);
  const reflectSec = pick(['未命中案例', '案例反省', '反省']);
  const rulesSec = pick(['準則檢驗']);
  const adviceSec = pick(['修正建議', '建議']);
  pick(['免責']);

  const summary = tableToObjects(firstTable(summarySec ? summarySec.tokens : [])).map((r) => ({
    item: plain(col(r, '項目')),
    value: col(r, '數據', '數值', '內容'),
    source: col(r, '來源'),
  }));

  // 大盤對照：舊版為「情境｜預測區間｜機率｜結果」，新版為「項目｜預測｜實際｜判定」等自由表格。
  let marketCheck = [];
  let marketTable = null;
  if (marketSec) {
    const scnTable = allTables(marketSec.tokens).find((t) => t.header.some((h) => /情境/.test(h.text)));
    if (scnTable) {
      marketCheck = tableToObjects(scnTable).map((r) => {
        const name = plain(col(r, '情境'));
        const result = col(r, '結果', '判定');
        const res = plain(result);
        return {
          name,
          kind: scenarioKind(name),
          range: extractRange(col(r, '區間', '預測')) || plain(col(r, '區間', '預測')),
          prob: parsePercent(col(r, '機率')),
          result,
          hit: /命中/.test(res) && !/未命中/.test(res),
        };
      });
    } else {
      marketTable = tableData(firstTable(marketSec.tokens));
    }
  }
  const marketText = marketSec ? marketSec.tokens.map((t) => plain(t.raw || t.text || '')).join('\n') : '';
  const marketDirHit = /方向命中|方向[^，。）]{0,8}命中/.test(marketText) ? true : /方向[^，。）]{0,8}(未命中|落空)/.test(marketText) ? false : null;
  const marketRangeHit = marketCheck.length
    ? marketCheck.some((s) => s.kind === 'base' && s.hit)
    : /區間命中|基準區間[^。\n]{0,30}命中/.test(marketText) && !/區間未命中|基準區間[^。\n]{0,30}未命中/.test(marketText)
      ? true
      : /區間未命中|未命中[^。\n]{0,10}區間|區間[^。\n]{0,10}未命中/.test(marketText)
        ? false
        : null;

  const scores = tableToObjects(firstTable(scoreSec ? scoreSec.tokens : [])).map((r) => {
    const res = col(r, '判定', '結果');
    const changeCell = col(r, '實際漲跌', '漲跌幅', '漲跌');
    let close = plain(colLast(r, '收'));
    if (close.includes('→')) close = close.split('→').pop().trim();
    if (!close && /、/.test(plain(changeCell))) close = plain(changeCell).split('、')[0].trim();
    const conf = col(r, '信心');
    const { name, note } = splitName(col(r, '名稱'));
    return {
      code: plain(col(r, '代碼', '代號')),
      name,
      nameNote: note,
      direction: direction(col(r, '方向')),
      directionText: plain(col(r, '方向')).split(/[（(]/)[0].trim(),
      confidence: plain(conf),
      level: confidenceLevel(conf),
      prob: parsePercent(conf),
      rules: plain(col(r, '準則')),
      close,
      change: plain(changeCell),
      changePct: parseSignedPercent(changeCell),
      result: res,
      outcome: outcome(res),
    };
  });

  const tally = (rows) => {
    const scored = rows.filter((s) => s.outcome === 'hit' || s.outcome === 'miss');
    const hit = scored.filter((s) => s.outcome === 'hit').length;
    return { hit, total: scored.length, pct: scored.length ? Math.round((hit / scored.length) * 1000) / 10 : null };
  };
  const stats = {
    bullish: tally(scores.filter((s) => s.direction === 'up')),
    bearish: tally(scores.filter((s) => s.direction === 'down')),
    overall: tally(scores),
    high: tally(scores.filter((s) => s.level === 'high')),
    mid: tally(scores.filter((s) => s.level === 'mid' || s.level === 'midlow')),
    low: tally(scores.filter((s) => s.level === 'low')),
    flat: scores.filter((s) => s.outcome === 'flat').length,
    na: scores.filter((s) => s.outcome === 'na' || s.outcome === 'unknown').length,
  };

  const adviceList = adviceSec ? firstList(adviceSec.tokens) : null;

  return {
    kind: 'postmortem',
    title,
    date: dateFromTitle(title, meta.date),
    tag: (title.match(/【([^】]+)】/) || [, ''])[1],
    intro: intro(sections),
    summary,
    marketCheck,
    marketTable,
    marketRangeHit,
    marketDirHit,
    marketNotes: marketSec ? proseOf(marketSec.tokens) : [],
    scores,
    scoreNotes: scoreSec ? proseOf(scoreSec.tokens) : [],
    stats,
    reflections: reflectSec ? reflectSec.tokens : [],
    ruleChecks: tableData(firstTable(rulesSec ? rulesSec.tokens : [])),
    ruleNotes: rulesSec ? proseOf(rulesSec.tokens) : [],
    advice: adviceList ? adviceList.items.map((i) => i.text) : [],
    adviceTokens: adviceSec ? adviceSec.tokens : [],
    others: leftovers(sections, used),
    sections,
  };
}

/** scoreboard.md */
export function parseScoreboard(md) {
  const tokens = lex(md);
  const { title, sections } = splitSections(tokens);
  const dailyTable = firstTable(sections[0] ? sections[0].tokens : []) || firstTable(tokens);
  const daily = tableToObjects(dailyTable)
    .map((r) => {
      const rangeCell = plain(col(r, '大盤基準區間', '區間'));
      const hitText = plain(col(r, '區間命中', '命中'));
      const both = `${hitText}｜${rangeCell}`;
      const dirHit = /方向[^，。）]{0,8}命中|是（方向/.test(both) ? true : /方向[^，。）]{0,8}(未命中|落空)|否（方向/.test(both) ? false : null;
      return {
        date: plain(col(r, '日期')),
        range: extractRange(rangeCell) || rangeCell,
        rangeNote: (rangeCell.match(/[（(](.*)[）)]/) || [, ''])[1],
        close: plain(col(r, '實際收盤', '收盤')),
        closeNum: parseNumber(col(r, '實際收盤', '收盤')),
        rangeHitText: hitText,
        rangeHit: /^是/.test(hitText) || (/命中/.test(hitText) && !/未命中|否/.test(hitText)),
        dirHit,
        bullish: parseRatio(col(r, '看漲')),
        bearish: parseRatio(col(r, '看跌')),
        high: parseRatio(col(r, '高信心')),
        mid: parseRatio(col(r, '中信心')),
        low: parseRatio(col(r, '低信心')),
      };
    })
    .filter((r) => DATE_RE.test(r.date))
    .sort((a, b) => (a.date < b.date ? -1 : 1));

  const totalsSec = findSection(sections, ['累計']);
  const totals = tableToObjects(firstTable(totalsSec ? totalsSec.tokens : [])).map((r) => ({
    item: plain(col(r, '項目')),
    ratio: parseRatio(col(r, '命中／總數', '命中/總數', '總數')),
    pct: parsePercent(col(r, '命中率')),
    pctText: plain(col(r, '命中率')),
  }));
  const totalsNotes = totalsSec ? proseOf(totalsSec.tokens) : [];

  return { kind: 'scoreboard', title, daily, totals, totalsNotes, intro: intro(sections), sections };
}

/** PLAYBOOK.md */
export function parsePlaybook(md) {
  const tokens = lex(md);
  const { title, sections } = splitSections(tokens);
  const versionTok = tokens.find((t) => t.type === 'blockquote');
  const versionText = versionTok ? plain(versionTok.text) : '';
  const version = (versionText.match(/v\d+(?:\.\d+)*/) || [''])[0];

  const validSec = findSection(sections, ['有效訊號']);
  const pendingSec = findSection(sections, ['待驗證']);
  const invalidSec = findSection(sections, ['無效訊號']);
  const processSec = findSection(sections, ['流程準則']);

  const ruleRows = (sec) =>
    tableToObjects(firstTable(sec ? sec.tokens : [])).map((r) => ({
      id: plain(col(r, '編號')),
      rule: col(r, '準則'),
      direction: plain(col(r, '方向')),
      status: plain(col(r, '狀態')),
    }));

  // 樣本紀錄：在待驗證區段內、表頭含「支持」的那張表。
  const sampleTable = pendingSec ? allTables(pendingSec.tokens).find((t) => t.header.some((h) => /支持/.test(h.text))) : null;
  const samples = tableToObjects(sampleTable).map((r) => ({
    id: plain(col(r, '準則')),
    support: parseNumber(col(r, '支持')) || 0,
    against: parseNumber(col(r, '反證')) || 0,
    days: plain(col(r, '獨立樣本')),
    notes: col(r, '紀錄', '說明'),
  }));
  const calibration = pendingSec
    ? pendingSec.tokens.filter((t) => t.type === 'paragraph' && /校準/.test(t.text)).map((t) => t.text)
    : [];

  const procList = processSec ? processSec.tokens.filter((t) => t.type === 'list') : [];
  const process = [];
  for (const list of procList) {
    for (const item of list.items) {
      const text = item.text;
      const m = text.match(/^(F-\d+)(（[^）]*）)?\s*[:：]\s*/);
      process.push({
        id: m ? m[1] : '',
        note: m && m[2] ? m[2].replace(/[（）]/g, '') : '',
        text: m ? text.slice(m[0].length) : text,
      });
    }
  }
  process.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));

  return {
    kind: 'playbook',
    title,
    version,
    versionText,
    valid: ruleRows(validSec),
    validTokens: validSec ? validSec.tokens : [],
    pending: ruleRows(pendingSec),
    invalid: ruleRows(invalidSec),
    invalidTokens: invalidSec ? invalidSec.tokens : [],
    samples,
    calibration,
    process,
    sections,
  };
}

/** 解析任意文件（依種類分派）。 */
export function parseDoc(kind, md, meta) {
  switch (kind) {
    case 'premarket':
      return parsePremarket(md, meta);
    case 'postmortem':
      return parsePostmortem(md, meta);
    case 'scoreboard':
      return parseScoreboard(md);
    case 'playbook':
      return parsePlaybook(md);
    default: {
      const tokens = lex(md);
      const { title, sections } = splitSections(tokens);
      return { kind, title, sections, intro: intro(sections) };
    }
  }
}
