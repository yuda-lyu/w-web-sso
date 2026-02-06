# SSO 使用者頁面與安全變更密碼功能計畫 (Plan 2)

本計畫旨在新增 SSO 使用者 (非管理者) 的瀏覽頁面，並實作需透過 Email 驗證身分的安全變更密碼流程。

## 1. 後端實作 (Backend)

### 1.1 `server/procCore.mjs`
需要實作或補完以下函數：

- **[實作] `emailUser(userId, title, content, html)`**
  - 利用已引入的 `srEmail.mjs` 模組。
  - 根據 `userId` 取得使用者 `email`。
  - 呼叫 `srEmail.send` 發送信件。

- **[新增] `sendChangePasswordEmail(token, userId)`**
  - 用途：使用者請求變更密碼時，發送驗證信。
  - 邏輯：
    1. 驗證當前請求的 `token` 是否有效 (或是由 API 層驗證)。
    2. 為該使用者產生一個新的 `verificationToken` (可重複使用 `createToken(userId)`，預設效期與一般 Token 相同，或需另外傳參設定較短效期，此處暫用預設)。
    3. 組合變更密碼連結：`http://{host}/?view=changePassword&token={verificationToken}`。
    4. 呼叫 `emailUser` 發送標題為「變更密碼驗證信」的郵件，內容包含上述連結。

- **[新增] `changePasswordWithToken(token, oldPassword, newPassword)`**
  - 用途：使用者點擊連結後，提交變更密碼。
  - 邏輯：
    1. 呼叫 `checkToken(token)` 驗證 `token` 有效性並取得 `userId`。
    2. 取得使用者資料，驗證 `oldPassword` 是否正確 (可重用 `loginByAccountAndPassword` 或其內部邏輯，注意避免產生新 Token 的副作用)。
       - 建議：手動雜湊 `oldPassword` 並與資料庫比對。
    3. 若驗證通過，將 `newPassword` 經過雜湊後更新至資料庫 (`woItems.users.save`)。
    4. (選用) 變更成功後，可刪除該 `token` 以防重複使用 (`logoutByToken`)。

- **[修改] `proc` 函數參數**
  - 確保 `srEmail` 正確傳入 `proc` 以供使用。

### 1.2 `server/WWebSso.mjs`
新增 API 路由以供前端呼叫：

- **`GET /api/sendChangePasswordEmail`**
  - 參數：`token` (當前登入使用者的 Token)。
  - 權限：需驗證 Token。
  - 呼叫 `procCore.sendChangePasswordEmail`。

- **`POST /api/changePassword`**
  - 參數：`token` (來自 Email 連結的 Token), `oldPassword`, `newPassword`。
  - 權限：需驗證 Token (此 Token 證明了 Email 擁有權)。
  - 呼叫 `procCore.changePasswordWithToken`。

## 2. 前端實作 (Frontend)

### 2.1 `src/components/PageUser.vue` (新增)
- **功能**：顯示使用者資訊。
- **UI 佈局**：
  - 標題：使用者資訊。
  - 欄位顯示：姓名 (Name)、Email、帳號 (Account)、說明 (Description)、來源 (From)、是否啟用 (IsActive)、是否管理員 (IsAdmin)。
  - 按鈕：「變更密碼」 (Change Password)。
    - 點擊後顯示 Loading 狀態，呼叫 `/api/sendChangePasswordEmail`。
    - 成功後顯示 Alert：「請至信箱收取驗證信以變更密碼」。

### 2.2 `src/components/PageChangePassword.vue` (新增)
- **功能**：變更密碼介面 (由 Email 連結進入)。
- **取得參數**：從 URL query `token` 獲取。
- **UI 佈局**：
  - 標題：變更密碼。
  - 輸入框：
    -舊密碼 (Old Password)。
    - 新密碼 (New Password)。
    - 確認新密碼 (Confirm New Password)。
  - 按鈕：「提交變更」 (Submit)。
- **邏輯**：
  - 檢查兩次新密碼是否相同。
  - 呼叫 `/api/changePassword`。
  - 成功後顯示：「密碼變更成功，請重新登入」，並導向登入頁或首頁。

### 2.3 `src/App.vue`
- **路由處理**：
  - 引入 `PageUser` 與 `PageChangePassword`。
  - 在 `template` 中的 `v-if` 區塊新增：
    ```html
    <PageUser v-if="viewState === 'user'" :ssoToken="ssoToken"></PageUser>
    <PageChangePassword v-if="viewState === 'changePassword'" :ssoToken="ssoToken"></PageChangePassword>
    ```
  - 處理網址參數 `View=changePassword` 的進入點。

## 3. 套件依賴
- **lodash-es**, **wsemi**: 專案已安裝，直接使用。
- **w-email**: 專案已安裝，後端直接使用此套件發信。

## 4. 驗證計畫 (Verification Plan)
- **自動化測試**：
  - 無。
- **手動驗證**：
  1. **查看使用者資訊**：
     - 使用一般使用者登入。
     - 點擊選單或網址進入 `/?view=user` (需在 Sidebar 或其他地方增加入口? 或手動輸入網址測試)。
     - 確認資訊顯示正確。
  2. **寄送驗證信**：
     - 在使用者頁面點擊「變更密碼」。
     - 檢查 Console Log (若未設定 SMTP) 或實際收信。
     - 確認信件內連結正確。
  3. **變更密碼流程**：
     - 點擊連結開啟新視窗。
     - 輸入錯誤的舊密碼 -> 預期失敗。
     - 輸入不一致的新密碼 -> 預期前端擋下或後端失敗。
     - 輸入正確舊密碼與新密碼 -> 預期成功。
  4. **登入驗證**：
     - 使用舊密碼登入 -> 預期失敗。
     - 使用新密碼登入 -> 預期成功。
