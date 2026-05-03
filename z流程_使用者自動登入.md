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
001  從 URL 取得目標頁面 view，無參數預設 'login'  [App.vue:97]
002  呼叫 mUI.autoLogin，帶入是否轉址 (view==='login' 時啟用轉址)  [App.vue:101]
003      執行非同步流程 core()  [mUI.mjs:522]
004          等待 syncState 為 true (waitFun 無 timeout, 不會 reject)  [mUI.mjs:527]
005          從 store 取得 webKey 作為 $keyLS  [mUI.mjs:533]
006              無 $keyLS:
007                  顯示 'failedLoginForNoWebKey' 錯誤, reject('invalid $keyLS')  [mUI.mjs:541]
008          以 `${$keyLS}:userToken` 為 key, 從 localStorage 取得快取的 token  [mUI.mjs:554]
009              無 token:
010                  reject('no token')，靜默回到登入頁（不顯示錯誤）  [mUI.mjs:562]
011          呼叫後端 checkToken 驗證 token, 後端在過期或無效時一律 reject (永遠不 resolve(false))  [mUI.mjs:569]
012              查詢 token 是否存在於資料庫  [procCore.mjs:417]
013                  找不到:
014                      reject('invalid token')  [procCore.mjs:428]
015                  重複(>=2):
016                      reject('duplicate tokens')  [procCore.mjs:435]
017              比對到期時間 (tn < timeEnd)  [procCore.mjs:380]
018                  已過期:
019                      _checkToken 回傳 false; checkToken wrapper 將 false 轉為 reject('token expired')  [procCore.mjs:409, 485]
020              token 有效時 _checkToken 回傳 true; checkToken wrapper 也 return true  [procCore.mjs:456, 504]
021          .catch  [mUI.mjs:573]
022              後端任何 reject (invalid token / duplicate tokens / token expired) 都進這裡, 填入 errTemp  [mUI.mjs:573]
023          檢查 errTemp 或 b 為 false:
024              清空 localStorage token, reject('token error')  [mUI.mjs:582, 585]
025              註：因後端 wrapper 永遠 reject 不 resolve(false)，errTemp 必為 truthy，
                   三元運算 `errTemp ? 'token error' : 'token expired'` 永遠走 'token error' 分支；
                   'token expired' 分支為防禦性 fallback，現行程式碼路徑不會到達
026          呼叫後端 getUserByToken 取得使用者資訊，無 catch，reject 時 throw 至 .catch  [mUI.mjs:591]
027              以 token 查找 userId，再以 userId 查找使用者（_getGenUserByKV 查詢含 isActive:'y'）  [procCore.mjs:1147, 56]
028              回傳使用者物件（不含密碼）  [procCore.mjs:1251]
029          後端回傳成功，繼續前端處理  [mUI.mjs:591]
030          檢查回傳的使用者物件  [mUI.mjs:595]
031              無效:
032                  reject('invalid user')  [mUI.mjs:599]
033          更新前端狀態 (token + 使用者資訊)  [mUI.mjs:605]
034          檢查是否啟用轉址  [mUI.mjs:609]
035              useRedir=true 且有 redir:
036                  goUrl 帶當前 lang 自動 append &lang= 至 redir URL，轉址，resolve('redir')  [mUI.mjs:630]
037              useRedir=true 但無 redir:
038                  顯示錯誤 'failedLoginForNoRedir'，reject('invalid redir')  [mUI.mjs:620]
039              useRedir=false:
040                  登入完成，resolve('done')  [mUI.mjs:640]
041      .catch  [mUI.mjs:646]
042          接住 core 內所有未 catch 的 reject/throw  [mUI.mjs:646]
043          alert('failedLoginForCatch') 已註解, 不顯示通用錯誤訊息  [mUI.mjs:650]
044          以 reject 回傳原始 err  [mUI.mjs:653]
045  .then  [App.vue:102]
046      前往 view 指定的功能頁，autoLogining = false  [App.vue:105]
047  .catch  [App.vue:110]
048      返回登入頁，autoLogining = false  [App.vue:113]
```
