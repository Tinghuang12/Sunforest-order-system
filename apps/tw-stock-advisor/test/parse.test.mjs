// 解析器測試。內建新舊兩種格式的小型樣本；若設定 TW_STOCK_REPORTS_DIR（指向 tw-stock-reports 本地 clone），
// 另以真實報告做煙霧測試。執行：npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import {
  classifyFile, parsePremarket, parsePostmortem, parseScoreboard, parsePlaybook,
  parseRatio, parseSignedPercent, extractRange, confidenceLevel, outcome, plain, verdictFrom,
} from '../js/parse.js';

const PREMARKET_V1 = `# 台股盤前顧問報告 — 2026-10-08（週四）

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

**開盤方向推測**：小幅開低，開盤區間 49,500–49,750。

| 情境 | 機率 | 收盤區間 | 條件與邏輯 |
|---|---|---|---|
| **基準** | 45% | **49,300–49,800** | 整理 |
| **悲觀** | 35% | **48,700–49,300** | 補跌 |
| **樂觀** | 20% | **49,800–50,250** | 回補 |

## 五、免責聲明

非投資建議。
`;

const PREMARKET_V2 = `# 台股盤前顧問報告 — 2026-11-03（週二）

> **產出時間**：07:30。

## 一、採納的修正建議

- R-15：單一來源至多「低」。

## 二、隔夜與今晨重點（2 條）

1. 費半 −3.37%。
2. 油價大跌。

## 三、大咖發言（F-10，逐人）

| 人物 | 結果 | 要點／來源 |
|---|---|---|
| Trump | 已搜尋 | 無新發言 |

## 四、產業族群（F-11，逐族群）

| 族群 | 狀態 | 說明 |
|---|---|---|
| 記憶體 | **有催化劑（偏空）** | 美光 −5.78% |

## 五、推理摘要

- **已反映程度**：低反應。

## 六、看漲候選（2 檔；依 P-23 不湊數）

> **偏離聲明**：僅 2 檔過門檻。

| 代碼 | 名稱 | 催化劑（來源，是否已開原文） | 推理邏輯（準則） | 信心／機率 | 目標價／失效條件 | 主要風險 |
|---|---|---|---|---|---|---|
| 2610 | 華航（11/2 收 20.65，+2.48%） | 油價大跌（已開原文） | P-10 | **低（57%）：收盤 >20.65** | 目標 21.2；失效：跌破 20.3 | 追高風險 |
| 2618 | 長榮航（11/2 收 43.15，+1.05%） | 同上 | 同 2610 | **低（56%）** | 目標 44.0 | 同 2610 |

## 七、看跌候選（1 檔）

| 代碼 | 名稱 | 催化劑（來源，是否已開原文） | 推理邏輯（準則） | 信心／機率 | 目標價／失效條件 | 主要風險 |
|---|---|---|---|---|---|---|
| 2330 | 台積電（11/2 收 2,330，−1.69%） | ADR −1.85% | P-01、P-22 | **高（78%）：收盤 <2,330** | 目標 2,285 | 護盤 |

## 八、大盤情境（目標日 11/3；基準＝11/2 收 44,920.14）

**開盤預估**：夜盤轉述收 44,310（−917），開盤區間 44,000–44,700，機率 42%。

| 情境 | 條件 | 機率 |
|---|---|---|
| **樂觀** | 收盤 ≥44,920（收平或收漲） | **26%** |
| **基準** | 收盤 44,000–44,920（**中位約 44,400**） | **42%** |
| **悲觀** | 收盤 <44,000（外資續賣） | **32%** |

**主判斷：收跌（收盤 <44,920.14），機率 70%**（≥60%，F-20(a)）。目標區間 **44,000–44,900**。

**不押（F-16）**：
- AI 伺服器鏈：連結未驗證。

## 九、搜尋紀錄表（F-14）

| 項目 | 查詢詞 | 結果 | 採用來源 | 是否已開原文 |
|---|---|---|---|---|
| Trump | trump tariff | 無 | – | – |

## 十、免責聲明

非投資建議。
`;

const PREMARKET_V3 = `# 台股盤前顧問報告 — 2026-10-13（週二）

## 六、大盤情境（目標日 10/13，基準＝10/12 收盤 49,301.96）

| 項目 | 內容 |
|---|---|
| 主判斷 | **收跌 68%**（收盤 <49,301.96） |
| 開盤預測（P-20） | **開盤落在 48,800–49,150：55%** |
| **基準（36%）** | 收 **48,700–49,300**：記憶體補跌 |
| **悲觀（32%）** | 收 **<48,700**：費半跌幅傳導 |
| **樂觀（32%）** | 收 **>49,300**：開低收高 |
| 驗證指標 | (1) 收盤 <49,301.96 |

## 七、看漲候選（1 檔）

| 代碼 | 名稱 | 催化劑 | 推理邏輯 | 信心 | 主要風險 |
|---|---|---|---|---|---|
| 2330 | 台積電 | 法說 | P-06 | 中 | 利多出盡 |
`;

const PREMARKET_V4 = `# 台股盤前顧問報告 — 2026-10-15（週四）

## 八、大盤情境（F-02、F-20）

**主判斷：收跌，機率 68%**（隔夜費半 −4.30%）。

- 基準點位推算：約 47,750–47,800。
- **開盤區間（P-20）**：47,550–48,050，機率 **50%**。
- **收盤三情境**：
  - **基準 47,500–48,300：48%**——開低後震盪。
  - **悲觀 <47,500：30%**——ADR 補跌。
  - **樂觀 >48,300：22%**——法說超預期。
- 失效條件：開盤外資買超台指期。
`;

const POSTMORTEM_V1 = `# 台股盤後檢討 — 2026-10-08（週四）

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

const POSTMORTEM_V2 = `# 台股盤後檢討 — 2026-10-16（週五）

> **檢討對象**：盤前報告。

## 一、實際結果摘要

| 項目 | 數據 | 來源 |
|---|---|---|
| 加權指數 | 開 46,995.03，**收 47,111.26（+0.30%）** | 證交所 |
| 台積電 | 收 2,420（−0.82%） | 證交所 |

## 二、大盤對照

| 項目 | 預測 | 實際 | 判定 |
|---|---|---|---|
| 主判斷 | 收漲 62% | 收 47,111.26 | **方向命中** |
| 基準區間 | 46,970–47,900 | 47,111.26 | **區間命中**；落在下緣 |
| 開盤區間 | 47,200–47,600 | 開 46,995.03 | **未命中** |

## 三、個股評分表

| 代碼 | 名稱 | 方向 | 信心（機率） | 引用準則 | 前收→收 | 實際漲跌 | 判定 |
|---|---|---|---|---|---|---|---|
| 2330 | 台積電 | 看漲 | 中（66%） | P-01、P-06 | 2,440→2,420 | −0.82% | **未命中** |
| 2454 | 聯發科 | 看漲 | 低（56%） | P-24 | 4,165→4,250 | +2.04% | **命中** |
| 2308 | 台達電 | 看漲 | 低（57%） | P-05 | 1,630→1,635 | +0.31% | **命中（邊緣）** |
| 2356 | 英業達 | 看跌 | 低（58%） | P-21 | 57.60→59.00 | +2.43% | **未命中** |
| 2408 | 南亞科 | 看跌（僅追蹤） | 低 | P-06 | 480.5→490 | −1.54% | 不計分（若計為命中） |

## 四、未命中案例反省

### 2330 台積電
1. 依據。

## 五、前次反省驗證（F-17）

| 項目 | 結論 | 說明 |
|---|---|---|
| 建議 1 | 被支持（弱） | 說明 |

## 六、準則檢驗表

| 準則 | 本案例 | 判定 |
|---|---|---|
| P-01 | 台積電 | 不計 |
| P-24 | 4 檔看漲 | **支持** |

## 七、明日給盤前顧問的三條具體修正建議（週一 10/19）

1. **開盤區間不要單靠夜盤**。
2. **需官方可驗證的連結**。
3. **週一檢查週末事件**。
`;

const POSTMORTEM_V3 = `# 台股盤後檢討 — 2026-10-14（週三）

## 三、個股評分表

| 代碼 | 名稱 | 方向 | 信心 | 引用準則 | 實際漲跌（10/14） | 判定 |
|---|---|---|---|---|---|---|
| 2330 | 台積電 | 看漲 | 中 | P-01 | 2,490、0.00% | **平盤（不計）** |
| 3008 | 大立光 | 看漲 | 低 | F-16 | 6,880、**−5.43%** | **未命中** |
`;

const SCOREBOARD = `# 戰績表（scoreboard）

| 日期 | 大盤基準區間 | 實際收盤 | 區間命中 | 看漲命中 | 看跌命中 | 高信心 | 中信心 | 低信心 |
|---|---|---|---|---|---|---|---|---|
| 2026-10-07 | 49,650–50,150 | 49,806.37 | 是 | 1/6＝16.7%（平盤不計） | 2/4＝50% | –（無樣本） | 3/7＝42.9% | 0/3＝0% |
| 2026-10-13 | 48,700–49,300（主判斷收跌 68%，方向命中） | 48,341.31 | 否（區間，落入悲觀 <48,700）／是（方向） | 0/1＝0% | 3/3＝100% | 1/1＝100% | 2/2＝100% | 0/1＝0% |
| 2026-10-15 | 47,500–48,300（主判斷收跌 68%，方向命中） | 46,969.87（−3.41%） | 否（區間）／是（方向） | –（名單為空） | 5/5＝100% | 1/1＝100% | 2/2＝100% | 2/2＝100% |
| 2026-10-16 | 46,970–47,900（主判斷收漲 62%，方向命中） | 47,111.26（+0.30%） | 是（區間下緣） | 2/4＝50% | 0/1＝0% | –（無樣本） | 0/1＝0% | 2/4＝50% |

## 累計

| 項目 | 命中／總數 | 命中率 |
|---|---|---|
| 大盤基準區間 | 4/7 | 57.1%（方向 6/6 已押） |
| 看漲個股 | 5/18 | 27.8%（10/15 名單為空） |
`;

const PLAYBOOK = `# 台股每日顧問 PLAYBOOK（策略準則）

> 版本：v0.9（2026-10-16）

## 一、有效訊號（已驗證）

（尚無。）

## 二、待驗證準則（初始假設）

| 編號 | 準則 | 適用方向 | 狀態 |
|---|---|---|---|
| P-01 | ADR 已反映。 | 多 | 待驗證 |
| P-02 | 法人賣超。 | 空／大盤 | 待驗證 |

### 樣本紀錄

| 準則 | 支持 | 反證 | 紀錄 | 獨立樣本日（支持／反證，F-17） |
|---|---|---|---|---|
| P-01 | 2 | 0 | 10-07、10-08 | 2／0 |
| P-02 | 2 | 1 | 10-07 | 1／1 |

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

test('數值解析工具', () => {
  assert.deepEqual(parseRatio('1/6＝16.7%（平盤不計）'), { hit: 1, total: 6, pct: 16.7, raw: '1/6＝16.7%（平盤不計）' });
  assert.equal(parseRatio('–（無樣本）').hit, null);
  assert.equal(parseRatio('2/2').pct, 100);
  assert.equal(plain('**收 49,313.44**'), '收 49,313.44');
  assert.equal(parseSignedPercent('−1.85%'), -1.85);
  assert.equal(parseSignedPercent('+3.50%'), 3.5);
  assert.equal(parseSignedPercent('2,490、0.00%'), 0);
  assert.equal(parseSignedPercent('6,880、**−5.43%**'), -5.43);
  assert.equal(extractRange('**49,300–49,800**'), '49,300–49,800');
  assert.equal(extractRange('收盤 ≥44,920（收平或收漲）'), '≥44,920');
  assert.equal(extractRange('收盤 <44,000（外資續賣）'), '<44,000');
  assert.equal(extractRange('收盤 44,000–44,920（中位約 44,400）'), '44,000–44,920');
  assert.equal(confidenceLevel('**低（57%）：收盤 >20.65**'), 'low');
  assert.equal(confidenceLevel('中（66%）'), 'mid');
  assert.equal(confidenceLevel('高（78%）'), 'high');
  assert.equal(confidenceLevel('中低'), 'midlow');
  assert.equal(outcome('**命中（邊緣）**'), 'hit');
  assert.equal(outcome('不計分（若計為命中）'), 'na');
  assert.equal(outcome('**平盤（不計）**'), 'flat');
  assert.equal(outcome('方向命中'), 'hit');
  assert.equal(plain('收盤 <46,368.33），機率 72%（≥60%）。「收盤 >46,368」'), '收盤 <46,368.33），機率 72%（≥60%）。「收盤 >46,368」');
  assert.equal(plain('a <b>bold</b> c'), 'a bold c');
  assert.deepEqual(verdictFrom('**主判斷：收跌（收盤 <46,368.33），機率 72%**（≥60%）。「收盤 >46,368」約 20%'), { text: '收跌', prob: 72 });
  assert.deepEqual(verdictFrom('主判斷：收跌，機率 68%（隔夜費半 −4.30%）'), { text: '收跌', prob: 68 });
  assert.deepEqual(verdictFrom('**主判斷：無優勢、不押方向**（收跌 55%／收漲 45%，低於 F-20(a) 的 60%）。'), { text: '無優勢、不押方向', prob: null });
  assert.deepEqual(verdictFrom('主判斷：方向無優勢、不押（ADR 平盤＋法人大賣互抵）；區間判斷如下。'), { text: '方向無優勢、不押', prob: null });
  assert.deepEqual(verdictFrom('**收跌 68%**（收盤 <49,301.96）'), { text: '收跌', prob: 68 });
  assert.deepEqual(verdictFrom('主判斷（收跌）= 15+50+7 = **72%**。'), { text: '收跌', prob: 72 });
  assert.deepEqual(verdictFrom('10/12 收跌：收盤低於 49,313.44 的機率 72%，最可能區間 48,400–49,100'), { text: '收跌', prob: 72 });
});

test('parsePremarket v1：候選與情境表', () => {
  const p = parsePremarket(PREMARKET_V1);
  assert.equal(p.date, '2026-10-08');
  assert.equal(p.bullish.length, 2);
  assert.equal(p.bullish[0].code, '2327');
  assert.equal(p.bullish[0].level, 'midlow');
  assert.equal(p.bearish[0].name, '川湖');
  assert.equal(p.market.scenarios.length, 3);
  assert.equal(p.market.scenarios[0].kind, 'base');
  assert.equal(p.market.scenarios[0].prob, 45);
  assert.equal(p.market.scenarios[0].range, '49,300–49,800');
  assert.equal(p.market.verdict, null);
  assert.match(p.market.opening, /小幅開低/);
  assert.equal(p.highlightItems.length, 2);
  assert.equal(p.others.length, 0);
});

test('parsePremarket v2：條件式情境、主判斷、目標價、新區段', () => {
  const p = parsePremarket(PREMARKET_V2);
  assert.equal(p.date, '2026-11-03');
  assert.equal(p.bullish.length, 2);
  assert.equal(p.bullish[0].name, '華航');
  assert.equal(p.bullish[0].nameNote, '11/2 收 20.65，+2.48%');
  assert.equal(p.bullish[0].level, 'low');
  assert.equal(p.bullish[0].prob, 57);
  assert.match(p.bullish[0].target, /目標 21.2/);
  assert.equal(p.bearish[0].level, 'high');
  assert.equal(p.bearish[0].prob, 78);
  const byKind = Object.fromEntries(p.market.scenarios.map((s) => [s.kind, s]));
  assert.equal(byKind.bull.range, '≥44,920');
  assert.equal(byKind.base.range, '44,000–44,920');
  assert.equal(byKind.bear.range, '<44,000');
  assert.equal(byKind.base.prob, 42);
  assert.deepEqual(p.market.verdict, { text: '收跌', prob: 70 });
  assert.match(p.market.opening, /夜盤轉述/);
  assert.ok(p.bigshots.length && p.sectors.length && p.reasoning.length && p.searchLog.length);
  assert.ok(p.bullishExtra.some((t) => t.type === 'blockquote'));
  assert.equal(p.others.length, 0);
});

test('parsePremarket v3／v4：項目表與條列式情境', () => {
  const p3 = parsePremarket(PREMARKET_V3);
  assert.deepEqual(p3.market.verdict, { text: '收跌', prob: 68 });
  assert.equal(p3.market.scenarios.length, 3);
  const k3 = Object.fromEntries(p3.market.scenarios.map((s) => [s.kind, s]));
  assert.equal(k3.base.prob, 36);
  assert.equal(k3.base.range, '48,700–49,300');
  assert.equal(k3.bear.range, '<48,700');
  assert.equal(k3.bull.range, '>49,300');
  assert.equal(k3.base.name, '基準');
  assert.match(p3.market.opening, /48,800–49,150/);
  const p4 = parsePremarket(PREMARKET_V4);
  assert.deepEqual(p4.market.verdict, { text: '收跌', prob: 68 });
  assert.equal(p4.market.scenarios.length, 3);
  const k4 = Object.fromEntries(p4.market.scenarios.map((s) => [s.kind, s]));
  assert.equal(k4.base.prob, 48);
  assert.equal(k4.base.range, '47,500–48,300');
  assert.equal(k4.bear.prob, 30);
  assert.equal(k4.bull.range, '>48,300');
  assert.match(p4.market.opening, /47,550–48,050/);
});

test('parsePostmortem v1：情境式大盤對照', () => {
  const p = parsePostmortem(POSTMORTEM_V1);
  assert.equal(p.date, '2026-10-08');
  assert.equal(p.scores.length, 4);
  assert.equal(p.scores[0].outcome, 'miss');
  assert.equal(p.scores[1].outcome, 'hit');
  assert.equal(p.scores[3].outcome, 'flat');
  assert.equal(p.scores[2].direction, 'down');
  assert.equal(p.scores[2].changePct, -9.97);
  assert.equal(p.scores[2].close, '10,615');
  assert.deepEqual(p.stats.bullish, { hit: 1, total: 2, pct: 50 });
  assert.deepEqual(p.stats.bearish, { hit: 1, total: 1, pct: 100 });
  assert.equal(p.stats.flat, 1);
  assert.equal(p.marketCheck[0].hit, true);
  assert.equal(p.marketCheck[1].hit, false);
  assert.equal(p.marketRangeHit, true);
  assert.equal(p.advice.length, 2);
  assert.equal(p.summary[0].item, '加權指數');
  assert.equal(p.ruleChecks.headers.length, 4);
});

test('parsePostmortem v2：自由表格大盤對照、判定欄、前收→收', () => {
  const p = parsePostmortem(POSTMORTEM_V2);
  assert.equal(p.marketCheck.length, 0);
  assert.deepEqual(p.marketTable.headers, ['項目', '預測', '實際', '判定']);
  assert.equal(p.marketRangeHit, true);
  assert.equal(p.marketDirHit, true);
  assert.equal(p.scores.length, 5);
  assert.equal(p.scores[0].close, '2,420');
  assert.equal(p.scores[0].level, 'mid');
  assert.equal(p.scores[0].prob, 66);
  assert.equal(p.scores[2].outcome, 'hit');
  assert.equal(p.scores[4].outcome, 'na');
  assert.equal(p.scores[4].directionText, '看跌');
  assert.deepEqual(p.stats.bullish, { hit: 2, total: 3, pct: 66.7 });
  assert.deepEqual(p.stats.bearish, { hit: 0, total: 1, pct: 0 });
  assert.equal(p.stats.na, 1);
  assert.equal(p.summary[0].source, '證交所');
  assert.equal(p.advice.length, 3);
  assert.equal(p.ruleChecks.rows.length, 2);
  assert.deepEqual(p.others.map((s) => s.heading), ['五、前次反省驗證（F-17）']);
});

test('parsePostmortem v3：收盤與漲跌同欄', () => {
  const p = parsePostmortem(POSTMORTEM_V3);
  assert.equal(p.scores[0].close, '2,490');
  assert.equal(p.scores[0].changePct, 0);
  assert.equal(p.scores[0].outcome, 'flat');
  assert.equal(p.scores[1].close, '6,880');
  assert.equal(p.scores[1].changePct, -5.43);
  assert.equal(p.scores[1].outcome, 'miss');
});

test('parseScoreboard：區間、方向、累計', () => {
  const s = parseScoreboard(SCOREBOARD);
  assert.equal(s.daily.length, 4);
  assert.equal(s.daily[0].bullish.pct, 16.7);
  assert.equal(s.daily[0].rangeHit, true);
  assert.equal(s.daily[0].dirHit, null);
  assert.equal(s.daily[1].range, '48,700–49,300');
  assert.equal(s.daily[1].rangeHit, false);
  assert.equal(s.daily[1].dirHit, true);
  assert.equal(s.daily[2].bullish.hit, null);
  assert.equal(s.daily[2].closeNum, 46969.87);
  assert.equal(s.daily[3].rangeHit, true);
  assert.equal(s.daily[3].dirHit, true);
  assert.equal(s.totals[0].ratio.hit, 4);
  assert.equal(s.totals[0].pct, 57.1);
});

test('parsePlaybook：準則、樣本（含獨立樣本日）、流程', () => {
  const p = parsePlaybook(PLAYBOOK);
  assert.equal(p.version, 'v0.9');
  assert.equal(p.pending.length, 2);
  assert.equal(p.pending[1].direction, '空／大盤');
  assert.equal(p.samples.length, 2);
  assert.equal(p.samples[1].against, 1);
  assert.equal(p.samples[1].days, '1／1');
  assert.equal(p.process.length, 3);
  assert.equal(p.process[0].id, 'F-01');
  assert.equal(p.process[1].id, 'F-02');
  assert.equal(p.process[2].note, '使用者 2026-10-06 指示');
  assert.equal(p.valid.length, 0);
});

const DIR = process.env.TW_STOCK_REPORTS_DIR;
test('真實報告煙霧測試', { skip: !DIR || !existsSync(DIR) ? '未設定 TW_STOCK_REPORTS_DIR' : false }, () => {
  const daily = join(DIR, 'docs/stocks/daily');
  const problems = [];
  for (const f of readdirSync(daily).filter((n) => n.endsWith('.md')).sort()) {
    const md = readFileSync(join(daily, f), 'utf8');
    const meta = classifyFile(`docs/stocks/daily/${f}`);
    if (meta.kind === 'premarket') {
      const p = parsePremarket(md, meta);
      if (p.bullish.length + p.bearish.length < 2) problems.push(`${f}: 候選不足`);
      if (!p.market || p.market.scenarios.length < 3) problems.push(`${f}: 大盤情境少於 3 列`);
      else {
        if (!p.market.scenarios.every((s) => s.prob > 0)) problems.push(`${f}: 情境缺機率`);
        if (!p.market.scenarios.some((s) => s.kind === 'base' && s.range)) problems.push(`${f}: 基準情境缺區間`);
      }
      if (![...p.bullish, ...p.bearish].every((s) => /^\d{4}/.test(s.code) && s.name && s.level !== 'unknown')) problems.push(`${f}: 代碼／名稱／信心格式`);
      console.log(`  ${f}: 看漲 ${p.bullish.length} 看跌 ${p.bearish.length} 主判斷 ${p.market.verdict ? `${p.market.verdict.text} ${p.market.verdict.prob ?? ''}%` : '–'} 情境 ${p.market.scenarios.map((s) => `${s.name} ${s.prob}% ${s.range}`).join(' | ')} 其他區段 ${p.others.map((s) => s.heading).join('、') || '無'}`);
    } else if (meta.kind === 'postmortem') {
      const p = parsePostmortem(md, meta);
      if (p.scores.length < 2) problems.push(`${f}: 評分列不足`);
      const unknown = p.scores.filter((s) => s.outcome === 'unknown');
      if (unknown.length) problems.push(`${f}: 未知結果 ${unknown.map((s) => `${s.code}:${s.result}`).join('，')}`);
      if (!p.scores.every((s) => s.changePct !== null)) problems.push(`${f}: 有評分列缺漲跌幅`);
      if (!p.marketCheck.length && !p.marketTable) problems.push(`${f}: 大盤對照無表`);
      if (!p.advice.length && !p.adviceTokens.length) problems.push(`${f}: 無修正建議`);
      if (p.summary.length < 2) problems.push(`${f}: 摘要列不足`);
      console.log(`  ${f}: 評分 ${p.scores.length} 看漲 ${p.stats.bullish.hit}/${p.stats.bullish.total} 看跌 ${p.stats.bearish.hit}/${p.stats.bearish.total} 平盤 ${p.stats.flat} 不計 ${p.stats.na} 大盤區間 ${p.marketRangeHit} 方向 ${p.marketDirHit} 建議 ${p.advice.length} 其他區段 ${p.others.map((s) => s.heading).join('、') || '無'}`);
    } else if (meta.kind === 'scoreboard') {
      const s = parseScoreboard(md);
      if (s.daily.length < 2 || s.totals.length < 4) problems.push(`${f}: scoreboard 解析不足`);
      console.log(`  ${f}: 每日 ${s.daily.length} 列 ${s.daily.map((d) => `${d.date.slice(5)} 區間${d.rangeHit ? '✓' : '✗'}方向${d.dirHit === null ? '–' : d.dirHit ? '✓' : '✗'}`).join(' ')}；累計 ${s.totals.map((t) => `${t.item} ${t.ratio.hit}/${t.ratio.total}`).join(', ')}`);
    }
  }
  const pb = parsePlaybook(readFileSync(join(DIR, 'docs/stocks/advisor/PLAYBOOK.md'), 'utf8'));
  if (pb.pending.length < 10 || pb.samples.length < 5 || pb.process.length < 10) problems.push('PLAYBOOK 解析不足');
  console.log(`  PLAYBOOK ${pb.version}: 待驗證 ${pb.pending.length}, 有效 ${pb.valid.length}, 無效 ${pb.invalid.length}, 樣本 ${pb.samples.length}, 流程 ${pb.process.length}`);
  assert.deepEqual(problems, []);
});
