# 2026-10-25 框架系統函數逐一確認之證據(sso-run01; ADR-096 / R-SYS-01)

真瀏覽器(Playwright Chromium)擷取框架系統函數之呼叫、`__sysToken__` 狀態與回應。token 一律只記「空 / 非空(長度)」, 不記值。

## 檔案

| 檔 | 內容 |
|---|---|
| `summary-<標籤>.txt` | 每個情境 × 函數: 送出數、`__sysToken__` 狀態、回應(`scripts/summ.mjs` 彙整); `ui-<標籤>.jsonl`: 各情境結束之頁面狀態(輸入欄數、可見文字前 220 字)與 `consoleErrors`(收 `console.error` 與 `pageerror`) |
| 標籤 `before` | 舊框架(w-serv-hapi 1.1.7)+ 預設全公開, 舊前端(輪詢不帶 token 鍵); 無 S6(S6 於其後加入) |
| `up-default` | 新框架(1.1.8 / 1.1.16 / 1.1.12)+ 預設全公開(輪詢改帶 token 鍵; 三者皆回成功) |
| `exp-e1` | 實驗 E1: 只公開 `[sys:getFuncList]` ⇒ 輪詢被拒, 前端停在「Connecting...」 |
| `exp-e2` | 實驗 E2: 公開 `[sys:getFuncList]` + `[sys:polling]`(即最終設定; 當時尚無 S6) |
| `exp-e3` | 實驗 E3: 只公開 `[sys:polling]` ⇒ `[sys:getFuncList]` 被拒, 前端停在「Connecting...」 |
| `after` / `after-dist` | 最終設定; `after` 為開發伺服器(8080)前端, `after-dist` 為後端提供之建置版前端(11007); 含 S6 重寄驗證信畫面 |
| `e2e-aggregate-subset9.txt` | 以預載攔截直接跑既有 e2e 檔(init、login、register、logout、autologin、stainfor、tokens、concurrency、ips 共 9 檔 151 案, 175 次前端開機)時之全部網路呼叫彙整(函數 × 結果 × `__sysToken__` 狀態); `e2e-aggregate-concurrency.txt` 為修後 `e2e-concurrency` 全檔(帶預載)之彙整。其餘 6 檔(adduser、autoblock、changepassword、deleteuser、modifyuser、resetpassword)無預載, 只驗通過與否 |
| `oldclient.log` | 真舊版框架用戶端(w-serv-hapi 1.1.7 / w-serv-webdata 1.1.15 / w-serv-broadcast 1.1.10)對最終後端開機之結果 |
| `mutations.json` | 變異驗證結果(M1~M6、U1~U5) |
| `scripts/` | 擷取與驗證腳本(原置於 `tmp/sso-run01/`, 其相對 repo 根之 import 為 `../../`; 重跑時複製回 `tmp/<任一夾>/`): `netcap.mjs`(擷取; 可作 `node --import` 預載, 需設 `NETCAP_OUT`)、`probe-capture.mjs`(情境腳本)、`summ.mjs` / `agg-sys.mjs`(彙整)、`probe-oldclient.mjs`、`mutate.mjs` / `exp.mjs`(暫改設定之變異與實驗, 一律還原並回驗 sha256)、`rerun.mjs`(逐檔隔離重跑指定 e2e 檔與案例) |

## 情境

S1 登入頁冷載入(無 token)、S2 申請帳號畫面、S3 登入失敗、S4 系統管理者登入 → 後台使用者 / 金鑰 / IP 各頁(整頁轉址後再開機)、S5 驗證信結果頁(HTTP, 伺服器渲染, 非前端頁)、S6 未驗證使用者之重寄驗證信畫面(只開到畫面, 未送出; **S6 僅 `exp-e3`、`after`、`after-dist` 有**, `before`、`up-default`、`exp-e1`、`exp-e2` 擷取時尚未加入)。

## 擷取技術備忘

- Playwright `request.postDataBuffer()` 對 XHR 二進位本體回 null, 故於頁面端 `addInitScript` 攔 `XMLHttpRequest.send`, 經 `exposeBinding` 送回, 以 wsemi `u8arr2obj` 解碼 `{ func, input: { __sysInputArgs__, __sysToken__ } }`; 回應以 `response.body()` 解碼 `{ success: { func, output } }`。
- 輪詢之輸入為 `{ clientId, __sysToken__ }`(舊版元件為 `{ clientId }`), 摘要中 clientId 遮成 `<id>`。
