# 開發使用者重設密碼功能

## 一、功能概述

管理員於後台 Users list 頁面，點擊某使用者的「Reset password」按鈕後，可為該使用者重設密碼。此為管理員操作，不需要輸入舊密碼，但需要輸入新密碼並通過密碼規則驗證。重設完成後可寄送通知信給該使用者。


## 二、現有架構分析

### 已有的基礎設施

| 項目 | 檔案 | 說明 |
|------|------|------|
| 前端按鈕 | `LayoutContentUsers.vue:210-230` | 「Reset password」WButtonChip 已存在，點擊呼叫 `$dg.modifyItemPasswordById(id)` |
| 前端方法 (placeholder) | `LayoutContentUsers.vue:1044-1095` | `modifyItemPasswordById` 目前僅顯示「尚待開發」 |
| 使用者自行變更密碼 UI | `PageUser.vue:34-129` | 含舊密碼/新密碼/確認密碼三欄位，可作為 UI 參考 |
| 使用者自行變更密碼 API | `PageUser.vue:369-455` | `submitChangePassword` 呼叫 `$fapi.checkUserPassword` + `$fapi.changeUserPassword` |
| 密碼格式驗證 (後端) | `procCore.mjs:652-688` | `checkUserPassword(lang, pw)` 回傳 `{state, msg}` |
| 密碼變更 (後端) | `procCore.mjs:691-798` | `checkTokenAndChangePassword(token, lang, oldPw, newPw)` 需驗舊密碼 |
| 密碼雜湊 | `hashPassword.mjs:6-24` | `hashPassword(pw, salt)` SHA-512 |
| API 註冊 | `WWebSso.mjs:1018-1031` | `checkUserPassword`、`changeUserPassword` |
| 語系 | `procLang.mjs` | 密碼相關語系鍵已有完整定義 |
| Email 通知 | `procCore.mjs:755-797` | 變更密碼後寄送通知信 |

### 與使用者自行變更密碼的差異

| 比較項目 | 使用者自行變更 | 管理員重設 |
|----------|--------------|-----------|
| 操作者 | 使用者本人 | 管理員 |
| 需要舊密碼 | 是 | 否 |
| 需要新密碼 | 是 | 是 |
| 需要確認密碼 | 是 | 是 |
| 密碼格式驗證 | 是 | 是 |
| Token 來源 | 使用者本人的 token | 管理員的 token |
| 目標使用者 | token 對應使用者 | 管理員指定的 userId |
| 權限檢查 | 無需額外權限 | 需檢查操作者為 admin |
| Email 通知 | 是 | 是 |


## 三、開發規劃

### 3.1 後端 - procCore.mjs

#### 新增函式：`resetUserPasswordByAdmin`

```
位置：procCore.mjs，接續 checkTokenAndChangePassword 之後（約 line 798）
```

**功能邏輯：**
1. 接收參數：`token`（管理員 token）、`lang`、`userId`（目標使用者 ID）、`newPassword`
2. 呼叫 `checkToken(token)` 驗證管理員 token 有效性
3. 呼叫 `checkUserPassword(lang, newPassword)` 驗證新密碼格式
4. 透過管理員 token 取得管理員身份，確認為 admin（參考 `funCheckAdmin` 模式）
5. 透過 `userId` 查詢目標使用者（`_getGenUserByKV('id', userId)`）
6. 雜湊新密碼：`hashPassword(newPassword, salt)`
7. 儲存至資料庫：`woItems.users.save({ id: userId, password: hashedPw })`
8. 寄送 Email 通知目標使用者（non-blocking，參考現有流程）

**匯出：** 加入 return 的 `p` 物件中

### 3.2 後端 - WWebSso.mjs

#### 新增 API 方法：`resetUserPassword`

```
位置：WWebSso.mjs kpfun 區塊，接續 changeUserPassword 之後（約 line 1031）
```

```javascript
resetUserPassword: async (_t, token, lang, userId, pwNew) => {
    srLog.info({ event: 'kpfun-resetUserPassword', token, lang, userId })
    let r = await p.resetUserPasswordByAdmin(token, lang, userId, pwNew)
    return r
},
```

**注意：** 密碼不應記錄於 log（`pwNew` 不放入 srLog）

### 3.3 前端 - LayoutContentUsers.vue

#### 修改 `modifyItemPasswordById` 方法

**UI 流程（使用 WPopup 或內建 dialog 機制）：**

考量現有專案不使用 `$confirm` 或 `$prompt`，且 PageUser.vue 的密碼變更 UI 是直接嵌入頁面內，因此管理員重設密碼採用以下方案：

**方案：使用 data 狀態控制顯示密碼輸入介面**

在 ag-grid cell 內空間有限，不適合展開表單。改為：
1. 點擊「Reset password」時，記錄目標 `userId` 到 data
2. 以 `$alert` 搭配自訂 slot 或獨立 dialog 區塊顯示密碼輸入表單
3. 表單包含：新密碼、確認密碼（不需要舊密碼）
4. 送出前呼叫 `$fapi.checkUserPassword(lang, newPw)` 驗證格式
5. 驗證通過後呼叫 `$fapi.resetUserPassword(token, lang, userId, newPw)` 重設密碼
6. 成功後顯示成功訊息、清除表單狀態

**需新增的 data：**
- `resetPasswordTargetId: ''` — 目標使用者 ID
- `resetPasswordTargetName: ''` — 目標使用者名稱（顯示用）
- `showResetPassword: false` — 控制密碼輸入區塊顯示
- `resetNewPassword: ''` — 新密碼
- `resetConfirmPassword: ''` — 確認密碼
- `showResetNewPassword: false` — 密碼顯示/隱藏切換
- `showResetConfirmPassword: false` — 確認密碼顯示/隱藏切換

**需新增的 methods：**
- `modifyItemPasswordById(id)` — 開啟重設密碼介面
- `submitResetPassword()` — 驗證並送出
- `cancelResetPassword()` — 取消並清除狀態

**需新增的 components：**
- `WText` — 密碼輸入框（參考 PageUser.vue 的用法）

**UI 配置位置：**
在 aggrid 區塊下方或上方新增一個可收合的密碼重設區塊，當 `showResetPassword` 為 true 時顯示。

### 3.4 語系 - procLang.mjs

#### 新增語系鍵

```javascript
adminResetPassword: {
    eng: 'Reset Password',
    cht: '重設密碼',
},
adminResetPasswordFor: {
    eng: 'Reset password for',
    cht: '重設密碼 - 對象：',
},
adminResetPasswordNewPassword: {
    eng: 'New password',
    cht: '新密碼',
},
adminResetPasswordConfirmPassword: {
    eng: 'Confirm password',
    cht: '確認新密碼',
},
adminResetPasswordForNoNewPassword: {
    eng: 'Please enter new password',
    cht: '尚未給予新密碼',
},
adminResetPasswordForNoConfirmPassword: {
    eng: 'Please enter confirm password',
    cht: '尚未給予確認密碼',
},
adminResetPasswordNotSame: {
    eng: 'New password and confirm password do not match',
    cht: '新密碼與確認密碼不一致',
},
adminResetPasswordSuccess: {
    eng: 'Password reset successful',
    cht: '密碼重設成功',
},
adminResetPasswordFail: {
    eng: 'Password reset failed',
    cht: '密碼重設失敗',
},
```

### 3.5 Email 通知

重設密碼的 Email 通知可共用現有 `chpwEmTitle` / `chpwEmContent`，或視需要新增獨立的管理員重設通知模板（例如加上「由管理員執行」的提示）。

若需獨立模板，在 `settings.json` 新增：

```javascript
adminResetPwEmTitle: {
    eng: 'Your password has been reset by administrator',
    cht: '您的密碼已由管理員重設',
},
adminResetPwEmContent: {
    eng: 'Dear User {name},<br><br>This is to inform you that the password for your {sender} account has been reset by the system administrator.<br><br>Please log in with the new password provided by the administrator. If you have any questions, please contact the system administrator.<br><br>This is an automated system notification. Please do not reply to this email.',
    cht: '使用者 {name} 您好：<br><br>您於「{sender}」的密碼已由系統管理員進行重設。<br><br>請使用管理員提供的新密碼重新登入。如有任何問題，請聯絡系統管理單位。<br><br>此為系統自動通知信件，請勿直接回覆。',
},
```


## 四、開發順序

| 步驟 | 內容 | 檔案 |
|------|------|------|
| 1 | 新增語系鍵 | `procLang.mjs` |
| 2 | 新增後端 `resetUserPasswordByAdmin` | `procCore.mjs` |
| 3 | 新增 API `resetUserPassword` | `WWebSso.mjs` |
| 4 | 修改前端 `modifyItemPasswordById`，新增密碼輸入 UI 與送出邏輯 | `LayoutContentUsers.vue` |
| 5 | （選配）新增管理員重設密碼的 Email 模板 | `settings.json`、`WWebSso.mjs` |
| 6 | 測試全流程 | — |


## 五、安全性考量

1. **權限檢查**：後端必須驗證操作者為 admin，防止一般使用者透過 API 直接呼叫重設他人密碼
2. **密碼格式驗證**：新密碼仍需通過 `checkUserPassword` 驗證（長度 8-30、含大小寫英文/數字/特殊符號）
3. **Log 記錄**：記錄重設事件但不記錄密碼明文（srLog 僅記錄 token、lang、userId）
4. **Token 失效**：重設密碼後可考慮是否清除該使用者現有的所有 token（強制重新登入），此為選配功能
5. **Email 通知**：通知目標使用者其密碼已被重設，若 Email 發送失敗不中斷主流程


## 六、UI 參考示意

```
┌─────────────────────────────────────────────┐
│  重設密碼 - 對象：ac-viewer                    │
│                                             │
│  新密碼                                      │
│  ┌───────────────────────────────────┐ 👁   │
│  │ ●●●●●●●●                         │      │
│  └───────────────────────────────────┘      │
│  確認新密碼                                   │
│  ┌───────────────────────────────────┐ 👁   │
│  │ ●●●●●●●●                         │      │
│  └───────────────────────────────────┘      │
│                                             │
│  [ 送出 ]  [ 取消 ]                          │
└─────────────────────────────────────────────┘
```

此區塊在 aggrid 上方顯示，點擊「Reset password」時展開，送出或取消後收合。
