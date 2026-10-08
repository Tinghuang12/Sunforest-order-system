// 解析器測試。內建小型樣本；若設定 TW_STOCK_REPORTS_DIR（指向 tw-stock-reports 本地 clone），
// 另以真實報告做煙霧測試。執行：node --test apps/tw-stock-advisor/test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import {
  classifyFile, parsePremarket, parsePostmortem, parseScoreboard, parsePlaybook, parseRatio, plain,
} from '../js/parse.js';

const PREMARKET = `# 台股盤前顧問報告 — 2026-10-08（週四）

> **產出時間**：07:30。

## 一、隔夜與今晨重點

1. **美股回檔**：道瓊 −0.7%。
2. 殖利率新高。

## 二、看漲候選（2 檔）

| 代碼 | 名稱 | 催化劑 | 推理邏輯（含準則編號） | 信心 | 主要風險 |
|---|---|---|---|---|---|
| 2327 | 國巨 | MLCC 吃緊 | P-04 | 中低 | 大盤回檔 |
| 2408 | 南亞科 | DRAM 合約價 | P-03、P-06 | 低 | 法說前 |

## 三、看跌候選（1 檔）

| 代碼 | 名稱 | 催化劑 | 推理邏輯（含準則編號） | 信心 | 主要風險 |
|---|---|---|---|---|---|
| 2059 | 川湖 | 營收月減 | 急單退潮 | 中低 | 反彈 |

## 四、大盤情境（10/8 週四）

**開盤方向推測**：小幅開低。

| 情境 | 機率 | 收盤區間 | 條件與邏輯 |
|---|---|---|---|
| **基準** | 45% | **49,300–49,800** | 整理 |
| **悲觀** | 35% | **48,700–49,300** | 補跌 |
| **樂觀** | 20% | **49,800–50,250** | 回補 |

## 五、免責聲明

非投資建議。
`;

const POSTMORTEM = `# 台股盤後檢討 — 2026-10-08（週四）

## 一、實際結果摘要

| 項目 | 數值 |
|---|---|
| 加權指數 | **收 49,313.44（−0.99%）** |
| 台積電 | 收 2,550 |

## 二、大盤對照

| 情境 | 預測區間 | 機率 | 結果 |
|---|---|---|---|
| 基準 | 49,300–49,800 | 45% | **命中** |
| 悲觀 | 48,700–49,300 | 35% | 未進入 |

## 三、個股評分表

| 代碼 | 名稱 | 方向 | 信心 | 引用準則 | 收盤 | 實際漲跌 | 結果 |
|---|---|---|---|---|---|---|---|
| 2327 | 國巨 | 看漲 | 中低 | P-04 | 635 | −1.85% | **未命中** |
| 2408 | 南亞科 | 看漲 | 低 | P-03 | 532 | +3.50% | 命中 |
| 2059 | 川湖 | 看跌 | 中低 | P-05 | 10,615 | −9.97% | 命中 |
| 2330 | 台積電 | 看漲 | 中 | P-01 | 2,585 | 0.00% | 平盤（不計） |

## 四、未命中案例反省（三問）

**2327 國巨**
1. 依據。

## 五、準則檢驗表

| 準則 | 本日案例 | 結論 | 累計（支持/反證） |
|---|---|---|---|
| P-01 | 台積電 | 支持 | 1/0 |

## 六、明日給盤前顧問的三條具體修正建議

1. **輪動股隔日回吐檢查**：不列看漲。
2. **看跌優先於看漲**。
`;

const SCOREBOARD = `# 戰績表（scoreboard）

| 日期 | 大盤基準區間 | 實際收盤 | 區間命中 | 看漲命中 | 看跌命中 | 高信心 | 中信心 | 低信心 |
|---|---|---|---|---|---|---|---|---|
| 2026-10-07 | 49,650–50,150 | 49,806.37 | 是 | 1/6＝16.7%（平盤不計） | 2/4＝50% | –（無樣本） | 3/7＝42.9% | 0/3＝0% |
| 2026-10-08 | 49,300–49,800 | 49,313.44 | 是（邊緣） | 2/5＝40% | 3/4＝75% | –（無樣本） | 2/3＝66.7% | 3/6＝50% |

## 累計

| 項目 | 命中／總數 | 命中率 |
|---|---|---|
| 大盤基準區間 | 2/2 | 100% |
| 看漲個股 | 3/11 | 27.3% |
`;

const PLAYBOOK = `# 台股每日顧問 PLAYBOOK（策略準則）

> 版本：v0.3（2026-10-08）

## 一、有效訊號（已驗證）

（尚無。）

## 二、待驗證準則（初始假設）

| 編號 | 準則 | 適用方向 | 狀態 |
|---|---|---|---|
| P-01 | ADR 已反映。 | 多 | 待驗證 |
| P-02 | 法人賣超。 | 空／大盤 | 待驗證 |

### 樣本紀錄

| 準則 | 支持 | 反證 | 紀錄 |
|---|---|---|---|
| P-01 | 2 | 0 | 10-07、10-08 |
| P-02 | 2 | 1 | 10-07 |

信心校準：累計無高信心樣本。

## 三、無效訊號（已驗證無效）

（尚無。）

## 四、流程準則

- F-01：每檔個股必須有依據。
- F-04（使用者 2026-10-06 指示）：**同時輸出 PDF**。
- F-02：大盤情境必須給點位。
`;

test('classifyFile 判斷種類與日期', () => {
  const a = classifyFile('docs/stocks/daily/2026-10-08-盤前顧問報告.md');
  assert.equal(a.kind, 'premarket');
  assert.equal(a.date, '2026-10-08');
  assert.equal(classifyFile('docs/stocks/daily/2026-10-08-盤後檢討.pdf').kind, 'postmortem');
  assert.equal(classifyFile('docs/stocks/daily/scoreboard.md').kind, 'scoreboard');
  assert.equal(classifyFile('docs/stocks/advisor/PLAYBOOK.md').kind, 'playbook');
  const r = classifyFile('docs/stocks/research/2026-10-06-創意3443-飆漲原因拆解.md');
  assert.equal(r.kind, 'research');
  assert.equal(r.title, '創意3443-飆漲原因拆解');
});

test('parseRatio 解析命中率寫法', () => {
  assert.deepEqual(parseRatio('1/6＝16.7%（平盤不計）'), { hit: 1, total: 6, pct: 16.7, raw: '1/6＝16.7%（平盤不計）' });
  assert.equal(parseRatio('–（無樣本）').hit, null);
  assert.equal(parseRatio('2/2').pct, 100);
  assert.equal(plain('**收 49,313.44**'), '收 49,313.44');
});

test('parsePremarket 擷取候選與情境', () => {
  const p = parsePremarket(PREMARKET);
  assert.equal(p.date, '2026-10-08');
  assert.equal(p.bullish.length, 2);
  assert.equal(p.bullish[0].code, '2327');
  assert.equal(p.bullish[0].level, 'midlow');
  assert.equal(p.bearish[0].name, '川湖');
  assert.equal(p.market.scenarios.length, 3);
  assert.equal(p.market.scenarios[0].kind, 'base');
  assert.equal(p.market.scenarios[0].prob, 45);
  assert.equal(p.market.scenarios[0].range, '49,300–49,800');
  assert.equal(p.highlightItems.length, 2);
});

test('parsePostmortem 擷取評分與統計', () => {
  const p = parsePostmortem(POSTMORTEM);
  assert.equal(p.date, '2026-10-08');
  assert.equal(p.scores.length, 4);
  assert.equal(p.scores[0].outcome, 'miss');
  assert.equal(p.scores[1].outcome, 'hit');
  assert.equal(p.scores[3].outcome, 'flat');
  assert.equal(p.scores[2].direction, 'down');
  assert.equal(p.scores[2].changePct, -9.97);
  assert.deepEqual(p.stats.bullish, { hit: 1, total: 2, pct: 50 });
  assert.deepEqual(p.stats.bearish, { hit: 1, total: 1, pct: 100 });
  assert.equal(p.stats.flat, 1);
  assert.equal(p.marketCheck[0].hit, true);
  assert.equal(p.marketCheck[1].hit, false);
  assert.equal(p.advice.length, 2);
  assert.equal(p.summary[0].item, '加權指數');
});

test('parseScoreboard 擷取每日列與累計', () => {
  const s = parseScoreboard(SCOREBOARD);
  assert.equal(s.daily.length, 2);
  assert.equal(s.daily[0].date, '2026-10-07');
  assert.equal(s.daily[0].bullish.pct, 16.7);
  assert.equal(s.daily[1].bearish.pct, 75);
  assert.equal(s.daily[1].rangeHit, true);
  assert.equal(s.daily[0].high.hit, null);
  assert.equal(s.totals.length, 2);
  assert.equal(s.totals[1].ratio.hit, 3);
  assert.equal(s.totals[1].pct, 27.3);
});

test('parsePlaybook 擷取準則、樣本與流程', () => {
  const p = parsePlaybook(PLAYBOOK);
  assert.equal(p.version, 'v0.3');
  assert.equal(p.pending.length, 2);
  assert.equal(p.pending[1].direction, '空／大盤');
  assert.equal(p.samples.length, 2);
  assert.equal(p.samples[1].against, 1);
  assert.equal(p.process.length, 3);
  assert.equal(p.process[0].id, 'F-01');
  assert.equal(p.process[1].id, 'F-02');
  assert.equal(p.process[2].note, '使用者 2026-10-06 指示');
  assert.equal(p.valid.length, 0);
});

const DIR = process.env.TW_STOCK_REPORTS_DIR;
test('真實報告煙霧測試', { skip: !DIR || !existsSync(DIR) ? '未設定 TW_STOCK_REPORTS_DIR' : false }, () => {
  const daily = join(DIR, 'docs/stocks/daily');
  for (const f of readdirSync(daily).filter((n) => n.endsWith('.md'))) {
    const md = readFileSync(join(daily, f), 'utf8');
    const meta = classifyFile(`docs/stocks/daily/${f}`);
    if (meta.kind === 'premarket') {
      const p = parsePremarket(md, meta);
      assert.ok(p.bullish.length >= 3, `${f}: 看漲候選不足`);
      assert.ok(p.bearish.length >= 1, `${f}: 看跌候選不足`);
      assert.ok(p.market && p.market.scenarios.length === 3, `${f}: 大盤情境應有 3 列`);
      assert.ok(p.market.scenarios.every((s) => s.prob > 0 && s.range), `${f}: 情境缺機率或區間`);
      assert.ok(p.bullish.every((s) => /^\d{4}/.test(s.code) && s.name), `${f}: 代碼格式`);
      console.log(`  ${f}: 看漲 ${p.bullish.length} 看跌 ${p.bearish.length} 情境 ${p.market.scenarios.map((s) => `${s.name} ${s.prob}% ${s.range}`).join(' | ')}`);
    } else if (meta.kind === 'postmortem') {
      const p = parsePostmortem(md, meta);
      assert.ok(p.scores.length >= 5, `${f}: 評分列不足`);
      assert.ok(p.scores.every((s) => s.outcome !== 'unknown'), `${f}: 有未知結果 ${JSON.stringify(p.scores.filter((s) => s.outcome === 'unknown'))}`);
      assert.ok(p.marketCheck.length === 3, `${f}: 大盤對照應 3 列`);
      assert.ok(p.advice.length >= 3, `${f}: 修正建議不足`);
      assert.ok(p.summary.length >= 3, `${f}: 摘要列不足`);
      console.log(`  ${f}: 評分 ${p.scores.length} 看漲 ${p.stats.bullish.hit}/${p.stats.bullish.total} 看跌 ${p.stats.bearish.hit}/${p.stats.bearish.total} 平盤 ${p.stats.flat} 建議 ${p.advice.length} 準則檢驗 ${p.ruleChecks.length}`);
    } else if (meta.kind === 'scoreboard') {
      const s = parseScoreboard(md);
      assert.ok(s.daily.length >= 2 && s.totals.length >= 4, `${f}: scoreboard 解析不足`);
      console.log(`  ${f}: 每日 ${s.daily.length} 列, 累計 ${s.totals.map((t) => `${t.item} ${t.ratio.hit}/${t.ratio.total}`).join(', ')}`);
    }
  }
  const pb = parsePlaybook(readFileSync(join(DIR, 'docs/stocks/advisor/PLAYBOOK.md'), 'utf8'));
  assert.ok(pb.pending.length >= 15, 'PLAYBOOK 待驗證準則不足');
  assert.ok(pb.samples.length >= 10, 'PLAYBOOK 樣本紀錄不足');
  assert.ok(pb.process.length >= 14, 'PLAYBOOK 流程準則不足');
  console.log(`  PLAYBOOK ${pb.version}: 待驗證 ${pb.pending.length}, 樣本 ${pb.samples.length}, 流程 ${pb.process.map((p) => p.id).join(' ')}`);
});
