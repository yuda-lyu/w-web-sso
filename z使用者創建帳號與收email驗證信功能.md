# 使用者創建帳號與收 email 驗證信功能

> 依賴：規格書 1（passwordPolicy 設定）
> 被依賴：無


## 一、目的

提供使用者自行於登入頁申請註冊帳號的功能，註冊後須收 email 驗證信並點擊連結完成驗證，帳號才能登入。此功能可透過 `settings.json` 中的 `allowUserRegistration` 開關控制，預設開啟，業主可依需求關閉（關閉後僅管理員可在後台建立帳號）。

### 帳號驗證原則

- 自助註冊帳號：`timeVerified=''`，需完成 email 驗證後才可登入
- 管理員後台建立帳號：視為已驗證，新增時自動補 `timeVerified`
- 既有帳號：部署時一次性回填 `timeVerified`，避免所有帳號被鎖住


## 二、設定檔

### settings.json 新增欄位

```javascript
allowUserRegistration: true,   // 是否允許使用者自行創建帳號，預設 true
siteUrl: 'http://localhost:8080',  // 使用者瀏覽器前往的登入頁基底網址（非 API host），用於拼接驗證連結

regVerifyEmTitle: {
    eng: 'Please verify your email',
    cht: '請驗證您的電子郵件',
},
regVerifyEmContent: {
    eng: 'Dear {name},<br><br>Thank you for registering at {sender}.<br><br>Please click the link below to verify your email and activate your account:<br><a href="{verifyUrl}">{verifyUrl}</a><br><br>If you did not register, please ignore this email.<br><br>This is an automated notification. Please do not reply.',
    cht: '{name} 您好：<br><br>感謝您註冊「{sender}」。<br><br>請點擊以下連結以驗證您的電子郵件並啟用帳號：<br><a href="{verifyUrl}">{verifyUrl}</a><br><br>若您未曾進行此操作，請忽略此信。<br><br>此為系統自動通知信件，請勿直接回覆。',
},
```

> `siteUrl` 定義為「使用者點開 email 後，瀏覽器應前往的登入頁基底網址」。開發環境為 `http://localhost:8080`（Vue dev server），production 為實際對外網址（含 subfolder）。

### WWebSso.mjs 啟動檢查

```javascript
//allowUserRegistration
let allowUserRegistration = get(opt, 'allowUserRegistration', true)
if (allowUserRegistration !== true && allowUserRegistration !== false) {
    allowUserRegistration = true
}

//以下設定僅在 allowUserRegistration=true 時才需檢查
if (allowUserRegistration) {

    //siteUrl
    let siteUrl = get(opt, 'siteUrl', '')
    if (!isestr(siteUrl)) {
        throw new Error('invalid siteUrl: must be a non-empty string when allowUserRegistration is enabled')
    }

    //regVerifyEmTitle, regVerifyEmContent
    let regVerifyEmTitle = get(opt, 'regVerifyEmTitle', '')
    if (!iseobj(regVerifyEmTitle)) {
        throw new Error('invalid regVerifyEmTitle: must be an object with eng/cht keys')
    }
    let regVerifyEmContent = get(opt, 'regVerifyEmContent', '')
    if (!iseobj(regVerifyEmContent)) {
        throw new Error('invalid regVerifyEmContent: must be an object with eng/cht keys')
    }

}
```

> 條件式驗證：`allowUserRegistration=false` 時不檢查 siteUrl / regVerify*，舊專案升級不會因缺少設定而無法啟動。

### 傳遞至前端

透過 `getWebInfor` 傳遞：

```javascript
let getWebInfor = () => {
    return {
        // ...現有欄位
        allowUserRegistration,
        passwordPolicyInfo: {
            minLength: passwordPolicy.minLength,
            maxLength: passwordPolicy.maxLength,
            requireLetter: passwordPolicy.requireLetter,
            requireUppercase: passwordPolicy.requireUppercase,
            requireLowercase: passwordPolicy.requireLowercase,
            requireDigit: passwordPolicy.requireDigit,
            requireSpecial: passwordPolicy.requireSpecial,
        },
    }
}
```


## 三、流程設計

```
1. 使用者在登入頁點擊「申請帳號」按鈕
   （此按鈕僅在 allowUserRegistration = true 時顯示）

2. 顯示註冊表單，使用者填寫：
   - account（帳號，必填）
   - password（密碼，必填）
   - confirmPassword（確認密碼，必填）
   - name（姓名，必填）
   - email（電子郵件，必填）

3. 前端即時驗證（純前端，不呼叫 API，因註冊時無 token）：
   - account 不可為空
   - password 依 passwordPolicyInfo 做本地預覽驗證（長度、字元要求）
   - confirmPassword 與 password 一致
   - email 格式驗證
   - 注意：前端驗證僅為 UX 輔助，完整驗證由後端執行

4. 使用者點擊「送出」

5. 後端 createUser API 執行（順序與程式碼一致）：
   a. 檢查 allowUserRegistration 是否開啟，若關閉則拒絕
   b. 驗證 account 不可為空
   c. 驗證 email 格式（非僅非空，須為合法 email）
   d. 驗證 password === confirmPassword，不一致則拒絕
   e. checkUserPassword(lang, password, { account }) 完整 14 項驗證
   f. 驗證 name 不可為空
   g. 檢查 account 是否已存在（全域唯一，不限 isActive）
   h. 檢查 email 是否已存在（全域唯一，不限 isActive）
   i. 密碼加鹽雜湊：hashPassword(password, salt)
   j. 建立使用者資料（isActive: 'y', isAdmin: 'n', timeVerified: ''）
   k. 產生驗證 token（isApp: 'verify'）
   l. 寄送驗證信至使用者 email（含驗證連結）
   m. 回傳成功，提示使用者至信箱收取驗證信

6. 使用者至信箱點擊驗證連結

7. 前端 PageLogin.vue mounted 偵測 URL 中 view=verifyEmail：
   a. 取出 token
   b. 呼叫 $fapi.verifyEmail(token)
   c. 成功：顯示驗證成功訊息，導回 /?view=login（清除 query 避免重新整理重送）
   d. 失敗：顯示錯誤訊息

8. 後端 verifyEmail API 執行：
   a. checkToken（驗證 token 是否存在）
   b. 確認 isApp === 'verify'（登入 token 不可用於驗證）
   c. 從 token 取得 userId
   d. 若 timeVerified 已有值 → 回傳 already verified
   e. 更新 timeVerified 為當前時間
   f. 刪除已使用的驗證 token

9. 使用者以帳密登入
   - loginByAccountAndPassword 密碼比對通過後，檢查 timeVerified
   - timeVerified 為空 → reject 'account not verified'
   - timeVerified 有值 → 正常建立登入 token

10. mUI.mjs 將 'account not verified' 錯誤上拋至 PageLogin
    - 現有 mUI.login() 的 catch 會統一顯示 failedLoginForCatch，遮蔽原始錯誤
    - 須修改：將 'account not verified' 保留上拋，不轉為通用錯誤

11. PageLogin 收到 'account not verified' 時：
    - 顯示語系訊息 userRegistrationNotVerified
    - 顯示「重寄驗證信」按鈕

12. 重寄驗證信（若使用者未收到驗證信）：
    - 使用者輸入 account + email
    - 後端 resendVerifyEmail API 執行：
      a. 以 account 查找使用者，驗證 email 匹配
      b. 確認 timeVerified 為空（尚未驗證）
      c. 刪除舊驗證 token（isApp='verify'）
      d. 產生新驗證 token 並寄出驗證信
```


## 四、後端實做

### procCore.mjs — createUser

修改現有基本版 createUser，加入 email 格式驗證、全域唯一性檢查、驗證 token 產生、寄信：

```javascript
//createUser
let createUser = async (lang, data) => {

    //check
    if (!isestr(lang)) {
        lang = 'eng'
    }

    //check allowUserRegistration
    if (!allowUserRegistration) {
        let msg = get(kpLang, `${lang}.userRegistrationNotAllowed`, 'user registration is not allowed')
        return Promise.reject(msg)
    }

    //account
    let account = get(data, 'account', '')
    if (!isestr(account)) {
        return Promise.reject('invalid account')
    }

    //email
    let email = get(data, 'email', '')
    if (!isestr(email) || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        return Promise.reject('invalid email format')
    }

    //password
    let password = get(data, 'password', '')

    //confirmPassword
    let confirmPassword = get(data, 'confirmPassword', '')
    if (password !== confirmPassword) {
        let msg = get(kpLang, `${lang}.userChangePasswordNotSame`, 'passwords do not match')
        return Promise.reject(msg)
    }

    //check password
    let r = checkUserPassword(lang, password, { account })
    if (r.state === 'error') {
        return Promise.reject(r.msg)
    }

    //name
    let name = get(data, 'name', '')
    if (!isestr(name)) {
        return Promise.reject('invalid name')
    }

    //check account unique (全域唯一，不限 isActive)
    let allUsers = await woItems.users.select()
    let existAccount = allUsers.some((u) => get(u, 'account', '') === account)
    if (existAccount) {
        let msg = get(kpLang, `${lang}.userRegistrationAccountExists`, 'account already exists')
        return Promise.reject(msg)
    }

    //check email unique (全域唯一，不限 isActive)
    let existEmail = allUsers.some((u) => get(u, 'email', '') === email)
    if (existEmail) {
        let msg = get(kpLang, `${lang}.userRegistrationEmailExists`, 'email already exists')
        return Promise.reject(msg)
    }

    //hashPassword
    let passwordHashed = hashPassword(password, salt)

    //new user (timeVerified 為空，須完成 email 驗證才能登入)
    let u = ds.users.funNew({
        account,
        password: passwordHashed,
        name,
        email,
        isAdmin: 'n',
        isActive: 'y',
    })

    //insert
    await procOrm('', 'users', 'insert', [u])

    //userId
    let userId = get(u, 'id', '')

    //create verify token (isApp: 'verify' 區分驗證 token 與登入 token)
    let vt = ds.tokens.funNew({ userId, isApp: 'verify' })
    await woItems.tokens.insert(vt)
    let verifyToken = get(vt, 'token', '')

    //send verify email (若失敗，使用者可透過「重寄驗證信」補救)
    try {
        let sender = get(kpLang, `${lang}.webName`, '')
        let title = get(regVerifyEmTitle, lang, '')
        let content = get(regVerifyEmContent, lang, '')
        let verifyUrl = `${siteUrl}/?view=verifyEmail&token=${verifyToken}`
        content = content.replaceAll('{sender}', sender)
        content = content.replaceAll('{name}', name)
        content = content.replaceAll('{verifyUrl}', verifyUrl)
        await srEmail.send(sender, title, content, email)
    }
    catch (err) {
        console.log('send verify email error', err)
    }

    return { state: 'success', msg: 'ok' }
}
```

### procCore.mjs — verifyEmail

```javascript
//verifyEmail
let verifyEmail = async (token) => {

    //checkToken (驗證 token 是否有效)
    await checkToken(token)

    //getTokenByKV, 確認為驗證 token（isApp === 'verify'）
    let tk = await getTokenByKV('token', token)
    let isApp = get(tk, 'isApp', '')
    if (isApp !== 'verify') {
        return Promise.reject('invalid verify token')
    }

    //userId (直接從 tk 取，避免重複查詢)
    let userId = get(tk, 'userId', '')
    if (!isestr(userId)) {
        return Promise.reject('invalid token')
    }

    //getGenUserByUserId
    let user = await _getGenUserByKV('id', userId)

    //check timeVerified (是否已驗證)
    let timeVerified = get(user, 'timeVerified', '')
    if (isestr(timeVerified)) {
        return { state: 'success', msg: 'already verified' }
    }

    //update timeVerified
    await woItems.users.save({
        id: userId,
        timeVerified: now2str(),
    })

    //delete used token (reuse tk from above)
    await woItems.tokens.del({
        id: tk.id,
    })

    return { state: 'success', msg: 'ok' }
}
```

### procCore.mjs — resendVerifyEmail

```javascript
//resendVerifyEmail
let resendVerifyEmail = async (lang, account, email) => {

    //check
    if (!isestr(lang)) {
        lang = 'eng'
    }

    //check
    if (!isestr(account) || !isestr(email)) {
        return Promise.reject('invalid account or email')
    }

    //getGenUserByAccount
    let u = null
    try {
        u = await _getGenUserByKV('account', account)
    }
    catch (err) {}
    if (!u) {
        return Promise.reject('invalid account or email') //不洩露帳號是否存在
    }

    //check email match
    let uEmail = get(u, 'email', '')
    if (uEmail !== email) {
        return Promise.reject('invalid account or email')
    }

    //check timeVerified
    let timeVerified = get(u, 'timeVerified', '')
    if (isestr(timeVerified)) {
        return Promise.reject('account already verified')
    }

    //userId
    let userId = get(u, 'id', '')
    let name = get(u, 'name', '')

    //delete old verify tokens for this user
    let tokens = await woItems.tokens.select()
    let oldVerifyTokens = tokens.filter((t) => {
        return get(t, 'userId', '') === userId && get(t, 'isApp', '') === 'verify'
    })
    for (let t of oldVerifyTokens) {
        await woItems.tokens.del({ id: t.id })
    }

    //create new verify token
    let vt = ds.tokens.funNew({ userId, isApp: 'verify' })
    await woItems.tokens.insert(vt)
    let verifyToken = get(vt, 'token', '')

    //send verify email
    try {
        let sender = get(kpLang, `${lang}.webName`, '')
        let title = get(regVerifyEmTitle, lang, '')
        let content = get(regVerifyEmContent, lang, '')
        let verifyUrl = `${siteUrl}/?view=verifyEmail&token=${verifyToken}`
        content = content.replaceAll('{sender}', sender)
        content = content.replaceAll('{name}', name)
        content = content.replaceAll('{verifyUrl}', verifyUrl)
        await srEmail.send(sender, title, content, email)
    }
    catch (err) {
        console.log('resend verify email error', err)
        return Promise.reject('send email failed')
    }

    return { state: 'success', msg: 'ok' }
}
```

### procCore.mjs — loginByAccountAndPassword 加入 timeVerified 檢查

在密碼比對通過後、createToken 之前加入：

```javascript
//check timeVerified
let timeVerified = get(u, 'timeVerified', '')
if (!isestr(timeVerified)) {
    return Promise.reject('account not verified')
}
```

> `loginByAccountAndPassword` 簽名為 `(account, password)`，不接收 lang，故 reject 為固定英文字串。前端需比對此字串對應語系鍵。

### procCore.mjs — updateTabItems 管理員建帳自動填 timeVerified

```javascript
// 在 updateTabItems 的 insert 流程中，對 users 表的新增列自動補 timeVerified
if (tableName === 'users') {
    each(r.add, (row) => {
        let tv = get(row, 'timeVerified', '')
        if (!isestr(tv)) {
            row.timeVerified = now2str()
        }
    })
}
```

### procCore.mjs — 函式簽名、export

```javascript
function proc(woItems, procOrm, { srLog, srEmail, salt, minExpired, kpLang, chpwEmTitle, chpwEmContent, passwordPolicy, allowUserRegistration, siteUrl, regVerifyEmTitle, regVerifyEmContent }) {
```

```javascript
return {
    // ...現有 exports
    createUser,
    verifyEmail,
    resendVerifyEmail,
}
```

### WWebSso.mjs — 傳入 procCore

```javascript
let p = procCore(woItems, procOrm, { srLog, srEmail, salt, minExpired, kpLang, chpwEmTitle, chpwEmContent, passwordPolicy, allowUserRegistration, siteUrl, regVerifyEmTitle, regVerifyEmContent })
```

### WWebSso.mjs — kpFunExt

```javascript
createUser: async (_t, lang, account, password, confirmPassword, name, email) => {
    srLog.info({ event: 'kpfun-createUser', lang, account })
    let data = { lang, account, password, confirmPassword, name, email }
    let r = await p.createUser(lang, data)
    return r
},

verifyEmail: async (_t, token) => {
    srLog.info({ event: 'kpfun-verifyEmail', token })
    let r = await p.verifyEmail(token)
    return r
},

resendVerifyEmail: async (_t, lang, account, email) => {
    srLog.info({ event: 'kpfun-resendVerifyEmail', lang, account })
    let r = await p.resendVerifyEmail(lang, account, email)
    return r
},
```


## 五、前端實做

### mUI.mjs — 登入錯誤保留上拋（關鍵修改）

現有 `mUI.login()` 的 `.catch()` 會統一顯示 `failedLoginForCatch`，遮蔽後端回傳的原始錯誤。須修改為：對 `'account not verified'` 保留原始錯誤上拋，不轉為通用錯誤。

```javascript
// mUI.mjs login() 的 catch 內，原本：
//   alert(vo.$t('failedLoginForCatch'))
// 改為：
let errMsg = (err && typeof err === 'string') ? err : ''
if (errMsg === 'account not verified') {
    // 不顯示通用錯誤，將原始錯誤上拋給 PageLogin 處理
}
else {
    alert(vo.$t('failedLoginForCatch'))
}
pm.reject(err)
```

### PageLogin.vue — mounted 偵測驗證連結

```javascript
// mounted 內新增
let view = vo.$ui.getUrlView()
if (view === 'verifyEmail') {
    let token = new URLSearchParams(window.location.search).get('token')
    if (token) {
        vo.$fapi.verifyEmail(token)
            .then(() => {
                alert(vo.$t('userRegistrationVerifySuccess') || 'Email verified successfully. Please log in.')
                // 清除 query 避免重新整理重送
                window.history.replaceState({}, '', '/')
            })
            .catch((err) => {
                alert(err)
                window.history.replaceState({}, '', '/')
            })
    }
}
```

### PageLogin.vue — 未驗證提示與重寄驗證信

login 方法的 `.catch()` 中：

```javascript
.catch((err) => {
    let errMsg = (err && typeof err === 'string') ? err : ''
    if (errMsg === 'account not verified') {
        // 顯示未驗證提示
        // 顯示「重寄驗證信」按鈕（需輸入 email）
        vo.showResendVerify = true
    }
    vo.$ui.updateViewState('login')
})
```

重寄驗證信：

```javascript
// resendVerify 方法
let lang = get(vo, '$store.state.lang', 'eng')
vo.$fapi.resendVerifyEmail(lang, vo.account, vo.resendEmail)
    .then(() => {
        alert(vo.$t('userRegistrationResendSuccess'))
        vo.showResendVerify = false
    })
    .catch((err) => {
        alert(err)
    })
```

### PageLogin.vue — 註冊成功訊息

修改現有 register 方法的成功提示：由「請登入」改為「請至信箱收取驗證信」。


## 六、語系

### 既有可沿用（11 個，不需變動）

```
userRegistration, userRegistrationAccount, userRegistrationName,
userRegistrationEmail, userRegistrationPassword, userRegistrationConfirmPassword,
userRegistrationSubmit, userRegistrationNotAllowed, userRegistrationAccountExists,
userRegistrationEmailExists, userRegistrationBackToLogin
```

### 須修改（1 個）

```javascript
userRegistrationSuccess: {  // 原為「請登入」，改為提示收驗證信
    eng: 'Registration successful. Please check your email to verify your account.',
    cht: '帳號申請成功，請至信箱收取驗證信以啟用帳號。',
},
```

### 須新增（5 個）

```javascript
userRegistrationNotVerified: {
    eng: 'Your account has not been verified. Please check your email and click the verification link.',
    cht: '您的帳號尚未完成 email 驗證，請至信箱點擊驗證連結。',
},
userRegistrationResendVerify: {
    eng: 'Resend verification email',
    cht: '重寄驗證信',
},
userRegistrationResendSuccess: {
    eng: 'Verification email has been resent. Please check your inbox.',
    cht: '驗證信已重新寄出，請至信箱收取。',
},
userRegistrationAlreadyVerified: {
    eng: 'This account has already been verified.',
    cht: '此帳號已完成驗證。',
},
userRegistrationVerifySuccess: {
    eng: 'Email verified successfully. Please log in.',
    cht: '電子郵件驗證成功，請登入。',
},
```


## 七、影響範圍

### 已實做（前次完成，本次不需變動）

| 檔案 | 已完成項目 |
|------|-----------|
| `settings.json` | `allowUserRegistration: true` |
| `WWebSso.mjs` | 讀取 `allowUserRegistration`、傳入 `getWebInfor`（含 `allowUserRegistration` + `passwordPolicyInfo`）、傳入 procCore、`createUser` 在 kpFunExt |
| `procCore.mjs` | 基本版 `createUser`（無驗證信）、export 含 `createUser`、`allowUserRegistration` 在簽名中 |
| `procLang.mjs` | 11 個基本註冊語系鍵 |
| `PageLogin.vue` | 註冊表單（5 欄位）、Register 按鈕、Back to login |

### 本次須修改

| 檔案 | 修改項目 |
|------|---------|
| `settings.json` | 新增 `siteUrl`、`regVerifyEmTitle`、`regVerifyEmContent` |
| `WWebSso.mjs` | 新增 `siteUrl`/`regVerify*` 條件式讀取/驗證、傳入 procCore 擴充、kpFunExt 新增 `verifyEmail` + `resendVerifyEmail` |
| `procCore.mjs` | 修改 `createUser`（email 格式驗證 + 全域唯一性 + 驗證 token + 寄信 + isAdmin 改 'n'）、新增 `verifyEmail`、新增 `resendVerifyEmail`、修改 `loginByAccountAndPassword`（timeVerified 檢查）、修改 `updateTabItems`（insert 時自動填 timeVerified）、proc 簽名擴充、export 擴充 |
| `procLang.mjs` | 修改 `userRegistrationSuccess`、新增 5 個驗證語系鍵 |
| `mUI.mjs` | 修改 `login()` catch：保留 `'account not verified'` 錯誤上拋，不轉為通用錯誤 |
| `PageLogin.vue` | 修改 register 成功提示、新增 mounted 偵測 `view=verifyEmail`（含 URL 清理）、新增未驗證登入提示 + 重寄驗證信 UI |
| `test/e2e-createUser.test.mjs` | 修改：註冊後不可直接登入 → 須驗證後才能登入 |


## 八、安全性考量

- **IP 頻率限制**：createUser / resendVerifyEmail 受框架層 `callApiByIp` 自動覆蓋
- **密碼完整驗證**：後端完整 14 項 checkUserPassword，不信任前端
- **email 格式驗證**：後端檢查 email 格式，防止無效 email 註冊後永遠無法驗證
- **全域唯一性**：account / email 唯一性檢查不限 `isActive`，避免 inactive 帳號被覆蓋
- **開關控制**：後端在 createUser 內再次檢查 `allowUserRegistration`
- **密碼不可逆**：儲存加鹽雜湊
- **新使用者非管理員**：`isAdmin` 明確設為 `'n'`
- **email 驗證**：`timeVerified` 為空時無法登入
- **驗證 token 可識別**：`isApp: 'verify'`，登入 token 不可用於驗證
- **驗證 token 一次性**：驗證完成後刪除
- **重寄驗證信安全**：需 account + email 匹配，統一錯誤訊息不洩露帳號存在性
- **驗證成功後 URL 清理**：`window.history.replaceState` 清除 query，避免重新整理重送


## 九、擴充預留

| 未來可能需求 | 擴充方式 |
|-------------|---------|
| 管理員審核 | `createUser` 建立後設 `isActive: 'n'`，管理員核准後改 `'y'` |
| 圖形驗證碼（CAPTCHA） | `createUser` / `resendVerifyEmail` API 增加 captcha 參數 |
| 限制 email 網域 | `settings.json` 新增 `allowedEmailDomains` 陣列 |
| resend cooldown | 加入 account/email 級別的短時間重寄限制 |
| 結構化錯誤碼 | 將 raw reject string 改為 `{ code, msg }` 結構，前端語系更穩定 |


## 十、測試矩陣

### A. 設定與啟動

| # | 測試項目 | 輸入 | 預期結果 |
|---|---------|------|---------|
| A1 | allowUserRegistration = true | 呼叫 createUser | 正常執行 |
| A2 | allowUserRegistration = false | 呼叫 createUser | reject `userRegistrationNotAllowed` |
| A3 | 未設定 allowUserRegistration | 啟動 | 預設 true |
| A4 | allowUserRegistration = 'yes' | 啟動 | 容錯為 true |
| A5 | 前端 allowUserRegistration = false | 登入頁 | 不顯示「申請帳號」 |
| A6 | 前端 allowUserRegistration = true | 登入頁 | 顯示「申請帳號」 |
| A7 | 開啟註冊但缺 siteUrl | 啟動 | throw |
| A8 | 關閉註冊且缺 siteUrl | 啟動 | 正常（不檢查） |
| A10 | siteUrl = 'http://example.com' | 啟動 | 正常，驗證連結用此網址 |

### B. 註冊欄位與密碼

| # | 測試項目 | 輸入 | 預期結果 |
|---|---------|------|---------|
| B1 | account 為空 | `account=''` | reject |
| B2 | email 為空 | `email=''` | reject |
| B3 | email 格式錯誤 | `email='abc'` | reject `invalid email format` |
| B4 | email 格式正確 | `email='a@b.com'` | 通過 |
| B5 | confirmPassword 不一致 | 不同 | reject `userChangePasswordNotSame` |
| B6 | 密碼太短 | `'Ab@1'` | reject `keyLimNumLenMin` |
| B7 | 密碼缺特殊字元 | `'Abcd1234'` | reject `keyLimRequireSpecial` |
| B8 | 黑名單密碼 | `'1qaz@WSX'` | reject `keyLimCommonPassword` |
| B9 | 含帳號連續字元 | account='newuser', pw='Ab@1ne34' | reject `keyLimConsecutiveCharsFromAccount` |
| B10 | name 為空 | `name=''` | reject |
| B11 | 全部合法 | 正確資料 | 註冊成功 |

### C. 唯一性

| # | 測試項目 | 條件 | 預期結果 |
|---|---------|------|---------|
| C1 | account 已存在 | 同 account | reject `userRegistrationAccountExists` |
| C2 | email 已存在 | 同 email | reject `userRegistrationEmailExists` |
| C3 | 不同 account 同 email | email 重複 | reject |
| C4 | 同 account 不同 email | account 重複 | reject |
| C5 | isActive='n' 的帳號已存在 | 同 account | reject（全域唯一） |

### D. 註冊後狀態與寄信

| # | 測試項目 | 預期結果 |
|---|---------|---------|
| D1 | 註冊後 DB user 狀態 | `isAdmin='n'`, `isActive='y'`, `timeVerified=''` |
| D2 | 註冊後建立 verify token | `isApp='verify'` |
| D3 | 驗證信寄出 | `srEmail.send` 被呼叫，收件人為註冊 email |
| D4 | 驗證信連結格式 | `{siteUrl}/?view=verifyEmail&token={token}` |
| D5 | email 發送失敗 | user 仍建立成功，可透過 resend 補救 |
| D6 | DB 中密碼為雜湊 | password 欄位非明文 |
| D7 | 注入 isAdmin='y' | DB 中 isAdmin 仍為 'n' |
| D8 | 注入 timeVerified | DB 中 timeVerified 仍為空 |

### E. verifyEmail

| # | 測試項目 | 預期結果 |
|---|---------|---------|
| E1 | 有效 verify token | timeVerified 寫入，token 刪除 |
| E3 | token 不存在 | reject |
| E4 | 登入 token 呼叫 verifyEmail | isApp 非 'verify' → reject |
| E5 | 重複點擊驗證連結 | 第一次成功，第二次 token 已刪 → reject |
| E6 | user 已驗證但 token 未刪 | 回 `already verified` |

### F. resendVerifyEmail

| # | 測試項目 | 預期結果 |
|---|---------|---------|
| F1 | account + email 正確且未驗證 | 舊 token 刪除，新 token 建立，信寄出 |
| F2 | account 不存在 | reject `invalid account or email` |
| F3 | email 不匹配 | reject `invalid account or email` |
| F4 | 帳號已驗證 | reject `account already verified` |
| F5 | 重寄後舊連結 | 失效 |
| F6 | 重寄後新連結 | 可正常驗證 |

### G. 登入攔截

| # | 測試項目 | 預期結果 |
|---|---------|---------|
| G1 | 未驗證帳號登入 | reject `account not verified` |
| G2 | 已驗證帳號登入 | 正常登入 |
| G3 | 後台建帳號登入 | updateTabItems 自動填 timeVerified → 正常 |
| G4 | 管理員建帳後 DB 狀態 | timeVerified 已自動填入 |

### H. 前端互動

| # | 測試項目 | 預期結果 |
|---|---------|---------|
| H1 | 登入頁顯示註冊入口 | allowUserRegistration=true 時可見 |
| H2 | register 成功提示 | 顯示「請至信箱收驗證信」 |
| H3 | 開啟 `/?view=verifyEmail&token=有效` | 自動驗證並顯示成功 |
| H4 | 開啟 `/?view=verifyEmail&token=無效` | 顯示失敗訊息 |
| H5 | 開啟 `/?view=verifyEmail` 無 token | 無動作 |
| H6 | 驗證成功後重新整理 | 不重複送（URL 已清理） |
| H7 | 未驗證登入 | 顯示未驗證提示 + resend UI |
| H8 | resend 成功 | 顯示 resend success |
| H9 | mUI.login 錯誤傳遞 | 'account not verified' 不被轉為通用錯誤 |

### J. 現有測試修正

| # | 測試項目 | 預期結果 |
|---|---------|---------|
| J1 | 現有 E2E「註冊後直接登入」 | 應改為失敗（需先驗證） |
| J2 | 新 E2E「註冊 → 驗證 → 登入」 | 應通過 |

### K. webInfor

| # | 測試項目 | 預期結果 |
|---|---------|---------|
| K1 | webInfor 含 allowUserRegistration | 有 |
| K2 | webInfor 含 passwordPolicyInfo | 有，含 7 欄位 |
| K3 | passwordPolicyInfo 不含敏感欄位 | 無 blacklist/forbiddenChars/noConsecutiveChars |
