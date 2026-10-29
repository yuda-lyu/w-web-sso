# 規則帳本(分冊: ORM 寫入與驗證規則)

本檔為規則帳本之分冊(2026-10-22 自 `sgud/rule/rulebook.md` 依類型拆出, 節號與標題不變、內容只搬不刪); 總索引見 `rulebook.md`.

### R-ORM-01: ORM 寫入結果須逐筆檢查; 寫入後副作用不依寫入成敗; 寫入失敗回語系鍵(2026-10-11, ADR-080)

- **規則**:
  1. 直接呼叫 woItems 之逐筆函數(`save` / `del`)一律經 `server/ormWrite.mjs`(以 w-data-collector `getItemsFail` 逐筆檢查——w-serv-orm 1.1.8 起之正本, 其 procOrm 同用之, ADR-081; 失敗即 reject 含主鍵與原文之訊息). 唯一例外: 已自行判斷逐筆結果者(`logoutByToken` 之 `0.nDeleted !== 1`). `insert` / `delAll` 回聚合物件且錯誤皆屬整批性, 不適用.
  2. 經 procOrm 之寫入(w-serv-orm 1.1.7 起逐筆失敗即 reject, 其餘筆已寫入)與直接寫入點之失敗, 皆不得把 ORM 原文回前端: 轉為語系鍵(eng + cht 於 `server/procLang.mjs`), 原文寫 srLog.error.
  3. 寫入之後續動作(寄信、記節流、回報成功)只在寫入成功後執行.
  4. 清單儲存(`updateTabItems`): 全部驗證在任何寫入之前; 寫入後副作用(users 表撤銷本批欲刪除 / 停用者之令牌、清除 `opt.ocList` 之清單快取)於寫入階段一經進入即執行, 不依寫入成敗; 驗證失敗不執行. 寫入階段失敗一律回 `saveWriteFail`.
  5. 撤銷使用者令牌一律經 procCore `revokeTokensByUserId`(p 匯出供 procProtect); 不得再手寫「select 後逐筆 del」.
- **理由**: w-orm 系列 save / del 遇單筆失敗不 reject; 未檢查者之 catch 永不觸發, 失敗被當成功(假的驗證成功、連結無效之重寄信、未生效之密碼變更通知與重設密碼信、未展延卻回報之到期時間、無紀錄之封鎖失敗). 1.1.7 之 procOrm 改為逐筆失敗即 reject 後, 排在寫入成功後之撤銷與清快取整段跳過. 見 ADR-080.
- **盤點指令**:
  - Grep `woItems\.\w+\.(save|del)\(` 於 `server/` → 只有 `logoutByToken` 之 `tokens.del`(1).
  - Grep `ormWrite\(` 於 `server/`(扣除 `ormWrite.mjs` 本身)→ 站點全集如下.
  - Grep `procOrm\(` 於 `server/` → 每筆在 `updateTabItems` 寫入階段之 try 內, 或帶 `.catch` 轉語系鍵(`createUser`).
  - Grep `tokens\.select\(\{ ?userId` 於 `server/` → 只在 `revokeTokensByUserId`(1).
  - Grep `\.clear\('fun'\)` 於 `server/procCore.mjs` → 只在 `updateTabItems`(1).
- **站點全集(2026-10-11)**: `ormWrite` 9 處 —— procCore 6(`refreshToken` tokens.save、`verifyEmail` / `resendVerifyEmail` / `checkTokenAndChangePassword` / `adminResetUserPassword` users.save、`revokeTokensByUserId` tokens.del)、procProtect 3(`blockAccount` / `blockAccountByToken` users.save、`blockIpByIp` ips.save); procOrm 5 處(`createUser` insert、`updateTabItems` del / insert / save×2); `revokeTokensByUserId` 呼叫 4 處(`updateTabItems` 刪除與停用、`blockAccount`、`blockAccountByToken`); 皆已套. 測試: `test/unit-ormWriteFail.test.mjs`(41 案, 真實 procOrm + 語意對齊 w-orm-lmdb 之記憶體資料表, 見上「unit 層」); 正常路徑之真後端撤銷: `test/api-deleteuser.test.mjs` API-002 / API-003.

### R-VAL-01: 寫入前驗證完備——可於寫入前判定、寫入時才會被拒或被改寫之輸入, 一律於驗證階段以語系鍵拒絕(2026-10-12, ADR-081)

- **規則**:
  1. 經 procOrm 寫入之輸入, 驗證須作用於「最終儲存值」: procOrm 寫入時對各欄位 clearXSS(w-serv-orm getMapOrm 之 adjustData), 故新增 / 修改列(與註冊三欄)之欄位值會被 clearXSS 改寫者(`!isEqual(clearXSS(v), v)`, 引同一 `wsemi/src/clearXSS.mjs`)即拒絕 `htmlMarkupNotAllowed`; 明文 password 於雜湊前不檢查; 刪除與比對後未變更之列不檢查.
  2. 清單儲存之列格式(三清單共用): rows 為陣列、主鍵為非空字串、本批不重複、UTF-8 位元組數不超過 1978(LMDB 鍵長上限)→ 否則 `invalidRows`; users 之 email 空 / 重複回 `userEmailEmpty` / `userEmailDuplicate`. 驗證錯誤一律回語系鍵, 不得以 template literal 組原始字串(ADR-034).
  3. 新增驗證時自問「此輸入寫入時會不會被 ORM 拒絕或改寫」: 會者必前移至驗證階段, 並補「與刪除同批」之案例(驗證階段之拒絕須無任何寫入: 整表快照與寫入次數).
  4. 判準複製自上游者須有語料等價測試(真 procOrm 對照); 升版查核加 `npm ls wsemi` 須只有一份(判準與上游共用同一實體之前提).
- **理由**: 本套件無交易(ADR-044), 寫入階段任一步失敗時其前步驟已落地; 寫入時之改寫使儲存值與送入值不同, 以送入值比對之唯一性、登入與重寄即失準(帳號 `john<doe` 存成 `john&lt;doe` 後無法登入, 與 `john&lt;doe` 可重複註冊). 見 ADR-081.
- **盤點指令**:
  - Grep `procOrm\(` 於 `server/` → 只在 `updateTabItems` 寫入階段(del / insert / save×2)與 `createUser`(insert); 前者之前須經 `rowsMarkup`(欄位)與列格式檢查, 後者須經三欄檢查.
  - Grep `Promise\.reject\(\`` 於 `server/procCore.mjs` → 2026-10-12 之 30 筆皆為查找 / 權杖類內部不變量(`failed to find …`、`duplicate …`、`invalid token` 等, 對外經 checkToken 等收斂為語系鍵, ADR-034)或以反引號書寫之語系鍵(`failedLoginForCatch`、`tokenExpired`); `updateTabItems` 與 `createUser` 之驗證段不得有命中.
  - Grep `clearXSS` 於 `server/` → 只在 procCore 之 `updateTabItems`(欄位檢查)與 `createUser`(三欄檢查).
- **站點全集(2026-10-12)**: `updateTabItems`(users / tokens / ips 三清單)、`createUser`; 皆已套. 測試: `unit-ormWriteFail` A11～A22、B8; `api-adduser` API-011～013(以 HEAD 版 procCore 對真後端驗紅、修改後綠).

### R-VAL-02: 後台使用者清單之 redir 檢查——只攔系統管理者本次新增或由非空改為空之列; 載入時即為空之既有列(自助註冊者)不擋存檔、不標警示(2026-10-23, sso-run04 第 116 項; ADR-094; 原則 3)

- **規則**:
  1. 前端 `errItemsByRedir` 只對「新增列(`_isNew`)redir 空」與「既有列 redir 由非空改為空」回錯(訊息 `userRedirEmpty`, 儲存格警示與 modal 文字不變); 載入時即為空之既有列不回錯. 比對基準 `redirOrig`(**Map**, 列主鍵 → redir 原值; 不用純物件, 因基準存於 Vue data, Vue 2 響應式會以 `__ob__` 鍵覆蓋同名主鍵之值)與 `baseline` 同一快照(載入、存檔成功後重讀)更新; 基準有效而列不在基準內且非新增者視為系統管理者所設, 嚴格檢查; **基準算不出(`null`, 重讀失敗)時只檢查新增列、不檢查既有列**——此時 baseline 亦為 null, 後端無基準之存檔一律拒收(`saveBaselineFormat`, 提示重新載入), 前端先擋既有列只會使使用者先看到不相干之訊息(外審 sol#3、#4).
  2. 儲存格警示以**列主鍵**為鍵(`cellRedirErr(id)`), 不以 redir 值為鍵(空值為鍵會使所有空 redir 儲存格同時被標).
  3. 檢查邏輯在 `src/usersRedirCheck.mjs`(純函式, `redirOrigOfUsers` / `redirErrIdsOfUsers`); 元件只接線.
  4. 後端不驗 redir(本就如此, 不新增); 自助註冊不給預設 redir、不遷移既有資料(取捨見 ADR-094; 「預設 redir」與「modal 指出列」為待裁示選項, 兩者皆會動既有標準圖).
- **理由**: 自助註冊者 redir 為空是設計事實(`createUser` 以 `funNew` 預設, 註冊流程無此欄; `view=user` / `view=backstage` 登入不需 redir); 規格(E2E-007 / E2E-008)只要求攔系統管理者本次輸入之空值, 前端規則範圍(全部列)大於規格; 一列之既有資料問題不得擋住整份清單之存檔.
- **盤點指令**:
  - Grep `errItemsByRedir|cellRedirErr|redirOrig` 於 `src/components/LayoutContentUsers.vue` → `errItemsByRedir` 只呼叫 `redirErrIdsOfUsers`、不自行逐列 `isestr(redir)`; `redirOrig` 於載入與存檔後重讀各設一次、重讀失敗清 `null`; redir 儲存格只用 `cellRedirErr`.
  - Grep `cellFieldErr\(` → 只剩 `'account'` / `'email'`(以值為鍵, K14 已套).
- **站點全集(2026-10-23)**: 前端 1 處(`LayoutContentUsers.vue`); 清單類中僅使用者清單有 redir.
- **測試**: `unit-usersRedir`(UR-U-001～014 邏輯 × 列來源與動作〔含基準 null、Map 與真 Vue data、基準重讀更新〕; UR-W01～03 接線靜態守護〔去行尾註解後計數、兩處賦值各緊接 baseline 賦值〕)、`e2e-modifyuser` E2E-016(新, 兩語系 4 張新標準圖; 既有 416 張 sha256 0 變動)與 E2E-007(既有列改空仍攔)、`e2e-adduser` E2E-008(新增列留空仍攔).
- **修前紅**: 換入 HEAD 版 `LayoutContentUsers.vue`(sha256 回驗還原): E2E-016 兩語系皆失敗(自助註冊者之空 redir 格被標警示圖示, 儲存前斷言 `img` 數 1 ≠ 0; HEAD 之儲存被擋見 sso-verify01 X3c / X8d).
- **變異驗證(2026-10-23, 外審修補後最終版)**: unit 層 9 項(U1～U5 含 U3b 邏輯、V1 / V2 / V4 接線)全數被抓到(對照組 18 案全綠); V3(元件呼叫檢查時不傳基準)只有 e2e 抓得到: 外審 sol#4 後語意為「基準 null 時只檢查新增列」, 故 V3 下 E2E-016 仍綠(實測 2 / 2 過, 即未被 E2E-016 抓到), 應由 E2E-007(既有列非空改空須被攔)偵測; 該次真瀏覽器層重驗(R-U1、R-V3)於 2026-10-23 因事故中止, **未完成(INCONCLUSIVE, 待補)**, 驅動為歸檔之 `mutate-repo.mjs`(R-V3 之偵測案已改為 E2E-007).

### R-ORM-02: 本套件不轉交 w-serv-orm 已移除之使用者檢查設定; settings / optExt 給予上游會拒絕之值者忽略並於啟動時記警告(2026-10-14 改寫, ADR-085; 原 2026-10-12, ADR-083)

- **規則**:
  1. 不轉交已移除之使用者檢查設定: `getProc(mapOrm)` 一律不傳 opt, `WServOrm(ds, WOrm, url, db, opt)` 之 opt 除診斷輸出之 `funLog`(R-ORM-04, 2026-10-28 起 `server/WWebSso.mjs` 傳 `{ funLog }`)外不傳任何鍵(`g_mOrm.mjs` 不傳)——w-serv-orm 1.1.9 起無此三鍵, 1.1.10 起 `useCheckUser` / `getUserById` / `useExcludeWhenNotAdmin` 給予 undefined、null、false 以外之值即於建構時拋錯(`w-serv-orm/src/checkOptRemoved.mjs`). 站點: `server/WWebSso.mjs`、`g_mOrm.mjs`、`test/tools/unitProc.mjs` 之 `mkProcOrm`.
  2. settings / optExt 之三鍵由 `server/getIgnoredOrmKeys.mjs` 判定: 逐鍵委派上游 `checkOptRemoved`(其註解明載供包裝層檢查自身之 opt), 會被上游拒絕者依 useCheckUser、getUserById、useExcludeWhenNotAdmin 之序列出, `WWebSso` 於啟動時記警告(console 與 srLog 之 boot 事件, warn), 不中斷啟動; undefined、null、false 不列(與上游接受集一致, 判準只有上游一份).
  3. 警告訊息只寫出被列出之鍵名, 理由文字不得含三鍵之名(`api-ormopts` ORMOPT-001 以「未給之鍵不出現在訊息」斷言).
  4. 寫入之授權由各功能負責: 清單儲存於呼叫 procOrm 前經 `checkToken(token, { fun: funCheckAdmin, perm })`; 自助註冊由 `allowUserRegistration` 與輸入驗證守門. 新增經 procOrm 之寫入點須同樣先授權, 不得倚賴 ORM 層(w-serv-orm 1.1.9 起 procOrm 不做授權, `WServOrm.mjs` JSDoc「授權」段).
  5. 若日後開放 ORM 通道(WServHapi 之 `operOrm` / `tableNamesExec`), 授權由 w-serv-webdata 之 `authorizeExec` 另行設計(含應用系統金鑰之虛擬使用者、自助註冊); 透傳三鍵已不可能(上游拋錯).
- **理由**: 擋板必須保留——部署方之舊設定若給 `useCheckUser: true` 而本套件轉交, w-serv-orm 1.1.10 於建構時拋錯、後端啟動即失敗(違反「舊 settings 原封不動, 新版必須能啟動」, `sgud/exp/experience.md` 套件身分第 1 條); 判準委派上游, 使「警告」恰為「若轉交即拒絕」之值. 原 ADR-083 之理由(上游之使用者檢查使註冊與清單儲存必然失敗、非布林預設為 true)自 1.1.9 起不成立. 見 ADR-085.
- **盤點指令**:
  - Grep `WServOrm\(` 於 `server/` 與根目錄 `*.mjs` → `WWebSso.mjs`、`g_mOrm.mjs` 各 1(`g_mOrm` 4 個參數; `WWebSso` 第 5 參數恰為 `{ funLog }`〔`funLog` 由 wsemi `genDiagFunLog((o) => srLog.warn(o))` 產生〕, R-ORM-04, `unit-diaglog` SITE-DG-001 / 002 守門).
  - Grep `getProc\(` 於 `test/`、`spec/evidence/` → `unitProc.mjs` 之 `mkProcOrm`(1 個參數)、`unit-ignoredOrmKeys`(以三鍵之值呼叫, 取上游拋錯為判準)、取證腳本(逐組 try/catch).
  - Grep `useCheckUser|getUserById|useExcludeWhenNotAdmin` 於 `server/` → 只在 `getIgnoredOrmKeys.mjs`(鍵名清單)與 `WWebSso.mjs` 之 JSDoc / 註解.
  - Grep `optWServOrm|getOptWServOrm` 於 `server/`、`test/`、根目錄 `*.mjs` → 0(ADR / 經驗之歷史敘述除外).
  - Grep `operOrm|tableNamesExec|tableNamesSync|useDbOrm` 於 `server/WWebSso.mjs` → `operOrm` 為註解、二清單為空陣列、`useDbOrm:false`.
  - 升級 w-serv-orm 時: 確認 `src/checkOptRemoved.mjs` 仍在且接受集未變(`unit-ignoredOrmKeys` IOK-007 以上游 getProc 為準逐格比對).
- **站點全集(2026-10-14)**: 建立 WServOrm 2 處(`WWebSso`、`g_mOrm`)、組 procOrm 1 處(`mkProcOrm`), 皆不傳 opt; 擋板 1 處(`WWebSso` 經 `getIgnoredOrmKeys`); 皆已套. 測試: `unit-ignoredOrmKeys` IOK-001～007; `api-ormopts` ORMOPT-001～008(以 `useCheckUser:true`、`useExcludeWhenNotAdmin:true` 重啟真後端: 啟動警告、照常啟動、四寫入點照常). 2026-10-12 版之 `getOptWServOrm`(交出固定 false / null / false)與 `unit-optWServOrm` 已移除.

### R-ORM-03: procOrm 之 userId 參數會被寫入名為 `userId`(insert)與 `userIdUpdate` 之欄; 該欄非建立者語意之表, 新增時以該列之值為參數(2026-10-12, ADR-084)

- **規則**:
  1. w-serv-orm 之 adjustData 於 insert 時把 `userId` / `userIdUpdate` 欄改寫為 procOrm 之 userId 參數(建立者), save 只改 `userIdUpdate`; 經 procOrm 寫入之表, 其 `userId` 欄若非建立者語意(tokens 之擁有者), 新增時須依該欄分組並以其值為參數寫入, 不得以操作者寫入.
  2. 新表或新欄名為 `userId` / `userIdUpdate` 時, 先確認語意是否為建立者 / 更新者; 否則依第 1 條, 或改用他名.
- **理由**: 金鑰清單原以操作者 '' 寫入, 經清單鑄造之金鑰擁有者被改寫為 '' 而不可用, 與 ADR-042 已接受之鑄造能力不符. 見 ADR-084.
- **盤點指令**:
  - Grep `procOrm\(` 於 `server/` → `createUser`(users, 建立者即自身)、`updateTabItems` 之刪除 / 新增 / 修改; 新增步驟於 tokens 以擁有者分組(`mpOwner`).
  - 讀 `src/schema/tables/*.mjs` 之 settings 鍵: `userId` 出現於 users(建立者)與 tokens(擁有者), `userIdUpdate` 只在 users; ips 皆無.
- **站點全集(2026-10-12)**: tokens 之新增 1 處; 已套. 測試: `unit-ormWriteFail` A23; `api-apptoken-perms` PERM-A-008(兩者修改前失敗、修改後通過).

### R-ORM-04: w-serv-orm 之診斷輸出由本套件以 wsemi `genDiagFunLog` 導入 srLog(只寫安全摘要); 外來值於進入本套件時遮罩憑證(2026-10-28 第 154 項 sso-run01 ADR-098; 2026-10-29 第 161 項 mig-sso 改依 dspec〈診斷輸出與遮罩〉, ADR-099)

> 跨套件規格: `C:\opensrcOper\dspec\診斷輸出與遮罩.md`(原則 D1~D5、裁定 Q1~Q4 / P1~P9、已知限制 §5); wsemi 規則 R-DIAG-01(`node_modules/wsemi` 來源 repo `sgud/rule/rulebook_diag.md`). 本條只記本套件須宣告與改之處; `rulebook.md`〈診斷輸出與遮罩〉為摘要.

- **規則**:
  1. 站點: `server/WWebSso.mjs` 建立 `WServOrm` 時 opt 恰為 `{ funLog }`, `funLog` 恰由 `let { funLog } = genDiagFunLog((o) => srLog.warn(o))` 產生(wsemi); 不傳 `logDetail`(true 會把含主鍵與錯誤原文之完整細節還原到 console, pm2 / 容器收集)、不傳已移除之使用者檢查設定(R-ORM-02). 新增建立 `WServOrm` 之站點須同樣接 funLog, 或在本條站點全集登錄刻意不套之理由.
  2. funLog 行為(wsemi 保證, dspec Q1): srLog.warn 一筆 `{ event: 'orm-diag', label, safe }`; **只有安全摘要, 無 detail**(funLog 帶 `noDetail`, w-serv-orm 不取細節); label 控制字元換 `?`; 傳 funLog 後 w-serv-orm 不寫 console, 本套件不補寫(不雙寫); srLog 寫入拋錯或回傳 rejected promise 皆吞下(不產生 unhandled rejection), 不影響 procOrm. `procOrm` 不再包裝(刪 `wrapProcOrm`、AsyncLocalStorage、`maskOrmDetail`, 檔 `server/ormDiagLog.mjs` 已刪).
  3. 外來值於進入本套件時遮罩(dspec D3: 只遮憑證——網址整串、`帳:密`、寄信密碼; 不遮單獨帳號與儲存路徑〔Q3〕): `WWebSso` 以 `getDiag({}, { secrets: getDiagSecrets({ urls: [url], username: emSrcEmail, password: emSrcPW }) })` 建本套件之 `diag`(只宣告秘密來源, 不自寫遮罩). 入口(站點全集見下): (a) `woItems = guardOrm(diag, woItemsRaw)`(`server/guardOrm.mjs`, 各資料表以 Proxy 轉呼叫, reject 與同步拋錯經 `diag.err`); (b) `srEmail.send` 內 `new WEmail(opt)` 之 catch 經 `diag.err`(`srEmailInit(opt, diag)`); (c) `WServOrm` 建構錯誤 catch 經 `diag.err` 後才 console 輸出與重拋; (d) `ormWrite` 之逐筆失敗原文(逐筆 err)於組成 reject 字串時 `diag.mask`(procCore 兩處 `ormWrite(` 皆帶 `diag`).
  4. **本套件以固定詞彙組成之 reject 不得包 `diag.err` / `diag.mask`**(dspec R07: 秘密為其子字串時固定 key 被切碎, 且形成反推密碼之 oracle): `procCore`、`procProtect`、`procStaInfor`、`lockSave` 內不得出現; 故不在 kpfun 集中出口(`WWebSso` 之 `optHapi.kpFunExt` 包裝)與九支 HTTP handler 統一遮罩——該處同時看到固定 key 與外來值. `procOrm` / `withTabLocks` / `guardWrite` 之 reject 為 w-serv-orm 以固定詞彙組成, 不另包.
  5. 建構期不回顯憑證: `url` 型別無效時 console 只印 `typeof url`; `srEmail` 之 `invalid srcPW` 不帶值.
- **理由**: dspec D1(單一實作: 遮罩一律用 wsemi, 各套件只宣告秘密來源與呼叫點); 本套件自製之 `maskOrmDetail`(鍵名啟發式＋AsyncLocalStorage)被外審指出缺口(`maskToken` 露首尾字元與長度), 使用者 2026-10-29 裁定 Q1=A 改為只寫安全摘要. 入口遮罩而非出口遮罩之理由見 ADR-099 Alternatives.
- **殘餘風險 / 已知限制**(dspec §5): reject 清單之短密碼(少於 4 字元)不遮; 單獨帳號與儲存路徑不遮(Q3); 非本套件宣告之秘密(例如資料庫端既存列之內容、錯誤原文夾帶之使用者資料)無從辨識; srLog 的 `err` 欄位仍記 procOrm 之 reject 文字(含主鍵, w-serv-orm 回傳契約文字)與 `fun-createUser-insert` 等站點之 `account`(既有稽核政策, 範圍外未動).
- **盤點指令**:
  - Grep `WServOrm\(` 於 `server/`、根目錄 `*.mjs`(去註解) → `WWebSso.mjs`(含 funLog)、`g_mOrm.mjs`(刻意不套) 各 1(`unit-diaglog` SITE-DG-001 / 002).
  - Grep `\bfunLog\b` 於 `server/`(去註解) → 只在 `WWebSso.mjs`; Grep `\blogDetail\b` 於 `server/`、`src/` → 0; Grep `maskOrmDetail|wrapProcOrm|AsyncLocalStorage|ormDiagLog` 於 `server/`、`src/`、根目錄 → 0(SITE-DG-003 / 004).
  - Grep `woItemsRaw` 於 `server/WWebSso.mjs`(去註解) → 恰 2 處(解構與 `guardOrm(diag, woItemsRaw)`, SITE-DG-005).
  - Grep `diag\.err\(` 於 `server/` → 只在 `WWebSso.mjs`(建構錯誤)、`guardOrm.mjs`、`srEmail.mjs`; Grep `diag\.mask\(` 於 `server/` → 只在 `ormWrite.mjs`; `procCore`/`procProtect`/`procStaInfor`/`lockSave` 內為 0(SITE-DG-007).
  - Grep `console\.log\((?:'[^']*', )?(?:err|errTemp)\)` 於 `server/` → `WWebSso.mjs` 1(fs 錯誤)、`procCore.mjs` 12、`procProtect.mjs` 3(SITE-DG-008; 其錯誤皆來自已於入口遮罩之資料表 / 寄信).
  - 可重跑: `npx mocha --no-parallel test/unit-diaglog.test.mjs test/api-ormdiag.test.mjs --timeout 180000`.
- **站點全集(2026-10-29 mig-sso; 盤點 `server/**`、`src/*.mjs`、根目錄 `*.mjs` 之 reject / throw / emit / srLog 欄位 / console / catch: 主表 116 列＋補充 36 列; 逐站表見 mig-sso 修正報告)**:
  - **外來值入口(已套)**: 資料表 reject(`procCore`/`procProtect`/`ormWrite` 直接呼叫 `woItems.*`; 含 `console.log(errTemp)` 12 處、srLog `err` 21 處、`Promise.reject(err)`/`r.msg` 回遠端之 kpfun 與 5 支 HTTP handler)→ `guardOrm`; 寄信 reject(`procCore` 4 處 console、2 處 srLog)→ `srEmail.send` catch; `WServOrm` 建構錯誤(`WWebSso`)→ `diag.err`; 逐筆 err(`ormWrite`)→ `diag.mask`.
  - **固定詞彙(刻意不包)**: `procCore`/`procProtect`/`WWebSso`/`lockSave`/`procStaInfor`/`hashPassword`/`genRandomPassword`/`wrapTimer`/`getIgnoredOrmKeys`/`srLog`/`staLogs/*` 之 `Promise.reject('<key>')`、`throw new Error('invalid …')` 等(依 dspec R07); 其中 `srEmail` 之 `invalid srcName[…]` 系列為固定詞彙加使用端輸入回顯(非憑證), 原樣.
  - **非憑證類外來值(原樣)**: `staLogs/*`、`procStaInfor`、`WWebSso:640` 之 fs / Worker 錯誤(僅本機路徑與 errno, 不遮路徑〔Q3〕); `srLog` 欄位之 token / ip / account 由既有 `maskToken`/`maskKv`/`capText` 處理(R-SEC-01).
  - **刻意不套**: `srv.mjs`(示範入口, `instWWebSso.on('error')` 的事件源為 w-serv-hapi 傳輸層; kpfun 之 reject 於進入本套件時已遮罩)、`g_*.mjs`(開發腳本, 本機 `./db`)、`src/baselineOf.mjs`(前端 console, 錯誤來自 w-serv-orm 前端 `buildBaseline`, 不屬後端出口)、`src/fetchSsoMsg.mjs`(已有 `maskUrl` ＋白名單形狀)。
  - 建立 `WServOrm` 2 處——`server/WWebSso.mjs`(**已套**)、`g_mOrm.mjs`(**刻意不套**: 開發腳本與測試用單例, 無 srLog, 預設 console 已不含個資); 測試替身組裝 2 處(`test/tools/unitProc.mjs` 之 `mkServ` / `mkProcOrm`, 不傳 funLog, 由 `unit-diaglog` 以真實 WServOrm 另驗 funLog).
- **測試**: `test/unit-diaglog.test.mjs`(接線測試: DGF 轉接器、DGX 外來值入口〔語料 T01 / T07 / R01 / R02 / R04 / R11 / R12 以 `guardOrm` 重跑, 另 R07 固定詞彙〕、DGC 建構期、SITE-DG 站點全集)、`test/api-ormdiag.test.mjs`(真後端 + `test/tools/srvOrmDiag.mjs`: ORMDIAG-001~005). 修改前紅 / 變異結果見 mig-sso 修正報告(`./tmp/mig-sso/campaign.mjs`, 一次取鎖跑完; 還原後逐檔 sha256 回驗).

