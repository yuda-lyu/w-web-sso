# 自動封鎖機制

## 觸發

後端 `procProtect.mjs` 於 `WWebSso` 啟動時初始化，註冊三個獨立的 `setInterval` 背景 timer（每 2 秒執行一次），分別偵測：
1. 帳號登入失敗次數
2. Token 調用 API 次數
3. IP 調用 API 次數

同時提供給主流程呼叫的記錄函式（`loginByAccountAndPassword`、`callApiByToken`、`callApiByIp`）與查詢函式（`getBlockedByAccount`、`getBlockedByIp`）。

## 重要流程

- **帳號封鎖**：使用者連續輸錯密碼超過門檻，背景 timer 觸發封鎖，更新 `users.timeBlocked` 並刪除對應 token。
- **Token 封鎖**：單一 token 在判準時間內調用 API 次數過多（疑似被濫用或盜用），背景 timer 透過 `blockAccountByToken` 封鎖該 token 對應的使用者（等同帳號封鎖），並刪除該 token。
- **IP 封鎖**：單一 IP 在判準時間內調用 API 次數過多（疑似爬蟲或 DDoS），背景 timer 封鎖該 IP，寫入 `ips.timeBlocked`，後續所有來自該 IP 的請求於 `verifyConn` 被擋下。
- **IP 初次偵測**：另一獨立 timer 定期將 `kpIpCallApi` 內未登記過的新 IP 插入 `ips` 資料表（不設封鎖時間，僅留存紀錄）。
- **封鎖檢查**：
  - 使用者登入前 `loginByAccountAndPassword` 先檢查 `getBlockedByAccount`
  - 所有 API 請求進入 hapi 前於 `verifyConn` 檢查 `getBlockedByIp`
  - `timeBlocked` 以 `當前時間 <= timeBlocked` 判斷為封鎖中，超過則自動解除（不需清空欄位）

## 執行流程
```
待補
```

## 參數設定

| 參數 | 預設 | 說明 | 位置 |
|------|------|------|------|
| `minForAccountLoginFailed` | 10 | 帳號登入失敗之判準時間窗（分鐘） | WWebSso.mjs:181 |
| `numForAccountLoginFailed` | 3 | 判準時間內最多允許的失敗次數 | WWebSso.mjs:188 |
| `minBlockForAccountLoginFailed` | 30 | 觸發後封鎖時長（分鐘） | WWebSso.mjs:195 |
| `minForTokenCallApi` | 10 | Token 調用 API 之判準時間窗（分鐘） | WWebSso.mjs:202 |
| `numForTokenCallApi` | 1000 | 判準時間內單一 token 最多允許的 API 次數 | WWebSso.mjs:209 |
| `minBlockForTokenCallApi` | 30 | 觸發後封鎖時長（分鐘） | WWebSso.mjs:216 |
| `minForIpCallApi` | 10 | IP 調用 API 之判準時間窗（分鐘） | WWebSso.mjs:223 |
| `numForIpCallApi` | 10000 | 判準時間內單一 IP 最多允許的 API 次數 | WWebSso.mjs:230 |
| `minBlockForIpCallApi` | 30 | 觸發後封鎖時長（分鐘） | WWebSso.mjs:237 |

## 三類封鎖對照表

| 項目 | 帳號封鎖 (Account) | Token 封鎖 | IP 封鎖 |
|------|-------------------|-----------|---------|
| 觸發條件 | 登入失敗次數超標 | 單一 token 調用 API 次數超標 | 單一 IP 調用 API 次數超標 |
| 記錄位置 | `kpAccountLoginFailed[account]` | `kpTokenCallApi[token]` | `kpIpCallApi[ip]` |
| 記錄時機 | `loginByAccountAndPassword` .catch | 每次 API handler 內 `pp.callApiByToken` | `verifyConn` 內 `pp.callApiByIp` |
| 封鎖落地欄位 | `users.timeBlocked` | `users.timeBlocked`（透過 token 查 user） | `ips.timeBlocked` |
| 附帶動作 | 刪除該使用者 token | 刪除該 token（等同強制登出） | 無 |
| 檢查時機 | 登入時於 `loginByAccountAndPassword` 前 | 無主動檢查（封鎖已透過刪 token 阻斷） | 每次請求於 `verifyConn` 前 |
| reject/阻斷訊息 | `account blocked` | token 失效（`invalid token`） | `verifyConn` 回傳 false |

## 記憶體結構

三種記錄皆為 in-memory 物件，server 重啟後歸零；`ips` 表與 `users.timeBlocked` 為持久化紀錄。

```
kpAccountLoginFailed = { [account]: [timeStr, timeStr, ...] }   // 登入失敗時間戳
kpTokenCallApi       = { [token]:   [timeStr, timeStr, ...] }   // token 調用時間戳
kpIpCallApi          = { [ip]:      [timeStr, timeStr, ...] }   // IP 調用時間戳
```

## 執行流程

### A. 帳號登入失敗封鎖

```
A01  使用者執行登入 loginByAccountAndPassword(account, password)  [procProtect.mjs:150]
A02  先查詢帳號是否被封鎖 getBlockedByAccount  [procProtect.mjs:153]
A03      讀取 users.timeBlocked 比對當前時間  [procProtect.mjs:54]
A04      當前時間 <= timeBlocked:
A05          封鎖中, reject('account blocked')  [procProtect.mjs:158]
A06      timeBlocked 為空或已過期:
A07          放行
A08  呼叫核心層 p.loginByAccountAndPassword  [procProtect.mjs:163]
A09      .then (登入成功):
A10          清空 kpAccountLoginFailed[account]  [procProtect.mjs:174]
A11      .catch (登入失敗):
A12          kpAccountLoginFailed[account].push(現在時間)  [procProtect.mjs:186]
A13  背景 timer (每 2 秒) 掃描 kpAccountLoginFailed  [procProtect.mjs:207]
A14      計算 timeStart = 現在 - minForAccountLoginFailed 分鐘  [procProtect.mjs:216]
A15      逐帳號過濾掉 timeStart 之前的記錄, 僅保留判準時間窗內  [procProtect.mjs:223]
A16      若判準時間窗內失敗次數 > numForAccountLoginFailed:  [procProtect.mjs:236]
A17          呼叫 blockAccount(account)  [procProtect.mjs:240]
A18              取得該 user 物件  [procProtect.mjs:113]
A19              若已在封鎖中, 直接跳出 (不延長)  [procProtect.mjs:124]
A20              計算 timeBlocked = 現在 + minBlockForAccountLoginFailed 分鐘  [procProtect.mjs:129]
A21              更新 users.timeBlocked  [procProtect.mjs:133]
A22              刪除該 user 擁有的 tokens 紀錄 (強制登出)  [procProtect.mjs:142]
A23  lockingForAccountLoginFailed 互斥旗標避免 timer 重入  [procProtect.mjs:210]
```

### B. Token 調用 API 次數封鎖

```
B01  API handler 內每次請求呼叫 pp.callApiByToken(token)  [WWebSso.mjs:819,855,891,927,971]
B02      kpTokenCallApi[token].push(現在時間)  [procProtect.mjs:321]
B03  背景 timer (每 2 秒) 掃描 kpTokenCallApi  [procProtect.mjs:344]
B04      計算 timeStart = 現在 - minForTokenCallApi 分鐘  [procProtect.mjs:353]
B05      逐 token 過濾, 僅保留判準時間窗內的紀錄  [procProtect.mjs:360]
B06      若判準時間窗內呼叫次數 > numForTokenCallApi:  [procProtect.mjs:373]
B07          呼叫 blockAccountByToken(token)  [procProtect.mjs:377]
B08              以 token 查 tokens 表取得 userId  [procProtect.mjs:263]
B09              以 userId 取 user 物件  [procProtect.mjs:280]
B10              若 user 已在封鎖中, 直接跳出 (不延長)  [procProtect.mjs:290]
B11              計算 timeBlocked = 現在 + minBlockForTokenCallApi 分鐘  [procProtect.mjs:295]
B12              更新 users.timeBlocked  [procProtect.mjs:299]
B13              刪除該 token 紀錄 (等同強制登出, 後續該 token 即失效)  [procProtect.mjs:305]
B14  lockingForTokenCallApi 互斥旗標避免 timer 重入  [procProtect.mjs:347]
```

備註：Token 封鎖採「封鎖 user + 刪 token」而非在 token 上加封鎖欄位，後續請求帶該 token 查不到 tokens 紀錄就會直接失效，下次登入亦受 `users.timeBlocked` 擋下。

### C. IP 調用 API 次數封鎖

```
C01  每次 API 請求進入 hapi verifyConn  [WWebSso.mjs:1052]
C02      以 pp.getIpByHeaders(req) 取得 client IP  [WWebSso.mjs:1056, procProtect.mjs:397]
C03          優先順序: x-forwarded-for[0] > req.info.remoteAddress > req.socket.remoteAddress > req.connection.remoteAddress  [procProtect.mjs:417~447]
C04      pp.callApiByIp(ip)  [WWebSso.mjs:1069]
C05          kpIpCallApi[ip].push(現在時間)  [procProtect.mjs:633]
C06      pp.getBlockedByIp(ip)  [WWebSso.mjs:1073]
C07          以 ip 查 ips 表  [procProtect.mjs:510]
C08              查無: 回傳 false (未封鎖)  [procProtect.mjs:532]
C09              查有: 比對 ips.timeBlocked 與當前時間  [procProtect.mjs:460]
C10                  當前時間 <= timeBlocked: 回傳 true (封鎖中)  [procProtect.mjs:481]
C11                  否則: 回傳 false  [procProtect.mjs:486]
C12      將 b 反向為「通行」布林值 (b = !b)  [WWebSso.mjs:1085]
C13      b = true: 放行進入 API handler  [WWebSso.mjs:1099]
C14      b = false: 拒絕連線, console.log('block ip[...]')  [WWebSso.mjs:1096]
C15  背景 timer (每 2 秒) 掃描 kpIpCallApi  [procProtect.mjs:721]
C16      計算 timeStart = 現在 - minForIpCallApi 分鐘  [procProtect.mjs:730]
C17      逐 IP 過濾, 僅保留判準時間窗內的紀錄  [procProtect.mjs:737]
C18      若判準時間窗內呼叫次數 > numForIpCallApi:  [procProtect.mjs:750]
C19          呼叫 blockIpByIp(ip)  [procProtect.mjs:754]
C20              若 ips 表無此 ip, insert 一筆含 timeBlocked 的新紀錄  [procProtect.mjs:575]
C21              若已有此 ip 且在封鎖中, 直接跳出 (不延長)  [procProtect.mjs:604]
C22              否則更新 ips.timeBlocked = 現在 + minBlockForIpCallApi 分鐘  [procProtect.mjs:611]
C23  lockingForIpCallApi 互斥旗標避免 timer 重入  [procProtect.mjs:724]
```

### D. IP 初次偵測（非封鎖，僅登記）

```
D01  背景 timer (每 2 秒) 掃描 kpIpCallApi 與 ips 表  [procProtect.mjs:656]
D02      取 kpIpCallApi 所有 key (現存出現過的 ip)  [procProtect.mjs:665]
D03      取 ips 表現有紀錄 getIpsList  [procProtect.mjs:669]
D04      比對出 kpIpNew 有但 ips 表內還沒有的新 ip  [procProtect.mjs:686]
D05      以 ds.ips.funNew 產生新 oip 物件 (無 timeBlocked)  [procProtect.mjs:698]
D06      批次 insert 進 ips 表  [procProtect.mjs:708]
D07  lockingForIpDetectNew 互斥旗標避免 timer 重入  [procProtect.mjs:659]
```

## 封鎖判定語意

`getBlockedByUser` / `getBlockedByOip` 都使用同一套邏輯（[procProtect.mjs:66](server/procProtect.mjs#L66)、[procProtect.mjs:472](server/procProtect.mjs#L472)）：

| `timeBlocked` 欄位狀態 | 比對結果 | 回傳 |
|------------------------|----------|------|
| 為空字串 `''` | - | `false`（未封鎖） |
| 合法 ISO 時間且 `當前 <= timeBlocked` | 仍在封鎖區間 | `true`（封鎖中） |
| 合法 ISO 時間且 `當前 > timeBlocked` | 封鎖時效已過 | `false`（自動解除） |
| 其他非法值 | - | reject |

因此「解鎖」是隱性的：不需要把 `timeBlocked` 清空，時間一到就自動視為解除，既省去額外寫入亦避免競態。

## 重複封鎖保護

三個 `blockXxx` 函式皆在更新 `timeBlocked` 前先檢查 `getBlockedByXxx`，若已在封鎖區間則直接跳出（不延長封鎖時間）。[procProtect.mjs:124](server/procProtect.mjs#L124)、[procProtect.mjs:290](server/procProtect.mjs#L290)、[procProtect.mjs:607](server/procProtect.mjs#L607)

## Timer 互斥

每個 timer 都有對應的 `lockingForXxx` 旗標，進入時若前一輪仍在執行則直接 return，避免資料庫操作重入（2 秒間隔若遇到慢速 I/O 可能尚未完成）。

## 前端呈現

- 使用者登入被擋：`PageLogin.vue` 於 `.catch(err)` 比對 `err === 'account blocked'`，顯示「帳號已被暫時鎖定」對應語系訊息。[PageLogin.vue:587](src/components/PageLogin.vue#L587)
- IP 被擋：`verifyConn` 直接返回 `false`，由 hapi 層阻斷，前端會收到連線失敗（非特定錯誤訊息）。
- Token 被擋：對應 token 紀錄被刪後，前端任何 API 會拿到 `invalid token`，通常導致前端回到登入頁。

## 與其他流程的關聯

| 相關流程 | 關聯點 |
|---------|--------|
| [z流程_使用者一般登入.md](z流程_使用者一般登入.md) | 登入前經 `pp.loginByAccountAndPassword` 檢查 `getBlockedByAccount`；失敗次數由本機制累計 |
| [z流程_使用者自動登入.md](z流程_使用者自動登入.md) | 自動登入走 `checkToken`，若 token 因 B/C 封鎖已被刪除則自動登入失敗 |
| `verifyConn` | 所有 API 進入點，IP 封鎖於此處生效 |
