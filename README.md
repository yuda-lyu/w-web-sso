# w-web-sso
A web service for SSO.

![language](https://img.shields.io/badge/language-JavaScript-orange.svg) 
[![npm version](http://img.shields.io/npm/v/w-web-sso.svg?style=flat)](https://npmjs.org/package/w-web-sso) 
[![license](https://img.shields.io/npm/l/w-web-sso.svg?style=flat)](https://npmjs.org/package/w-web-sso) 
[![npm download](https://img.shields.io/npm/dt/w-web-sso.svg)](https://npmjs.org/package/w-web-sso) 
[![npm download](https://img.shields.io/npm/dm/w-web-sso.svg)](https://npmjs.org/package/w-web-sso) 
[![jsdelivr download](https://img.shields.io/jsdelivr/npm/hm/w-web-sso.svg)](https://www.jsdelivr.com/package/npm/w-web-sso)

## Documentation
To view documentation or get support, visit [docs](https://yuda-lyu.github.io/w-web-sso/WWebSso.html).

## Upgrade Notes

### Upgrading from 1.0.3x / 1.0.5x

**Settings (啟動契約)**: 舊版 settings 原封不動即可啟動——新增之設定鍵皆有內建預設：

- `allowUserRegistration` 預設 `false`（自助註冊為 opt-in 新功能，明確設 `true` 才啟用；啟用時須另給 `siteUrl`，正式機另須給 `verifyBaseUrl` 使驗證信連結可自外部連通）。
- `passwordPolicy` 未給採程式內建預設密碼政策（同套件自帶 settings.json 之預設組）；有給則 13 個子欄位逐欄驗證。
- 信件文字鍵**全數繼續生效**（各欄位逐語系物件，語意同舊版）：`chpwEmTitle` / `chpwEmContent`（變更密碼通知信，`{sender}`/`{name}` 置換符）、`regVerifyEmTitle` / `regVerifyEmContent`（註冊驗證信，`{sender}`/`{name}`/`{verifyUrl}` 置換符）；另新增 `resetPwEmTitle` / `resetPwEmContent`（重設密碼通知信，`{sender}`/`{name}`/`{account}`/`{newPassword}` 置換符）與 `verifyEmailResultContent`（驗證結果頁，`{title}`/`{message}` 置換符）。各值可直接給文字，**亦可給檔案路徑**（絕對或基於啟動路徑之相對，檔案存在即讀檔作為內容，不存在則原樣視為文字）。既有客製不需任何搬移；未給時採內建語系文字（結果頁採內建模板，另可用 `pathTemplate` 指定自訂結果頁模板資料夾）。套件自帶 `settings.json` 已含全部鍵與預設文字可直接參考。
- 生產環境須以環境變數 `SALT` 注入真實 pepper（settings 內 `salt` 為 `'{salt}'` 佔位符或空值時啟動拒啟；測試/開發可設 `ALLOW_PLACEHOLDER_SALT=1` 放行）。

**API (授權收緊, 1.0.5x 起)**: `/api/getSsoUserInfor` 與 `/api/getSsoUsersList` 由「任何有效 token」收緊為須 **admin token 或 app token（`isApp='y'`）**。以 app token 做系統介接者不受影響；若既有整合以一般使用者 token 呼叫這兩支，請改用 app token。錯誤訊息字串已改為 i18n key（呼叫端請以 `state==='success'` 判斷成敗，勿比對錯誤字串）。

**Database (資料契約, 1.0.5x 起之破壞性變更)**: 密碼雜湊改為 `scrypt:{saltHex}:{hashHex}` 自描述格式且**不相容舊格式**，並新增 `timeVerified` 必填欄位（為空視為未完成信箱驗證、拒絕登入）。舊 DB 之使用者（含 admin）升級後將全數無法登入——請重建 DB 並重匯入使用者資料（以新版 `hashPassword` 產生密碼並補 `timeVerified`），或自行撰寫一次性遷移（重設密碼＋補 `timeVerified`＋可標 `isForceChangePw='y'` 要求使用者改密）。

## Installation

### Using npm(ES6 module):
```alias
npm i w-web-sso
```

#### Example for server:
> **Link:** [[dev source code](https://github.com/yuda-lyu/w-web-sso/blob/master/srv.mjs)]
```alias

```
