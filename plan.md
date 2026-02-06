
# SSO User Page & Password Change Plan

## 1. Backend Implementation

### 1.1 `server/procCore.mjs`
- **Implement `emailUser`**:
  - Requires `nodemailer`. Will check if configured or ask user to install.
  - Function signature: `emailUser(user, title, content, html)`.
- **Implement `sendChangePasswordEmail(token, userId)`**:
  - Finds user by token.
  - Generates a `changePasswordToken` (store in `tokens` table or similar, short expiry).
  - Sends email with link: `http://{host}/?view=changePassword&token={changePasswordToken}`.
- **Implement `changePasswordWithToken(changePasswordToken, oldPassword, newPassword)`**:
  - Finds user by `changePasswordToken`.
  - Verifies `oldPassword` matches current hash.
  - Updates password to `newPassword`.
  - Invalidates `changePasswordToken`.

### 1.2 `server/WWebSso.mjs`
- **Add API Endpoints**:
  - `GET /api/sendChangePasswordEmail`:
    - Checks current user token.
    - Calls `procCore.sendChangePasswordEmail`.
  - `POST /api/confirmChangePassword`:
    - Inputs: `token` (from email), `oldPassword`, `newPassword`.
    - Calls `procCore.changePasswordWithToken`.

## 2. Frontend Implementation

### 2.1 `src/components/PageUser.vue` (New)
- **UI**:
  - Display User Info (Name, Email, Description).
  - Button "變更密碼" (Change Password).
  - Dialog/Alert: "Confirmation email sent. Please check your inbox."

### 2.2 `src/components/PageChangePassword.vue` (New)
- **UI**:
  - Form:
    - Old Password
    - New Password
    - Confirm New Password
  - Submit Button.
- **Logic**:
  - On submit, call `/api/confirmChangePassword`.
  - On success, redirect to login or user page.

### 2.3 `src/App.vue`
- **Update Logic**:
  - Import `PageUser` and `PageChangePassword`.
  - In template, add conditions:
    ```html
    <PageUser v-if="viewState==='user'"></PageUser>
    <PageChangePassword v-if="viewState==='changePassword'"></PageChangePassword>
    ```

### 2.4 `src/plugins/mUI.mjs` (Check only)
- Ensure `getUrlView` handles `changePassword` correctly (it accepts arbitrary strings, so likely fine, but need to check if `autoLogin` overrides it).
- `autoLogin` logic might need adjustment if `view=changePassword` doesn't require a valid *user* token (it has its own token).
  - Actually, `changePassword` flow relies on the token in URL. `autoLogin` usually checks `localStorage` token.
  - If `view=changePassword`, we might skip `autoLogin` or handle it specifically.

## 3. Tasks
1.  **Install `nodemailer`**: Ask user for permission.
2.  **Backend**: Update `server/procCore.mjs` and `server/WWebSso.mjs`.
3.  **Frontend**: Create components and update `App.vue`.
4.  **Verify**: Test the flow.

