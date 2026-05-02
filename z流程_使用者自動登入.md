# 使用者自動登入流程

## 觸發

App.vue mounted 時自動執行。檢查 localStorage 是否有快取的 token，有則嘗試自動登入。

## 重要流程
- 使用者開登入網頁, 因過往已成功登入, 直接轉跳redir
- 使用者開登入網頁, 因過往未登入, 直接轉回登入頁
- 使用者開登入網頁, 過往已成功登入但帳號已非啟用(isActive='n'), getUserByToken 查無使用者而 reject, 轉回登入頁
- 使用者開登入網頁, token 快取存在但後端資料庫已查無(如已登出或被管理員清除), 清空 localStorage token 並轉回登入頁
- 使用者開登入網頁, token 快取存在但已過期, 清空 localStorage token 並轉回登入頁
- 使用者開登入網頁, 自動登入成功但使用者資料無 redir 欄位值, 顯示 'failedLoginForNoRedir' 錯誤並轉回登入頁
- 使用者開登入網頁, 但前端 webKey 尚未取得, 顯示 'failedLoginForNoWebKey' 錯誤並轉回登入頁
- 使用者以 view=backstage 或 view=user 開啟頁面, 自動登入成功後停留於前端並進入該功能頁 (不轉址)
- 自動登入過程中後端任何 reject/例外, 統一被外層 .catch 接住後以 reject 回傳 (alert 已註解, 不顯示通用錯誤訊息), 由 App.vue 轉回登入頁

## 執行流程

```
001  從 URL 取得目標頁面 view，無參數預設 'login'  [App.vue:96]
002  呼叫 mUI.autoLogin，帶入是否轉址 (view==='login' 時啟用轉址)  [App.vue:100]
003      執行非同步流程 core()  [mUI.mjs:507]
004          等待 syncState 為 true (waitFun 無 timeout, 不會 reject)  [mUI.mjs:512]
005          從 store 取得 webKey 作為 $keyLS  [mUI.mjs:518]
006              無 $keyLS:
007                  顯示 'failedLoginForNoWebKey' 錯誤, reject('invalid $keyLS')  [mUI.mjs:522]
008          以 `${$keyLS}:userToken` 為 key, 從 localStorage 取得快取的 token  [mUI.mjs:539]
009              無 token:
010                  reject('no token')，靜默回到登入頁（不顯示錯誤）  [mUI.mjs:543]
011          呼叫後端 checkToken 驗證 token 是否有效, 接住回傳的 boolean 至 b  [mUI.mjs:553]
012              查詢 token 是否存在於資料庫  [procCore.mjs:417]
013                  找不到:
014                      reject('invalid token')  [procCore.mjs:428]
015                  重複(>=2):
016                      reject('duplicate tokens')  [procCore.mjs:435]
017              比對到期時間 (tn < timeEnd)  [procCore.mjs:380]
018                  已過期:
019                      回傳 false (resolve, 不 reject)  [procCore.mjs:409]
020              回傳 true（token 有效）  [procCore.mjs:456]
021          .catch  [mUI.mjs:558]
022              非預期錯誤 (找不到 token、duplicate、查詢例外) 時填入 errTemp  [mUI.mjs:558]
023          檢查 errTemp 或 b 為 false, 任一條件成立:
024              清空 localStorage token, reject (errTemp 為 'token error', 過期為 'token expired')  [mUI.mjs:566]
025          呼叫後端 getUserByToken 取得使用者資訊，無 catch，reject 時 throw 至 .catch  [mUI.mjs:576]
026              以 token 查找 userId，再以 userId 查找使用者（查詢含 isActive:'y'）  [procCore.mjs:1147]
027              回傳使用者物件（不含密碼）  [procCore.mjs:1251]
028          後端回傳成功，繼續前端處理  [mUI.mjs:580]
029          檢查回傳的使用者物件  [mUI.mjs:580]
030              無效:
031                  reject('invalid user')  [mUI.mjs:584]
032          更新前端狀態 (token + 使用者資訊)  [mUI.mjs:590]
033          檢查是否啟用轉址  [mUI.mjs:594]
034              useRedir=true 且有 redir:
035                  轉址至 redir 網址，resolve('redir')  [mUI.mjs:614]
036              useRedir=true 但無 redir:
037                  顯示錯誤 'failedLoginForNoRedir'，reject('invalid redir')  [mUI.mjs:605]
038              useRedir=false:
039                  登入完成，resolve('done')  [mUI.mjs:624]
040      .catch  [mUI.mjs:630]
041          接住 core 內所有未 catch 的 reject/throw  [mUI.mjs:630]
042          alert('failedLoginForCatch') 已註解, 不顯示通用錯誤訊息  [mUI.mjs:633]
043          以 reject 回傳原始 err  [mUI.mjs:637]
044  .then  [App.vue:101]
045      前往 view 指定的功能頁，autoLogining = false  [App.vue:104]
046  .catch  [App.vue:109]
047      返回登入頁，autoLogining = false  [App.vue:112]
```
