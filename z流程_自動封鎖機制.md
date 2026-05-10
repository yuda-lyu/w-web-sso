# 自動封鎖機制

## 觸發

後端 `procProtect.mjs` 於 `WWebSso` 啟動時初始化（被 `WWebSso.mjs:469` 帶入九個 opt 參數呼叫），於同一個 closure 內註冊四個獨立的 `setInterval` 背景 timer（每 2 秒執行一次），分別偵測：
1. 帳號登入失敗次數
2. Token 調用 API 次數
3. IP 調用 API 次數
4. IP 初次出現偵測（僅登記，不封鎖）

同時對外輸出（掛在 `pp` 物件上）：
- 給主流程呼叫的記錄函式：`loginByAccountAndPassword`（保護層）、`callApiByToken`、`callApiByIp`
- 給主流程呼叫的查詢函式：`getBlockedByAccount`、`getBlockedByIp`
- 取得 client IP 的工具：`getIpByHeaders`

## 重要流程

- 使用者短時間內輸錯密碼次數過多, 帳號被自動封鎖, 同時被強制登出
- 使用者輸錯多次後輸對一次, 失敗紀錄歸零, 不會累計到觸發封鎖
- 使用者帳號封鎖中再嘗試登入, 顯示「帳號已被暫時鎖定」
- 使用者帳號封鎖時間到期, 自動解除, 可再正常登入
- 同一 token 短時間內調用 API 次數過多, 該使用者被封鎖且該 token 失效
- 同一 IP 短時間內調用 API 次數過多, 該 IP 被封鎖
- IP 封鎖中, 來自該 IP 的請求於連線層被擋下
- IP 封鎖時間到期, 自動解除
- 後端取不到 client IP, 該請求以封鎖處理 (fail-closed)
- 新 IP 首次調用 API, 自動登記至 ips 表 (純登記, 不封鎖)

## 執行流程

### A. 帳號登入失敗封鎖

```
A01  使用者執行登入，前端呼叫後端 loginByAccountAndPassword(account, password)
A02  進入保護層 pp.loginByAccountAndPassword  [procProtect.mjs:150]
A03      先查詢帳號是否被封鎖 getBlockedByAccount  [procProtect.mjs:153]
A04          以 account 取 user 物件 (p.getGenUserByAccount)  [procProtect.mjs:97]
A05          讀取 user.timeBlocked，呼叫 getBlockedByUser  [procProtect.mjs:104]
A06              空字串: 回傳 false (未封鎖)  [procProtect.mjs:85]
A07              合法 ISO 時間且 當前 <= timeBlocked: 回傳 true (封鎖中)  [procProtect.mjs:75]
A08              合法 ISO 時間且 當前 > timeBlocked: 回傳 false (時效已過, 自動解除)  [procProtect.mjs:79]
A09              其他非法值: reject  [procProtect.mjs:89]
A10      封鎖中:
A11          reject('account blocked')  [procProtect.mjs:158]
A12      未封鎖:
A13          呼叫核心層 p.loginByAccountAndPassword  [procProtect.mjs:163]
A14          .then (登入成功):
A15              清空 kpAccountLoginFailed[account] = []  [procProtect.mjs:174]
A16              r = { state:'success', msg:user }  [procProtect.mjs:168]
A17          .catch (登入失敗):
A18              kpAccountLoginFailed[account].push(現在時間)  [procProtect.mjs:186]
A19              r = { state:'error', msg:err }  [procProtect.mjs:189]
A20      r.state==='success': 回傳 user  [procProtect.mjs:198]
A21      r.state==='error':   reject(原始 err)  [procProtect.mjs:201]
A22  背景 timer (每 2 秒) 掃描 kpAccountLoginFailed  [procProtect.mjs:207]
A23      lockingForAccountLoginFailed 互斥旗標, 上一輪未結束直接 return  [procProtect.mjs:210]
A24      timeStart = 現在 - minForAccountLoginFailed 分鐘  [procProtect.mjs:216]
A25      逐帳號過濾掉 timeStart 之前的記錄, 僅保留判準時間窗內  [procProtect.mjs:223]
A26      若判準時間窗內失敗次數 > numForAccountLoginFailed:  [procProtect.mjs:236]
A27          呼叫 blockAccount(account)  [procProtect.mjs:240]
A28              取得該 user 物件  [procProtect.mjs:114]
A29              若已在封鎖中, 直接跳出 (不延長封鎖時間)  [procProtect.mjs:124]
A30              timeBlocked = 現在 + minBlockForAccountLoginFailed 分鐘  [procProtect.mjs:129]
A31              更新 users.timeBlocked  [procProtect.mjs:133]
A32              刪除該 user 擁有的 tokens 紀錄 (強制登出)  [procProtect.mjs:142]
```

### B. Token 調用 API 次數封鎖

```
B01  API handler 內每次請求皆呼叫 pp.callApiByToken(token)  [WWebSso.mjs:819,855,891,927,971]
B02      kpTokenCallApi[token].push(現在時間)  [procProtect.mjs:321]
B03  背景 timer (每 2 秒) 掃描 kpTokenCallApi  [procProtect.mjs:344]
B04      lockingForTokenCallApi 互斥旗標  [procProtect.mjs:347]
B05      timeStart = 現在 - minForTokenCallApi 分鐘  [procProtect.mjs:353]
B06      逐 token 過濾, 僅保留判準時間窗內的紀錄  [procProtect.mjs:360]
B07      若判準時間窗內呼叫次數 > numForTokenCallApi:  [procProtect.mjs:373]
B08          呼叫 blockAccountByToken(token)  [procProtect.mjs:377]
B09              以 token 查 tokens 表取得 userId  [procProtect.mjs:263]
B10              以 userId 取 user 物件 (p.getGenUserByUserId)  [procProtect.mjs:280]
B11              若 user 已在封鎖中, 直接跳出 (不延長封鎖時間)  [procProtect.mjs:290]
B12              timeBlocked = 現在 + minBlockForTokenCallApi 分鐘  [procProtect.mjs:295]
B13              更新 users.timeBlocked  [procProtect.mjs:299]
B14              刪除該 token 紀錄 (等同強制登出, 後續該 token 即失效)  [procProtect.mjs:305]
```

> 備註：Token 封鎖採「封鎖 user + 刪 token」而非在 token 上加封鎖欄位，後續請求帶該 token 查不到 tokens 紀錄就會直接得 `invalid token` 而失效；同帳號下次重新登入也會被 `users.timeBlocked` 擋下。

### C. IP 調用 API 次數封鎖

```
C01  每次 API 請求進入 hapi verifyConn  [WWebSso.mjs:1074]
C02      pp.getIpByHeaders(req) 取得 client IP  [WWebSso.mjs:1078, procProtect.mjs:397]
C03          優先順序: x-forwarded-for[0] > req.info.remoteAddress
C04                  > req.socket.remoteAddress > req.connection.remoteAddress  [procProtect.mjs:417~447]
C05      pp.callApiByIp(ip)  [WWebSso.mjs:1091]
C06          kpIpCallApi[ip].push(現在時間)  [procProtect.mjs:633]
C07      pp.getBlockedByIp(ip)  [WWebSso.mjs:1095]
C08          以 ip 查 ips 表 (p.getIpByKV)  [procProtect.mjs:510]
C09              查無: 回傳 false (未封鎖)  [procProtect.mjs:532]
C10              查有: 比對 ips.timeBlocked 與當前時間 (getBlockedByOip)  [procProtect.mjs:460]
C11                  當前時間 <= timeBlocked: 回傳 true (封鎖中)  [procProtect.mjs:481]
C12                  否則: 回傳 false  [procProtect.mjs:486]
C13      將 b 反向為「通行」布林值 (b = !b)  [WWebSso.mjs:1107]
C14      b = false: console.log('block ip[...]'), 拒絕連線  [WWebSso.mjs:1118]
C15      b = true:  放行進入 API handler
C16  背景 timer (每 2 秒) 掃描 kpIpCallApi  [procProtect.mjs:721]
C17      lockingForIpCallApi 互斥旗標  [procProtect.mjs:724]
C18      timeStart = 現在 - minForIpCallApi 分鐘  [procProtect.mjs:730]
C19      逐 IP 過濾, 僅保留判準時間窗內的紀錄  [procProtect.mjs:737]
C20      若判準時間窗內呼叫次數 > numForIpCallApi:  [procProtect.mjs:750]
C21          呼叫 blockIpByIp(ip)  [procProtect.mjs:754]
C22              若 ips 表無此 ip, 以 ds.ips.funNew 產生含 timeBlocked 的新 oip 並 insert  [procProtect.mjs:575]
C23              若已有此 ip 且在封鎖中, 直接跳出 (不延長封鎖時間)  [procProtect.mjs:604]
C24              否則更新 ips.timeBlocked = 現在 + minBlockForIpCallApi 分鐘  [procProtect.mjs:611]
```

### D. IP 初次偵測（非封鎖，僅登記）

```
D01  背景 timer (每 2 秒) 掃描 kpIpCallApi 與 ips 表  [procProtect.mjs:656]
D02      lockingForIpDetectNew 互斥旗標  [procProtect.mjs:659]
D03      取 kpIpCallApi 所有 key (現存出現過的 ip)  [procProtect.mjs:665]
D04      取 ips 表現有紀錄 p.getIpsList  [procProtect.mjs:669]
D05      比對出 kpIpCallApi 有但 ips 表內還沒有的新 ip  [procProtect.mjs:686]
D06      以 ds.ips.funNew 產生新 oip 物件 (無 timeBlocked)  [procProtect.mjs:698]
D07      批次 insert 進 ips 表  [procProtect.mjs:708]
```

## 參數設定

| 參數 | 預設 | 說明 | 位置 |
|------|------|------|------|
| `minForAccountLoginFailed`     | 10    | 帳號登入失敗之判準時間窗（分鐘） | WWebSso.mjs:181 |
| `numForAccountLoginFailed`     | 3     | 判準時間內最多允許的失敗次數 | WWebSso.mjs:188 |
| `minBlockForAccountLoginFailed`| 30    | 觸發後封鎖時長（分鐘） | WWebSso.mjs:195 |
| `minForTokenCallApi`           | 10    | Token 調用 API 之判準時間窗（分鐘） | WWebSso.mjs:202 |
| `numForTokenCallApi`           | 1000  | 判準時間內單一 token 最多允許的 API 次數 | WWebSso.mjs:209 |
| `minBlockForTokenCallApi`      | 30    | 觸發後封鎖時長（分鐘） | WWebSso.mjs:216 |
| `minForIpCallApi`              | 10    | IP 調用 API 之判準時間窗（分鐘） | WWebSso.mjs:223 |
| `numForIpCallApi`              | 10000 | 判準時間內單一 IP 最多允許的 API 次數 | WWebSso.mjs:230 |
| `minBlockForIpCallApi`         | 30    | 觸發後封鎖時長（分鐘） | WWebSso.mjs:237 |

## 三類封鎖對照表

| 項目 | 帳號封鎖 (Account) | Token 封鎖 | IP 封鎖 |
|------|-------------------|-----------|---------|
| 觸發條件 | 登入失敗次數超標 | 單一 token 調用 API 次數超標 | 單一 IP 調用 API 次數超標 |
| 記錄位置（記憶體） | `kpAccountLoginFailed[account]` | `kpTokenCallApi[token]` | `kpIpCallApi[ip]` |
| 記錄時機 | `pp.loginByAccountAndPassword` 的 .catch | 每次 API handler 內 `pp.callApiByToken` | 每次 `verifyConn` 內 `pp.callApiByIp` |
| 偵測 timer | A 區塊（每 2 秒） | B 區塊（每 2 秒） | C 區塊（每 2 秒） |
| 封鎖落地欄位 | `users.timeBlocked` | `users.timeBlocked`（透過 token 反查 user） | `ips.timeBlocked` |
| 附帶動作 | 刪除該使用者所有 token（強制登出） | 刪除該 token（等同強制登出） | 無 |
| 主動檢查時機 | 登入時於 `pp.loginByAccountAndPassword` 前 | 無主動檢查（封鎖已透過刪 token 阻斷） | 每次請求於 `verifyConn` |
| reject/阻斷訊息 | `account blocked` | token 失效（後續 API 拿到 `invalid token`） | `verifyConn` 回傳 false（hapi 層阻斷） |

## 記憶體結構

三類記錄皆為 in-memory 物件（procProtect closure 內），server 重啟後歸零；`ips` 表與 `users.timeBlocked` 為持久化紀錄。

```
kpAccountLoginFailed = { [account]: [timeStr, timeStr, ...] }   // 登入失敗時間戳
kpTokenCallApi       = { [token]:   [timeStr, timeStr, ...] }   // token 調用時間戳
kpIpCallApi          = { [ip]:      [timeStr, timeStr, ...] }   // IP 調用時間戳
```

每輪 timer 都會把陣列裁切為「僅保留判準時間窗內的紀錄」，故記憶體用量受時間窗與流量上限綁定，不會無限成長。

## 封鎖判定語意

`getBlockedByUser`（[procProtect.mjs:54](server/procProtect.mjs#L54)）與 `getBlockedByOip`（[procProtect.mjs:460](server/procProtect.mjs#L460)）共用同一套邏輯：

| `timeBlocked` 欄位狀態 | 比對結果 | 回傳 |
|------------------------|----------|------|
| 為空字串 `''` | - | `false`（未封鎖） |
| 合法 ISO 時間且 `當前 <= timeBlocked` | 仍在封鎖區間 | `true`（封鎖中） |
| 合法 ISO 時間且 `當前 > timeBlocked` | 封鎖時效已過 | `false`（自動解除） |
| 其他非法值 | - | `reject` |

「解鎖」為隱性：不需要把 `timeBlocked` 清空，時間一到自動視為解除，省去額外寫入並避免競態。

## 重複封鎖保護

三個 `blockXxx` 函式皆在更新 `timeBlocked` 前先檢查當前是否已在封鎖區間，若是直接跳出，**不延長封鎖時間**：

- `blockAccount`：[procProtect.mjs:124](server/procProtect.mjs#L124)
- `blockAccountByToken`：[procProtect.mjs:290](server/procProtect.mjs#L290)
- `blockIpByIp`（已存在 ip 的分支）：[procProtect.mjs:607](server/procProtect.mjs#L607)

設計理由：避免暴力流量在封鎖中持續觸發 timer 不斷把封鎖時間往後延，造成事實上「永久封鎖」。

## Timer 互斥

每個 timer 都有對應的 `lockingForXxx` 旗標，進入時若前一輪仍在執行則直接 return，避免資料庫操作重入（2 秒間隔若遇到慢速 I/O 可能尚未完成）。`finally` 內必歸零，確保下一輪能正常進入。

| Timer | 互斥旗標 | 位置 |
|-------|---------|------|
| 帳號登入失敗 | `lockingForAccountLoginFailed` | procProtect.mjs:206 |
| Token 調用 API | `lockingForTokenCallApi` | procProtect.mjs:343 |
| IP 初次偵測 | `lockingForIpDetectNew` | procProtect.mjs:655 |
| IP 調用 API | `lockingForIpCallApi` | procProtect.mjs:720 |

## 前端呈現

- **使用者登入被擋（帳號封鎖）**：`PageLogin.vue` 於 `.catch(err)` 比對 `errMsg === 'account blocked'`，顯示「帳號已被暫時鎖定」對應語系訊息。[PageLogin.vue:620](src/components/PageLogin.vue#L620)
- **IP 被擋**：`verifyConn` 直接返回 false，由 hapi 層阻斷，前端會收到連線失敗（無特定錯誤訊息）。
- **Token 被擋**：對應 token 紀錄已被刪除，前端任何 API 會拿到 `invalid token`，通常觸發前端清空 localStorage token 並回到登入頁。

