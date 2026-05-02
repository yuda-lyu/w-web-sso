# 使用者一般登入流程

## 觸發

使用者在 PageLogin.vue 輸入帳號密碼，點擊「Log in」按鈕。

## 重要流程
- 使用者輸入帳密成功登入
- 使用者輸入帳密失敗
- 使用者輸入帳密但未驗證, 得要先去收信驗證後才能登入
- 使用者輸入帳密但帳號被暫時封鎖 (例如登入失敗次數過多時由背景 timer 自動封鎖)
- 使用者輸入帳密但帳號已被停用 (isActive !== 'y')
- 使用者輸入帳密但帳號已過期 (timeExpired 已過)
- 登入成功後依 URL view 參數分流 (轉址 redir / 進入後台 backstage / 進入使用者資訊頁 user)

## 執行流程

```
001  從 URL 取得目標頁面 view ('login'|'backstage'|'user'，無參數預設 'login')  [PageLogin.vue:568]
002  呼叫 mUI.login，帶入帳號、密碼、是否轉址 (view==='login' 時啟用轉址)  [PageLogin.vue:571]
003      執行非同步流程 core()  [mUI.mjs:340]
004          呼叫後端 loginByAccountAndPassword，無 catch，reject 時 throw 至 .catch  [mUI.mjs:364]
005              呼叫保護層 pp.loginByAccountAndPassword (非直接 procCore)  [WWebSso.mjs:1140]
006                  檢查帳號是否被封鎖 (比對 timeBlocked 與當前時間)  [procProtect.mjs:153]
007                      封鎖中:
008                          reject('account blocked')  [procProtect.mjs:158]
009                  呼叫核心層 p.loginByAccountAndPassword  [procProtect.mjs:163]
010                      以帳號查詢使用者 (不限 isActive，以便逐一檢查狀態)  [procCore.mjs:248]
011                          找不到:
012                              reject('incorrect user account or password')  [procCore.mjs:250]
013                      檢查帳號是否啟用 (isActive)  [procCore.mjs:255]
014                          非 'y':
015                              reject('account inactive')  [procCore.mjs:257]
016                      比對密碼雜湊  [procCore.mjs:265]
017                          不一致:
018                              reject('incorrect user account or password')  [procCore.mjs:266]
019                      檢查 email 是否已驗證 (timeVerified 是否有值)  [procCore.mjs:270]
020                          未驗證:
021                              reject('account not verified')  [procCore.mjs:272]
022                      檢查帳號是否過期 (timeExpired 是否已過)  [procCore.mjs:276]
023                          已過期:
024                              reject('account expired')  [procCore.mjs:280]
025                      建立登入 token (到期時間 = 現在 + minExpired 分鐘)  [procCore.mjs:289]
026                      回傳使用者資訊與 token  [procCore.mjs:293]
027                  .then  [procProtect.mjs:164]
028                      清除該帳號的登入失敗紀錄  [procProtect.mjs:174]
029                  .catch  [procProtect.mjs:177]
030                      記錄本次失敗時間  [procProtect.mjs:186]
031                  檢查結果  [procProtect.mjs:198]
032                      成功(state==='success'):
033                          回傳使用者物件  [procProtect.mjs:199]
034                      失敗(state==='error'):
035                          reject 錯誤訊息  [procProtect.mjs:201]
036              .then  [WWebSso.mjs:1141]
037                  暫存使用者物件  [WWebSso.mjs:1142]
038              .catch  [WWebSso.mjs:1144]
039                  暫存錯誤訊息  [WWebSso.mjs:1145]
040              檢查使用者物件  [WWebSso.mjs:1149]
041                  有值:
042                      回傳使用者物件  [WWebSso.mjs:1157]
043                  無值:
044                      reject 錯誤訊息  [WWebSso.mjs:1159]
045          檢查回傳的使用者物件與 token  [mUI.mjs:375]
046              無效:
047                  reject，中止  [mUI.mjs:379]
048          更新前端狀態 (token + 使用者資訊)，將 token 存入 localStorage  [mUI.mjs:401]
049          檢查是否啟用轉址  [mUI.mjs:408]
050              useRedir=true 且有 redir:
051                  轉址至 redir 網址，結束  [mUI.mjs:427]
052              useRedir=true 但無 redir:
053                  顯示錯誤 'failedLoginForNoRedir'，中止  [mUI.mjs:418]
054              useRedir=false:
055                  登入完成，resolve  [mUI.mjs:443]
056      .catch  [mUI.mjs:449]
057          上拋原始 err 給 PageLogin (pm.reject)  [mUI.mjs:456]
058  .then  [PageLogin.vue:572]
059      前往 view 指定的功能頁  [PageLogin.vue:575]
060  .catch(err)  [PageLogin.vue:579]
061      檢查錯誤類型  [PageLogin.vue:582]
062          'account not verified':
063              顯示「重寄驗證信」UI  [PageLogin.vue:584]
064          'account blocked':
065              顯示「帳號已被暫時鎖定」  [PageLogin.vue:587]
066          'account inactive':
067              顯示「帳號已被停用」  [PageLogin.vue:590]
068          'account expired':
069              顯示「帳號已過期」  [PageLogin.vue:593]
070          'incorrect user account or password':
071              顯示「帳密錯誤」  [PageLogin.vue:596]
072          其他:
073              console.log 記錄未知錯誤  [PageLogin.vue:599]
074              顯示「未預期錯誤」  [PageLogin.vue:600]
075      返回登入頁  [PageLogin.vue:604]
```

## 備註：帳號封鎖機制

procProtect 內有獨立的背景 timer（每 2 秒執行），掃描 kpAccountLoginFailed，若某帳號在 minForAccountLoginFailed 分鐘內失敗次數超過 numForAccountLoginFailed，則自動封鎖該帳號（寫入 timeBlocked + 刪除所有 token）。此機制與登入流程非同步，不在 .catch 內同步執行。[procProtect.mjs:207]

## 後端檢查順序

| 順序 | 檢查項目 | reject 字串 | 位置 |
|------|---------|-------------|------|
| 1 | 帳號是否被封鎖 | `account blocked` | procProtect.mjs:158 |
| 2 | 帳號是否存在 | `incorrect user account or password` | procCore.mjs:250 |
| 3 | 帳號是否啟用 | `account inactive` | procCore.mjs:257 |
| 4 | 密碼是否正確 | `incorrect user account or password` | procCore.mjs:266 |
| 5 | email 是否已驗證 | `account not verified` | procCore.mjs:272 |
| 6 | 帳號是否過期 | `account expired` | procCore.mjs:280 |
| 7 | token 建立是否成功 | `can not create a token from userId` | procCore.mjs:289 |

## 錯誤處理層級

| 層級 | 職責 | 位置 |
|------|------|------|
| 後端 | 產生原始錯誤字串 | procCore / procProtect |
| mUI | 上拋原始 err，不做錯誤訊息顯示 | mUI.mjs:449 .catch() |
| PageLogin | 依錯誤類型顯示對應語系訊息 | PageLogin.vue:579 .catch(err) |

## 登入成功分流

| URL 條件 | useRedir | redir | 結果 |
|----------|----------|-------|------|
| 無 view 或 `view=login` | true | 有值 | 轉址至 redir |
| 無 view 或 `view=login` | true | 無值 | 顯示 'failedLoginForNoRedir' |
| `view=backstage` | false | 不看 | 進入後台 |
| `view=user` | false | 不看 | 進入使用者資訊頁 |
