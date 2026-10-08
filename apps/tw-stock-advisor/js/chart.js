// 戰績折線圖：看漲／看跌命中率（SVG，含 hover／tap 提示與大盤區間命中列）。
import { esc, pct } from './render.js';

const SERIES = [
  { key: 'bullish', label: '看漲命中率', cls: 'up', dash: '' },
  { key: 'bearish', label: '看跌命中率', cls: 'down', dash: '6 4' },
];

function shortDate(d) {
  const m = d.match(/\d{4}-(\d{2})-(\d{2})/);
  return m ? `${Number(m[1])}/${Number(m[2])}` : d;
}

export function renderHitRateChart(container, daily) {
  container.innerHTML = '';
  if (!daily || !daily.length) {
    container.innerHTML = '<p class="muted">尚無每日戰績資料。</p>';
    return;
  }
  const W = 640;
  const H = 260;
  const pad = { l: 44, r: 20, t: 16, b: 56 };
  const iw = W - pad.l - pad.r;
  const ih = H - pad.t - pad.b;
  const n = daily.length;
  const x = (i) => pad.l + (n === 1 ? iw / 2 : (iw * i) / (n - 1));
  const y = (v) => pad.t + ih - (ih * v) / 100;

  const legend = SERIES.map(
    (s) => `<span class="legend-item"><svg width="22" height="10" aria-hidden="true"><line x1="1" y1="5" x2="21" y2="5" class="series-${s.cls}" stroke-width="2" stroke-dasharray="${s.dash}"/><circle cx="11" cy="5" r="3.5" class="series-${s.cls}-fill"/></svg>${s.label}</span>`,
  ).join('');

  let svg = `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="每日看漲與看跌命中率折線圖">`;
  // 網格與 y 軸
  for (const v of [0, 25, 50, 75, 100]) {
    svg += `<line x1="${pad.l}" x2="${W - pad.r}" y1="${y(v)}" y2="${y(v)}" class="grid"/>`;
    svg += `<text x="${pad.l - 8}" y="${y(v) + 4}" class="axis" text-anchor="end">${v}%</text>`;
  }
  // 基準線 50%
  svg += `<line x1="${pad.l}" x2="${W - pad.r}" y1="${y(50)}" y2="${y(50)}" class="grid grid-mid"/>`;
  // x 軸標籤與大盤命中列
  daily.forEach((d, i) => {
    svg += `<text x="${x(i)}" y="${H - pad.b + 20}" class="axis" text-anchor="middle">${esc(shortDate(d.date))}</text>`;
    const glyph = d.rangeHit ? '✓' : '✗';
    const cls = d.rangeHit ? 'mark-hit' : 'mark-miss';
    svg += `<text x="${x(i)}" y="${H - pad.b + 40}" class="axis ${cls}" text-anchor="middle" aria-label="大盤區間${d.rangeHit ? '命中' : '未命中'}">${glyph}</text>`;
  });
  svg += `<text x="${pad.l - 8}" y="${H - pad.b + 40}" class="axis" text-anchor="end">大盤</text>`;
  // 折線
  SERIES.forEach((s) => {
    let path = '';
    let prevOk = false;
    daily.forEach((d, i) => {
      const v = d[s.key] && d[s.key].pct;
      if (v === null || v === undefined) {
        prevOk = false;
        return;
      }
      path += `${prevOk ? 'L' : 'M'}${x(i).toFixed(1)} ${y(v).toFixed(1)} `;
      prevOk = true;
    });
    svg += `<path d="${path}" class="series-${s.cls} line" stroke-dasharray="${s.dash}" fill="none"/>`;
    daily.forEach((d, i) => {
      const v = d[s.key] && d[s.key].pct;
      if (v === null || v === undefined) return;
      svg += `<circle cx="${x(i)}" cy="${y(v)}" r="5" class="series-${s.cls}-fill dot"/>`;
    });
    // 直接標籤：最後一點
    const last = [...daily].reverse().find((d) => d[s.key] && d[s.key].pct !== null && d[s.key].pct !== undefined);
    if (last) {
      const i = daily.indexOf(last);
      const v = last[s.key].pct;
      const anchor = n === 1 || i === n - 1 ? 'end' : 'start';
      const dx = anchor === 'end' ? -10 : 10;
      const dy = s.key === 'bullish' ? -10 : 18;
      svg += `<text x="${x(i) + dx}" y="${y(v) + dy}" class="label" text-anchor="${anchor}">${s.label.slice(0, 2)} ${pct(v)}</text>`;
    }
  });
  // 互動層
  svg += `<line class="crosshair" x1="0" x2="0" y1="${pad.t}" y2="${pad.t + ih}" style="display:none"/>`;
  daily.forEach((d, i) => {
    const left = i === 0 ? pad.l : (x(i - 1) + x(i)) / 2;
    const right = i === n - 1 ? W - pad.r : (x(i) + x(i + 1)) / 2;
    svg += `<rect class="hit" data-i="${i}" x="${left}" y="${pad.t}" width="${Math.max(right - left, 1)}" height="${ih}" fill="transparent"/>`;
  });
  svg += '</svg>';

  container.innerHTML = `<div class="legend">${legend}<span class="legend-item"><span class="mark-hit">✓</span>／<span class="mark-miss">✗</span> 大盤基準區間</span></div>${svg}<div class="tooltip" hidden></div>`;

  const svgEl = container.querySelector('svg');
  const tip = container.querySelector('.tooltip');
  const cross = container.querySelector('.crosshair');
  const show = (i) => {
    const d = daily[i];
    if (!d) return;
    cross.setAttribute('x1', x(i));
    cross.setAttribute('x2', x(i));
    cross.style.display = '';
    const row = (label, r) => `<div><span>${label}</span><strong>${r && r.hit !== null ? `${r.hit}/${r.total}＝${pct(r.pct, 1)}` : '無樣本'}</strong></div>`;
    tip.innerHTML = `<div class="tip-title">${esc(d.date)}</div>${row('看漲', d.bullish)}${row('看跌', d.bearish)}<div><span>大盤</span><strong>${d.rangeHit ? '命中' : '未命中'} ${esc(d.range)}</strong></div><div><span>收盤</span><strong>${esc(d.close)}</strong></div>`;
    tip.hidden = false;
    const rect = svgEl.getBoundingClientRect();
    const px = (x(i) / W) * rect.width;
    const tw = tip.offsetWidth || 160;
    tip.style.left = `${Math.min(Math.max(px - tw / 2, 0), rect.width - tw)}px`;
  };
  const hide = () => {
    tip.hidden = true;
    cross.style.display = 'none';
  };
  svgEl.addEventListener('pointermove', (e) => {
    const t = e.target.closest('.hit');
    if (t) show(Number(t.dataset.i));
  });
  svgEl.addEventListener('pointerleave', hide);
  svgEl.addEventListener('click', (e) => {
    const t = e.target.closest('.hit');
    if (t) show(Number(t.dataset.i));
  });
}
