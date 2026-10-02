# 後台清單頁載入失敗之畫面——真瀏覽器探測紀錄（2026-09-29，ADR-076）

## 方法

- 環境：`test/tools/e2e-setup.mjs` 之 `startServersOnce()`（後端 11007、前端 dev server 8080）、`launchBrowser()`（確定性渲染旗標之 headless Chromium），視窗 1280×720，eng。
- 資料：`resetToBaseSeed()` 後插入一位管理者（帳號 `pl-admin`）供登入。
- 步驟（每頁一個全新 context）：於 `**/api/main` 掛攔截，將請求本體以 `u8arr2obj` 解出 `func`，僅當 `func` 為該頁之清單載入函式（`getUsersList` / `getTokensList` / `getIpsList`）時 `route.abort('failed')`，其餘照常 → 以真鍵盤登入 → 點主選單之「Users list」／「Tokens list」／「Ips list」。
- 觀察：點選後約 1 秒之畫面（修正後才取樣）；之後最長等 90 秒至畫面出現 `getDataError` 文字（「Failed to get data, please try again later」），記錄耗時；最終畫面有無表格（`.ag-root-wrapper`）與資料列數。另於不攔截之 context 依序點三頁，確認資料列出現、無等待或錯誤文字殘留。
- 探測腳本為 AI 暫存（`tmp/probe-loadfail.mjs`，已清除）；重做時依上列方法即可。

## 結果

| 情境 | 使用者清單 | 金鑰清單 | IP 清單 |
|---|---|---|---|
| 修正前，載入失敗（等 4 秒） | 空表格、無訊息（被攔截 3 次） | 同左 | 同左 |
| 修正後，載入失敗，點選後 1 秒 | 顯示「Waiting data...」、無表格 | 同左 | 同左 |
| 修正後，載入失敗，最終 | 6202 ms 後顯示「Failed to get data, please try again later」、無表格（被攔截 4 次） | 6195 ms，同左 | 6147 ms，同左 |
| 修正後，未攔截 | 資料列 4、無等待或錯誤文字 | 資料列 8、同左 | 資料列 1、同左 |

修正前之金鑰清單畫面：表格標頭與「No Rows To Show」，無任何錯誤訊息。修正後之錯誤畫面：功能列下方顯示一行「Failed to get data, please try again later」，樣式同統計資訊頁與使用者資訊頁之既有錯誤呈現。
