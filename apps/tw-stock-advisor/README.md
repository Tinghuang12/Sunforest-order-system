# 台股顧問 App

把兩個 Claude Routine（**台股每日顧問**、**台股盤後檢討**）每天推送到 GitHub 的報告，整理成一個可以加到手機主畫面的 PWA。

| 分頁 | 內容 | 資料來源 |
|---|---|---|
| 盤前 | 大盤三情境（機率、點位區間）、看漲／看跌候選（代碼、信心、催化劑、推理、風險）、隔夜重點、採納的修正建議 | `docs/stocks/daily/YYYY-MM-DD-盤前顧問報告.md` |
| 盤後 | 看漲／看跌／合計命中率、大盤區間是否命中、個股評分表、明日修正建議、未命中反省、準則檢驗表 | `docs/stocks/daily/YYYY-MM-DD-盤後檢討.md` |
| 戰績 | 累計命中率 KPI、每日命中率折線圖、每日明細 | `docs/stocks/daily/scoreboard.md` |
| 準則 | P-xx 待驗證／有效／無效準則、每條的支持／反證樣本、F-xx 流程準則 | `docs/stocks/advisor/PLAYBOOK.md` |
| 歷史 | 所有盤前、盤後、研究報告，依日期分組，可開 Markdown 或下載 PDF | `docs/stocks/**` |

App 只讀 GitHub，不寫入任何檔案。Routine 的排程與產出方式不變，App 只是閱讀介面。

## 使用方式

1. 開啟部署好的網址（GitHub Pages）或在本機 `npm start` 後開 <http://127.0.0.1:8080>。
2. 第一次使用到「設定」填入 GitHub **fine-grained Personal Access Token**（只需 `tw-stock-reports` 的 Contents: Read-only）。Token 只存在該裝置的瀏覽器 `localStorage`。
3. iPhone：Safari 分享 → 加入主畫面；Android：Chrome 選單 → 安裝應用程式。

預設資料來源為 `Tinghuang12/tw-stock-reports` 的 `claude/stock-advisor-data` 分支（Routine 推送的分支），可在設定中更改。

## 部署（GitHub Pages）

1. Repo → Settings → Pages → Build and deployment → Source 選 **GitHub Actions**。
2. 推送到預設分支後，`.github/workflows/deploy-pages.yml` 會先跑測試再部署 `apps/tw-stock-advisor/`。
3. 網址為 `https://<帳號>.github.io/<repo>/`。

## 開發

```bash
cd apps/tw-stock-advisor
npm test                                       # 解析器單元測試
TW_STOCK_REPORTS_DIR=/path/to/tw-stock-reports npm test   # 另以真實報告做煙霧測試
npm start                                      # 本機靜態伺服器
```

- 無建置步驟、無框架：`index.html` + ES modules。
- `js/parse.js`：Markdown → 結構化資料（候選表、情境表、評分表、戰績、PLAYBOOK）。報告格式若變動，先改這裡並補測試。
- `js/github.js`：GitHub Trees／Contents API，ETag 與 sha 快取，離線時用上次快取。
- `js/app.js`：路由與五個分頁。`js/chart.js`：SVG 命中率折線圖。
- `vendor/`：marked 18.1.0、DOMPurify 3.4.16（原樣 vendored，離線可用）。
- `sw.js`：只快取 App 外殼；GitHub API 一律走網路。
