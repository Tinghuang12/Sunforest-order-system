// 將兩個 Routine 產出的 Markdown 報告解析成結構化資料。
// 只依賴 marked 的 lexer（無 DOM），可在瀏覽器與 Node 測試中共用。
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
    .replace(/<[^>]+>/g, '')
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

export function findSection(sections, keywords) {
  const list = Array.isArray(keywords) ? keywords : [keywords];
  return sections.find((s) => list.some((k) => s.heading.includes(k))) || null;
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

/** 依關鍵字找欄位值（表頭可能是「推理邏輯（含準則編號）」等變體）。 */
export function col(obj, ...keys) {
  for (const key of Object.keys(obj)) {
    if (key === '_cells') continue;
    if (keys.some((k) => key.includes(k))) return obj[key];
  }
  return '';
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

export function parseNumber(text) {
  const t = plain(text).replace(/[,，]/g, '').replace(/[−–]/g, '-');
  const m = t.match(/-?\d+(?:\.\d+)?/);
  return m ? Number(m[0]) : null;
}

export function confidenceLevel(text) {
  const t = plain(text);
  if (/高/.test(t)) return 'high';
  if (/中低/.test(t)) return 'midlow';
  if (/中/.test(t)) return 'mid';
  if (/低/.test(t)) return 'low';
  return 'unknown';
}

export function direction(text) {
  const t = plain(text);
  if (/漲|多/.test(t)) return 'up';
  if (/跌|空/.test(t)) return 'down';
  return 'neutral';
}

export function outcome(text) {
  const t = plain(text);
  if (/未命中/.test(t)) return 'miss';
  if (/命中/.test(t)) return 'hit';
  if (/平盤/.test(t)) return 'flat';
  if (/未查得|無法|不計/.test(t)) return 'na';
  return 'unknown';
}

function dateFromTitle(title, fallback) {
  const m = (title || '').match(DATE_RE);
  return m ? `${m[1]}-${m[2]}-${m[3]}` : fallback || null;
}

function intro(sections) {
  return sections[0] ? sections[0].tokens : [];
}

function stockRows(table) {
  return tableToObjects(table).map((r) => ({
    code: plain(col(r, '代碼', '代號')),
    name: plain(col(r, '名稱')),
    catalyst: col(r, '催化劑'),
    logic: col(r, '推理', '邏輯'),
    confidence: plain(col(r, '信心')),
    level: confidenceLevel(col(r, '信心')),
    risk: col(r, '風險'),
  }));
}

/** 盤前顧問報告 */
export function parsePremarket(md, meta = {}) {
  const tokens = lex(md);
  const { title, sections } = splitSections(tokens);
  const bull = findSection(sections, '看漲');
  const bear = findSection(sections, '看跌');
  const market = findSection(sections, ['大盤情境', '大盤']);
  const highlights = findSection(sections, ['隔夜', '今晨', '重點']);
  const adopted = findSection(sections, ['採納', '修正建議']);
  const bigshots = findSection(sections, ['大咖']);
  const searchLog = findSection(sections, ['搜尋紀錄']);
  const notes = findSection(sections, ['附註']);
  const disclaimer = findSection(sections, ['免責']);

  let scenarios = [];
  if (market) {
    scenarios = tableToObjects(firstTable(market.tokens)).map((r) => {
      const name = plain(col(r, '情境'));
      return {
        name,
        kind: /基準/.test(name) ? 'base' : /樂觀/.test(name) ? 'bull' : /悲觀/.test(name) ? 'bear' : 'other',
        prob: parsePercent(col(r, '機率')),
        range: plain(col(r, '區間', '點位')),
        logic: col(r, '條件', '邏輯'),
      };
    });
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
    bullish: bull ? stockRows(firstTable(bull.tokens)) : [],
    bearish: bear ? stockRows(firstTable(bear.tokens)) : [],
    bullishExtra: bull ? bull.tokens.filter((t) => t.type !== 'table' && t.type !== 'space') : [],
    bearishExtra: bear ? bear.tokens.filter((t) => t.type !== 'table' && t.type !== 'space') : [],
    market: market
      ? {
          heading: market.heading,
          tokens: market.tokens,
          scenarios,
          prose: market.tokens.filter((t) => t.type !== 'table' && t.type !== 'space'),
        }
      : null,
    searchLog: searchLog ? searchLog.tokens : [],
    notes: notes ? notes.tokens : [],
    disclaimer: disclaimer ? disclaimer.tokens : [],
    sections,
  };
}

/** 盤後檢討 */
export function parsePostmortem(md, meta = {}) {
  const tokens = lex(md);
  const { title, sections } = splitSections(tokens);
  const summarySec = findSection(sections, ['實際結果', '摘要']);
  const marketSec = findSection(sections, ['大盤對照']);
  const scoreSec = findSection(sections, ['個股評分']);
  const reflectSec = findSection(sections, ['反省']);
  const rulesSec = findSection(sections, ['準則檢驗']);
  const adviceSec = findSection(sections, ['修正建議', '建議']);

  const summary = tableToObjects(firstTable(summarySec ? summarySec.tokens : [])).map((r) => ({
    item: plain(col(r, '項目')),
    value: col(r, '數值', '內容'),
  }));

  const marketCheck = tableToObjects(firstTable(marketSec ? marketSec.tokens : [])).map((r) => {
    const name = plain(col(r, '情境'));
    const result = col(r, '結果');
    return {
      name,
      kind: /基準/.test(name) ? 'base' : /樂觀/.test(name) ? 'bull' : /悲觀/.test(name) ? 'bear' : 'other',
      range: plain(col(r, '區間')),
      prob: parsePercent(col(r, '機率')),
      result,
      hit: /命中/.test(plain(result)) && !/未命中/.test(plain(result)),
    };
  });

  const scores = tableToObjects(firstTable(scoreSec ? scoreSec.tokens : [])).map((r) => {
    const res = col(r, '結果');
    return {
      code: plain(col(r, '代碼', '代號')),
      name: plain(col(r, '名稱')),
      direction: direction(col(r, '方向')),
      directionText: plain(col(r, '方向')),
      confidence: plain(col(r, '信心')),
      level: confidenceLevel(col(r, '信心')),
      rules: plain(col(r, '準則')),
      close: plain(col(r, '收盤')),
      change: plain(col(r, '漲跌')),
      changePct: parseNumber(col(r, '漲跌')),
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

  const ruleChecks = tableToObjects(firstTable(rulesSec ? rulesSec.tokens : [])).map((r) => ({
    rule: plain(col(r, '準則')),
    cases: col(r, '案例'),
    verdict: plain(col(r, '結論')),
    tally: col(r, '累計'),
  }));

  const adviceList = adviceSec ? firstList(adviceSec.tokens) : null;

  return {
    kind: 'postmortem',
    title,
    date: dateFromTitle(title, meta.date),
    tag: (title.match(/【([^】]+)】/) || [, ''])[1],
    intro: intro(sections),
    summary,
    marketCheck,
    marketNotes: marketSec ? marketSec.tokens.filter((t) => t.type !== 'table' && t.type !== 'space') : [],
    scores,
    scoreNotes: scoreSec ? scoreSec.tokens.filter((t) => t.type !== 'table' && t.type !== 'space') : [],
    stats,
    reflections: reflectSec ? reflectSec.tokens : [],
    ruleChecks,
    advice: adviceList ? adviceList.items.map((i) => i.text) : [],
    adviceTokens: adviceSec ? adviceSec.tokens : [],
    sections,
  };
}

/** scoreboard.md */
export function parseScoreboard(md) {
  const tokens = lex(md);
  const { title, sections } = splitSections(tokens);
  const dailyTable = firstTable(sections[0] ? sections[0].tokens : []) || firstTable(tokens);
  const daily = tableToObjects(dailyTable)
    .map((r) => ({
      date: plain(col(r, '日期')),
      range: plain(col(r, '區間')),
      close: plain(col(r, '實際收盤', '收盤')),
      closeNum: parseNumber(col(r, '實際收盤', '收盤')),
      rangeHitText: plain(col(r, '區間命中', '命中')),
      rangeHit: /^是|命中/.test(plain(col(r, '區間命中'))) && !/未命中|否/.test(plain(col(r, '區間命中'))),
      bullish: parseRatio(col(r, '看漲')),
      bearish: parseRatio(col(r, '看跌')),
      high: parseRatio(col(r, '高信心')),
      mid: parseRatio(col(r, '中信心')),
      low: parseRatio(col(r, '低信心')),
    }))
    .filter((r) => DATE_RE.test(r.date))
    .sort((a, b) => (a.date < b.date ? -1 : 1));

  const totalsSec = findSection(sections, ['累計']);
  const totals = tableToObjects(firstTable(totalsSec ? totalsSec.tokens : [])).map((r) => ({
    item: plain(col(r, '項目')),
    ratio: parseRatio(col(r, '命中／總數', '命中/總數', '總數')),
    pct: parsePercent(col(r, '命中率')),
    pctText: plain(col(r, '命中率')),
  }));
  const totalsNotes = totalsSec ? totalsSec.tokens.filter((t) => t.type !== 'table' && t.type !== 'space') : [];

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

  // 樣本紀錄：在待驗證區段內的第二張表（H3 子標題）
  const sampleTable = pendingSec ? allTables(pendingSec.tokens).find((t) => t.header.some((h) => /支持/.test(h.text))) : null;
  const samples = tableToObjects(sampleTable).map((r) => ({
    id: plain(col(r, '準則')),
    support: parseNumber(col(r, '支持')) || 0,
    against: parseNumber(col(r, '反證')) || 0,
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
