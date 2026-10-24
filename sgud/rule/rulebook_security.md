# 規則帳本(分冊: 憑證 / 權限 / 來源 IP / 查詢欄位規則)

本檔為規則帳本之分冊(2026-10-22 自 `sgud/rule/rulebook.md` 依類型拆出, 節號與標題不變、內容只搬不刪); 總索引見 `rulebook.md`.

### R-SEC-01: 權杖(憑證)不得進入任何輸出——回應、reject 值、srLog、console(2026-09-24, ADR-068)

- **規則**:
  1. 對外 helper(`src/getUserByToken|getUserByUserId|getUsersByToken.mjs`, 核心 `src/fetchSsoMsg.mjs`):
     - reject 只能是固定 key;
     - console 只能經 `fetchSsoMsg` 之 `logFail` 印一行(範本之 origin + pathname、錯誤 name / code / status、key 形狀之 SSO msg);
     - 代入一律 split / join + `encodeURIComponent`.
  2. 後端寫 srLog / console 時:
     - 權杖類值一律經 `maskToken`;
     - 網址(含 referer)一律經 `maskUrl`;
     - 以任意欄位查詢之值一律經 `maskKv`;
     - 不得印整包 headers / query / request / 錯誤物件.
  3. 對外介接輸出之使用者列一律經 `omitUserCredential`; 新增憑證欄時登錄於 procCore 之 `keysUserCredential`.
  4. 新增或更名 helper key 時, 同步以下三處(同步點):
     - `server/procLang.mjs`;
     - README 對照表;
     - 消費端 `server/wrapInjected.mjs` 之白名單(w-web-perm / w-web-api / w-web-task).
- **理由**: 見 ADR-068(helper 之 reject 原含已代入權杖之網址; referer / 陣列 / 憑證欄查詢值三通道把權杖寫入 srLog).
- **盤點指令**(以規則為軸, 不以單一站點為軸; 2026-09-24 kpfun `getUserInfor` 之 valueLog 即因只看 HTTP 路由而一度漏改):
  - Grep `Promise\.reject\(` 於上列 helper 與核心 → 每筆參數為字面 key 或 `keyRequest` / `keyData` / `keyNoData` / `'noUserDataAfterConvert'`.
  - Grep `console\.log` 於同上 → 只有 `src/fetchSsoMsg.mjs` 之 `logFail`.
  - Grep `replaceAll\('\{` 於 `src/` → 0.
  - Grep `srLog\.(info|warn|error)\(\{[^}]*\b(token|value|referer|url|href|query|headers|authorization)\b` 於 `server/` → 每筆該欄之值皆經遮罩函數.
  - Grep `console\.log\([^)]*\b(req|headers|query|url|href|authorization|referer|token|value|valueUser)\b` 於 `server/` → 未註解者不得輸出上述原值.
- **站點全集(2026-09-24)**:
  - helper:
    - `Promise.reject` 16 處, 皆為 key;
    - console 1 處(`logFail`).
  - server:
    - `maskToken` 33 處(`WWebSso.mjs` 27、`procCore.mjs` 5、`procProtect.mjs` 1);
    - `maskUrl` 1 處(verifyConn referer);
    - `maskKv` 3 處(`getSsoUserInfor` HTTP 與 kpfun 之 valueLog、`_getGenUserByKV` DB 錯誤 console);
    - `procProtect` 取不到 IP 時只印標頭名稱;
    - `omitUserCredential` 1 處(`/api/getSsoUsersList`; 後台 kpfun `getUsersList` 刻意不套用, 見 ADR-068).

### R-PERM-01: 需管理者之權限閘須同時宣告 app token 所需權限 `perm`(2026-09-25, ADR-069)

- **規則**:
  1. 凡以 `{ fun: funCheckAdmin }` 守門之呼叫點, 同一 opt 須帶 `perm: '<權限字串>'`; 只給 `fun` 者 app token 一律不通過(fail closed), 屬漏宣告.
  2. 授權寫在 procCore 內之功能(如 `adminResetUserPassword` 以操作者 `isAdmin` 判斷), app 權限閘亦寫在 procCore(`checkToken(token, { perm })`), 因 app 之虛擬使用者恆為 `isAdmin='y'`.
  3. `perm` 之值須為 `src/appPerms.mjs` 之 `keysAppPerm` 成員; 新增權限時同步: `keysAppPerm`(及是否列入 `keysAppPermHigh`)、`server/procLang.mjs` 之 `appPerm_<權限>`(eng + cht)、README 權限表、`api-apptoken-perms` 之 ops 與 `unit-appPerms` 之 PERM-U-001.
  4. 自身權杖操作(`checkToken` / `refreshToken` / `logoutByToken` / kpfun `getUserByToken` / `checkTokenAndChangePassword`)不帶 `fun` 亦不帶 `perm`.
- **理由**: ADR-005 之 bypass 使 app token 通過全部需管理者之閘(ADR-069 Context); 改為逐閘宣告後, 漏宣告者以 fail closed 收斂.
- **盤點指令**:
  - Grep `fun: funCheckAdmin` 於 `server/` → 每筆同行含 `perm: '`(兩者計數相等).
  - Grep `perm: '` 於 `server/` → 值皆在 `keysAppPerm`.
  - Grep `checkToken\(` 於 `server/` → 未帶 opt 者只能是上列自身權杖操作與 `adminResetUserPassword`(帶 `{ perm: 'writeUsers' }`).
- **站點全集(2026-09-25)**: 17 閘 —— `WWebSso.mjs` 16(HTTP `getSsoUsersList`、`getSsoUserInfor` 兩分支; kpfun `getUserInfor`、`getUsersList`、`updateUsersList`、`getTokensList`、`updateTokensList`、`getIpsList`、`updateIpsList`、`getSta*` 6 支)+ `procCore.mjs` 1(`adminResetUserPassword`); 皆已套.

### R-SESS-01: 改密碼後須撤銷 session 權杖——管理員重設撤銷對方全部; 自行改密碼保留目前 session、撤銷其他; app 權杖不撤銷(2026-10-23, sso-run04 第 117 項; ADR-093; 使用者裁示, OWASP ASVS)

- **規則**:
  1. **改密碼入口全集**(以 Grep 取得, 2026-10-23): `adminResetUserPassword`(管理員 session 或具 `writeUsers` 之 app 權杖; 對象為他人)、`checkTokenAndChangePassword`(session 權杖; app 權杖亦通過 `checkToken`, 作用於其擁有者並須舊密碼)——這兩個是**既有使用者密碼之唯一寫入點**; 其餘「寫 password」者為新帳號(`createUser` 自助註冊、`updateTabItems` users 新增列、離線 `g_initialData.mjs`), 無 session 可撤; 「忘記密碼 / email 重設」入口不存在(日後若新增, 須撤銷全部 session); HTTP 路由無改密碼端點. 新增任何改既有使用者密碼之站點, 須同時加撤銷並補本規則測試.
  2. **撤銷範圍**: 只撤銷 `tokens.userId = 目標` 且 `isApp !== 'y'` 之列(session 權杖); app 權杖(`isApp === 'y'`, 含擁有者為該使用者者)不是 session, 不撤銷. 管理員重設撤銷全部; 自行改密碼以呼叫所用之權杖字串(`token`)為 `exceptToken` 保留其餘撤銷(app 權杖呼叫者無目前 session, 全撤); 實作為 `revokeSessionTokensLocked(userId, exceptToken)`, 與刪除 / 停用 / 封鎖用之 `revokeTokensByUserIdLocked`(名下一切權杖皆撤, ADR-037)分開, 不共用、不加旗標.
  3. **鎖與次序**: 驗證、撤銷、密碼寫入全在 `withTabLocks(['tokens', 'users'])` 內(`kmx` 在外層); 驗證全通過後**先撤銷、後寫密碼**——撤銷失敗整體拒絕且密碼不變(`adminResetPasswordFailed` / `userChangePasswordFail`, 不寄信、不記節流); 撤銷成功而密碼寫入失敗則拒絕、密碼不變、session 已撤銷(fail closed); 不變式: 絕不出現「密碼已變更但舊 session 仍有效」. 驗證未過(舊密碼錯、新密碼不合策略、非管理員、對自己重設、目標不存在)不撤銷任何權杖.
  4. 被撤銷之權杖立即無效(`checkToken` 查庫無快取, 回 `tokenExpired`); 不新增語系鍵; `isForceChangePw` 行為不變(重設 `'y'`、自行改密碼 `'n'`).
  5. **自行改密碼於鎖內再驗呼叫權杖**(外審 sol#1): 鎖外 `checkToken` 通過後、等鎖期間該 session 可能已被撤銷, 被撤銷之權杖不得再改密碼(`tokenExpired`, 密碼不變、不撤銷他人); `checkToken` 只讀不取鎖可於鎖內呼叫. 管理員重設不加此再驗(操作者等鎖期間被撤銷屬 HEAD 既有之檢查後行為, 未改).
  6. **撤銷失敗以布林旗標判定**(外審 sol#2), 不以「錯誤值是否為 null」: reject 值可能為 `null` / `undefined`.
- **理由**: 改密碼的目的之一是讓外洩憑證換來之登入態失效(ASVS); 舊決定 ADR-009「不清除既有 token」被使用者 2026-10-23 裁示取代. 先撤銷後寫密碼是因無交易(ADR-044): 反過來撤銷失敗會留下「新密碼生效、舊 session 仍有效」之最壞狀態且補償回滾本身可失敗; 先撤銷之最壞狀態只是「多登出一次」.
- **盤點指令**:
  - Grep `revokeSessionTokensLocked` 於 `server/procCore.mjs` → 定義 1(外加其說明註解 1 行)、`checkTokenAndChangePassword` 呼叫 1(帶 `token`)、`adminResetUserPassword` 呼叫 1(不帶 exceptToken); 共 4 行命中.
  - Grep `withTabLocks\(\['tokens', 'users'\]` 於 `server/procCore.mjs` → 恰 2 行, 即此二站點(procProtect 之封鎖站點另在 `procProtect.mjs`).
  - Grep `password: |row\.password` 於 `server/procCore.mjs` → 恰 5 行: `createUser`(新帳號)、`checkTokenAndChangePassword`、`adminResetUserPassword`、`updateTabItems` 新增列之 `row.password` 兩行(新帳號); 寫入既有使用者 `password` 者只有 `checkTokenAndChangePassword` 與 `adminResetUserPassword`.
- **站點全集(2026-10-23)**: 2 站點(`checkTokenAndChangePassword`、`adminResetUserPassword`), 皆已套; 新帳號寫 password 之 4 處不適用.
- **測試**: `unit-passwordSession`(PS-U-001～021: 兩入口 × 呼叫者種類(管理員 session / writeUsers app 權杖 / 使用者 session / app 權杖呼叫改密碼)× app 權杖不撤銷 × 失敗點(驗證未過 / 撤銷失敗含 reject(null) / 密碼寫入失敗)× 鎖與競態(登入交錯、撤銷進行中插入登入、重設與自行改密碼並行、兩 session 並行改密碼、等鎖期間權杖被撤銷))、`api-passwordsession`(PSA-001～006, 真後端 / 真登入 / 真 `checkToken`)、`api-resetpassword` API-008(改斷言新規則)、`unit-tablock` SITE-LOCK-S07 / S08(兩把鎖任一被占用皆等待).
- **修前紅**: 換入 HEAD 版 `server/procCore.mjs`(sha256 回驗還原): `api-passwordsession` 6 案 5 紅(PSA-001、002、003、005、006; PSA-004 為驗證未過不撤銷之對照組, 修前後皆綠); `unit-passwordSession` 17 案 11 紅(修前版 server).
- **變異驗證(2026-10-23, 外審修補後最終版)**: unit 層 15 項全數被抓到(對照組 45 案全綠; 在 `tmp` 內之 repo 子集副本施作, 逐項還原並驗 sha256): S1 拿掉管理員重設之撤銷、S2 拿掉自行改密碼之撤銷、S3 撤銷到目前 session、S4 撤銷到 app 權杖、S5 / S6 撤銷失敗被吞(仍寫密碼)、S7 驗證未過即撤銷、S8～S11 表鎖只取單表(各站點 × users / tokens)、S12 保留者比對欄位錯、S13 / S14 失敗判定回退為 `errRevoke !== null`(reject(null) 被當成功)、S15 拿掉鎖內再驗呼叫權杖. S1～S4 另於真後端(`api-passwordsession` + `api-resetpassword`)重驗, 結果見報告(sso-run04-修正報告.md).

### R-APPTOK-01: 應用系統金鑰之兩種用途——「權杖代表誰」只經 `loadActor` / `getActorByToken` 解析、即時判準與登入同謂詞、金鑰只經 `createAppToken` 鑄造、不給期限不續期(2026-10-24, sso-run01; ADR-095; 使用者裁示, 存取管控表 S-1~S-6)

- **規則**:
  1. **身分單一咽喉**: 凡需要「這個權杖代表誰」(本人入口、管理入口之操作者、稽核欄、改密碼對象、反查身分)一律經 `getActorByToken(token)`(= `loadActor` + `isActorLive`); **不得直接讀 `tokens.userId` 當身分**——系統服務用途金鑰之 `userId` 只記建立者(稽核), 建立者被停用 / 刪除 / 為空皆不影響; 使用者用途之 `userId` 才是所綁使用者. 允許直接讀 `tk.userId` 之處僅: `loadActor`(解析用)、log 欄位、`refreshToken` 之稽核操作者(只對登入 token, 應用系統金鑰已先拒)、`tokenAppLocked` 之比對、`createAppToken` 之輸入驗證.
  2. **即時判準(S-4)**: 登入 token = 未逾期且 `isUserUsable(使用者)`; 使用者用途 = 不看 `timeEnd` 且所綁使用者 `isUserUsable`; 系統服務用途 = 恆可用. `isUserUsable` 與登入(`loginByAccountAndPassword` / `createToken` 鎖內重讀)同謂詞——`timeVerified` 為非空字串(**不要求 timemsTZ 格式**)、`tn > timeExpired` 才算到期、`tn <= timeBlocked` 為封鎖中、`isActive === 'n'` 為停用——**不得改回 `mShare.checkUserBasic`**(其 `getIsVerified` 要求 timemsTZ、`isActive` 須為 `'y'`, 舊格式驗證時間者可登入卻立即被判失效, 外審 sol#4). 管理入口之管理員判準 `funCheckAdmin`(= `checkUserAdmin`)維持原樣.
  3. **授權**: 使用者 token 與使用者用途以 `fun(tk, 使用者)` 判斷、perms 不適用; 系統服務用途以 `perm` 判斷(只給 `fun` 未宣告 `perm` 者 fail closed, 沿 R-PERM-01); 用途值未登錄 fail closed.
  4. **鑄造唯一入口 `createAppToken`**: 權杖字串與主鍵伺服端產生; 於 `[tokens, users]` 表鎖內驗證(綁定者存在且啟用、綁定值不含會被 XSS 清除改寫之標記)並**再驗操作者仍有權**(`recheck`)再寫入; `lockSave('createAppToken', 操作者)` 雙擊防護; 失敗以旗標判定. 清單存檔(`updateTabItems` tokens 路徑)只改不增: 新增應用系統金鑰列 → `tokenAppAddNotAllowed`、升級登入 token → `tokenSessionUpgradeNotAllowed`、改字串 / 綁定者 / 啟用旗標 / 期限 → `tokenAppLocked`、使用者用途設 perms → `tokenAppPermsNotForUser`; 皆整批零寫入.
  5. **撤銷範圍**: 刪除 / 停用使用者(清單存檔)撤銷其登入 token 與綁其之使用者用途金鑰(`revokeTokensByUserIdLocked(userId, { includeAppUser: true })`); 自動封鎖只撤登入 token(預設); 系統服務用途金鑰(含 `userId` 欄為該使用者之既有列)一律不撤銷. 測試以直寫庫改狀態(不經清單存檔、故不撤銷)驗「即時失效 / 恢復」, 經清單存檔驗「撤銷範圍」, 兩者分開.
  6. **不給期限**: 應用系統金鑰不看 `timeEnd`; `refreshToken` 一律 `tokenAppNoRefresh`; 統計之「已到期」「24 小時內到期」不計應用系統金鑰(升級前即不可用之 `retired` 舊列例外: 計入「已到期」、不計入「有效」, 見第 11 點).
  7. **本人入口僅限代表使用者本人者**: `changeUserPassword` 對系統服務用途回 `tokenUserOnly`; 鎖內重新解析身分須與鎖外相同.
  8. **S-2 / S-5 / S-6**: `adminResetUserPassword` 以 `funCheckAdmin` 授權、對外同為 `tokenExpired`(`adminResetPasswordForbidden` 已移除); `key=token` 查他人之目標權杖須此刻可用(逾期 / 查無 / 其使用者不可用 → 固定鍵 `tokenNoPermission`); `allowUserRegistration` 非 true 時 `verifyEmail`(HTTP、函數)與 `resendVerifyEmail` 固定拒絕 `userRegistrationNotAllowed`.
  9. **保留前綴 `app:`**: 後台清單新增使用者之主鍵不得以 `app:` 開頭(`invalidRows`); 呼叫統計以 `app:<金鑰主鍵>` 記系統服務用途之呼叫者.
  10. **登出入口刻意不判逾期與使用者狀態**(持有者清理自己之權杖: 只刪本權杖、不回資料、不行使能力); 以 `api-accessmatrix` MX-DEAD 鎖定此例外.
  11. **升級不得使已失效之應用系統金鑰復活(2026-10-24 sso-run02; 主控裁定, `dspec` 二.8; ADR-095 補記)**: 升級前之應用系統金鑰列(`isApp='y'` 且 `appUsage` 缺欄 / null / `''`)只由 `procCore.migrateLegacyAppTokens`(`WWebSso` 啟動時呼叫一次)於 `tokens` 表鎖內一次性定案, 判準單一擁有者 `src/appUsage.mjs:classifyLegacyAppToken`(= 升級前 `_checkTokenByObj` 之判定: `timeEnd` 須為合法時間且現在 < `timeEnd`):
      - 升級前可用 → `appUsage='system'`(不設期限); 升級前不可用(已逾期、恰等於現在、無 `timeEnd`、`timeEnd` 格式錯)→ `appUsage='retired'`(已失效, 永不可用, `loadActor` 回 `appRetired`、`isActorLive` 恆 false); **列保留不刪**, 只寫 `appUsage`(`serverOnly` 欄, 不入基準), 不動 `timeEnd` 與其他欄位.
      - **冪等**: 只處理仍缺 `appUsage` 者, 第二次起零寫入; 已定案者不因日後 `timeEnd` 成為過去值而改判(這是須持久標記而非讀取時推導之理由).
      - **判準 = 升級前判定 ∧ 時刻未逾期**(外審 sol F1 / F7): 升級前判定為字串逐字比較 `tn < timeEnd`(不是時刻比較; 舊碼對 `Z`、`+14:00` 等非本機偏移之字串序與時刻序不一致); 另加 `Date.parse` 時刻比較亦未逾期。伺服器產生之 `timeEnd` 與 `tn` 同偏移, 兩者一致、不改變任何伺服器資料之結果, 且**升級時更換伺服器時區不致改判**(UP-23: 舊 Taipei 判已逾期之 `11:00+08:00`, 新 UTC 行程字串序判可用而時刻已逾期 → 仍 `retired`); 兩者不一致者(手動寫入之非本機偏移字串, 或換時區)一律從嚴。**與舊碼唯一之差異**: 字串序判可用而時刻已逾期者(實跑例: `12:00:00.000+14:00`, 時刻上已逾期 6h)舊碼可用、本輪 `retired`。**殘餘風險**(不處理): 手動寫入之 `Z` 形式資料 ∧ 升級同時更換伺服器時區, 可能使舊碼判不可用者定案為 `system`(UP-23 之 c4 於 UTC 行程); 此組合不屬本套件任何寫入路徑。
      - **未定案之舊列(遷移進行中 / 失敗 / 啟動後才直寫庫)後端於 `loadActor` 依同一判準即時判定, 永不比升級前更寬; `getTokensList` 對此類列回傳即時判定之用途(`system` / `retired`)**, 後台顯示與統計(`getTokensListCache`)皆取回傳值, **前端不以瀏覽器時間重新推算**(瀏覽器時區 / 時鐘與伺服器不同、舊清單於存檔後被保留, 皆會使前端推算與授權判定不一致; 外審 sol F3 / F4)。不在鎖內等待遷移(遷移持 `tokens` 表鎖, 等待它會與已持鎖之站點互鎖); 遷移失敗不阻擋啟動、記 `tokenAppLegacyMigrateFailed`、重啟重試; 遷移寫入後不論成敗皆清權杖清單快取(部分落地時 reject 亦然, F5)、寫入帶 `mustExist` 且全表讀取在鎖內(UP-21 / UP-22)。**不得**把「缺欄」一律視同 `system`(sso-run01 之作法, 使已逾期者復活)、**不得**在遷移前後用不同判準。
      - `retired` 列: 呼叫者為已失效金鑰時各入口(含 `getUserByToken`、各管理入口、統計)回 `tokenExpired`; **作為被查詢之目標時**(`getSsoUserInfor` 之 `key=token`、`checkTokenAndGetUserByToken`)內層回 `null`、對外回固定鍵 `tokenNoPermission`(S-5 契約, 與逾期 / 查無同鍵, 不洩漏原因; 外審 sol F6); `refreshToken` 維持 `tokenAppNoRefresh`、登出類放行並刪本列; 清單存檔無法復活(用途伺服器專有、`tokenAppLocked`)但可刪除; 統計計入已到期不計入有效; 後台顯示「已失效(升級前)」(英文須短於約 19 字元, 用途欄寬 150px; E2E-011 以幾何斷言〔`scrollWidth ≤ clientWidth`〕攔截截斷, 不依賴標準圖).
- **理由**: 原實作以 `tokens.userId` 當身分, 且 `isAdmin='y'` 之虛擬使用者混用建立者 id, 使系統服務金鑰之反查與建立者無法區分、建立者被停用即波及、`isApp` 勾選可把登入 token 升級為永久金鑰; 即時判準只看權杖到期, 被封鎖 / 到期 / 未驗證者之既有 token 照常可用. 單一咽喉使「新增入口時忘記用途判斷」變成缺少一個函數呼叫而非一整套判斷.
- **盤點指令**:
  - Grep `get\(tk, 'userId'|get\(tks, '0\.userId'` 於 `server/` → 命中皆為上列允許之處(`loadActor` 2、log 欄位 2、`refreshToken` 稽核 1、`tokenAppLocked` 比對 1〔`get(row, 'userId'`〕、`createAppToken` 輸入 2、`procProtect` 封鎖站點 2〔限 `isApp !== 'y'` 之登入 token〕).
  - Grep `getActorByToken\(|loadActor\(|isActorLive\(` 於 `server/procCore.mjs` → 站點: `_checkToken` / `_checkTokenByObj`(2)、`_refreshToken`(1, 經 loadActor + isActorLive)、`checkTokenAndChangePassword`(外 1 + 鎖內 1)、`adminResetUserPassword`、`getUserByToken`、`checkTokenAndUpdateUsersList` / `TokensList` / `IpsList`、`checkTokenAndCreateAppToken`.
  - Grep `checkUserBasic` 於 `server/` → 0 命中(不得回用於即時判準).
  - Grep `classifyLegacyAppToken|isLegacyAppToken|migrateLegacyAppTokens` 於 `server/ src/` → 判準單一定義於 `src/appUsage.mjs`; 使用處僅 `procCore.loadActor`(授權即時判定)、`procCore.getTokensList`(清單回傳即時判定之用途)、`procCore.migrateLegacyAppTokens`(定案)、`WWebSso`(啟動呼叫一次); `src/components/` 與 `src/*.vue` 內 **0 命中**(前端不得自行推算, 見第 11 點); Grep `Date\.parse` 於 `src/appUsage.mjs` → 僅判準內之時刻比較一處.
  - Grep `getAppUsage\(` 於 `server/` → 授權判定(`loadActor`)先經 `isLegacyAppToken` 分流; 其餘(`_checkToken` log 身分、`procStaInfor` 命名 / 已到期)只用於顯示與統計.
  - Grep `kpfun`／`path: '/api/` 於 `server/WWebSso.mjs` → 受 token 入口全集 27 個(= `test/api-accessmatrix.test.mjs` 之 `entries`; 新增入口須同時補 entries).
- **站點全集(2026-10-24)**: token 入口 27 個 × 呼叫者 7 類 = 189 格, 另失效 token 子類(未知字串、已逾期登入 token; sso-run02 增已失效之舊應用系統金鑰〔retired, perms 全開〕)27 × 3 = 81 格(原 54); 公開入口(1.2 前段)與註冊開關格見 `api-accessmatrix` 尾端統計行. 刻意未測: `[sys:getTableTags]`、`[sys:polling]`(現全公開, 排程第 128 項 C4 另輪)、通訊路由 ulctr / slc / dwgfn / dwgf / dw(未註冊監聽)、`/api/cleanKp*`(固定權杖 + 本機白名單, 不屬 token 呼叫者)、UI 頁面格(由 e2e 覆蓋).
- **測試**: `api-accessmatrix`(入口 × 呼叫者全矩陣 + 失效 token 子類 + 公開入口 + 註冊關閉)、`api-apptoken-usage`(ST 狀態即時失效 / 恢復 × 4 種身分、舊格式驗證時間、不看 timeEnd; REV 撤銷範圍; S-2、S-5; SELF 自我保護與 `app:` 前綴; LIST 清單存檔規則; MINT 鑄造驗證、雙擊、同鎖; LEGACY 升級前可用之舊列相容; SESSION 不變)、`unit-appUsage`(AU-01~23)、**`unit-appUpgrade`(UP-01~19: 判準、定案與資料、升級前後可用性 = 升級前舊碼之判定、冪等、時間流逝、表鎖、失敗不放寬、未定案即時判定、已失效列各入口、後台處置、與鑄造共存、統計)、`api-apptoken-upgrade`(UPG-01~06: 真後端重啟之定案、可用性 HTTP + kpfun、後台清單、重啟冪等、清單處置)**、`unit-tablock`(S11 / S11b / S11c)、`unit-saveBaseline` / `unit-ormWriteFail` / `unit-writeContract` 之改寫、`e2e-tokens`(E2E-008~010 + 既有案例之改寫)、`e2e-register` E2E-017(S-6 前端).
- **驗證結果(2026-10-24 sso-run01; 全文見 `C:\opensrcOper\dnow\20261024130755\agent-out\sso-run01-修正報告.md`)**:
  - **修前紅**(以 `tmp/sso-run01/swap.mjs` 暫時換入 HEAD 版 `server/procCore.mjs`、`procLang.mjs`、`procStaInfor.mjs`、`WWebSso.mjs`, 跑完回驗 sha256 還原): `unit-appUsage` + `unit-tablock` 25 過 / **18 敗**; `api-accessmatrix` 33 過 / **28 敗**; `api-apptoken-usage` 3 過 / **36 敗**(失敗皆為斷言差異: 封鎖 / 到期 / 未驗證者之 token 全數仍可用、`fapi.createAppToken not found`、`isApp` 升級照常成功等, 非環境錯誤). 修後: unit 全 389 過、api 全 262 過、`e2e-tokens` 18 / 18.
  - **變異驗證**(單點變異, 還原後 sha256 相符): M1 使用者用途不判所綁使用者當前狀態(`isActorLive` 對 `appUser` 恆真)→ `unit-appUsage` AU-11 敗、`api-apptoken-usage` ST 6 格敗(封鎖 / 到期 / 未驗證 × AU-U / AU-A; 停用格因取使用者時即過濾 `isActive` 而另有一道防線, 未被單獨抓到屬預期); M2 撤銷範圍含系統服務用途(`return includeAppUser`)→ AU-16 敗、api REV 3 案敗; M3 `refreshToken` 不拒應用系統金鑰 → AU-14 敗、`api-accessmatrix` MX[HTTP / kpfun refreshToken] 敗(使用者用途得 `invalid timeEnd` 而非 `tokenAppNoRefresh`); M4 S-6 前端: **單拿掉一處不被抓到**(`showResendVerify = vo.allowUserRegistration` 與模板 `allowUserRegistration &&` 為互為備援之兩道, 單變異 E2E-017 仍綠, 屬刻意備援), 兩處同時還原為 HEAD 版 `PageLogin.vue` → `e2e-register` E2E-017 eng + cht 皆敗(語意斷言「註冊關閉時不應顯示重寄驗證信連結, 實際 1 個」).
  - **外審**: sol 15 條逐條核對(13 屬實 / 部分屬實並處置、1 誤報、1 既存缺口待裁示), 見報告〈五〉; nemotron、beam 額度用盡未審.
  - **sso-run02(第 11 點; 全文見 `C:\opensrcOper\dnow\20261024130755\agent-out\sso-run02-修正報告.md`)**:
    - **修前紅**(`tmp/sso-run02/mutate.mjs` 之 `head` 模式暫時換入 HEAD 版 `procCore` / `WWebSso` / `procStaInfor` / `procLang` / `appUsage` / `LayoutContentTokens.vue`, 跑完 sha256 回驗還原): `api-apptoken-upgrade` 0 過 / **6 敗**(UPG-02 `l-past(逾期) true !== false`、UPG-03 `l-past: 統計 true !== false` 為實質缺陷——升級前已逾期之金鑰升級後可用; 其餘因啟動時未定案而逾時); `unit-appUpgrade` 於 HEAD 載入即失敗(`classifyLegacyAppToken` 不存在).
    - **變異驗證**(單點變異, 還原後 sha256 相符): m1 判準不判退役(逾期者一律 `system`, 即「拿掉已逾期舊列維持失效」)→ `unit-appUpgrade` / `unit-appUsage` 13 敗(UP-01、UP-10~15…); m2 遷移不寫入 → 9 敗; m3 拿掉讀取時即時判定 → UP-14 / 15 / 15b / 15c 4 敗; m4 已失效列視為可用 → 10 敗; m5 只標已失效、不持久標記未逾期者 → 7 敗(UP-10、UP-12、UP-13…); m6 遷移不取 `tokens` 表鎖 → UP-14 敗; m7 統計不計已失效 → UP-19 敗; m8 `WWebSso` 不呼叫遷移(接線)→ `api-apptoken-upgrade` 6 / 6 敗; m9 後台到期欄對已失效列顯示「不設期限」→ `e2e-tokens` E2E-011 eng + cht 敗.

### R-IP-01: 來源 IP 之取值——`X-Forwarded-For` 最左段須為合法 IP 才採用, 否則退回連線位址並限流記 warn; 合法 IP 原樣不改寫(2026-10-20, 主控第 93 項; 使用者裁示: SSO 不做防偽造)

- **規則**:
  1. 單一擁有者 `server/procProtect.mjs` 之 `getIpByHeaders(req)`(全套件唯一取「來源 IP」之處; `WWebSso` 之 `verifyConn` 呼叫): 取 `x-forwarded-for` 之**第一個非空段**(以 `,` 分段、各段 `trim` 後略過空段〔沿用 wsemi `sep`, 修改前即如此〕, 即最左).
     - 無值(無標頭、空值、空白、僅逗號)→ 靜默退回連線位址, 不記 warn.
     - 該段非空 → 以 `net.isIP`(回 4 或 6)驗證, 且長度不得超過 `FORWARDED_IP_MAX_LEN`(64; IPv6 文字最長 45 字元, 外加 zone 識別碼——`net.isIP` 對 zone 識別碼長度無上限, 2026-10-20 實測 `::1%` 加 15000 字元仍回 6, 單獨依 isIP 會放行萬字元「IP」). 通過 → **原字串採用、不改寫**(不剝 `::ffff:`、不改大小寫 / 壓縮、不去 zone; 否則 `ips` 表既有列——封鎖查詢 `getIpByKV('ip', ip)` 為精確字串比對——不再命中而回未封鎖). 不通過(`length`、`constructor`、`<img src=x>`、`unknown`、超長字串等)→ 不採用, 退回連線位址並記 warn. 只驗被選中的那一段, 後段不影響(首段合法則後段為任何內容皆採首段、不記 warn; 首段非 IP 不改取後段).
     - **去 port(唯一之正規化; run02 裁示 1, 2026-10-20)**: 首段本身不是合法 IP 時, 若為 `IPv4:port`(`d.d.d.d:port`)或括號形式 `[IPv6]:port`, 取其 IP 部分(部分雲端閘道 / 反代於標頭帶來源 port; 不去 port 而退回連線位址, 多層反代下全部使用者會被視為同一閘道位址, 頻率限制與自動封鎖將誤封所有人). 判準: port 為 1~5 位十進位數字且 ≤ 65535; 去後之 IP 須 `isIP` 為 4(IPv4 形式)/ 6(括號形式)且長度 ≤ 64; 去後之 IP 仍**原樣**(不改大小寫、不剝 `::ffff:`、不去 zone). 去後仍非 IP(`256.1.1.1:80`、`[::g]:80`、`1.2.3.4:abc`、`1.2.3.4:65536`、`1.2.3.4:`、`1.2.3.4:80:90`)或非此兩種形式(`[::1]` 無 port、`[1.2.3.4]:80` 括號 IPv4)→ 才退回連線位址並記 warn(`len` / `preview` 為整段原值). 裸 IPv6 本身即合法(`2001:db8::1:80` 為合法 IPv6, 不視為帶 port, 原樣採用). port `0` 與前導零(`:0`、`:00080`)採納(輸出只取 IP, port 值不影響結果); 括號 IPv4(`[1.2.3.4]:80`)與 IPv4-mapped 帶 port 之裸形式(`::ffff:203.0.113.9:5678`)不屬兩種形式而退回連線位址(外審 agy-opus F-A1 提出、依裁示僅此兩種形式去 port, 不採); 裸 IPv6 帶 zone 者(`fe80::1%eth0:80`)`isIP` 為 6, 依「合法 IP 原樣」採用(不與括號形式對稱, 外審 agy-opus F-A2; zone 識別碼僅見於連結本地位址, 不採). **升級影響(外審 minimax MM-A-01)**: `ips` 表中修前版本以帶 port 之原字串登錄之列(如 `203.0.113.9:8080`, 含其封鎖列)不再被命中——新請求以去 port 後之 `203.0.113.9` 判定並由偵測計時器另登新列; 不遷移(各 port 為短暫連接埠, 列本身即屬登錄雜訊), README Upgrade Notes 載明, 建議管理端檢視並清除. 實作單一擁有者 `procProtect.mjs` 之 `pickForwardedIp(raw)`(回合法 IP 或空字串), `getIpByHeaders` 只呼叫它.
  2. 退回順序: `req.info.remoteAddress` → `req.socket.remoteAddress` → `req.connection.remoteAddress`(空白 / 缺席者續往下; 連線位址由 Node 提供, 不再驗證); 皆無 → 空字串並維持原有 `can not get ip of user` 診斷. 因此非 IP 標頭之請求其封鎖與頻率限制一併改以連線位址計算(連線位址已被封鎖則這些請求被拒; 多個不同非 IP 標頭值共用連線位址之計數).
  3. warn: `srLog.warn({ event: 'fun-getIpByHeaders', key: 'invalidForwardedFor', len, preview, ip, suppressed })`.
     - 限流: 至多每 `FORWARDED_WARN_INTERVAL_MS`(10 秒)一筆, 期間被略過之次數於下一筆以 `suppressed` 帶出; 時鐘回撥(`Date.now()` 小於前次)時以現時重設窗口起點並略過本筆, 連續回撥亦不致每筆皆記.
     - `len` 為被選中那一段之長度, `preview` 為其前 64 字元且控制字元(< 32、127)置換為 `?`(`srLog.safeText`, 與 `maskToken` 同一擁有者), `ip` 為實際採用之連線位址.
     - 記錄失敗不得使取 IP 失敗: `srLog.warn` 同步拋錯或回傳被 reject 之 Promise 一律吞下(使用端以非 IP 標頭即可觸發此路徑, 記錄器故障不應放大為請求失敗). `srLog` 未給或無 `warn` 函式時略過(同 `logError` 之守衛).
  4. 信任邊界(**使用者 2026-10-20 裁示**): 線上系統常有多層反向代理, 使用者 IP 由反代提供; 能經跳板自填者, 反代拿到的也是自填值, 此類防護屬防火牆 / 反代之責, **SSO 不做防偽造系統**. 故維持「取最左段」語意: 不預設不信任標頭、不改取最右(多層反代下最右為上一層代理 IP)、不提供 `trustProxy`. 部署時請由最外層受信任之代理**覆寫**(而非附加)該標頭. 本規則只做不改語意之衛生(格式驗證), 不解: 合法格式之自填(使他人 IP 遭計次封鎖、以標頭輪替規避 IP 封鎖、以大量互異合法 IP 填充 `ips` 表). 外審若提出取最右 / 預設不信任 / `trustProxy`, 依裁示不採.
  5. 兩個本機放行端點(`/api/cleanKpIpCallApi`、`/api/cleanKpAccountLoginFailed`)取 socket 位址、不讀標頭, 不變.
- **理由**: 修前(HEAD `4480264`, 經真後端)標頭首段原樣成為 `verifyConn` 之 `ip`——寫入 `verifyConn` log、`ips` 表(管理端顯示面)、`kpIpCallApi` 之鍵與統計之鍵. 非 IP 字串(含標記、超長)可任意登錄; 格式驗證使這類值不再進入任何持久面, 合法 IP 之行為完全不變.
- **盤點指令**:
  - `git grep -n -i -E "x-forwarded-for|remoteAddress|getIpByHeaders" -- server src` → 取值只在 `procProtect.getIpByHeaders`; `WWebSso.mjs` 之 `verifyConn`(呼叫 `pp.getIpByHeaders`)與兩個本機放行端點(自取 socket 位址, 註解載明不讀標頭); 其餘為註解 / JSDoc.
  - 可執行版: `unit-sourceIp` 之 `SITE-IP-001`(除 `getIpByHeaders` 外 `server/` 不讀 `x-forwarded-for`)、`SITE-IP-002`(`pickForwardedIp` 以 `isIP` 驗證、不通過者回空字串, `pickForwardedIp` 與 `getIpByHeaders` 皆未對採用值做改寫, `getIpByHeaders` 不自行驗證).
- **站點全集(2026-10-20)**: ①`procProtect.getIpByHeaders`——已套. ②`WWebSso` 之 `verifyConn`——經 `pp.getIpByHeaders`, 無自取. ③`/api/cleanKpIpCallApi`、`/api/cleanKpAccountLoginFailed` 之 `realIp`——取 socket 位址、不讀標頭, 刻意不套(本機放行判定不得受標頭影響). ④`staLogs` 之 IP 統計——讀 `verifyConn` log 之 `ip`(已為驗證後之值; 修前之歷史 log 仍可含任意字串, 統計端以 R-OBJ-ITER-01 / R-KEY-01 處理, 不依賴本規則).
- **測試**: `test/unit-sourceIp.test.mjs`(IP-U-001～011 含 006b、SITE-IP-001～002 共 14 案; 真實 `procProtect` 工廠)、`test/api-sourceip.test.mjs`(IP-A-001～007, 經真後端 / 真 HTTP; 以臨時 settings 之 `logFd` 隔離統計 log): 非 IP 標頭 → `ips` 表與統計皆記連線位址、log 有限流之 warn 且超長值只留 64 字元預覽; 合法 IPv4 / IPv6 / `::ffff:` / 大寫 IPv6 原樣登錄; 以原字串寫入之封鎖列仍命中; 不同非 IP 標頭值共用連線位址之計數並封鎖該位址; 帶 port 者去 port 取 IP(IP-A-006: 同一 IP 不同 port 為同一 IP、不退回連線位址;IP-A-007: 帶 port 之請求以 IP 本身計次封鎖、封鎖列對帶 port 之請求命中、連線位址不受牽連). 既有 `api-iterclient` IT-A-001 / 003a / 003b 之前提(標頭值成為統計鍵)隨本規則改為「標頭值不成為統計鍵」: IT-A-001 改以臨時 logFd 內植入歷史 log 維持 R-OBJ-ITER-01 之端到端覆蓋, 原型鍵名防護由 `unit-iterClientObj` IT-K / IT-S / IT-P 與 IT-A-003c / d(權杖參數)守.
- **修前紅(2026-10-20, 定稿測試對 HEAD `4480264` 之 `server/procProtect.mjs` + `server/srLog.mjs`; 腳本 `tmp/ledger/head-red.mjs`, 暫存區可能已清, 依此重建)**: unit 新兩檔 24 案中 21 案失敗(對照案 IP-U-001、IP-U-003、SITE-IP-001 原即通過); api 層 `api-sourceip` + `api-iterclient` 11 案中 6 案失敗(經真後端: IP-A-001 `ips` 表出現 `"length"`、IP-A-004 被刪之列復活、IP-A-005 非 IP 標頭未計入連線位址故不封鎖、IT-A-001 `length` 鍵計 6 而非 3、IT-A-003a / b 標頭值成為統計鍵), IP-A-002 / 003 與 IT-A-002 / 003c / d 為對照案原即通過.
- **變異驗證(2026-10-20, 每項植入後還原並以 sha1 核對相同; 腳本 `tmp/ledger/mutate.mjs`、清單 `mutations-sso.mjs`, 暫存區可能已清, 依此重建〔副本已存於主控 `dnow/20261020151326/agent-out/run01-evidence/`〕; 23 項全數轉紅, 含 M16 / M17 計時器只處理第一鍵 → CNT-001 / 002 / 003 / 005 / 006)**: M1 移除格式驗證 → `unit-sourceIp` + IP-A-001 / IP-A-005; M1b 移除 zone 長度上限 → IP-U-002; M1c 上限邊界 `>` 改 `>=` → IP-U-001(64 字元合法); M2a 合法字串轉小寫 → IP-U-001 / SITE-IP-002 + IP-A-002; M2b 剝除 `::ffff:` → 同; M3 不記 warn → IP-U-002 / 004 / 006 + IP-A-001; M4 warn 不限流 → IP-U-006; M5 時鐘回撥不處理 → IP-U-006b; M6 改取最右段(違反裁示)→ IP-U-004; M7 吞錯改回外拋 → IP-U-008; M7b 不承接 reject → IP-U-008; M7c preview 不置換控制字元 → IP-U-009. 計數容器相關見 R-CNT-01. 白名單(查詢欄位名)未採, 無變異.
- **外審(2026-10-20; sol `gpt-6.1-sol` max + minimax `minimax-m3.1-flash-free` xhigh)採納項**: `srLog.warn` 失敗不得中斷取 IP(規則 3)、時鐘回撥(規則 3)、preview 控制字元(規則 3)、長度邊界 63 / 64 / 65 與 `getIpByHeaders` 邊界輸入之測試、IP-A-001 改為以 1000 字元者打頭並依實際經過時間計 warn 上限、IP-A-004 窗口放大為 6 秒、IP-A-005(封鎖與合併計數之 HTTP 案)、`SITE-IP-002` 改取完整函式本體、`withFakeClock` 禁巢狀. 不採: 重複標頭陣列形態不記 warn(真 Node 以 `, ` 合併為字串, 陣列僅見手製請求物件)、取最右 / trustProxy(使用者裁示).

### R-QKEY-01: 以使用端給定之欄位名查使用者, 欄位名須在白名單 `id / account / email / name`; 白名單外 reject 且不回顯; 查詢值之 log 一律遮罩(2026-10-20, 主控第 93 項 run02 裁示 2)

- **規則**:
  1. 單一擁有者 `server/procCore.mjs` 之 `getUserInfor(key, value)`: `key` 非字串或不在 `keysUserQuery`(`server/srLog.mjs` 匯出之 `['id', 'account', 'email', 'name']`, `maskKv` 同用)者 → `Promise.reject('invalidUserQueryKey')`, 不查資料庫. reject 值為固定 key(procLang 有 eng + cht), **不含 key 與 value 之任何內容**. 白名單以陣列比對(非物件鍵查詢): `constructor`、`__proto__`、`toString` 等一律在外.
  2. 順序: 檢查置於 `checkToken` **之後**(未授權者先得 `tokenExpired`, 不得藉此回應探測白名單); 且置於 `WWebSso` 兩個入口(HTTP `/api/getSsoUserInfor`、kpfun `getUserInfor`)之 `srLog.info` **之後**——被拒之查詢仍留稽核痕跡(記 `key` 與已遮罩之 `value`), `maskKv` 對白名單外欄位之遮罩因此仍可由真後端觀察(`api-srlog-noleak` LOG-003).
  3. HTTP `key=token` 在 `WWebSso` 上游分流至 `checkTokenAndGetUserByToken`, 不經欄位選擇器, 不受白名單影響; kpfun `getUserInfor` 無此分支, `key='token'` 屬白名單外 → 被拒(全庫無任何呼叫端以 kpfun 傳 `key='token'`).
  4. `procCore._getGenUserByKV` 的 `srLog.debug`(`userNotFound` / `userDuplicate`)之 `valueUser` 以 `maskKv(keyUser, valueUser)` 遮罩(與同函式 console 一致); 內部呼叫端固定傳 `account` / `id`, 此為縱深防禦.
  5. 對外 helper(`getUserByToken` / `getUserByUserId` / `getUsersByToken`)之網址範本檢查改為「恰一個完整參數」比對: `src/fetchSsoMsg.mjs` 之 `hasUrlParam(url, name, value)` ——參數名之前須為字串起點或 `?` `&` `"` 空白、參數值之後須為字串終點或 `& # "` 空白(以參數分隔字元定界; `"` 與空白供單元測試以 `data:` 網址〔佔位符在 JSON 字串內、無 `?`〕模擬 SSO), 且同名參數恰出現一次. 原 `indexOf('key=token')` 子字串檢查使 `key=tokenVerify`、`xkey=token`、`token={sysToken}x` 皆通過; 初版(run02 前半)改以「前後不得為參數字元 `[A-Za-z0-9_.~%-]`」排除, 外審(minimax MM-C-01 / 02、agy-opus F-C1 / F-C2)指出仍通過 `key=token+`〔server 實得 `token `〕、`key=token;x`、`a=key=token`、`&amp;key=token`、路徑 `/key=token`、片段 `#key=token`、重複參數 `key=token&key=id` 等偽陽性, 改為分隔字元定界 + 恰一個.
  6. log 衛生(外審 minimax MM-B-01 / 02、MM-D-02 提出, 本輪採納): 使用端給定之欄位名 `key` 與識別欄之查詢值 `value`(白名單內者原樣記供追查)寫入 `srLog` 前一律經 `srLog.capText`: 控制字元(< 32、127)置換為 `?`(`safeText`), 長度超過 `LOG_TEXT_MAX`(256)者截斷並附 `...(len=N)`; 短字串原樣. 站點: `WWebSso` 兩入口 `srLog.info` 之 `key`、`maskKv` 識別欄分支、`procCore._getGenUserByKV` `srLog.debug` 之 `keyUser`. 非識別欄之值仍一律 `maskToken`(規則 4). (pino JSON 已跳脫控制字元, 不致換行注入; 此規則限制使用端可控之 log 量並與 `maskToken` 同一紀律.)
- **理由**: 修前欄位名由呼叫者(管理者或具 `readUsers` 之應用系統金鑰)任意指定並直接作為資料庫選擇器鍵: ①誤用 `key=userId`(`users.userId` 為建立者主鍵欄)不報錯而查到建立者; ②可對憑證欄(`tokenVerify`、`password`)以值探測存在性; ③非識別欄之值可能即憑證, 需靠 log 遮罩補救(R-SEC-01). 全庫正式用法僅 `token`(上游分流)、`id`、`account`、`name`(srv.mjs 註解範例).
- **盤點指令**:
  - `git grep -n -E "checkTokenAndGetUserInfor|getUserInfor|_getGenUserByKV|getGenUserByKV\(" -- server` → 欄位名只在 `procCore.getUserInfor`(使用端給定)與內部固定常數呼叫(`account` / `id`).
  - `git grep -n -E "indexOf\('(key|token|value)=" -- src` → 應為 0(helper 範本檢查一律經 `hasUrlParam`).
  - 可執行版: `unit-queryKey` 之 `SITE-QK-001`(`getUserInfor` 先驗白名單後查庫、`keysUserQuery` 單一定義且與 `maskKv` 同源)、`SITE-QK-002`(`src/` 無 `indexOf('key=` 子字串檢查).
- **站點全集(2026-10-20)**:

| # | 站點 | 欄位名來源 | 判定 |
|---|---|---|---|
| Q1 | `procCore.getUserInfor`(`checkTokenAndGetUserInfor` 之唯一呼叫) | 使用端 | **已套**(單一擁有者) |
| Q2 | `WWebSso` HTTP `/api/getSsoUserInfor` 之 `key !== 'token'` 分支 | 使用端 `query.key` | **已套**(經 Q1; `srLog.info` 在前) |
| Q3 | `WWebSso` HTTP `key === 'token'` 分支 → `checkTokenAndGetUserByToken` | 固定語意(以權杖查) | 刻意不套(不經欄位選擇器) |
| Q4 | `WWebSso` kpfun `getUserInfor` | 使用端 `key` | **已套**(經 Q1; `srLog.info` 在前) |
| Q5 | `procCore._getGenUserByKV` / `getGenUserByKV` / `getGenUserByUserId` 之內部呼叫 | 程式常數(`account` / `id`) | 刻意不套(縱深防禦: debug 記錄遮罩, 規則 4) |
| Q6 | `src/getUserByToken.mjs` / `getUserByUserId.mjs` / `getUsersByToken.mjs` 之範本檢查 | 部署端網址範本 | **已套**(`hasUrlParam`, 規則 5) |

- **已知限制(外審 sol F-01、minimax MM-B-03 提出; 文件更正、程式不改)**: 規則 1 的「`key` 非字串 → `invalidUserQueryKey`」成立於 `procCore` 層(`unit-queryKey` QK-003). 對外兩入口(HTTP `/api/getSsoUserInfor`、kpfun `getUserInfor`)另有 run02 前即有之「入口一致性」守門 `_strictStr(token, key, value)`, 先於 `srLog.info` 與白名單: `token` / `key` / `value` 任一為空字串、陣列(Hapi 對重複 query 參數給陣列)或非字串者一律 `tokenExpired`、不留入口稽核紀錄. 對所有 `getSsoUserInfor` 輸入相同、未回顯值, 且 `api-getuserinfor` QK-A-006 守護此行為; 白名單 / `invalidUserQueryKey` 因此只對「字串、非空」之 `key` 於對外入口可見. README 同步載明.
- **修前紅 / 變異(2026-10-20 run02; 腳本 `tmp/ledger/mutate.mjs`、清單 `mutations-run02.mjs`, 暫存區可能已清, 依此重建; 全部以 sha1 核對還原)**: 修前紅——定稿測試對未改程式(run01 狀態): `unit-sourceIp` IP-U-010 / SITE-IP-002、`unit-queryKey` QK-002～004 / QK-007 / SITE-QK-001 / 002、`unit-external-helpers` HLPU-002b 共 9 案失敗(對照案 IP-U-011、QK-001 / 005 / 006 原即通過); api 層之修前紅等同下列 R2-M1 / M8(變異後之程式即修前程式). 變異 45 項(`R2-M1`～`M46` 含 `M6b`、缺 `M33` / `M34`; 其中 M25～M31 取自外審 sol 第 1 輪〔中途因額度用盡而結束〕已產出之存活變異, M35～M39 取自 agy-opus 之測試缺口 T1 / T3 並與 M20 / M21 / M27 / M28 / M32 隨 `hasUrlParam` 重設計重寫, M40～M46 對應 minimax 提出之 log 衛生與 console 守護; 其對應測試缺口皆已補; 最終程式上全部重跑)**全數轉紅**: 去 port——M1 移除 → IP-U-010 + IP-A-006 / 007; M2 移除 65535 上限、M3 版本與形式不比對、M6 / M6b port 位數不限、M7 括號形式可無 port → IP-U-011(M7 另 IP-U-002); M4 去後轉小寫 → IP-U-010 + SITE-IP-002; M5 去後不驗長度 → IP-U-002 / 011 + SITE-IP-002; M25 上限 `<` / M26 括號形式 port 0 被拒 → IP-U-010. 白名單——M8 移除 → QK-002 / 003 / 004 + SITE-QK-001 + QK-A-002 / 003 + LOG-004; M9 大小寫不敏感、M10 回顯欄位名、M12 以 `in` 物件鍵查詢 → QK-002 等 + QK-A-002; M11 置於 `checkToken` 前 → QK-005 + QK-A-004; M17 / M18 HTTP / kpfun 白名單置於 `srLog.info` 前 → LOG-003; M19 procLang 缺 key → QK-004. 遮罩——M13 / M14 / M29 debug 記錄不遮罩或誤用 `maskToken` → QK-007; M15 `maskKv` 恆原樣 → QK-007 + LOG-003; M16 `maskKv` 與白名單不同源 → SITE-QK-001; M30 / M31 info 記錄遮罩了 token 而非 value → LOG-003. helper——M20 / M21 前後界移除、M27 後界放寬含 sub-delim、M28 前界放寬含 `/ # ; : = +`、M32 不要求同名參數恰一個 → HLPU-002b; M22～M24 退回 `indexOf` → HLPU-002b + SITE-QK-002. 去 port 正規式錨點——M35 / M36(IPv4:port 去 `^` / `$`)、M37 / M38(`[IPv6]:port` 去 `^` / `$`)→ IP-U-011. 遮罩補充——M39 `maskKv` 對欄位名大小寫 / 空白不敏感 → QK-007. log 衛生(規則 6)——M40 `capText` 不截斷、M46 不置換控制字元 → QK-009; M41 `maskKv` 識別欄分支不經 `capText` → QK-009 + SITE-QK-003 + LOG-005; M42 / M43 兩入口 `srLog.info` 之 `key` 原值 → SITE-QK-003 + LOG-005; M44 debug 記錄 `keyUser` 原值 → QK-009 + SITE-QK-003; M45 console 不遮罩 `valueUser` → QK-008. **揭露兩處測試自身缺口(變異存活後補)**: ①LOG-003 初版斷言「記錄存在」讀取整個整點 log 檔(含歷次執行), 且遮罩形式只露前後字元與長度、歷次相同, 故 M17 / M18 / M30 / M31 存活——改以 `time >= t0` 過濾本次記錄並比對 maskToken 公式(`k=min(4,floor(n/8))`)後轉紅; ②外審 sol 以窄替身重放發現 IPv6 括號形式 port 0 / 65535、`%` / `~` 界字元、識別欄之 duplicate debug 記錄、info 記錄遮罩對象等測試缺口, 已補.
- **測試**: `test/unit-queryKey.test.mjs`(真實 `procCore` 工廠 + 記憶體資料表: 白名單內 4 欄可查、白名單外含原型鍵名 / 憑證欄 / `userId` / `isAdmin` / 空字串 / 非字串全被拒且不查庫、reject 值不含 key 與 value、未授權先得 `tokenExpired`、`_getGenUserByKV` debug 遮罩、站點守門)、`test/api-getuserinfor.test.mjs` 增案(真後端 HTTP + kpfun: 白名單外 `state=error` / `invalidUserQueryKey`、回應與 log 不含查詢值、白名單內仍可查、`key=token` HTTP 不受影響)、`test/api-srlog-noleak.test.mjs` LOG-003(探測改為斷言被拒且 log 仍遮罩)、`test/unit-external-helpers.test.mjs` 增案(`hasUrlParam` 邊界).

