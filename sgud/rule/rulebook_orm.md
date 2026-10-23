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

### R-VAL-02: 後台使用者清單之 redir 檢查——只攔管理員本次新增或由非空改為空之列; 載入時即為空之既有列(自助註冊者)不擋存檔、不標警示(2026-10-23, sso-run04 第 116 項; ADR-094; 原則 3)

- **規則**:
  1. 前端 `errItemsByRedir` 只對「新增列(`_isNew`)redir 空」與「既有列 redir 由非空改為空」回錯(訊息 `userRedirEmpty`, 儲存格警示與 modal 文字不變); 載入時即為空之既有列不回錯. 比對基準 `redirOrig`(**Map**, 列主鍵 → redir 原值; 不用純物件, 因基準存於 Vue data, Vue 2 響應式會以 `__ob__` 鍵覆蓋同名主鍵之值)與 `baseline` 同一快照(載入、存檔成功後重讀)更新; 基準有效而列不在基準內且非新增者視為管理員所設, 嚴格檢查; **基準算不出(`null`, 重讀失敗)時只檢查新增列、不檢查既有列**——此時 baseline 亦為 null, 後端無基準之存檔一律拒收(`saveBaselineFormat`, 提示重新載入), 前端先擋既有列只會使使用者先看到不相干之訊息(外審 sol#3、#4).
  2. 儲存格警示以**列主鍵**為鍵(`cellRedirErr(id)`), 不以 redir 值為鍵(空值為鍵會使所有空 redir 儲存格同時被標).
  3. 檢查邏輯在 `src/usersRedirCheck.mjs`(純函式, `redirOrigOfUsers` / `redirErrIdsOfUsers`); 元件只接線.
  4. 後端不驗 redir(本就如此, 不新增); 自助註冊不給預設 redir、不遷移既有資料(取捨見 ADR-094; 「預設 redir」與「modal 指出列」為待裁示選項, 兩者皆會動既有標準圖).
- **理由**: 自助註冊者 redir 為空是設計事實(`createUser` 以 `funNew` 預設, 註冊流程無此欄; `view=user` / `view=backstage` 登入不需 redir); 規格(E2E-007 / E2E-008)只要求攔管理員本次輸入之空值, 前端規則範圍(全部列)大於規格; 一列之既有資料問題不得擋住整份清單之存檔.
- **盤點指令**:
  - Grep `errItemsByRedir|cellRedirErr|redirOrig` 於 `src/components/LayoutContentUsers.vue` → `errItemsByRedir` 只呼叫 `redirErrIdsOfUsers`、不自行逐列 `isestr(redir)`; `redirOrig` 於載入與存檔後重讀各設一次、重讀失敗清 `null`; redir 儲存格只用 `cellRedirErr`.
  - Grep `cellFieldErr\(` → 只剩 `'account'` / `'email'`(以值為鍵, K14 已套).
- **站點全集(2026-10-23)**: 前端 1 處(`LayoutContentUsers.vue`); 清單類中僅使用者清單有 redir.
- **測試**: `unit-usersRedir`(UR-U-001～014 邏輯 × 列來源與動作〔含基準 null、Map 與真 Vue data、基準重讀更新〕; UR-W01～03 接線靜態守護〔去行尾註解後計數、兩處賦值各緊接 baseline 賦值〕)、`e2e-modifyuser` E2E-016(新, 兩語系 4 張新標準圖; 既有 416 張 sha256 0 變動)與 E2E-007(既有列改空仍攔)、`e2e-adduser` E2E-008(新增列留空仍攔).
- **修前紅**: 換入 HEAD 版 `LayoutContentUsers.vue`(sha256 回驗還原): E2E-016 兩語系皆失敗(自助註冊者之空 redir 格被標警示圖示, 儲存前斷言 `img` 數 1 ≠ 0; HEAD 之儲存被擋見 sso-verify01 X3c / X8d).
- **變異驗證(2026-10-23, 外審修補後最終版)**: unit 層 9 項(U1～U5 含 U3b 邏輯、V1 / V2 / V4 接線)全數被抓到(對照組 18 案全綠); V3(元件呼叫檢查時不傳基準)只有 e2e 抓得到: 外審 sol#4 後語意為「基準 null 時只檢查新增列」, 故 V3 下 E2E-016 仍綠(實測 2 / 2 過, 即未被 E2E-016 抓到), 應由 E2E-007(既有列非空改空須被攔)偵測; 該次真瀏覽器層重驗(R-U1、R-V3)於 2026-10-23 因事故中止, **未完成(INCONCLUSIVE, 待補)**, 驅動為歸檔之 `mutate-repo.mjs`(R-V3 之偵測案已改為 E2E-007).

### R-ORM-02: 本套件不轉交 w-serv-orm 已移除之使用者檢查設定; settings / optExt 給予上游會拒絕之值者忽略並於啟動時記警告(2026-10-14 改寫, ADR-085; 原 2026-10-12, ADR-083)

- **規則**:
  1. `WServOrm(ds, WOrm, url, db)` 與 `getProc(mapOrm)` 一律不傳 opt——w-serv-orm 1.1.9 起無設定鍵, 1.1.10 起 `useCheckUser` / `getUserById` / `useExcludeWhenNotAdmin` 給予 undefined、null、false 以外之值即於建構時拋錯(`w-serv-orm/src/checkOptRemoved.mjs`). 站點: `server/WWebSso.mjs`、`g_mOrm.mjs`、`test/tools/unitProc.mjs` 之 `mkProcOrm`.
  2. settings / optExt 之三鍵由 `server/getIgnoredOrmKeys.mjs` 判定: 逐鍵委派上游 `checkOptRemoved`(其註解明載供包裝層檢查自身之 opt), 會被上游拒絕者依 useCheckUser、getUserById、useExcludeWhenNotAdmin 之序列出, `WWebSso` 於啟動時記警告(console 與 srLog 之 boot 事件, warn), 不中斷啟動; undefined、null、false 不列(與上游接受集一致, 判準只有上游一份).
  3. 警告訊息只寫出被列出之鍵名, 理由文字不得含三鍵之名(`api-ormopts` ORMOPT-001 以「未給之鍵不出現在訊息」斷言).
  4. 寫入之授權由各功能負責: 清單儲存於呼叫 procOrm 前經 `checkToken(token, { fun: funCheckAdmin, perm })`; 自助註冊由 `allowUserRegistration` 與輸入驗證守門. 新增經 procOrm 之寫入點須同樣先授權, 不得倚賴 ORM 層(w-serv-orm 1.1.9 起 procOrm 不做授權, `WServOrm.mjs` JSDoc「授權」段).
  5. 若日後開放 ORM 通道(WServHapi 之 `operOrm` / `tableNamesExec`), 授權由 w-serv-webdata 之 `authorizeExec` 另行設計(含應用系統金鑰之虛擬使用者、自助註冊); 透傳三鍵已不可能(上游拋錯).
- **理由**: 擋板必須保留——部署方之舊設定若給 `useCheckUser: true` 而本套件轉交, w-serv-orm 1.1.10 於建構時拋錯、後端啟動即失敗(違反「舊 settings 原封不動, 新版必須能啟動」, `sgud/exp/experience.md` 套件身分第 1 條); 判準委派上游, 使「警告」恰為「若轉交即拒絕」之值. 原 ADR-083 之理由(上游之使用者檢查使註冊與清單儲存必然失敗、非布林預設為 true)自 1.1.9 起不成立. 見 ADR-085.
- **盤點指令**:
  - Grep `WServOrm\(` 於 `server/` 與根目錄 `*.mjs` → `WWebSso.mjs`、`g_mOrm.mjs` 各 1, 皆 4 個參數.
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

