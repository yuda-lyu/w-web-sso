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

## Security: token 入口與呼叫者(2026-10-24)

後端以 token 授權之入口，依呼叫者之通過（✓）與拒絕（✗；對外一律固定鍵 `tokenExpired`，除註明者）整理如下。呼叫者：**無**＝未帶 token；**使用者**＝一般使用者之登入 token；**管理員**＝管理者之登入 token；**用途·使用者**＝使用者用途之應用系統金鑰（綁一般使用者／綁管理員，授權同所綁使用者之登入 token）；**用途·系統**＝系統服務用途之應用系統金鑰（依 `perms`；基本權限 `readUsers` 恆具備）。使用者目前之狀態（已驗證、未封鎖、帳號未到期、未停用）於每次使用時判定；系統服務用途不受建立者狀態影響。

| 入口 | 無 | 使用者 | 管理員 | 用途·使用者(綁一般) | 用途·使用者(綁管理員) | 用途·系統(具 perm) | 用途·系統(缺 perm) |
|---|---|---|---|---|---|---|---|
| `checkToken`、`logoutByToken`、`logoutSsoUser`（HTTP／函數） | ✗ | ✓ 本人 | ✓ 本人 | ✓ 本 token | ✓ 本 token | ✓ 本 token | ✓ 本 token |
| `refreshToken` | ✗ | ✓ | ✓ | ✗ `tokenAppNoRefresh` | ✗ `tokenAppNoRefresh` | ✗ `tokenAppNoRefresh` | ✗ `tokenAppNoRefresh` |
| `getUserByToken`（查自己） | ✗ | ✓ | ✓ | ✓ 所綁使用者 | ✓ 所綁使用者 | ✓ 應用系統身分 | ✓ 應用系統身分 |
| `changeUserPassword` | ✗ | ✓ 本人（須舊密碼） | ✓ 本人 | ✓ 所綁使用者（須舊密碼） | ✓ 所綁使用者 | ✗ `tokenUserOnly` | ✗ `tokenUserOnly` |
| 讀使用者：`/api/getSsoUserInfor`（`key=id\|account\|email\|name\|token`）、`/api/getSsoUsersList`、`getUserInfor`、`getUsersList`（`readUsers`） | ✗ | ✗ | ✓ | ✗ | ✓ | ✓ | ✓ |
| 寫使用者：`updateUsersList`、`adminResetUserPassword`（`writeUsers`） | ✗ | ✗ | ✓ | ✗ | ✓ | ✓ | ✗ |
| 金鑰：`getTokensList`（`readTokens`）；`updateTokensList`、`createAppToken`（`writeTokens`） | ✗ | ✗ | ✓ | ✗ | ✓ | ✓ | ✗ |
| IP：`getIpsList`（`readIps`）；`updateIpsList`（`writeIps`） | ✗ | ✗ | ✓ | ✗ | ✓ | ✓ | ✗ |
| 統計：`getStaUserSummary`、`getStaTokenSummary`、`getStaIpSummary`、`getStaUserAccountLogin`、`getStaToken`、`getStaIp`（`readStats`） | ✗ | ✗ | ✓ | ✗ | ✓ | ✓ | ✗ |

- 公開入口（不讀 token）：靜態頁、`getWebInfor`、`checkUserPassword`、`loginByAccountAndPassword`、`[sys:getFuncList]`；`createUser`、`verifyEmail`（HTTP 連結與函數）、`resendVerifyEmail` 另受 `allowUserRegistration` 開關約束（關閉時一律回 `userRegistrationNotAllowed`）。
- 失效之 token（未知字串、已逾期之登入 token）一律同於「無」（對外 `tokenExpired`）；**例外**：登出入口讓持有者清理自己已逾期之登入 token。
- 本表以 `test/api-accessmatrix.test.mjs` 逐格驗證（token 入口 27 個 × 呼叫者 7 類，另失效 token 子類與公開入口），修改任何入口之授權時須同步更新該檔之 `entries`。已知另輪處理：`[sys:getTableTags]`、`[sys:polling]` 兩個系統函數目前不要求 token。

## Upgrade Notes

### Upgrading from 1.1.13 and earlier

**應用系統金鑰之兩種用途與反查身分（行為變更，ADR-095）**：應用系統金鑰（`isApp='y'`）依用途分為兩種，tokens 表新增 `appUsage`（`user`／`system`）與 `appName`（金鑰名稱）兩欄（既有資料不需遷移）：

| | 使用者用途（`appUsage='user'`） | 系統服務用途（`appUsage='system'`） |
|---|---|---|
| 代表 | 所綁定之一位既有啟用使用者本人（`userId` 即所綁使用者，可綁管理員） | 外部應用系統本身，不綁使用者（`userId` 僅記建立者供稽核） |
| 授權 | 同該使用者之登入權杖（含管理入口之管理者判準），不適用 `perms` | 依 `perms`（ADR-069，預設只有 `readUsers`） |
| 可用性 | 每次使用即時依所綁使用者目前狀態判定（存在、啟用、未封鎖、帳號未到期、已驗證），不符即不可用，狀態恢復後可再用 | 不隨建立者之停用、刪除、封鎖而失效；由管理員於後台撤銷 |
| `getUserByToken`／`/api/getSsoUserInfor?key=token` 回傳 | 所綁使用者之真實資料，`isApp='y'` | 應用系統身分：`id=app:<金鑰主鍵>`、`name=金鑰名稱`、`isApp='y'`、`isAdmin='y'`，其餘為占位字串 |
| `changeUserPassword` | 可（仍須舊密碼，作用於所綁使用者） | 不可（`tokenUserOnly`） |

- **對下游專案（w-web-perm／w-web-api／w-web-task 等）之反查變更**：系統服務用途金鑰過去反查回之 `id` 為金鑰擁有者欄（建立者）之使用者主鍵，與真實使用者主鍵相同而無法區分；本版起為 `app:<金鑰主鍵>`（後台清單拒收 `app:` 開頭之使用者主鍵，故不與任何使用者相撞）且 `name` 為金鑰名稱。下游若以反查之 `id` 對應自家資料（角色、權限、稽核），須改以 `app:` 前綴辨識應用系統身分。使用者用途金鑰反查回所綁使用者本人（與其登入權杖同一身分，另帶 `isApp='y'`）。
- **反查之目標權杖須此刻可用**：以 `key=token` 反查之目標權杖已逾期、查無，或其使用者目前不可用（停用、封鎖、帳號到期、未驗證），一律回固定鍵（`tokenNoPermission`），不分原因。
- **不設期限、不續期**：兩種用途皆不給到期時間（後台列表顯示「不設期限」）；對應用系統金鑰呼叫 `refreshToken` 一律拒收（`tokenAppNoRefresh`）。升級前既有之應用系統金鑰列（無用途欄）視同系統服務用途，不改庫；**其中 `timeEnd` 已過期而未被刪除之舊列，因應用系統金鑰不再判定到期而恢復可用**，升級前請於後台金鑰清單檢視並刪除不再需要者。
- **新增方式改為 `createAppToken`（後台「金鑰清單」之「新增應用系統金鑰」鈕）**：填名稱（1～60 字）、選用途；使用者用途須選一位啟用中之使用者，系統服務用途勾選權限；權杖字串由伺服端產生。金鑰清單存檔（`updateTokensList`）**不再能新增應用系統金鑰**（`tokenAppAddNotAllowed`），**不再能把登入權杖勾選升級為應用系統金鑰**（`tokenSessionUpgradeNotAllowed`；後台「是否為應用系統金鑰」欄改為唯讀），應用系統金鑰之金鑰字串、所綁使用者、用途、名稱、到期時間建立後不可變更（`tokenAppLocked`），使用者用途不可帶 `perms`（`tokenAppPermsNotForUser`）；清單存檔仍可修改系統服務用途之權限與刪除金鑰。**直打 API 以清單鑄造應用系統金鑰之舊用法須改為呼叫 `createAppToken`**。
- **停用或刪除使用者時之撤銷範圍**：撤銷該使用者之登入權杖與**綁定該使用者之使用者用途金鑰**（刪列，重新啟用後不恢復，須重新核發）；系統服務用途金鑰（含建立者欄為該使用者者）不撤銷。使用者被封鎖（含自動封鎖）、帳號到期、未驗證時，使用者用途金鑰不刪列，只是即時不可用，狀態恢復後可再用。
- **對外查詢之授權判準**：以使用者用途金鑰呼叫對外查詢、後台入口者，授權同所綁使用者（綁一般使用者者不具管理服務）；使用者用途金鑰綁管理員時，同樣受「不得停用／降權／刪除自己」之保護（作用於所綁管理員）。
- 保留字：使用者主鍵不得以 `app:` 開頭（後台清單新增使用者時拒收，`invalidRows`）。**既有使用者若主鍵已以 `app:` 開頭，其與系統服務用途金鑰之應用系統身分同名**（`app:<金鑰主鍵>`），下游依 `id` 對應資料時會混同；升級前請檢查 `users` 表並更換此類主鍵（正常產生之主鍵為 UUID，不會如此）。
- 登出（`logoutByToken`、`logoutSsoUser`）為持有者清理自己權杖之入口：**已逾期之登入權杖仍可登出（只刪本權杖、不回任何資料、不行使任何能力）**，其餘各入口對逾期、使用者不可用之權杖一律回 `tokenExpired`。
- 統計之「權杖調用」以系統服務用途金鑰之應用系統身分記錄（顯示金鑰名稱），不再併入建立者名下。

**登入權杖之即時有效性（行為變更，S-4）**：登入權杖（session 權杖）原只檢查到期時間；本版起每次使用另依其使用者目前狀態判定（與登入同一判準：已驗證、帳號未到期、未被封鎖、啟用），不符即與到期同樣回 `tokenExpired`。**未驗證信箱、被封鎖、帳號到期或已停用使用者所持有之既有登入權杖因此立即失效**（原可使用至權杖到期）；狀態恢復後權杖照常可用（未被撤銷者）。

**後台重設他人密碼之管理者判準（S-2，語系鍵移除）**：`adminResetUserPassword` 原僅判 `isAdmin==='y'` 並對非管理者回 `adminResetPasswordForbidden`；本版起與其他管理入口同一判準（`funCheckAdmin`：已驗證、帳號未到期、未被封鎖、啟用、管理者），非管理者、狀態不符或權杖無效一律回 `tokenExpired`。語系鍵 `adminResetPasswordForbidden` 已移除，呼叫端若以該鍵判斷須改判 `tokenExpired`。

**自助註冊關閉時之驗證入口（S-6）**：`allowUserRegistration` 為 `false`（預設）時，`verifyEmail`（HTTP 驗證連結與 kpfun）與 `resendVerifyEmail` 一律回 `userRegistrationNotAllowed`（驗證連結失效、不寄信、不改資料）；登入頁之「重寄驗證信」連結同步隱藏。已開啟註冊之部署不受影響。

- 新增語系鍵：`tokenAppAddNotAllowed`、`tokenSessionUpgradeNotAllowed`、`tokenAppLocked`、`tokenAppPermsNotForUser`、`tokenAppUsageInvalid`、`tokenAppNameInvalid`、`tokenAppUserInvalid`、`tokenAppUserNotForSystem`、`tokenAppCreateFailed`、`tokenAppNoRefresh`、`tokenUserOnly` 及後台畫面用之文字鍵（eng／cht）；移除 `adminResetPasswordForbidden`。
- 本節取代 1.1.12 節中「金鑰清單新增列僅限應用系統金鑰」「將既有 session 列升級為應用系統金鑰」之敘述。

**改密碼後之 session 處置（行為變更）**：依 OWASP ASVS「改密碼後提供終止其他所有 session」，本版起改密碼會撤銷該使用者的登入權杖（session 權杖，`isApp` 非 `'y'`）：

- **管理員重設他人密碼**（後台「重設密碼」鈕，或具 `writeUsers` 之 app 權杖呼叫 `adminResetUserPassword`）→ 撤銷**對方全部** session 權杖；該使用者所有裝置立即登出（下次呼叫回登入頁），須以新密碼重新登入。強制下次登入改密碼（`isForceChangePw='y'`）之行為不變。
- **使用者自行改密碼**（`changeUserPassword`）→ **保留發出此請求之目前 session**，撤銷該使用者**其他所有** session 權杖；其他裝置須重新登入。
- **app 權杖（應用系統金鑰，`isApp='y'`）不是 session，不撤銷**（含以該使用者為擁有者者）；疑似被盜之 app 權杖仍須由後台「金鑰清單」處置。以 app 權杖呼叫 `changeUserPassword`（作用於其擁有者，仍須提供舊密碼）時無「目前 session」可保留，該使用者全部 session 撤銷。
- 密碼寫入與撤銷在 `[tokens, users]` 兩把表鎖內完成；驗證全數通過後先撤銷、後寫密碼：撤銷失敗則整次拒絕（`adminResetPasswordFailed`／`userChangePasswordFail`）且密碼不變；撤銷成功而密碼寫入失敗時拒絕、密碼不變、session 已撤銷（以原密碼重新登入）。不會出現「密碼已變更但舊 session 仍有效」。舊密碼錯、新密碼不合策略、目標不存在等驗證未過之情形不撤銷任何權杖。
- 被撤銷之權杖立即無效（`checkToken`／`refreshToken` 皆拒）。無新增語系鍵、RPC 簽章不變。本套件無「忘記密碼、經 email 重設」之未登入入口；日後若新增，須同樣撤銷全部 session。
- 影響：多裝置使用者自行改密碼後，其他裝置須重新登入（原本可使用至權杖到期）；管理員重設後目標使用者所有裝置皆登出。

**後台使用者清單之「登入後轉址（redir）」檢查範圍（修正）**：自助註冊之使用者其 `redir` 為空（註冊流程不收轉址，預設空字串；以 `view=user`／`view=backstage` 登入不需轉址），過去前端對清單全部列檢查「redir 不可空」，只要清單中有這類使用者，管理員儲存任何變更都被擋（「尚未給予有效登入後轉址」）。本版起只攔下管理員**本次新增**之列與**由非空改為空**之既有列；載入時即為空之既有列不擋存檔、不標警示（欲讓其以預設 `view=login` 轉址登入，請管理員於清單補上 redir）。後端本就不驗 redir，無變更。

### Upgrading from 1.1.12 and earlier

**多人同時編輯之寫入契約（行為變更）**：多位管理員可同時開啟後台使用者／金鑰／IP 清單，過去先存者之修改會被持舊畫面者整份蓋回（含系統另行寫入之驗證時間、封鎖時間、強制變更密碼旗標、密碼雜湊、續期後之到期時間），載入後新增之使用者／IP／登入中之 session 金鑰會被誤刪，已登出或被封鎖撤銷之 session 金鑰會復活。本版起（依 w-serv-orm 1.1.17，部署前提：單一行程、同表只由同一個 ORM 實例寫入）：

- **先動先贏、整次拒收、零寫入**：後台三個清單頁於載入時以畫面所見之列自算基準（`buildBaseline`，前後端共用 `src/writeContracts/` 之寫入契約），存檔時連同送出；後端於該表之表鎖內新鮮讀取並比對，不符整次拒收（不部分寫入），草稿保留並提示重新載入，回語系鍵 `saveStale`（載入後資料已被更動）、`saveRowNotFound`（要改或刪之資料已不存在）、`saveBaselineFormat`（基準格式或版本不識；不會降級為不帶基準）。存檔成功後前端重新讀取清單作為新基準（不以自己送出之值當基準）。基準比對之欄位為契約 `fields`（使用者清單另含列序名次）；伺服器專有欄位不入基準。
- **RPC 簽章**：`updateUsersList`／`updateIpsList` 新增選用第 4 參數 `{ baseline }`，`updateTokensList` 為 `{ baseline, baselineSession }`（`baseline`：應用系統金鑰列〔`isApp='y'`〕嚴格整表比對；`baselineSession`：session 列逐列寬鬆比對）。第 4 參數只接受此白名單鍵；不是純物件、多餘鍵、缺鍵或格式不識皆回 `saveBaselineFormat`。回傳形狀不變。
- **金鑰清單之 session 列（選項 P）**：session 列由登入新增、續期改 `timeEnd`、登出或封鎖刪除，變動頻繁，不採整表比對。只比對管理員有修改或刪除之列；載入後才登入之 session 不被刪；載入後已登出或被封鎖撤銷者不復活；系統續期而管理員未動之列不寫（到期時間不被舊值蓋回）；管理員有動而庫內已變者（如刪除或修改一個剛被續期之 session）整次拒收，重新載入後再操作。
- **不帶基準之寫入**（app 權杖直呼、升級前已開啟而未重新載入之舊版頁面）本 major 仍允許，後者蓋前者，但：一律取表鎖、修改只改不增、伺服器專有欄位（`password`、`tokenVerify`、`userId`、`timeCreate`、稽核欄、tokens 之 `timeUpdate`）不採用客戶端值（舊版頁面整列送回之舊值不再回寫）；金鑰清單只刪／改應用系統金鑰列，**session 列不刪、不以送入值覆蓋**（原會刪除載入後才登入者、以舊到期時間蓋回續期）；新增列僅限應用系統金鑰（`isApp='y'`，含直打 API 鑄造應用系統金鑰）。若要刪除某 session 以強制登出，請用後台頁（帶基準）。**下一個 major 起後台一律必帶基準，未帶者拒收。**
- **金鑰清單存檔不得新增 session 列（行為變更；帶或不帶基準皆然）**：session 金鑰（`isApp` 非 `'y'`）只由登入產生。`updateTokensList` 送出之列若庫內不存在且 `isApp` 非 `'y'`，整次拒收（零寫入，同批之其他變更亦不寫），回語系鍵 `tokenSessionAddNotAllowed`（「不可新增登入權杖」），不回顯值。因此以 app 權杖直呼、或升級前已開啟而未重新載入之舊版頁面，送回已被登出或自動封鎖撤銷之 session 列時，不會使其復活（繞過自動封鎖）；舊版頁面遇此情形須重新載入。不受影響：新增應用系統金鑰列、管理員（帶基準）對既有 session 列之刪除（強制登出）、將既有 session 列升級為應用系統金鑰、帶基準時基準內而管理員未動且已被撤銷之 session 列（略過、不復活）。原先「直打 API 以清單鑄造使用者 session 金鑰」之能力一併收回；需要以應用系統身分呼叫者請鑄造應用系統金鑰。
- **雙方欄位**（後台可改、系統亦會寫）入基準：`timeVerified`、`timeBlocked`、`isForceChangePw`、金鑰之 `timeEnd`、IP 之 `timeBlocked`。系統於持舊畫面者載入後改動這些欄位（驗證信、自動封鎖、重設密碼、app 權杖續期、IP 封鎖），其存檔即被拒。IP 清單另有：自動偵測計時器每 2 秒登錄新 IP，繁忙系統上舊畫面存檔較常需重新載入。
- **表鎖**：users／tokens／ips 每表一把；server 端全部 19 個寫入站點（後台存檔、登入新增金鑰、續期、登出、自助註冊、驗證信、改密碼、重設密碼、自動封鎖帳號／權杖、計時器登錄與封鎖 IP 等）皆在該表表鎖內執行，系統直寫改為只改不增（讀到後該列被刪，不再把只含被寫欄位之殘缺列新增回庫）；使用者清單存檔與帳號封鎖在 `[tokens, users]` 兩把鎖內同鎖撤銷名下金鑰；自助註冊與後台清單新增同帳號不再可同時成功（帳號唯一性檢查與新增同在 users 表鎖內）；登入於 tokens 表鎖內重讀使用者狀態，已被停用、刪除或封鎖、密碼已被變更（如管理員重設）、驗證被清除或已到期者不再鑄出金鑰，登入回傳之使用者資料取自該次新鮮讀取；自動封鎖（登入失敗、權杖呼叫超限）於鎖內再驗帳號仍屬該使用者、token 仍是其名下使用者 token，等鎖期間已被改名、升為應用系統金鑰或登出者不封鎖。
- **最後修改者**：tokens、ips 新增欄位 `userIdUpdate`（既有資料不回填，無須遷移）；後台存檔記操作管理員，app 權杖記其虛擬使用者 id，使用者自助流程（驗證信、改密碼）記該使用者，登入／續期記金鑰擁有者，系統計時器與自動封鎖記常數 `system`。tokens 新增列之擁有者 `userId` 保留送入值（擁有者為空者以操作者補），不被操作者覆寫。
- **`getUsersList` 不再回傳 `tokenVerify`（憑證類欄位收回）**：後台使用者清單原連同註冊驗證用 token 一併回傳並整列存回；契約生效後它屬伺服器專有欄位（存檔取庫內值），前端不再需要。對外 `getSsoUsersList` 原即不輸出。
- **log／錯誤文字**：基準不符等拒收於 srLog 記 warn（`fun-updateTabItems-reject`，帶語系鍵）；庫內列主鍵重複或缺漏（`rowsInvalid`，屬資料錯誤）回 `anUnexpectedErrorOccurred` 並記 error。帳號封鎖寫入失敗之 log 因改經 w-serv-orm 寫入，錯誤文字為其固定字串（如 `failed to save data`），原例外文字只進 console。
- 新增語系鍵：`saveStale`、`saveRowNotFound`、`saveBaselineFormat`、`tokenSessionAddNotAllowed`（eng／cht）。

### Upgrading from 1.1.11 and earlier

**來源 IP 須為合法 IP（行為變更）**：資料通道的來源 IP 仍取請求標頭 `X-Forwarded-For` 以逗號分隔之第一個非空段（最左），但取得之值現須通過 `net.isIP`（IPv4 或 IPv6；帶 zone 識別碼者總長度不得超過 64 字元）才採用，且**原樣使用、不改寫**（不剝除 `::ffff:` 前綴、不改大小寫），因此以原字串寫入 `ips` 表之既有封鎖列照常命中。唯一之正規化是去除 port：`IPv4:port`（如 `203.0.113.9:8080`）與括號形式 `[IPv6]:port`（如 `[2001:db8::1]:443`）取其 IP 本身（部分雲端閘道會在標頭附帶來源 port；同一 IP 不同 port 計為同一 IP，不會退回連線位址而使全部使用者呈現為閘道位址），port 須為 1～5 位數字且不超過 65535，去除後之 IP 同樣原樣使用。去除後仍非 IP（如 `256.1.1.1:80`、`1.2.3.4:abc`）或標頭值本身非 IP（如 `length`、`constructor`、含標記之字串、`unknown`、超長字串）時不採用，改取連線位址並記一筆 `warn`（`event` 為 `fun-getIpByHeaders`、`key` 為 `invalidForwardedFor`，至多每 10 秒一筆，`suppressed` 為期間被略過之次數，只記長度與前 64 字元）；標頭不存在或為空時仍靜默取連線位址。退回連線位址者，其 IP 封鎖與頻率限制一併改以連線位址計算：若該位址（例如反向代理 IP）已被封鎖，這些請求將被拒；`ips` 表中既有的非 IP 字串列（修改前由任意標頭值登錄而來，含其封鎖列；帶 port 者如 `203.0.113.9:8080` 亦同，新請求改以去 port 後之 `203.0.113.9` 判定並另登新列）不會再被命中，建議管理端檢視並清除。

**計數容器之鍵於窗口過後清除（修正）**：權杖與來源 IP 的調用次數紀錄原只在剪枝時移除窗外之紀錄，鍵本身永久殘留；未登入請求每換一個權杖參數或標頭值就多一個永久殘留之空鍵（長時間運行記憶體無上限成長，且每 2 秒的剪枝與偵測計時器都要走訪全部鍵）。本版起 `minForTokenCallApi`／`minForIpCallApi` 窗口內無新請求之鍵即刪除（登入失敗紀錄原即如此）。連帶行為：管理者自 IP 清單刪除某 IP 後，窗口（預設 10 分鐘）過後不再被偵測計時器自動復活（修改前每 2 秒復活一次）；偵測新 IP 之計時器若連續失敗超過整個窗口，窗內只請求過一次之 IP 不會補登，該 IP 再次請求即重新登錄。

**來源 IP 之信任邊界（維持；不提供 `trustProxy`）**：本套件信任 `X-Forwarded-For` 最左段且不做防偽造——線上系統常有多層反向代理、使用者 IP 由反代提供，能經跳板偽造者，反代拿到的也是偽造值，此類防護屬防火牆／反向代理之責。部署於反向代理後時，請由最外層受信任之代理覆寫（而非附加）該標頭；直接對外提供服務（前方無反向代理）時，用戶端可填寫任意合法格式之 IP 以規避 IP 封鎖與頻率限制、冒用他人 IP（可使他人 IP 遭自動封鎖），大量互異之合法 IP 亦會使 `ips` 表列數成長。`/api/cleanKpIpCallApi`、`/api/cleanKpAccountLoginFailed` 不讀標頭，只取連線位址。

**查詢使用者之欄位名限 `id`／`account`／`email`／`name`（行為變更）**：`/api/getSsoUserInfor`（`key` 參數）與後台 `getUserInfor`（第 3 個參數）原由呼叫端任意指定欄位名並直接作為資料庫查詢欄位，誤用 `key=userId`（建立者欄）不報錯而查到建立者，亦可對憑證欄（如 `tokenVerify`）探測值是否存在。本版起欄位名須為 `id`、`account`、`email`、`name` 其一，其餘（含大小寫不同者）回 `invalidUserQueryKey`（不回顯欄位名與查詢值，權限檢查仍在先：無權限者先得 `tokenExpired`）；欄位名或查詢值為空字串、重複參數（陣列）等格式不符者，仍由既有的入口檢查先回 `tokenExpired`。HTTP `key=token`（以權杖查使用者）不受影響；後台 `getUserInfor` 傳 `key='token'` 亦屬白名單外而被拒（原即無此用法，以權杖查請走 HTTP `key=token` 或 `getUserByToken`）。被拒之查詢仍寫一筆稽核紀錄（`api/getSsoUserInfor`／`kpfun-getUserInfor`，查詢值已遮罩；使用端可自填之欄位名與識別欄查詢值寫入 log 前置換控制字元，超過 256 字元者截斷並附 `...(len=原長)`）。對外查詢 helper（`getUserByToken`、`getUserByUserId`、`getUsersByToken`）之網址範本檢查改為完整參數比對：`key=tokenVerify`、`xkey=token`、`token={sysToken}x` 等僅子字串相符者不再通過（回 `noTokenKeyValueInUrl`／`noTokenKeyUserIdInUrl`／`noTokenInUrl`）；`token={sysToken}`、`key=token`（或 `key=id`）、`value={token}`（或 `value={userId}`）須各為網址查詢字串中恰出現一次的完整參數（以 `?`、`&` 定界；出現在路徑、片段、參數值內或重複者不算，如 `key=token&key=id`、`#key=token`、`key=token+`），順序與其他參數不限。

### Upgrading from 1.1.10 and earlier

**未登入請求可使後端結束（修正）**：來源 IP（`X-Forwarded-For` 標頭第一段）、權杖參數與登入帳號原以一般物件為鍵記錄調用／失敗次數；值為 `constructor`、`__proto__`、`toString` 等原型鍵名時，記錄函數拋出 `TypeError`（`verifyConn` 與 HTTP 路由內未被接住之 async 呼叫），在 Node 預設設定下使後端行程結束（`X-Forwarded-For: constructor` 或 `/api/checkToken?token=constructor` 單一請求即可）；帳號為該類名稱之既存使用者，登入失敗亦不計次、不會被封鎖。本版起以無原型容器記錄，這些字串與其他字串同為一般鍵。

**統計頁之 IP／使用者鍵為 `length` 時失真（修正）**：統計 log 以 IP（標頭可植入）或 userId 為鍵累計，鍵為 `length` 時，後台統計（`getStaIp`、`getStaToken`）與統計頁原以陣列樣方式走訪，真實鍵被略過（該小時桶之全部 IP／使用者計數與總數消失），且每個時間桶多出數字假鍵；原型鍵名之計數另累加成字串，鍵為 `count` 者蓋掉該桶總數。本版起一律依自有鍵處理：`count` 為該桶總筆數（保留字，IP／userId 恰為 `count` 者、以及權杖統計中使用者名稱恰為 `count` 者，其筆數已含於總數、不另列），其餘字串（含 `length`）皆為一般鍵。

**統計頁逐 IP 圖表與時間分組恆為 0（修正）**：前端以 `data.<IP>` 字串取值，含 `.` 之 IPv4 被當作路徑，選擇「逐一顯示」IP 或 4／8 小時、1 日分組時數值恆為 0（使用者／IP 用量表不經路徑取值，遇 `length` 鍵之缺陷同上一點）。本版起不再把名稱或 IP 當路徑。

**後台清單儲存之主鍵／帳號為原型鍵名（修正）**：主鍵或帳號為 `constructor`、`__proto__`、`toString` 等時，原誤判為重複（`invalidRows`／`accountDuplicate`）；新增之使用者其明文密碼被清為空。本版起照常驗證與儲存；後台使用者清單頁之前端預檢（帳號／email 重複、空值）原亦以一般物件判重，帳號為 `constructor` 等時誤判重複而擋下整份清單儲存，一併修正。`checkTokenAndUpdateUsersList`、`checkTokenAndUpdateTokensList` 之 `rows` 非陣列時回 `invalidRows`（資料通道入口原已以陣列檢查拒絕；原權杖清單遇非陣列於內部拋 `TypeError`）。

**來源 IP 之信任邊界（2026-10-20 更正）**：本條原載「後續版本擬提供 `trustProxy` 設定與 IP 格式驗證」。IP 格式驗證已於上一節（Upgrading from 1.1.11 and earlier）實作；`trustProxy` 經使用者裁示不提供——偽造防護屬防火牆／反向代理之責，本套件維持信任 `X-Forwarded-For` 最左段。

### Upgrading from 1.1.8 and earlier

**寫入前驗證（行為變更）**：後台清單儲存（`updateUsersList` / `updateTokensList` / `updateIpsList`，含以具寫入權限之 app token 呼叫者）與自助註冊（`createUser`）改於任何寫入之前驗證下列輸入；拒絕時資料庫無任何變更（同批之刪除不會先落地、不撤銷令牌、不清快取）：

| 輸入 | 新回應 key | 原本行為 |
|---|---|---|
| 欄位值（含主鍵；明文密碼除外）含會被 XSS 清除改寫之 HTML 標記（如 `<` 後接英文字母、白名單外之屬性；白名單標籤與不構成標記之 `<` 如 `a < b` 照常） | `htmlMarkupNotAllowed` | 一般欄位存成 `&lt;` 之形式（帳號因此無法以所輸入之值登入、唯一性可被繞過）；主鍵則於寫入中段被拒，回 `saveWriteFail` 而同批刪除已落地 |
| rows 非陣列；主鍵非字串、本批重複，或 UTF-8 超過 1978 位元組（LMDB 鍵長上限） | `invalidRows` | 重複主鍵後列覆蓋前列；超長主鍵於寫入中段失敗（同上部分寫入） |
| 使用者清單之 email 為空 / 本批重複 | `userEmailEmpty` / `userEmailDuplicate` | 含 email 值之英文字串 |

- 既有資料不回溯：已存成 `&lt;` 形式之值維持原樣。
- 依賴：`w-serv-orm ^1.1.11`、`w-serv-hapi ^1.1.6`、`w-data-collector ^1.0.46`、`w-syslog ^1.0.33`、`w-orm-lmdb ^1.0.39`、`wsemi ^1.9.16`；w-serv-orm 自身之錯誤訊息改為英文（只寫入 srLog，不回前端）。

**停用 `useCheckUser` / `getUserById` / `useExcludeWhenNotAdmin`（行為變更）**：此三鍵原透傳給 w-serv-orm 之使用者檢查；w-serv-orm 1.1.9 起已移除此三鍵（1.1.10 起給予 `undefined`、`null`、`false` 以外之值即於建構時拋錯）。本套件不再轉交，寫入皆於各功能內以權杖授權（使用者須為管理者、app token 須具對應寫入權限），自助註冊為公開流程。舊設定若仍給予（如 `useCheckUser: true`），後端照常啟動並於啟動時記警告（console 與 srLog 之 `boot` 事件，只列出給予之鍵）；`null`、`false` 視同未給、不警告；請自 settings / optExt 移除。停用前之行為：開啟 `useCheckUser` 時自助註冊必回 `userRegistrationFailed`、金鑰與 IP 清單之儲存必回 `saveWriteFail`（未給 `getUserById` 時使用者清單亦然；有給時以 app token 儲存使用者清單仍然失敗），`useExcludeWhenNotAdmin` 則從未作用。

**`serverPort` 未給或無效時監聽 11007（修正）**：原後端把未正規化之 `serverPort` 交給 w-serv-hapi，settings 未給或給非正整數時實際監聽 8080，與文件所載之預設 11007、註冊驗證信連結之回退網址 `http://localhost:11007` 不一致；本版起一律監聽正規化後之值。

**背景計時器之錯誤不再中斷後端（修正）**：w-serv-hapi 1.1.6 起不再於行程層攔截未處理之錯誤（本套件亦不註冊，全域錯誤政策由部署方決定）。本版起帳號登入失敗紀錄剪枝、權杖與 IP 之調用次數封鎖、新 IP 偵測等計時器之內部錯誤一律記入 srLog（`event: 'timer-error'`）並於下一輪照常執行，不會使後端行程結束；原新 IP 偵測於讀取 IP 清單失敗後即永久停止偵測。

**統計之 log 掃描 worker 改於首次統計時定位（修正）**：原於模組載入時以模組所在位置組出 worker 檔之路徑，經打包（本套件之 `dist`，即 `main` 所指之 `dist/w-web-sso.umd.js`，或被下游專案再打包）後載入即拋 `ReferenceError: Cannot access '…' before initialization`，且打包後之位置下沒有 worker 檔。本版起於第一次統計時依序由本套件根目錄、bundle 所在位置之 `node_modules`、工作目錄之 `node_modules` 定位 `server/staLogs/staLogsCore.shellWorker.mjs` 並快取；找不到時該次統計回 `getStaDataFailed`（srLog 記錄已試之位置），不影響其他功能。安裝時須保留套件之 `server/` 資料夾（預設即保留）。bundle 內之 w-syslog 原亦有同型問題，已隨其 1.0.33 修正，本版之 `dist` 可正常載入。

**log（依賴 w-syslog 1.0.33，行為變更）**：`logFd` 之資料夾不可建立（例如上層為檔案）時啟動即拋錯（早於建立資料庫）；寫檔失敗與 log 背景執行緒之錯誤不再使後端行程結束（改輸出至 stderr）；`logFd` 為連結（junction／symlink）時亦依 `logNumKeep`（未給採 w-syslog 預設）刪除最舊之 log 檔，原本不刪；log 資料夾於執行中被刪除時，切檔時自動重建。

**回傳物件**：`WWebSso(...)` 回傳 w-serv-hapi 之伺服器事件物件（可監聽 `error`）；w-serv-hapi 1.1.6 起另有 `ready()`、`stop()`，其中 `stop()` 只停止 HTTP 與通訊層，不停止本套件之背景計時器與資料庫連線，呼叫後行程仍持續（完整停止尚未提供）。

**金鑰清單經 API 新增之列保留擁有者（修正）**：直打 `updateTokensList` 新增列（鑄造金鑰；後台介面無新增列）時，擁有者（`userId`）原被改寫為空字串而使該金鑰不可用；本版起依送入值寫入。

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

**log**：權杖遮罩對 16 字元以下之權杖露出更少字元（36 字元 session token 格式不變），陣列與非字串一律遮罩；資料通道之 `referer` 只記 origin + pathname；`getSsoUserInfor` 以非識別欄（id / account / email / name 以外）查詢時之查詢值遮罩（欄位名限白名單後，此類查詢被拒，稽核紀錄之查詢值仍遮罩）。

### Upgrading from 1.0.3x / 1.0.5x

**Settings (啟動契約)**: 舊版 settings 原封不動即可啟動——新增之設定鍵皆有內建預設：

- `allowUserRegistration` 預設 `false`（自助註冊為 opt-in 新功能，明確設 `true` 才啟用；正式機須給 `verifyBaseUrl` 使驗證信連結可自外部連通）。`siteUrl` 為選填（目前保留供未來使用，尚無功能讀取，不強制提供）。
- `passwordPolicy` 未給採程式內建預設密碼政策（同套件自帶 settings.json 之預設組）；有給則以內建預設為底淺層 merge——可只給欲調整之欄位（如 `{ minLength: 10 }`），未給欄位沿用內建（黑名單等隨套件更新），merge 後逐欄驗證（給了就必須給對）。
- 信件文字鍵**全數繼續生效**（各欄位逐語系物件，語意同舊版）：`chpwEmTitle` / `chpwEmContent`（變更密碼通知信，`{sender}`/`{name}` 置換符）、`regVerifyEmTitle` / `regVerifyEmContent`（註冊驗證信，`{sender}`/`{name}`/`{verifyUrl}` 置換符）；另新增 `resetPwEmTitle` / `resetPwEmContent`（重設密碼通知信，`{sender}`/`{name}`/`{account}`/`{newPassword}` 置換符）與 `verifyEmailResultContent`（驗證結果頁，`{title}`/`{message}` 置換符）；2026-09-15 起結果頁之三則訊息 `userRegistrationVerifySuccess` / `verifyEmailAlreadyVerified` / `verifyEmailInvalidToken` 亦可以同名 settings 鍵逐語系覆寫（代入 `{message}`；部署方須點名自家系統時於此覆寫，不改套件內建）；2026-10-11 起另含驗證時寫入資料庫失敗之 `verifyEmailFailed`（連結仍有效，可再點一次）。各值可直接給文字，**亦可給檔案路徑**（絕對或基於啟動路徑之相對，檔案存在即讀檔作為內容，不存在則原樣視為文字）。既有客製不需任何搬移；未給時採內建語系文字（結果頁採內建模板，另可用 `pathTemplate` 指定自訂結果頁模板資料夾）。套件自帶 `settings.json` 已含全部鍵與預設文字可直接參考。
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
