# Sunforest-order-system

| 目錄 | 內容 |
|---|---|
| [`apps/tw-stock-advisor/`](apps/tw-stock-advisor/) | 台股顧問 App：把「台股每日顧問」與「台股盤後檢討」兩個 Routine 推送到 `tw-stock-reports` 的報告整理成手機 PWA（盤前候選、盤後評分、累計戰績、PLAYBOOK 準則、歷史報告）。 |

部署：`.github/workflows/deploy-pages.yml` 會在預設分支更新時把 App 發佈到 GitHub Pages（需在 Settings → Pages 將 Source 設為 GitHub Actions）。
