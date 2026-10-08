// Markdown → 安全 HTML（DOMPurify），以及小型 DOM 工具。
import { marked } from '../vendor/marked.esm.js';
import DOMPurify from '../vendor/purify.es.mjs';

marked.setOptions({ gfm: true, breaks: false });

DOMPurify.addHook('afterSanitizeAttributes', (node) => {
  if (node.tagName === 'A' && node.getAttribute('href')) {
    node.setAttribute('target', '_blank');
    node.setAttribute('rel', 'noopener noreferrer');
  }
});

const PURIFY_OPTS = { USE_PROFILES: { html: true }, ADD_ATTR: ['target'] };

export function sanitize(html) {
  return DOMPurify.sanitize(html, PURIFY_OPTS);
}

export function mdToHtml(md) {
  return sanitize(marked.parse(md || ''));
}

export function tokensToHtml(tokens) {
  if (!tokens || !tokens.length) return '';
  return sanitize(marked.parser(tokens));
}

export function inline(md) {
  return sanitize(marked.parseInline(md || ''));
}

export function esc(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** 由 HTML 字串建立元素（回傳第一個節點）。 */
export function h(html) {
  const tpl = document.createElement('template');
  tpl.innerHTML = html.trim();
  return tpl.content.firstElementChild;
}

export function fmtDate(iso, { weekday = true } = {}) {
  if (!iso) return '';
  const m = iso.match(/(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return iso;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  const wd = ['日', '一', '二', '三', '四', '五', '六'][d.getDay()];
  return `${Number(m[2])}/${Number(m[3])}${weekday ? `（${wd}）` : ''}`;
}

export function fmtDateTime(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleString('zh-TW', { timeZone: 'Asia/Taipei', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false });
}

export function todayTaipei() {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Taipei', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date());
  const get = (t) => parts.find((p) => p.type === t).value;
  return `${get('year')}-${get('month')}-${get('day')}`;
}

export function pct(n, digits = 0) {
  if (n === null || n === undefined || Number.isNaN(n)) return '–';
  return `${Number(n).toFixed(digits)}%`;
}

export const CONF_LABEL = { high: '高', mid: '中', midlow: '中低', low: '低', unknown: '–' };
export const OUTCOME_LABEL = { hit: '命中', miss: '未命中', flat: '平盤', na: '未查得', unknown: '–' };
export const SCENARIO_LABEL = { base: '基準', bull: '樂觀', bear: '悲觀', other: '其他' };
