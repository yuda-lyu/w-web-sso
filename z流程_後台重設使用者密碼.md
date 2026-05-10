# 後台重設使用者密碼流程

> **設計策略**：管理員直接產生符合策略之隨機密碼塞給使用者，**不走 reset 連結機制**、**不限時**。改以 `users.isForceChangePw='y'` 旗標強制使用者下次登入後立即變更為自訂密碼。

## 觸發

管理員於 LayoutContentUsers.vue 後台 Users list 對某使用者點擊「Reset password」按鈕。

## 重要流程

### 一、管理員觸發

- 管理員於後台點擊重設密碼, 系統產生符合策略的隨機新密碼 → save 至 user (含 isForceChangePw='y') → 寄信附上明文新密碼
- 管理員觸發成功但寄信失敗（如 SMTP 不通）, 仍視為觸發成功（密碼已重設、isForceChangePw 已寫入）, 須由管理員透過其他管道告知使用者新密碼或重新觸發
- 管理員對自己觸發重設, 後端拒絕（避免自我鎖死）
- 一般使用者透過 API 直接呼叫觸發 reset, 後端拒絕（須 admin 權限）

### 二、使用者收信並登入

- 使用者收信, 信中含帳號 + 明文新密碼, 不含連結
- 使用者持新密碼登入, 帳密通過驗證
- 登入成功時前端偵測 `userSelf.isForceChangePw === 'y'` → 顯示 CheckYes 「您的密碼已由管理員重設，請按確認後變更為您自己的新密碼」
- 使用者點 CheckYes 的 OK 後, 進入 user view 並**自動展開變更密碼表單**（使用既有變更密碼 UI）
- 使用者已登入但其他裝置仍持有舊 token, 該 token 因仍有效暫不受影響, 但下次該裝置 session 結束後須以新密碼登入（**已知 trade-off**, 不主動清除 user 所有 tokens 以保簡單）

### 三、使用者完成強制變更

- 使用者於強制變更頁面填妥舊密碼（管理員給的隨機）+ 新密碼+確認密碼且都正確, 變更成功 → 後端清 `isForceChangePw='n'` + 寄變更通知信
- 使用者欄位錯誤（空值、新密碼≠確認、新密碼不符策略、舊密碼錯）, 各錯誤以 inline 紅字顯示於對應輸入框下方
- 強制變更模式下「取消」按鈕**直接隱藏**, 只剩「送出」一條路（避免使用者繞過強制變更繼續使用; 不改 cancel 行為以維持既有按鈕邏輯單純）
- 使用者點 logout, 回登入頁；下次以隨機密碼再登入又會被拉回強制變更（直到變更為止）

## 執行流程

### 一、管理員觸發重設

```
001  管理員於 LayoutContentUsers.vue 點擊目標使用者列的「Reset password」按鈕
002  前端 modifyItemPasswordById(id):
003      $dg.showCheckYesNo「確定對 {account} 重設密碼？」二次確認
004      確認後 $ui.updateLoading(true)，呼叫 $fapi.adminResetUserPassword(token, lang, userId)
005      .then alert「已重設並寄送新密碼至 {email}」
006      .catch 依錯誤類型 alert (forbidden / user not found / cannot reset self / 其他)
007      .finally $ui.updateLoading(false)
008  後端 WWebSso.mjs adminResetUserPassword handler → p.adminResetUserPassword
009      checkToken 驗證操作者 token 有效（無效 / 過期 / 重複 → reject）
010      getUserByToken 取出操作者 → 檢查 isAdmin === 'y'
011          非 admin: reject('forbidden')
012      檢查 userId 為空字串
013          空: reject('invalid userId')
014      _getGenUserByKV('id', targetUserId) 取目標使用者
015          查無: reject('user not found')
016      檢查不可對自己觸發
017          operatorId === targetUserId: reject('cannot reset self')
018      呼叫 genRandomPassword(passwordPolicy, account) 產生符合策略的隨機新密碼
              （詳見「四、隨機密碼產生器」）
019      雜湊新密碼: hashPassword(newPassword, salt)
020      save 至 users 表:
              password = hashedPassword
              isForceChangePw = 'y'
              timePasswordChanged = now
021      try: 寄送重設密碼信，內含明文新密碼（不含連結）
              讀 settings.json resetPwEmTitle / resetPwEmContent，
              模板代入 sender / name / account / newPassword
022      catch: 僅 srLog.error, 不 reject（密碼已寫入，寄信失敗可由管理員另外通知）
023      回傳 { state: 'success' }（**不回傳明文密碼給前端**，避免操作者得知；明文僅在寄信當下使用後即釋放）
```

### 二、使用者收信並登入

```
001  使用者收到「您的密碼已被管理員重設」信件，內含 account + 新密碼明文
002  使用者前往登入頁，輸入帳號 + 新密碼
003  進入一般登入流程（procCore loginByAccountAndPassword 一路驗證）
004  登入成功, 前端取得 userSelf 物件（含 isForceChangePw 欄位）
005  PageLogin login .then 內檢查 userSelf.isForceChangePw === 'y'
006      'y':
007          不執行 useRedir 轉址（即使原本 view='login' 該轉跳）
008          顯示 $dg.showCheckYes「密碼已被管理員重設，請變更為您自己的新密碼」
009          使用者按 OK
010          updateViewState('user') 進入使用者資訊頁（無視原 URL view 參數）
011      'n' 或空:
012          照原本流程（依 view 轉址或進指定頁）
```

### 三、PageUser 強制展開變更密碼表單

```
001  PageUser.vue mounted 時檢查 userSelf.isForceChangePw === 'y'
002      'y':
003          自動 clickChangePassword（展開變更密碼表單）
004          UI 模式進入「強制變更模式」（forceChangePwMode = true）
005          隱藏 logout 以外的其他導覽（避免使用者跳出去）
006          「取消」按鈕直接隱藏（只剩送出，使用者要離開只能 logout）
007  使用者填寫舊密碼（管理員給的隨機新密碼）+ 新密碼 + 確認密碼，點送出
008      呼叫既有 submitChangePassword 流程
009      後端 checkTokenAndChangePassword 在成功 save 時多寫一欄: isForceChangePw='n'
010      變更成功 → 收起表單 + alert「密碼變更成功」
011      forceChangePwMode 解除（因 userSelf.isForceChangePw 已是 'n'）, 一般 user view 行為恢復
```

### 四、隨機密碼產生器（後端 helper）

```
位置：server/procCore.mjs 或獨立 server/genRandomPassword.mjs
簽名：genRandomPassword(passwordPolicy, account) → 字串

邏輯：
001  讀 passwordPolicy（minLength / maxLength / requireLetter / requireUppercase /
        requireLowercase / requireDigit / requireSpecial / forbiddenChars 等）
002  目標長度: max(minLength, 12) 與 maxLength 取較小值（建議 12-16）
003  字元池:
        letters = a-z, A-Z（依 requireUppercase / requireLowercase 細分）
        digits = 0-9
        specials = !@#$%^&*()_+-=[]{}|;:,.<>?  排除 forbiddenChars 內字元（預設排除 \）
004  生成迴圈（最多 N=20 次嘗試）:
005      初始化 password = []
006      若 requireLetter: 隨機抽 1 字 letters
007      若 requireUppercase: 隨機抽 1 大寫
008      若 requireLowercase: 隨機抽 1 小寫
009      若 requireDigit: 隨機抽 1 字 digits
010      若 requireSpecial: 隨機抽 1 字 specials
011      補滿到目標長度，每位置從合法字元池隨機抽
012      shuffle 打亂順序
013      呼叫 isUserPw(password, passwordPolicy, { account })  // 復用既有檢查
014          通過: return password
015          不通過（最常見：與 account 連續字元衝突 / 命中黑名單）:
016              繼續下一輪嘗試
017  嘗試上限後仍失敗: throw 'cannot generate random password matching policy'
        （極少發生，除非 passwordPolicy 設定不合理）
```

### 五、新增 / 修改的檔案概要

| 檔案 | 變動 |
|---|---|
| `server/procCore.mjs` | 新增 `adminResetUserPassword` 與 `genRandomPassword`（或拆出獨立 helper）；修改 `checkTokenAndChangePassword` 於成功 save 時加 `isForceChangePw: 'n'` |
| `server/WWebSso.mjs` | 新增 `adminResetUserPassword` API（admin 驗證） |
| `server/procLang.mjs` | 新增 `adminResetPasswordConfirm`、`adminResetPasswordSent`、`userForceChangePwPrompt` 等語系鍵 |
| `src/schema/tables/users.mjs` | （已有 `isForceChangePw`，只需確認 funNew 預設 `'n'`，並把此欄位納入 admin 後台檢視 / 查詢 schema） |
| `src/components/LayoutContentUsers.vue` | `modifyItemPasswordById` 改實作（呼叫 adminResetUserPassword API + showCheckYesNo 二次確認 + alert） |
| `src/components/PageLogin.vue` | login `.then` 內檢查 `userSelf.isForceChangePw === 'y'`，若是則 showCheckYes 後 updateViewState('user') |
| `src/components/PageUser.vue` | mounted 內檢查 `userSelf.isForceChangePw === 'y'`，若是則自動展開變更密碼表單 + 切到「強制變更模式」（取消按鈕直接隱藏，隱藏 logout 以外的選項） |
| `server/procLang.mjs` | 新增 `resetPwEmTitle`（信件標題, eng + cht）|
| `server/template/resetPasswordEmail-{eng,cht}.html` | 新增信件 body 模板, 內含 `{name}` / `{sender}` / `{account}` / `{newPassword}` placeholder, **無 `{resetUrl}`**（與既有 `regVerifyEmail-*.html`、`changePasswordEmail-*.html` 慣例一致） |

> 移除：先前規劃的 `passwordResetToken` / `timePasswordResetExpired` / `isPendingPasswordReset` 欄位、PageResetPassword.vue、validateResetToken / submitResetPassword API 等全部不需要。

### 六、Email 模板（無連結，僅明文新密碼）

依 `CLAUDE.md` 「Email 模板存放慣例」：標題進 `procLang.mjs`，body 放 `server/template/`。

**1. `server/procLang.mjs` 新增語系鍵**：

```js
resetPwEmTitle: {
    eng: 'Your password has been reset',
    cht: '您的密碼已被重設',
},
```

**2. `server/template/resetPasswordEmail-eng.html`**：

```html
<p>Dear {name},</p>
<p>The administrator has reset the password for your {sender} account.</p>
<p>Account: {account}<br>New password: <strong>{newPassword}</strong></p>
<p>Please log in with this password and immediately set your own new password upon login.</p>
<p>If you did not expect this change, please contact the administrator.</p>
<p>This is an automated notification.</p>
```

**3. `server/template/resetPasswordEmail-cht.html`**：

```html
<p>{name} 您好：</p>
<p>管理員已重設您於「{sender}」的密碼。</p>
<p>帳號：{account}<br>新密碼：<strong>{newPassword}</strong></p>
<p>請以此密碼登入後，立即變更為您自己的新密碼。</p>
<p>若非您預期之操作，請聯繫管理員。</p>
<p>此為系統自動通知信。</p>
```

寄信時由 `procCore.renderEmailBody('resetPasswordEmail', lang, { name, sender, account, newPassword })` 載入並代入。

## 安全性考量

| 項目 | 處理方式 / trade-off |
|---|---|
| 信件含明文新密碼 | **設計取捨**：採此做法簡化流程（不需 reset 連結機制）。風險：信件被攔截/外洩 → 隨機密碼可被首次登入濫用。緩解：使用者首次登入後**強制變更**，攻擊者若搶先登入也只能換一次密碼，原使用者察覺異常後再請 admin 重設 |
| 隨機密碼強度 | 由 `genRandomPassword` 產生符合 `passwordPolicy` 的密碼，至少 12 字元含字母+數字+特殊符號 |
| 不限時 | 因「沒有 reset 連結」可外洩，限時意義減弱（信件本身已洩漏明文密碼），故省略；isForceChangePw='y' 是常駐旗標直到使用者變更 |
| 攻擊者搶先登入 | 攻擊者拿到信件先登入 → 強制變更頁 → 改成攻擊者的密碼 → 原使用者察覺後請 admin 再 reset 一次。風險存在但縮限攻擊面（攻擊者改了密碼會立即被合法使用者察覺） |
| 多裝置 token 不清除 | 簡化設計：admin reset 不主動清該 user 所有 tokens。已登入裝置 session 不受影響但下次重登需用新密碼。**已知 trade-off**：若管理員重設是因「該 user 帳號疑似被盜」，建議手動清除其所有 tokens（可另加管理員「強制登出該 user」按鈕） |
| Admin 對自己重設 | 拒絕（避免自我鎖死） |
| 密碼不記錄 log | srLog 僅記錄 event / userId，**不記錄 newPassword 明文**；明文僅在寄信當下使用後即釋放 |
| 操作者得知密碼 | 後端不回傳密碼明文給前端（管理員無法看到）。理論上若管理員可讀使用者信箱仍可得知，但這是 email 系統層級信任邊界 |
| 強制變更頁面跳脫 | UX 設計上「取消」按鈕**直接隱藏**，使用者要離開只能點 logout 重登（重登又會被拉回強制變更，直到完成為止） |

## 開發順序建議

| 步驟 | 內容 | 檔案 |
|---|---|---|
| 1 | 新增語系鍵 `resetPwEmTitle` 與相關 alert / CheckYes 文字 | `server/procLang.mjs` |
| 2 | 新增 Email body 模板兩支（eng/cht） | `server/template/resetPasswordEmail-{eng,cht}.html` |
| 3 | 實作 `genRandomPassword` helper（獨立檔） | `server/genRandomPassword.mjs` |
| 4 | 實作 `adminResetUserPassword` | `server/procCore.mjs` |
| 5 | 修改 `checkTokenAndChangePassword` 於成功時清 `isForceChangePw='n'` | `server/procCore.mjs` |
| 6 | 註冊 API | `server/WWebSso.mjs` |
| 7 | 前端 `LayoutContentUsers.vue` `modifyItemPasswordById` 實作 | — |
| 8 | 前端 `PageLogin.vue` login 後檢查 `isForceChangePw` | — |
| 9 | 前端 `PageUser.vue` 強制變更模式（自動展開 + 隱藏取消按鈕） | — |
| 10 | e2e 測試（登入後強制變更流程） | `test/e2e-resetpassword.test.mjs` |
