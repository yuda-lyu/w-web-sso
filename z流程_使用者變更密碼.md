# 使用者變更帳密流程

## 觸發

使用者於 user view（`viewState='user'`，PageUser.vue）點擊「變更密碼 / Change Password」按鈕，展開變更表單，輸入舊密碼、新密碼、確認密碼後點擊「送出 / Submit」。

## 重要流程
- 使用者於使用者頁點擊變更密碼, 展開變更密碼表單（舊密碼/新密碼/確認密碼三欄位）
- 使用者於使用者頁點擊變更密碼, 展開後再點擊取消, 收起表單恢復原狀
- 使用者送出變更, 三欄都填妥+新密碼合規+舊密碼正確, 變更成功+寄通知信（成功訊息以 alert 通知）
- 使用者送出變更, 變更成功但寄通知信失敗（如 SMTP 不通）, 仍視為成功不阻擋使用者（紀錄於 srLog.error）
- 使用者送出變更, 未填舊密碼, 於「舊密碼」欄位下方以紅字 inline 顯示「請輸入舊密碼」
- 使用者送出變更, 未填新密碼, 於「新密碼」欄位下方以紅字 inline 顯示「請輸入新密碼」
- 使用者送出變更, 未填確認密碼, 於「確認密碼」欄位下方以紅字 inline 顯示「請輸入確認密碼」
- 使用者送出變更, 新密碼≠確認密碼, 於「確認密碼」欄位下方以紅字 inline 顯示「兩次密碼不一致」
- 使用者送出變更, 新密碼不符密碼策略（長度/字元/黑名單/與帳號連續字元等）, 於「新密碼」欄位下方以紅字 inline 顯示對應策略錯誤
- 使用者送出變更, 前端密碼策略檢查（呼叫後端 checkUserPassword）發生網路錯誤, 於「新密碼」欄位下方以紅字 inline 顯示「網路錯誤」
- 使用者送出變更, 新密碼通過策略但舊密碼不符, 後端 reject 'incorrect old password', 於「舊密碼」欄位下方以紅字 inline 顯示「變更失敗」（不洩露細節）
- 使用者送出變更, token 失效（如過期/被清除）, 後端 checkToken reject, 於「舊密碼」欄位下方以紅字 inline 顯示「變更失敗」

## 執行流程

### 一、展開變更密碼表單

```
001  使用者點擊「變更密碼」按鈕  [PageUser.vue:367]
002  showChangePassword = true（展開表單）  [PageUser.vue:369]
003  清空 oldPassword / newPassword / confirmPassword 欄位  [PageUser.vue:370-372]
004  showOldPassword / showNewPassword / showConfirmPassword 預設 false（密碼遮罩）  [PageUser.vue:373-375]
005  清空 chPwOldError / chPwNewError / chPwConfirmError 三個 inline 錯誤訊息  [PageUser.vue:377-379]
```

### 二、取消變更

```
001  使用者點擊「取消」按鈕  [PageUser.vue:382]
002  showChangePassword = false（收起表單）  [PageUser.vue:384]
003  清空 chPwOldError / chPwNewError / chPwConfirmError  [PageUser.vue:386-388]
```

> 註：欄位內容不主動清空，使用者下次再點「變更密碼」時，clickChangePassword 會清空。

### 三、送出變更

```
001  使用者點擊「送出」按鈕，呼叫 submitChangePassword  [PageUser.vue:391]
002  $ui.updateLoading(true) 顯示 loading  [PageUser.vue:473]
003  執行 core() 非同步流程  [PageUser.vue:394]
004      每次送出先清空 chPwOldError / chPwNewError / chPwConfirmError 三個 inline 錯誤訊息  [PageUser.vue:397-399]
005      檢查 oldPassword 為空  [PageUser.vue:402]
006          空:
007              chPwOldError = $t('userChangePasswordForNoOldPassword')（舊密碼欄下方紅字）, return  [PageUser.vue:403]
008      檢查 newPassword 為空  [PageUser.vue:408]
009          空:
010              chPwNewError = $t('userChangePasswordForNoNewPassword'), return  [PageUser.vue:409]
011      檢查 confirmPassword 為空  [PageUser.vue:414]
012          空:
013              chPwConfirmError = $t('userChangePasswordForNoConfirmPassword'), return  [PageUser.vue:415]
014      檢查 newPassword 與 confirmPassword 一致  [PageUser.vue:420]
015          不一致:
016              chPwConfirmError = $t('userChangePasswordNotSame'), return  [PageUser.vue:421]
017      呼叫後端 checkUserPassword 驗證新密碼是否合規  [PageUser.vue:427]
018          state==='success': bCkPw=true 繼續  [PageUser.vue:429]
019          state==='error': chPwNewError = res.msg（語系化策略錯誤訊息）  [PageUser.vue:433]
020          其他/網路錯誤: chPwNewError = $t('userChangePasswordForNetError')  [PageUser.vue:437-442]
021      呼叫後端 changeUserPassword（含 token + lang + 舊密碼 + 新密碼）  [PageUser.vue:450]
022          後端 checkTokenAndChangePassword:
023              checkToken 驗證 token 有效（無效/過期/重複/找不到 → reject）  [procCore.mjs:930]
024              檢查 oldPassword 字串非空  [procCore.mjs:938]
025                  空: reject('invalid oldPassword')  [procCore.mjs:939]
026              getUserByToken 取出使用者 id  [procCore.mjs:943]
027              _getGenUserByKV 以 id 取使用者完整資料（含 password 雜湊）  [procCore.mjs:947]
028              再次呼叫 checkUserPassword（防呆，新密碼策略）  [procCore.mjs:953]
029                  state==='error': reject(對應語系錯誤訊息)  [procCore.mjs:955]
030              比對舊密碼雜湊  [procCore.mjs:962-967]
031                  不符: reject('incorrect old password')  [procCore.mjs:966]
032              檢查使用者 email 非空（用於後續寄通知信）  [procCore.mjs:971]
033                  空: reject('invalid email')  [procCore.mjs:974]
034              新密碼加鹽雜湊後 save 至 users 表  [procCore.mjs:979-985]
035              try: 寄送密碼變更通知信（chpwEmTitle/chpwEmContent 模板代入 sender/name）  [procCore.mjs:988-1020]
036              catch: 僅 srLog.error 記錄, 不 reject（變更已成功，寄信失敗不阻擋）  [procCore.mjs:1023-1028]
037      .then 後端成功:
038          bChPw=true  [PageUser.vue:452]
039          cancelChangePassword（收起表單 + 清空 inline errors）  [PageUser.vue:455]
040          $alert($t('userChangePasswordSuccess')) 變更成功通知（保留為 alert，與輸入欄位無關）  [PageUser.vue:457]
041      .catch 後端任何 reject:
042          chPwOldError = $t('userChangePasswordFail')（顯示於舊密碼欄下方紅字，統一訊息不洩露細節）  [PageUser.vue:463]
043  .finally:
044      $ui.updateLoading(false) 隱藏 loading  [PageUser.vue:480]
```

### 四、變更成功後的後續

- 變更成功後使用者繼續處於 user view，**token 不變**（原有 session 保留，不需重新登入）
- email 通知（若寄信成功）內容含 sender（webName 對應語系）、name（使用者姓名），文字模板由 chpwEmTitle / chpwEmContent 控制
- 下次以舊密碼登入會被擋下（密碼已改）；以新密碼登入正常通過

### 五、密碼策略多層檢查設計

```
前端：未填欄位提示 + 兩次密碼一致檢查（純 UI 體驗，無 API 呼叫）
↓
前端 → 後端 checkUserPassword：策略合規檢查（長度、字元、黑名單、與帳號連續字元等）
       獨立 API，方便前端在送出前先驗
↓
後端 changeUserPassword 內 checkUserPassword：再次驗證一次（防 caller 跳過前端檢查）
↓
後端比對舊密碼正確
↓
寫入 + 寄通知信
```

兩層 checkUserPassword（前端送出前 + 後端 changeUserPassword 內）是有意設計：前者給使用者及時 UX 反饋，後者防止 caller 略過前端直接打 API。

### 六、與其他流程的互動

| 場景 | 行為 |
|------|------|
| 變更後以新密碼登入 | 正常通過 procCore.loginByAccountAndPassword 比對 |
| 變更後以舊密碼登入 | reject 'incorrect user account or password' |
| 變更後其他裝置已有的 token | 不受影響，仍可使用至 timeEnd（密碼變更**不**強制清除既有 token） |
| email 失效（被刪、改錯）| 寄信會 catch 失敗，但變更仍成功 |
| 並發變更（同時兩個 tab 送出）| 後端 save 會覆寫；前者完成後前端會看到密碼已改的事實，但無顯式衝突偵測 |

### 七、與「管理員重設密碼」「使用者透過連結變更密碼」的差異

| 項目 | 使用者自主變更（本流程） | 管理員重設 | 使用者透過連結變更 |
|------|------------------|-----------|-------------------|
| 進入點 | user view 內變更密碼按鈕 | 後台使用者清單 | email 連結 |
| 須知舊密碼 | 是 | 否 | 否（以連結 token 認證） |
| 須登入 | 是（既有 token） | 是（管理員 token） | 否（連結內含一次性 token） |
| 寄通知信 | 是 | 是 | 是 |
| 對應檔案 | PageUser.vue + procCore.checkTokenAndChangePassword | (見 z管理員使用者重設密碼之流程.md) | (見 z規格書5-使用者透過連結變更密碼.md) |
