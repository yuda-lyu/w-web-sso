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

### Upgrading from 1.1.4 and earlier

**修正說明**：1.1.4（含）以前，對外查詢 helper 失敗時會把已代入權杖之完整網址放進 reject 值與 console；消費端若把錯誤原樣回應，送出無效權杖即可取得該系統向 SSO 介接用之 app token。本版起 helper 之 reject 值與 console 皆不含權杖（下述），且 app token 改為依權限授權、預設只能查使用者（見下方「應用系統金鑰權限」）。

**應用系統金鑰（app token，`isApp='y'`）改為依權限授權（破壞性變更）**：原本 app token 通過全部需管理者之功能（視同管理者），本版起依 tokens 表新增之 `perms` 欄（權限字串陣列，多元素即多權限聯集）授權，**預設只提供查使用者**：

| 權限字串 | 名稱 | 可呼叫之功能 |
|---|---|---|
| `readUsers` | 讀使用者（基本權限，恆具備） | HTTP `/api/getSsoUserInfor`、`/api/getSsoUsersList`；後台 `getUserInfor`、`getUsersList` |
| `writeUsers` | 寫使用者 | 後台 `updateUsersList`、`adminResetUserPassword` |
| `readTokens` | 讀金鑰 | 後台 `getTokensList` |
| `writeTokens` | 寫金鑰 | 後台 `updateTokensList` |
| `readIps` | 讀IP | 後台 `getIpsList` |
| `writeIps` | 寫IP | 後台 `updateIpsList` |
| `readStats` | 讀統計 | 後台 `getStaUserSummary`、`getStaTokenSummary`、`getStaIpSummary`、`getStaUserAccountLogin`、`getStaToken`、`getStaIp` |

- 升級前既有之 app token 無 `perms` 欄，升級後只具 `readUsers`。本套件之對外查詢 helper 只用 `readUsers`，不受影響；介接系統若呼叫其他後台功能，請管理者於後台「金鑰清單」之「應用系統權限」欄勾選授予。
- `writeUsers`、`readTokens`、`writeTokens` 可讓持有者取得管理者層級之能力（讀取管理者之 session 金鑰、改寫金鑰或使用者後接管帳號），後台以「等同管理者權限」標註，請僅授予確有需要之系統。
- 缺權限時對外回 `tokenExpired`（與非管理者相同），SSO 之 srLog 記 `appTokenPermDenied`（含所需權限）供排錯。
- 以 API 寫入 `perms` 時須為權限字串陣列（未設定視同空陣列），含未登錄之字串則整批 reject `tokenPermsInvalid`。
- 使用者 token 不受 `perms` 影響，仍依使用者之 `isAdmin` 判斷；app token 之速率豁免（不受 token 調用次數封鎖）不變。

**對外查詢 helper（`src/getUserByToken.mjs` / `getUserByUserId.mjs` / `getUsersByToken.mjs`）之 reject 值改為固定 key（破壞性變更）**：reject 值不再含網址與權杖，詞彙與 w-web-perm 之 helper 一致；各 key 之 eng / cht 文字見 `server/procLang.mjs`。

| 舊 reject 字串 | 新 key |
|---|---|
| `invalid url` / `invalid tokenSelf` / `invalid tokenTar` / `invalid userIdTar` | `invalidUrl` / `invalidTokenSelf` / `invalidTokenTar` / `invalidUserIdTar` |
| `no 'token={sysToken}', 'key=token', 'value={token}' in url` | `noTokenKeyValueInUrl` |
| `no 'token={sysToken}', 'key=id', 'value={userId}' in url` | `noTokenKeyUserIdInUrl` |
| `no 'token={sysToken}' in url` | `noTokenInUrl` |
| `can not get user by url[...]` / `can not get users by url[...]` | `cannotGetUserByUrl` / `cannotGetUsersByUrl` |
| `can not get user data by url[...]` / `can not get users data by url[...]` | `cannotGetUserDataByUrl` / `cannotGetUsersDataByUrl` |
| `no user data by url[...]` / `no users data by url[...]` | `noUserDataByUrl` / `noUsersDataByUrl` |
| `no user data after funConvertUser`（含 `funConvertUser` 拋錯或 reject） | `noUserDataAfterConvert` |

- 呼叫端請以 key 判斷，並映射為自家語系之錯誤 key 後再回前端；helper 之 reject 值不得原樣回前端。
- `tokenSelf` 為 app token 時，helper 只可在伺服端呼叫（放進瀏覽器即等於公開 app token）。
- 代入值改經 `encodeURIComponent`（對 UUID、英數與 `-_.~` 不變），`getUsersByToken` 之清單須為非空陣列。
- 失敗時之 console 由多行改為一行 `[w-web-sso] <helper> <key> {...}`，不含任何權杖字元。

**`/api/getSsoUsersList`（及 `getUsersByToken`）不再輸出 `tokenVerify`**（憑證欄；`password` 原即不輸出）。後台使用者清單不受影響。

**log**：權杖遮罩對 16 字元以下之權杖露出更少字元（36 字元 session token 格式不變），陣列與非字串一律遮罩；資料通道之 `referer` 只記 origin + pathname；`getSsoUserInfor` 以非識別欄（id / account / email / name 以外）查詢時之查詢值遮罩。

### Upgrading from 1.0.3x / 1.0.5x

**Settings (啟動契約)**: 舊版 settings 原封不動即可啟動——新增之設定鍵皆有內建預設：

- `allowUserRegistration` 預設 `false`（自助註冊為 opt-in 新功能，明確設 `true` 才啟用；正式機須給 `verifyBaseUrl` 使驗證信連結可自外部連通）。`siteUrl` 為選填（目前保留供未來使用，尚無功能讀取，不強制提供）。
- `passwordPolicy` 未給採程式內建預設密碼政策（同套件自帶 settings.json 之預設組）；有給則以內建預設為底淺層 merge——可只給欲調整之欄位（如 `{ minLength: 10 }`），未給欄位沿用內建（黑名單等隨套件更新），merge 後逐欄驗證（給了就必須給對）。
- 信件文字鍵**全數繼續生效**（各欄位逐語系物件，語意同舊版）：`chpwEmTitle` / `chpwEmContent`（變更密碼通知信，`{sender}`/`{name}` 置換符）、`regVerifyEmTitle` / `regVerifyEmContent`（註冊驗證信，`{sender}`/`{name}`/`{verifyUrl}` 置換符）；另新增 `resetPwEmTitle` / `resetPwEmContent`（重設密碼通知信，`{sender}`/`{name}`/`{account}`/`{newPassword}` 置換符）與 `verifyEmailResultContent`（驗證結果頁，`{title}`/`{message}` 置換符）；2026-09-15 起結果頁之三則訊息 `userRegistrationVerifySuccess` / `verifyEmailAlreadyVerified` / `verifyEmailInvalidToken` 亦可以同名 settings 鍵逐語系覆寫（代入 `{message}`；部署方須點名自家系統時於此覆寫，不改套件內建）。各值可直接給文字，**亦可給檔案路徑**（絕對或基於啟動路徑之相對，檔案存在即讀檔作為內容，不存在則原樣視為文字）。既有客製不需任何搬移；未給時採內建語系文字（結果頁採內建模板，另可用 `pathTemplate` 指定自訂結果頁模板資料夾）。套件自帶 `settings.json` 已含全部鍵與預設文字可直接參考。
- settings 內 `salt` 為伺服器端 pepper（範例值 `'{salt}'`，正式部署請自行改為高熵字串；亦可以環境變數 `SALT` 覆寫）；套件不檢查其內容。

**API (授權收緊, 1.0.5x 起)**: `/api/getSsoUserInfor` 與 `/api/getSsoUsersList` 由「任何有效 token」收緊為須 **admin token 或 app token（`isApp='y'`；1.1.4 之後之版本改為具 `readUsers` 之 app token，此為其基本權限）**。以 app token 做系統介接者不受影響；若既有整合以一般使用者 token 呼叫這兩支，請改用 app token。錯誤訊息字串已改為 i18n key（呼叫端請以 `state==='success'` 判斷成敗，勿比對錯誤字串）。

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
