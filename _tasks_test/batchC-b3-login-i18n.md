# 批 C — B3: login 鏈錯誤訊息 i18n ({key, msg})

## 觸發變更
login 鏈加 lang + 後端翻譯; 前端 PageLogin login catch 改 err.key 判斷種類(含 showResendVerify) / err.msg 顯示:
- procLang: 新增 `loginIncorrect` (重用 loginAccountBlocked/loginAccountExpired/userRegistrationNotVerified)
- procCore `loginByAccountAndPassword`: 'incorrect user account or password'/'account not verified'/'account expired' → key
- procProtect `loginByAccountAndPassword`/`blockAccount`: 'account blocked' → key
- WWebSso kpfun `loginByAccountAndPassword`: 加 lang 參數 + catch `_tErr(lang, err)`
- 前端 mUI.mjs:380 `loginByAccountAndPassword(account, password)` → 加傳 lang
- 前端 PageLogin login catch: 移除 raw 字串 if-else; 改 `if (err.key === 'userRegistrationNotVerified') showResendVerify=true`; 顯示 err.msg
- e2e 斷言: login 各失敗情境改比對 err.key / err.msg

## 測試指令
```
npx mocha test/e2e-login.test.mjs test/e2e-autoblock.test.mjs --timeout 240000 --reporter list
```

## 預期結果
- login 帳密錯/未驗證(含 resend 連結 via err.key)/過期/封鎖 各顯示後端翻譯訊息
- showResendVerify 行為靠 err.key 觸發,不靠 raw 英文字串
- 受影響 baseline (login eng/cht) 重產後 byte-equal

## 狀態
PENDING (批 A,B 完成後執行)
