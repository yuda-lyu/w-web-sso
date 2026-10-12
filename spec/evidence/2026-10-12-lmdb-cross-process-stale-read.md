# 2026-10-12 測試行程與後端共用 LMDB 之跨行程舊快照（ADR-081；`CLAUDE_rulebook.md`「已知缺口」）

## 現象

api 全量（`npx mocha --no-parallel "test/api-*.test.mjs"`）偶發失敗，單獨重跑皆通過：

| 輪次 | 結果 | 失敗案 |
|---|---|---|
| 1 | 95 / 97 | `api-apptoken-perms` PERM-A-001[app-writeIps]（kpfun `updateIpsList` 回成功，測試行程讀回 `192.0.2.10`，預期 `.11`）；`api-httpendpoints`「refreshToken：已過期 token」（後端回 `invalid token`，即查無測試行程剛插入之令牌） |
| 2～7 | 97 / 97 | — |
| 8（本輪改動後，100 案） | 98 / 100 | PERM-A-001[app-writeIps]、PERM-A-001[app-all]（皆為 `updateIpsList` 之讀回斷言，同上） |

兩種方向：
- **測試行程讀到舊值**：測試行程先讀（`getRowsForSave`），後端寫入並回覆，測試行程於回覆之回呼內立即再讀，讀到寫入前之值。
- **後端讀到舊值**：後端前一請求剛讀過某表，測試行程隨即寫入 fixture 並送出下一請求，後端處理時查無剛寫入之列。

## 機制（原始碼）

- lmdb-js 之讀取一律取 `readTxnRenewed ? readTxn : renewReadTxn(this)`（`node_modules/lmdb/read.js:62`、`:86`、`:577` 等）；renew 後以 `setTimeout(resetReadTxn, 0)` 延至下一次 timers 階段才重設（`read.js:1056-1058`）。
- 本行程寫入於 commit 時立即重設讀交易（`node_modules/lmdb/write.js:579-582`），他行程之 commit 則要等上述計時器。事件迴圈閒置等待 I/O 時，I/O 回呼可能先於該計時器被處理，回呼內之讀取即沿用舊快照。
- w-orm-lmdb 於寫交易外之讀取未重設讀交易（`node_modules/w-orm-lmdb/src/WOrmLmdb.mjs`）：`getData`（`client.getRange()`，供 select、delAll）與 `getValue`（`client.get()`，供 selectByPk、save 之快速路徑、del）；`useCache` 預設 false，非快取所致。
- 版本：lmdb 3.5.6、w-orm-lmdb 1.0.37，與 w-serv-orm 1.1.8 升版前相同（`git show HEAD:package-lock.json`）。

## 最小重現（不經 SSO）

`node spec/evidence/2026-10-12-lmdb-cross-process-stale-read.mjs <mode> 200`（兩行程、開啟參數同 w-orm-lmdb；Windows 11、Node 24.19.0）：

| mode | 第 1 次（閒置時） | 第 2 次（e2e 執行中） |
|---|---|---|
| `plain`（回覆之回呼內立即讀） | 106 / 200 讀不到（回覆距前次讀取 2～4 ms） | 147 / 200 讀不到 |
| `wait1`（讀前讓出 1 ms 計時器） | 0 / 200 | 0 / 200 |
| `reset`（讀前 `db.resetReadTxn()`） | 0 / 200 | 0 / 200 |

## 真實失敗情境之取證

`test/api-apptoken-perms.test.mjs` 之副本（只在 `updateIpsList` 之讀回斷言不符時，讓出 1 ms 計時器後同一行程再讀並印出兩值），只跑 PERM-A-001，連跑 10 輪：6 輪有失敗；凡有診斷行者皆為 `DIAG-STALE first=192.0.2.10 afterYield=192.0.2.11`，即後端已寫入、測試行程第一次讀到舊快照。另 1 輪失敗於 `updateTokensList` 之讀回斷言（該 op 未加診斷，徵狀同型）。

## w-orm-lmdb 層之重現與修改驗證

`node spec/evidence/2026-10-12-worm-lmdb-cross-process-stale-read.mjs [N] [yield]`（以 w-orm-lmdb 之 API；行程 A 先讀一次，請行程 B 寫入，A 於 B 之 IPC 回覆回呼內立即操作；環境變數 `WORM_LMDB_SRC` 可改用指定之 `WOrmLmdb.mjs`），各情境 100 次：

| 版本 | select 查無 | selectByPk 查無 | save 後發之更新遺失 | del 未刪 |
|---|---|---|---|---|
| w-orm-lmdb 1.0.37（三次） | 72／77／65 | 73／74／72 | 58／48／59 | 71／81／82 |
| 1.0.37，A 操作前先讓出 1 ms（對照） | 0 | 0 | 0 | 0 |
| 1.0.37 之複本，`getData` 於 `getRange` 前、`getValue` 於 `get` 前各加 `client.resetReadTxn()` | 0（另 300 次亦 0） | 0 | 0 | 0 |

成本（單一行程、1000 列，3 輪）：selectByPk 每次約 2.1～2.3 µs → 2.5～2.6 µs；select 每次 0.61～0.75 ms → 0.64～0.73 ms（雜訊範圍）。

## 處置

- 依全域 §7（自有套件問題由套件端統一改版），不在本專案繞道；建議 w-orm-lmdb 於讀取前（非寫交易內）呼叫 `client.resetReadTxn()`（或提供選項），兩行程皆即時可見（見上表 `reset` 與上節之複本）；建議檔 `建議w-orm-lmdb調整.md`（2026-10-12；業主發布 1.0.38 修復後依指示刪除，見下節）。
- 修復前（已解除）：api 全量之間歇失敗以本檔判讀，不得以「單獨重跑通過」結案；新寫之 api 案以後端讀取驗證寫入結果（ADR-081 之 `api-adduser` API-011～013）。

## 修復紀錄（2026-10-12，w-orm-lmdb 1.0.38；ADR-082）

- 改動：寫交易外之每次讀取前呼叫 `client.resetReadTxn()`（`prepareRead`；select、selectByPk，以及 save、del、delAll 內之讀取）。1.0.37 / 1.0.38 發佈包全量比對，lmdb 仍為 3.5.6；本專案 `package.json` 升 `^1.0.38`。
- 驗證：

| 項目 | 1.0.37 | 1.0.38 |
|---|---|---|
| w-orm-lmdb 層腳本，各情境 100 次 | 48～82 次異常（三次） | 0（三次） |
| PERM-A-001 連跑 10 輪 | 6 輪失敗（帶診斷之副本） | 10 輪皆 13 / 13 |
| api 全量 | 8 輪中 2 輪各 2 案失敗 | 8 輪皆 100 / 100 |

- e2e 依差異範圍抽驗（eng）：login E2E-001、tokens E2E-001、adduser E2E-001、deleteuser 刪除成功，皆通過且與既有標準圖相符，`./testPending/` 零新增。
- 日後升級 w-orm-lmdb 時，以 `spec/evidence/2026-10-12-worm-lmdb-cross-process-stale-read.mjs` 回歸（應為 0）。
