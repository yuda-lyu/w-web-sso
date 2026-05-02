# 使用者創建帳密流程

## 觸發

使用者在 PageLogin.vue 點擊「Register」進入註冊表單，填寫完成後點擊「Submit」。

## 重要流程
- 使用者於登入頁點擊註冊, 檢測ooo都成功, 收信點擊驗證信, 完成登入
- 使用者於登入頁點擊註冊, 檢測ooo都成功, 未收信點擊驗證信, 無法登入
- 使用者於登入頁點擊註冊, 檢測未給予帳號, 無法註冊
- 使用者於登入頁點擊註冊, 檢測未給予密碼, 無法註冊
- 使用者於登入頁點擊註冊, 檢測未給予email, 無法註冊
- 使用者於登入頁點擊註冊, 檢測ooo密碼不合格式, 無法註冊
- 使用者於登入頁點擊註冊, 檢測ooo密碼與確認密碼不同, 無法註冊
- 使用者於登入頁點擊註冊, 檢測ooo未給予姓名, 無法註冊
- 使用者於登入頁點擊註冊, 檢測ooo email格式不合, 無法註冊
- 使用者於登入頁點擊註冊, 檢測ooo帳號已被註冊, 無法註冊
- 使用者於登入頁點擊註冊, 檢測ooo email已被註冊, 無法註冊
- 使用者於登入頁點擊註冊, 系統不允許自助註冊, 無法註冊
- 使用者於登入頁點擊註冊, 檢測ooo都成功但寄驗證信失敗, 仍完成註冊但使用者收不到驗證信, 須透過重寄機制
- 使用者點擊驗證信連結, token 不存在或已被使用, 重導至驗證失敗頁
- 使用者點擊驗證信連結, token 非驗證用途 (如 login token), 重導至驗證失敗頁
- 使用者點擊驗證信連結, 帳號已驗證過, 顯示已驗證提示
- 使用者未驗證帳號嘗試登入, 顯示「重寄驗證信」UI
- 使用者於未驗證提示點擊重寄, 檢測帳號不存在, 無法重寄 (統一訊息不洩露帳號存在性)
- 使用者於未驗證提示點擊重寄, 檢測 email 與帳號不符, 無法重寄
- 使用者於未驗證提示點擊重寄, 檢測帳號已驗證, 無法重寄
- 使用者於未驗證提示點擊重寄, 寄信失敗, 無法重寄
- 使用者於未驗證提示點擊重寄, 重寄成功, 使用者可重新收信驗證

## 執行流程

### 一、註冊

```
001  呼叫後端 createUser，帶入語系、帳號、密碼、確認密碼、姓名、email  [PageLogin.vue:530]
002      呼叫核心層 p.createUser，無 catch，reject 時 throw 至外層  [WWebSso.mjs:1169]
003          檢查是否允許自助註冊  [procCore.mjs:648]
004              不允許:
005                  reject('userRegistrationNotAllowed')  [procCore.mjs:650]
006          檢查帳號  [procCore.mjs:654]
007              為空:
008                  reject('invalid account')  [procCore.mjs:656]
009          檢查 email 格式  [procCore.mjs:662]
010              無效:
011                  reject('invalid email format')  [procCore.mjs:663]
012          檢查密碼與確認密碼  [procCore.mjs:670]
013              不一致:
014                  reject('userChangePasswordNotSame')  [procCore.mjs:672]
015          執行 14 項密碼策略驗證  [procCore.mjs:677]
016              不符:
017                  reject(對應語系錯誤訊息)  [procCore.mjs:679]
018          檢查姓名  [procCore.mjs:683]
019              為空:
020                  reject('invalid name')  [procCore.mjs:685]
021          全表查詢所有使用者（不限 isActive），檢查唯一性  [procCore.mjs:689]
022              帳號已存在:
023                  reject('userRegistrationAccountExists')  [procCore.mjs:692]
024              email 已存在:
025                  reject('userRegistrationEmailExists')  [procCore.mjs:700]
026          密碼加鹽雜湊  [procCore.mjs:704]
027          建立使用者資料 (isAdmin:'n', isActive:'y', timeVerified:'' 須驗證)  [procCore.mjs:707]
028          寫入資料庫，無 catch，reject 時 throw 至外層  [procCore.mjs:717]
029          產生驗證用 token (isApp:'verify')  [procCore.mjs:720]
030          寫入 token，無 catch，reject 時 throw 至外層  [procCore.mjs:724]
031          try: 寄送驗證信（連結指向後端 /api/verifyEmail?token=xxx）  [procCore.mjs:728]
032          catch: 僅 log，失敗不阻擋註冊  [procCore.mjs:740]
033          回傳成功  [procCore.mjs:744]
034  .then  [PageLogin.vue:531]
035      顯示「請至信箱收取驗證信」  [PageLogin.vue:534]
036      清空表單，切回登入模式  [PageLogin.vue:538]
037  .catch(err)  [PageLogin.vue:543]
038      直接顯示後端回傳的語系化錯誤訊息  [PageLogin.vue:544]
```

### 二、驗證信

```
001  使用者點擊 email 中的驗證連結
002  瀏覽器 GET {verifyBaseUrl}/api/verifyEmail?token=xxx
003      呼叫核心層 p.verifyEmail  [WWebSso.mjs:1021]
004          驗證 token 是否存在，無 catch，reject 時 throw 至外層  [procCore.mjs:752]
005              不存在:
006                  reject  [procCore.mjs:752]
007          確認為驗證用 token (isApp==='verify')，無 catch，reject 時 throw 至外層  [procCore.mjs:755]
008              非驗證 token:
009                  reject('invalid verify token')  [procCore.mjs:757]
010          以 userId 查找使用者，無 catch，reject 時 throw 至外層  [procCore.mjs:766]
011          檢查 timeVerified  [procCore.mjs:769]
012              已有值:
013                  回傳 'already verified'  [procCore.mjs:770]
014          將 timeVerified 寫入當前時間，無 catch，reject 時 throw 至外層  [procCore.mjs:777]
015          刪除已使用的驗證 token，無 catch，reject 時 throw 至外層  [procCore.mjs:782]
016          回傳成功  [procCore.mjs:787]
017      檢查 verifyEmail 結果  [WWebSso.mjs:1030]
018          resolve:
019              302 重導至 {siteUrl}/?verified=ok  [WWebSso.mjs:1031]
020          reject:
021              302 重導至 {siteUrl}/?verified=fail  [WWebSso.mjs:1034]
022  瀏覽器載入前端登入頁
023  mounted 偵測 URL 的 verified 參數  [PageLogin.vue:345]
024      ok:
025          顯示「驗證成功，請登入」  [PageLogin.vue:347]
026      fail:
027          顯示「驗證失敗」  [PageLogin.vue:351]
```

### 三、未驗證帳號嘗試登入

```
001  進入一般登入流程 (見 z流程_使用者一般登入.md)
002  密碼比對通過  [procCore.mjs:263]
003  檢查 timeVerified  [procCore.mjs:268]
004      為空:
005          reject('account not verified')  [procCore.mjs:270]
006  .catch  [mUI.mjs:448]
007      上拋原始 err 給 PageLogin (pm.reject)  [mUI.mjs:461]
008  .catch(err)  [PageLogin.vue:579]
009      檢查錯誤類型  [PageLogin.vue:582]
010          'account not verified':
011              顯示「重寄驗證信」UI  [PageLogin.vue:583]
012      返回登入頁  [PageLogin.vue:603]
```

### 四、重寄驗證信

```
001  呼叫後端 resendVerifyEmail，帶入語系、帳號、email  [PageLogin.vue:552]
002      以帳號查找使用者，無 catch，reject 時 throw 至外層  [procCore.mjs:807]
003          找不到:
004              reject('invalid account or email')（統一訊息，不洩露帳號存在性）  [procCore.mjs:812]
005      檢查 email 是否與該帳號一致  [procCore.mjs:814]
006          不符:
007              reject('invalid account or email')  [procCore.mjs:816]
008      檢查 timeVerified  [procCore.mjs:819]
009          已驗證:
010              reject('account already verified')  [procCore.mjs:820]
011      刪除該使用者所有舊的驗證 token  [procCore.mjs:828]
012      產生新驗證 token  [procCore.mjs:835]
013      寫入新 token，無 catch，reject 時 throw 至外層  [procCore.mjs:838]
014      try: 寄送驗證信  [procCore.mjs:842]
015      catch: reject('send email failed')  [procCore.mjs:852]
016      回傳成功  [procCore.mjs:855]
017  .then  [PageLogin.vue:553]
018      顯示「驗證信已重新寄出」  [PageLogin.vue:554]
019  .catch(err)  [PageLogin.vue:557]
020      顯示錯誤訊息  [PageLogin.vue:558]
```

### 五、新帳號狀態變化

| 階段 | timeVerified | 可登入 |
|------|-------------|--------|
| 剛註冊 | 空 | 否 |
| 點擊驗證連結 | 填入時間 | 是 |
| 正常登入 | 有值 | 是 |

### 六、管理員後台建帳 vs 自助註冊

| 項目 | 自助註冊 | 管理員後台建帳 |
|------|---------|--------------|
| timeVerified | 空（須驗證） | 自動填入 now（已驗證） |
| isAdmin | 固定 'n' | 可設定 |
| 驗證信 | 自動寄出 | 不寄 |
