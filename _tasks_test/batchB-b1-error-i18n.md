# 批 B — B1: 有 lang 業務函數錯誤訊息 i18n ({key, msg})

## 觸發變更
B1 四函數(已有 lang)之 raw reject → 回 key 名 + kpfun `_tErr` 翻譯; 前端移除 raw 字串 if-else,改 err.key 判斷 / err.msg 顯示:
- procLang 新增 key: `userRegistrationResendThrottled` / `userChangePasswordIncorrectOld` / (adminReset throttle key `adminResetPasswordAlreadyTriggered`)
- procCore:
  - `createUser` 759/765/787 'invalid account'/'invalid email format'/'invalid name' → key
  - `resendVerifyEmail` 'invalid account or email'/'resend throttled'/'account already verified'/'send email failed' → key
  - `checkTokenAndChangePassword` 'incorrect old password'/'invalid oldPassword'/'invalid email' → key
  - `adminResetUserPassword` 'forbidden'/'cannot reset self'/'reset already triggered'/'user not found'/'invalid userId' → key
- WWebSso kpfun createUser/resendVerifyEmail/changeUserPassword/adminResetUserPassword catch → `_tErr(lang, err)`
- 前端 PageLogin(register/resend catch) / PageUser(changePw catch) / LayoutContentUsers(adminReset catch) → 移除 raw if-else, err.msg 顯示
- e2e 斷言改: doubleclick:298 'reset already triggered' / 371 'resend throttled' / 412 'incorrect old password' → 比對 .key 或 .msg

## 測試指令
```
npx mocha test/e2e-register.test.mjs test/e2e-login.test.mjs test/e2e-changepassword.test.mjs test/e2e-resetpassword.test.mjs test/e2e-doubleclick.test.mjs --timeout 240000 --reporter list
```

## 預期結果
- register/resend/changepw/resetpw 各錯誤情境顯示後端依 lang 翻譯之中/英訊息
- 受影響 baseline 重產後 byte-equal
- doubleclick 斷言改後通過

## 狀態
PENDING (批 A 完成後執行)
