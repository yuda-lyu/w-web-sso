# 規則帳本(分冊: 多人同時編輯之寫入契約)

本檔為規則帳本之分冊(2026-10-22 第 111 項 inv01 盤點輪新增); 總索引見 `rulebook.md`.

## 多人同時編輯(原則 10)

- **摘要**: 管理員之間「開著舊畫面存檔」時採**先動先贏、整次拒收、零寫入**: 前端載入時以 `buildBaseline` 對畫面所見之列自算有序基準 `[[id, 列摘要]]`, 存檔連同送出; 後端於**該表之表鎖內**新鮮讀取、重算比對, 不符整次拒收並提示重新載入. 每表一份寫入契約(`fields` 白名單 / `serverOnly` / `orderKey` / `scope`), 欄位分三類(客戶端 / 雙方 / 伺服器專有), **所有**寫入入口(後台存檔、登入續期登出、驗證信、改密碼、自動封鎖、計時器登錄 IP)取同一表鎖, 系統直寫只改不增、刪除未命中回報, 資料列記錄最後修改者. 外部應用(app 權杖)直呼 API 屬不帶基準之寫入, 照常寫入(後者蓋前者).
- **權威來源(絕對路徑)**:
  - 共用規格: `C:\opensrcOper\dspec\多人同時編輯之寫入契約.md`(本冊依其第 3、4、9、10、11、13 節); 外部匯入另見 `C:\opensrcOper\dspec\外部匯入之定義與機制.md`(第 113 項).
  - 上位原則: `C:\opensrcOper\sgud\proc\process_principle.md` 第 10 條(多人同時編輯)、第 11 條(外部匯入).
  - 定稿方案與三審採納表: `C:\opensrcOper\dnow\20261022221854\方案v2.md`(第 3.2 節為本套件方向; 第六節 E1 為本套件現存缺陷).
- **本冊狀態(2026-10-23)**: 第 111 項**第二步「實作輪 sso-run01」完成**(依 w-serv-orm 1.1.17): R-CONC-01~05 皆**已套**(見各條「現況」與末節〈第二波實作結果〉), E1、X1~X8 全數修正並有測試守護. 2026-10-22 的「第一步盤點輪」之原文(含各條「現況(2026-10-22)」之修改前狀態、現存缺陷實證、第二波規劃 W2-1~W2-8)保留於後, 供對照; 規劃中與實作不同處見〈第二波實作結果〉之「與規劃不同處」. 外部匯入(第 113 項, `rulebook_import.md`)未做.
- **盤點報告(含探測輸出全文)**: `C:\opensrcOper\dnow\20261022221854\agent-out\sso-inv01-盤點報告.md`; 探測腳本 `p1~p9` 留存於 `C:\opensrcOper\dnow\20261022221854\agent-out\sso-inv01-probes\`(repo 內 `./tmp/inv01/` 已清理; 重現法見「現存缺陷實證」).
- **本冊內容**: R-CONC-01 寫入者全集與表鎖 → R-CONC-02 欄位三分類與寫入契約草案 → R-CONC-03 整表存檔之比對 / 刪除集合 / tokens 雙層 → R-CONC-04 最後修改者 → R-CONC-05 前端基準 → 現存缺陷實證 → 第二波實作規劃(含 V1~V14 測試計畫、既有測試影響、改動範圍→e2e 對照) → 待裁示與依原則自行決定.

### R-CONC-01: 所有寫入 users / tokens / ips 之站點須在該表表鎖內執行(每表一鍵、全實例共用); 系統直寫只改不增, 刪除未命中回報(2026-10-22, 原則 10, 規格 §6 / §7 / §9)

**規則**: 凡寫入三表之站點——不論經 procOrm 或直呼 `woItems.*`/`ormWrite`——一律在 `withTabLocks([表…], fn)` 內執行; 每表一把鎖(`users` / `tokens` / `ips`), 多表依表名碼元排序取鎖(`tokens` 先於 `users`); 既有自行取鎖者(`kmx` 以使用者為鍵、`cst.setWithFree`、`lockSave`)保留於**外層**, 表鎖在**內層**, 且持表鎖之程式不得再呼叫任何會取表鎖者(不可重入). 系統直寫之 `save` 一律「只改不增」(`autoInsert:false`), 列已不存在即拒絕; 刪除檢查存在或實際刪除筆數.

**現況(2026-10-23, 第二波後)**: 19 站點 × 表鎖: **已套 19 / 未套 0 / 刻意不套 0**; 離線工具 4 點不適用表鎖(前提為服務停止, 見下). 盤點指令(2026-10-23 重定義, 修改前之三條 `rg` 因寫入改經 `procOrm` + `withTabLocks` 而形狀改變):
```
# a. 仍直呼 ORM 寫入之站點——須恰 2 行: procCore.mjs logoutByToken 之 tokens.del(S03, 在 tokens 鎖內, 自行檢查 nDeleted)、revokeTokensByUserIdLocked 之 ormWrite del(S09 持鎖版)
rg -n "woItems\.\w+\.(insert|save|del|delAll)\(|ormWrite\(woItems\." server --glob "*.mjs" | rg -v "^\S+:\d+:\s*//"
# b. 取表鎖處——須為 procCore 10 行(含 guardWrite)與 procProtect 4 行, 共 14 行(S01 createToken、S02 refreshToken、S03 logoutByToken、S04 createUser、S05 verifyEmail、S06 resendVerifyEmail、S07 changePassword、S08 adminReset、S09 revoke、S10~S14 updateTabItems〔guardWrite〕、S15 blockAccount、S16 blockAccountByToken、S17/S18 blockIpByIp、S19 ipDetectNew)
rg -n "withTabLocks\(|guardWrite\(" server --glob "*.mjs" | rg -v "^\S+:\d+:\s*//"
# c. 經 procOrm 之寫入——updateTabItems 內者須帶 mustExist(del / save)或 keepUserId(tokens insert); 系統直寫(procProtect)記 SYSTEM_ID
rg -n "procOrm\(" server --glob "*.mjs"
# d. 離線工具——仍 4 行(不適用)
rg -n "woItems\.\w+\.(insert|save|del|delAll)\(" g_*.mjs
```
站點 → 測試(`unit-tablock` 以「他人持該表表鎖時站點等待、不先寫」逐站點守護; `SITE-LOCK-S01~S19`; 變異 M01~M14、M10b 逐站點取錯表鎖皆被抓到): S01 loginByAccountAndPassword→createToken(另加鎖內重讀使用者狀態, `SB-S05`)、S02 refreshToken、S03 logoutByToken、S04 createUser(`SB-U13`、`CC-A-019`)、S05 verifyEmail、S06 resendVerifyEmail、S07 changePassword、S08 adminReset、S09 revoke(公開版取 tokens 鎖、持鎖版供 `[tokens, users]` 內使用)、S10~S14 updateTabItems 三路徑、S15 blockAccount、S16 blockAccountByToken、S17 / S18 blockIpByIp、S19 ipDetectNew.

**盤點指令(可重跑)**:
```
# 1. server/ 之 ORM 寫入站點全集(排除純註解行)——結果須恆為 19 行; 增減即本表待更新
rg -n "woItems\.\w+\.(insert|save|del|delAll)\(|ormWrite\(woItems\.|procOrm\(" server --glob "*.mjs" | rg -v "^\S+:\d+:\s*//"
# 2. 離線工具(專案根 g_*.mjs)——結果須恆為 4 行
rg -n "woItems\.\w+\.(insert|save|del|delAll)\(" g_*.mjs
# 3. 動態分派檢查——須僅 ormWrite.mjs:34(通用實作, 非站點)與 procCore.mjs:1512(woItems[woName].select 為讀取)
rg -n "wo\[mode\]|woItems\[" server --glob "*.mjs"
# 4. 無資料通道直寫——須為 useDbOrm: false、tableNamesExec / tableNamesSync 為空
rg -n "useDbOrm|tableNamesExec|tableNamesSync" server/WWebSso.mjs
```
站點數: **server/ 19**(procCore.mjs 14、procProtect.mjs 5) + **離線 4** = **23**; 全數歸類, 未歸類 0. 經 procOrm 者 6(S04、S10~S14), 直呼 `woItems`/`ormWrite` 者 13. 現鎖分布: 無鎖 10(S01、S02、S03、S05、S09、S15~S19)、`kmx` 以使用者為鍵 3(S06~S08)、`cst.setWithFree` 1(S04)、`lockSave` 以 `${op}:${operatorId}` 為鍵 5(S10~S14)——**無任何一把是表鎖**.

| 編號 | 檔:行 | 表 / 動作 | 入口函式 ← 上游入口 | 寫入欄位 | 現鎖 | 刪除 / 未命中回報 | 歸類 | 第二波處置 |
|---|---|---|---|---|---|---|---|---|
| S01 | `server/procCore.mjs:411` | tokens insert(直呼) | `createToken` ← `loginByAccountAndPassword`(:364) ← `procProtect.loginByAccountAndPassword` ← kpfun `loginByAccountAndPassword`(`WWebSso.mjs:1149`) | funNew 全欄(id、token、userId、perms=[]、timeCreate、timeEnd、timeUpdate; isApp 為 '') | 無 | — | 新增 session 列(範圍外, 不比對) | tokens 鎖內 insert; 補 `userIdUpdate`(=登入者) |
| S02 | `procCore.mjs:684` | tokens save(`ormWrite`) | `refreshToken` ← kpfun `refreshToken`(`WWebSso.mjs:1142`)、HTTP `/api/refreshToken`(:818→:835) | `{id, timeEnd, timeUpdate}` | 無 | save 預設 autoInsert → 列已刪則**新增殘缺列**(X5-a) | 雙方欄位 `timeEnd` | tokens 鎖 + 只改不增; 補 `userIdUpdate` |
| S03 | `procCore.mjs:746` | tokens del(直呼) | `logoutByToken` ← kpfun(:1181)、HTTP `/api/logoutByToken`(:857→:874) | `{id}` | 無 | 檢查 `0.nDeleted===1`, 否則 reject `can not delete the token`(已回報未命中, 鍵為本套件既有) | 刪除(session 撤銷) | tokens 鎖 |
| S04 | `procCore.mjs:888` | users insert(`procOrm`, userId=自身) | `createUser` ← kpfun `createUser`(`WWebSso.mjs:1188`) | funNew 全欄(密碼雜湊、tokenVerify、timeVerified 空…) | `cst.setWithFree` [`createUser:account:<a>`, `createUser:email:<e>`](**非表鎖**, 與清單儲存不互斥, X8) | insert 遇既有主鍵略過 | 新增(唯一性檢查+insert 須同鎖) | users 鎖內含唯一性檢查 |
| S05 | `procCore.mjs:952` | users save(`ormWrite`) | `verifyEmail` ← kpfun(:1195)、HTTP `/api/verifyEmail`(:1008→:1020) | `{id, timeVerified}` | 無 | 同 S02(殘缺列, X5-b) | 雙方欄位 `timeVerified` | users 鎖 + 只改不增; 補 `userIdUpdate/timeUpdate`(目前不更新, X2-g) |
| S06 | `procCore.mjs:1027` | users save(`ormWrite`) | `resendVerifyEmail` ← kpfun(:1201) | `{id, tokenVerify}` | `kmx` `resendVerifyEmail:${account}` | 同 S02 | 伺服器專有 `tokenVerify`(不須表鎖; 但須只改不增) | 只改不增; 補更新者; 是否取表鎖見 R-CONC-01 注 1 |
| S07 | `procCore.mjs:1185` | users save(`ormWrite`) | `checkTokenAndChangePassword` ← kpfun `changeUserPassword`(:1237) | `{id, password, isForceChangePw:'n'}` | `kmx` `changeUserPassword:${userId}` | 同 S02 | `password` 專有 + `isForceChangePw` 雙方 | users 鎖(kmx 外、表鎖內) + 只改不增 |
| S08 | `procCore.mjs:1322` | users save(`ormWrite`) | `adminResetUserPassword` ← kpfun(:1247) | `{id, password, isForceChangePw:'y'}` | `kmx` `adminResetUserPassword:${targetUserId}` | 同 S02 | 同 S07 | 同 S07; 更新者=操作管理員 |
| S09 | `procCore.mjs:1403` | tokens del(`ormWrite`) | `revokeTokensByUserId` ← `updateTabItems`(:1695、:1705)、`procProtect.blockAccount`(:213)、`blockAccountByToken`(:408) | 該 userId 全部 token | 無 | 無 token 回 0(冪等, 不視為未命中) | 刪除(撤銷) | 拆「持鎖版」與「自取鎖版」: 上游已持 tokens 鎖者用持鎖版 |
| S10 | `procCore.mjs:1650` | users/tokens/ips del(`procOrm`) | `updateTabItems` ← `checkTokenAndUpdateUsersList`(:2004)/`TokensList`(:2137)/`IpsList`(:2200) ← kpfun(`WWebSso.mjs:1264/1284/1303`; app 權杖具 writeUsers/Tokens/Ips 亦可呼叫, :2024-2026) | 刪除集合 = **庫內全部 − 送出**(`:1582`) | `lockSave` `${op}:${operatorId}`(非表鎖, X6) | rows 取自同函式 select(:1512), 無存在檢查 | 後台整表存檔之刪除 | guardWrite 內; 刪除集合改為「基準內 − 送出」(無基準者 R-CONC-03) |
| S11 | `procCore.mjs:1668` | tokens insert(`procOrm`, 依擁有者分組) | 同 S10(tokens) | 全欄(擁有者 = 送入 userId, R-ORM-03) | 同 S10 | — | 新增(直打 API 鑄造, ADR-042; UI 無新增列) | 同 S10; userIdUpdate 見 R-CONC-04 |
| S12 | `procCore.mjs:1672` | users/ips insert(`procOrm`) | 同 S10(users/ips) | 全欄 | 同 S10 | — | 新增 | 同 S10 |
| S13 | `procCore.mjs:1678` | tokens save(`procOrm`, `perms:null` 前置清空) | 同 S10(tokens) | `{id, perms:null}` | 同 S10 | — | 客戶端欄位 `perms` | 同 S10 |
| S14 | `procCore.mjs:1681` | users/tokens/ips save(`procOrm`, 整列) | 同 S10 | 送出之**整列**(含伺服器專有欄位之客戶端值, X2) | 同 S10 | — | 修改 | 同 S10; 只寫 `fields`(+`order`), 專有欄取庫內值 |
| S15 | `server/procProtect.mjs:198` | users save(`ormWrite`) | `blockAccount` ← `procProtect.loginByAccountAndPassword`(:300) ← kpfun `loginByAccountAndPassword` | `{id, timeBlocked}` | 無(:297 註解稱冪等) | 同 S02 | 雙方欄位 `timeBlocked` | [tokens, users] 鎖: 重讀 → 封鎖 → 撤銷 tokens 同鎖 |
| S16 | `procProtect.mjs:396` | users save(`ormWrite`) | `blockAccountByToken` ← 計時器 `tokenCallApi`(:462→:489) | `{id, timeBlocked}` | 無 | 同 S02 | 雙方欄位 `timeBlocked` | 同 S15 |
| S17 | `procProtect.mjs:789` | ips insert(直呼) | `blockIpByIp`(新 IP 直接以封鎖狀態登記) ← 計時器 `ipCallApi`(:921→:948) | funNew + `{ip, timeBlocked}` | 無(:741 註解稱單一 caller) | — | 新增(系統) | ips 鎖; 補更新者 |
| S18 | `procProtect.mjs:817` | ips save(`ormWrite`) | `blockIpByIp` | `{id, timeBlocked}` | 無 | 同 S02 | 雙方欄位 `timeBlocked` | ips 鎖 + 只改不增 |
| S19 | `procProtect.mjs:915` | ips insert(直呼) | 計時器 `ipDetectNew`(:868, 每 2 秒) | funNew `{id, ip}` | 無 | — | 新增(系統自動登錄新 IP) | ips 鎖; 補更新者 |
| O01 | `g_initialData.mjs:117` | users delAll | 離線初始化工具(`node g_initialData.mjs`) | — | 無 | — | 離線工具 | 不適用表鎖(跨行程); 前提: 服務已停止(規格 §12) |
| O02 | `g_initialData.mjs:118` | users insert | 同上 | `buildBaseUsers()` | 無 | — | 離線工具 | 同 O01 |
| O03 | `g_initialData.mjs:120` | tokens delAll | 同上 | — | 無 | — | 離線工具 | 同 O01 |
| O04 | `g_initialData.mjs:121` | tokens insert | 同上 | `buildBaseTokens()` | 無 | — | 離線工具 | 同 O01 |

- **注 1(S06 是否取表鎖)**: `tokenVerify` 屬伺服器專有(不入基準, 存檔不採用客戶端值), 規格 §4 對伺服器專有欄位不要求取表鎖; 惟 `updateTabItems` 之整列寫入需保證**不覆蓋**它(R-CONC-03), 且「只改不增」必須套用. 依 D2(統一取鎖)S06 仍在 users 鎖內執行(開銷極小), 免除逐站點判斷.
- **ORM 實例與快取**: `server/WWebSso.mjs:460` `WServOrm(ds, WOrm, url, db)` 僅 1 個實例, 其 `woItems / procOrm` 共用於 `procCore`(:543)、`procProtect`(:544)、`procStaInfor`(:558, 唯讀); `WOrm` = `w-orm-lmdb`(安裝 1.0.42), `useCache` 未設 → 預設 false(`node_modules/w-orm-lmdb/src/WOrmLmdb.mjs:81-84`), w-serv-orm 1.1.15 無設定鍵. 後台清單 RPC(`getUsersList / getTokensList / getIpsList`)直讀 `select`, 不經 30 秒快取(`get*ListCache` 只供統計 `procStaInfor`): 比對讀取天然新鮮. 其他 ORM 實例: 無(`g_mOrm.mjs` 為離線腳本專用). 資料通道: `useDbOrm:false`、`tableNamesExec / tableNamesSync: []`(`WWebSso.mjs:1123-1128`)→ 前端無法繞過 kpfun 直寫表, 亦無推播(V11 不適用).
- **外部同步入口(規格 §9 / §10)**: **0 個**. 無 `syncAndReplaceTabs` / `provideTabs`(`06966d8` 移除); 外部目前只能用 app 權杖(writeUsers / writeTokens / writeIps)呼叫整表存檔(S10~S14), 不帶基準, 刪除集合 = 庫內全部 − 送出(會刪光清單外之使用者, 含後台自建者). users 表有 `from` 欄(來源)而**無** `srcKey` 欄; 第 113 項新增匯入管道(`from` 範圍 + `srcKey` 差異同步)時, `from`、`srcKey` 為外部列身分欄(後台不可改), 本冊契約之 `fields` 屆時須納入 `srcKey`、並依「外部擁有 / 本系統擁有」再分欄(規格《外部匯入》§4); 匯入取 users 鎖, 刪除使用者時於**同一鎖內**撤銷其權杖(`[tokens, users]` 鎖).
- **站點歸類統計**: 後台整表存檔 S10~S14(5)、session 生命週期 S01~S03、S09(4)、註冊 / 驗證 / 密碼 S04~S08(5)、自動封鎖與 IP 登錄 S15~S19(5); 合計 19; 離線 O01~O04(4).

### R-CONC-02: 每張表每欄皆分類(客戶端 / 雙方 / 伺服器專有), 寫入契約白名單明列; 新增欄位時同步補分類(2026-10-22, 原則 10, 規格 §3 / §4)

**規則**: `fields`(入基準、存檔採用客戶端值)= 客戶端欄位 ∪ 雙方欄位, **明列**; `serverOnly` = 伺服器專有(不入基準、存檔一律取庫內值); 主鍵與 `orderKey` 另計. 判準: 只由後台 / 外部經存檔寫入 → 客戶端; 後台可改且系統亦寫 → 雙方(**系統直寫亦須取表鎖**, 且被系統改動後持舊畫面者存檔即被拒, 不得改列伺服器專有或不入基準); 只由系統寫 → 伺服器專有. 完整性守護(第二波 `unit-writeContract`): 每表 `pk ∪ orderKey ∪ fields ∪ serverOnly` 恰等於 schema 全欄, 且 `fields ∩ serverOnly = ∅`.

**現況(2026-10-23)**: 契約檔已落: `src/writeContracts/{users,tokens,tokensSession,ips}.mjs`(+ `index.mjs`), 前後端同一來源; `tokensSession` 為 session 列之第二份契約(同 fields, scope 互補). `unit-writeContract` 核對: ①每表每欄皆已分類且與手寫預期逐欄相符(WC-01、WC-02); ②tokens 兩契約 scope 互補(WC-03); ③凍結向量(WC-04). 欄位政策與下表(修改前之分類)相同, 無調整; `tokens.userIdUpdate`、`ips.userIdUpdate` 已補入 schema 並列伺服器專有.

**users(20 欄 = 主鍵 1 + 名次欄 1 + 客戶端 9 + 雙方 3 + 伺服器專有 6)**

| 欄 | 分類 | 判定依據(檔:行) |
|---|---|---|
| `id` | 主鍵 | `src/schema/tables/users.mjs:16` |
| `order` | `orderKey`(名次入基準, 不入 fields) | 存檔依列序重編: `updateUsersList` 傳 `resetOrder:true`(`server/procCore.mjs:1997`)→ `:1458-1464`; UI 以拖曳列序決定(`LayoutContentUsers.vue:1014-1016`), 欄位隱藏(:1025); **注意**: 自助註冊新增之列 `order` 為空字串(funNew 預設 `''`, S04 insert 不設), 非數值——核心排序規則(`order` 數值)須定義非數值之位置(T2 ⑤) |
| `account` | 客戶端 | UI 可編(`LayoutContentUsers.vue:1006`); 後端唯一性 / 非空(`procCore.mjs:1527-1564`); 系統不寫 |
| `name` `email` `description` `redir` | 客戶端 | UI 可編(:1008-1010、:1012); `email` 後端唯一 / 非空(`procCore.mjs:1500-1509`); 系統不寫 |
| `from` | 客戶端(現況) | UI 可編(:1011); 無系統寫入者(同步雛形已移除); 第 113 項起為外部列範圍欄, 後台不可改外部列之 `from`(屆時調整, 見 R-CONC-01 外部同步段) |
| `isAdmin` | 客戶端 | UI checkbox(`LayoutContentUsers.vue:262`); 系統不寫 |
| `timeExpired` | 客戶端 | UI 可編(:305-314); 系統僅讀(登入判斷 `procCore.mjs:350-357`) |
| `isActive` | 客戶端 | UI checkbox(:266); 系統不寫(僅 funNew 預設 'y', `users.mjs:106`); 停用 → 撤銷 tokens(`procCore.mjs:1700-1709`) |
| `timeVerified` | **雙方** | UI 可編(:269-278); 系統寫: S05 `verifyEmail`(`procCore.mjs:952`)、後台建帳自動填(:1608-1614) |
| `timeBlocked` | **雙方** | UI 可編(:341-350); 系統寫: S15 / S16(`procProtect.mjs:198 / 396`) |
| `isForceChangePw` | **雙方**(依方案 v2 §2.2; 見「自行決定」D1) | UI 不顯示且不可編(`tabKeys` 無此欄, :468-487); 系統寫: S07 `'n'`、S08 `'y'`; funNew 預設(`users.mjs:107-109`); 經 API(含 app 權杖)仍可設定, 故不改列伺服器專有 |
| `password` | **伺服器專有**(新增列例外) | 既有列一律保留庫內雜湊(`procCore.mjs:1566-1579`); UI 僅新增列可編(:1007), 既有列改走「重設密碼」; 系統寫 S07 / S08; 新增列採客戶端明文並雜湊(:1598-1607) |
| `tokenVerify` | **伺服器專有** | 系統寫: S04 / S06; UI 不顯示(:468-487); 目前仍隨 `getUsersList` 回傳並被整列存回(`WWebSso.mjs:918` 註解、`procCore.mjs:1581-1582`)→ 缺陷 X2-d; 契約生效後客戶端值被忽略 |
| `userId` `timeCreate` `userIdUpdate` `timeUpdate` | **伺服器專有** | w-serv-orm 稽核戳記(`node_modules/w-serv-orm/src/getMapOrm.mjs:697-778` `adjustData`); UI 唯讀 |

**tokens(8 欄 = 主鍵 1 + 客戶端 5 + 雙方 1 + 伺服器專有 1; 補 `userIdUpdate` 後 9 欄、專有 2)**

| 欄 | 分類 | 判定依據(檔:行) |
|---|---|---|
| `id` | 主鍵 | `src/schema/tables/tokens.mjs:18` |
| `token` | 客戶端 | UI 可編(`LayoutContentTokens.vue:683`); ADR-042 以改寫權杖字串把既有列升為應用系統金鑰(`spec/設計要點與取捨.md` ADR-042); 系統於 S01 產生初值 |
| `userId` | 客戶端(**擁有者語意**, 規格 §3 / §11 明列入 fields) | UI 僅非 app 列可編(:684-698); procOrm insert 會改寫為建立者, 本套件依擁有者分組寫入(`procCore.mjs:1656-1669`, R-ORM-03); 不得被操作者覆寫 |
| `isApp` | 客戶端 | UI checkbox(:170、:879-887); 系統不寫(funNew 為 '', 即 session 列 isApp 為 ''); 亦為 `scope` 判準 |
| `perms` | 客戶端 | UI 權限清單(:172-238); 驗證 `procCore.mjs:2108-2127`; 縮短需前置清空(:1617-1642) |
| `timeCreate` | 客戶端(本表另有語意) | UI 可編(:241-269); w-serv-orm 僅於 insert 戳記, save 不動(`getMapOrm.mjs:729-734`)→ 管理員編輯可留存; 系統僅於 S01 初始化 |
| `timeEnd` | **雙方** | UI 可編(:271-300); 系統寫: S02 `refreshToken`(`procCore.mjs:684-688`)、S01 初值 |
| `timeUpdate` | **伺服器專有** | UI 顯示可編(:301-)但每次 save 由 adjustData 重設為現在(`getMapOrm.mjs:744-766`), 編輯無法留存; 系統寫 S02 → 不入基準、不採用客戶端值 |
| `userIdUpdate`(新增) | 伺服器專有 | 補欄, R-CONC-04 |

**ips(3 欄 = 主鍵 1 + 客戶端 1 + 雙方 1; 補 `userIdUpdate` 後 4 欄)**

| 欄 | 分類 | 判定依據(檔:行) |
|---|---|---|
| `id` | 主鍵 | `src/schema/tables/ips.mjs:16` |
| `ip` | 客戶端 | UI 可編(`LayoutContentIps.vue:512-514`); 系統僅於新增時寫(S17 / S19) |
| `timeBlocked` | **雙方** | UI 可編; 系統寫 S17 / S18(`procProtect.mjs:789 / 817`) |
| `userIdUpdate`(新增) | 伺服器專有 | 補欄, R-CONC-04 |

**寫入契約草案(第二波落檔; 前後端 import 同一檔)**

```js
//src/writeContracts/users.mjs
export default {
    table: 'users', pk: 'id',
    fields: ['account', 'name', 'email', 'description', 'from', 'redir', 'isAdmin', 'timeVerified', 'timeExpired', 'timeBlocked', 'isForceChangePw', 'isActive'],
    serverOnly: ['password', 'tokenVerify', 'userId', 'timeCreate', 'userIdUpdate', 'timeUpdate'],
    orderKey: 'order',
    scope: null,
}
//src/writeContracts/tokens.mjs
export default {
    table: 'tokens', pk: 'id',
    fields: ['token', 'userId', 'isApp', 'perms', 'timeCreate', 'timeEnd'],
    serverOnly: ['timeUpdate', 'userIdUpdate'],
    scope: (r) => r.isApp === 'y', //app 權杖; session 列(isApp 為 '' / 'n')在範圍外, 處置見 R-CONC-03「tokens 雙層」
}
//src/writeContracts/ips.mjs
export default {
    table: 'ips', pk: 'id',
    fields: ['ip', 'timeBlocked'],
    serverOnly: ['userIdUpdate'],
    scope: null,
}
```

**理由**: ①users 的 12 個 `fields` 恰為「後台能改」或「系統會改且後台能改」者, 其中 `timeVerified / timeBlocked / isForceChangePw` 被系統改動後舊畫面存檔即被拒(先動先贏), 否則即缺陷 X2-a/b/c(靜默回寫); ②`password / tokenVerify` 專有: 既有列取庫內值, 修 X2-d; ③`order` 以名次入基準(拖曳重排被偵測, 存檔重編號不誤擋, 規格 §5); ④tokens `userId` 為擁有者故入 fields; `timeUpdate` 專有因編輯無法留存; `timeEnd` 雙方因 S02 會寫; ⑤`scope` 使 session 列的高頻變動(登入、續期、登出隨時發生)不使管理員存檔被誤拒, 並使刪除集合不含載入後才出現的 session(修 E1); ⑥ips 無範圍: 系統自動登錄的新 IP 屬「他人於載入後新增」, 舊畫面存檔即被拒(符合原則; 繁忙系統上 ips 頁較常需重新載入, 見風險).

### R-CONC-03: 整表存檔——表鎖內新鮮讀取、基準比對、刪除集合 = 基準內 − 送出、只寫 fields、不帶基準者沿用既有政策(2026-10-22, 原則 10, 規格 §6 / §8)

**現況(2026-10-23)**: **已套**(`server/procCore.mjs` `updateTabItems` + `parseSaveOpt`; 3 路徑 × 帶 / 不帶基準全數有測試). 與下方規劃不同處: ①不帶基準之 tokens **新增列限應用系統金鑰**(鑄造應用系統金鑰, ADR-084 已接受之能力, `unit-ormWriteFail` A23 守護; 庫內不存在之 session 列一律拒收, 見 R-CONC-06〔2026-10-23 收回, 原「含鑄造使用者 token」〕), 「刪除、修改」限應用系統金鑰列(原規劃「不帶基準者只處理 A 範圍」之字面會使鑄造失效); ②第 4 參數 `{baseline, baselineSession}` 兩者必成對, 且以白名單驗證(`parseSaveOpt`), 不識一律 `saveBaselineFormat`; ③寫入階段任何失敗(含 `rowNotFound`)皆回 `saveWriteFail`(可能已部分寫入); ④通過比對後 `rowsInvalid` 以外之驗證錯誤維持既有語系鍵. 測試: `unit-saveBaseline` SB-U01~U16、SB-I01~I05、SB-T01~T13、SB-S01~S06、SB-C01~C02; `api-concurrency` CC-A-001~021.

**規則(users / ips; tokens 見下「雙層」)**:
1. 全程在表鎖內: `[新鮮讀取 → 驗證依賴庫內之項(account / email 唯一、新增列已存在 `_isNew`) → 比對 → diff → 寫 → 撤銷 tokens → 清快取]`; 驗證階段(現 `procCore.mjs:1441-1615`)內容不變, 只是讀取移入鎖內.
2. **帶 `baseline`**: 格式 / 版本不識 → `baselineFormat`(不得降級為不帶); `compareBaseline(rowsNow∩scope, baseline)` 不符 → `baselineMismatch`, **零寫入**. 通過後: 刪除集合 = 基準內 id − 送出 id; 修改 = 送出列之摘要 ≠ 基準內該列摘要(只看使用者實際動過者, 而非與庫比對); 新增 = 送出之 id 不在庫內且不在基準.
3. **不帶 `baseline`**(app 權杖 / 外部 / 舊前端; 現行 major 沿用既有政策): 刪除集合 = 範圍內庫內全部 − 送出(users / ips 即現行「以外部為主」語意; tokens 限 `scope`, **不再刪 session 列**); 修改 = 送出列與庫內列的 `fields` 摘要不同者; 修改只改不增, 列已不存在 → `rowNotFound`; 不再以整列 `JSON.stringify` 比對(`wsemi/src/ltdtDiffByKey.mjs` 對鍵序敏感且含專有欄).
4. **寫入**: 只寫 `fields`(+`order`); 專有欄取庫內值(新增列例外: `password` 雜湊、funNew 預設); 摘要相同之列不寫(連帶不戳記 `userIdUpdate`, 修 X2-f).
5. 拒收鍵轉語系鍵: `baselineMismatch → saveStale`、`rowNotFound → saveRowNotFound`、`baselineFormat → saveBaselineFormat`(皆提示重新載入; 第二波新增於 `server/procLang.mjs` eng + cht, `unit-lang` 守護).

**tokens 雙層(規格 §3 `scope` 與本產品設計之衝突, 待裁示 T1)**:
- **衝突**: 方案 v2 §3.2 稱「session token 之撤銷維持既有專用路徑」, 但盤點顯示**後台金鑰清單本身就是 session 的管理員撤銷路徑**: 清單列出全部 session 列(`getTokensList` 回全表, `procCore.mjs:2067-2076`), spec `流程_後台金鑰清單.md` E2E-003「勾選金鑰刪除並儲存以撤銷登入」(強制登出特定使用者)與 E2E-002(把 session 列 `isApp` 切為 `y` 即升為應用系統金鑰, ADR-042: 清單無新增列, 新 app 權杖由既有列勾選並改寫權杖字串產生); 其他撤銷路徑只有持有者自己登出(S03)與系統的刪除 / 停用 / 封鎖(S09). 若契約 `scope` 單純限 `isApp==='y'` 並以「基準內 − 送出」為刪除集合, 管理員在清單刪除 session 列將**靜默無效**(列不在基準 → 不被刪), 且 session 列升級路徑失去基準保護——屬功能退化與部分變更.
- **建議(選項 P, 僅用核心純函數, 不改核心)**: 前端依 `scope` 切兩份基準送出: `baseline` = `buildBaseline(app 列, 契約 A: scope=isApp==='y')`(嚴格); `baselineSession` = `buildBaseline(非 app 列, 契約 B: 同 fields、scope=isApp!=='y')`(寬鬆). 後端: A 嚴格比對; B 以 `compareBaseline` 結果取 `added`(忽略, 不刪)、`removed`(他人已撤銷, 忽略並略過該列)、`changed`(系統續期等, 管理員**未編輯**該列〔送出摘要 = 基準摘要〕則略過、**已編輯**則 `baselineMismatch`); 刪除集合 = (A 基準 id ∪ B 基準 id) − 送出 id(僅庫內仍存在者); 升級(送出列 `isApp==='y'` 而庫內為 session)視為該列之編輯, 採用 `fields`; 不帶基準者只處理 A 範圍, session 列不刪、不覆蓋. 此解同時修 E1(載入後新 session 不被刪)、X1(已撤銷之 session 不復活: 送出而庫內不存在且未編輯者略過)、X7(續期後 `timeEnd` 不被舊值蓋回).
- **備選**: ①A: 清單不再顯示 / 不可刪 session 列, 另建管理員撤銷 RPC——違反 spec E2E-001~003 與 UI 行為, e2e 標準圖大量重產; ②B': 基準含全部列——登入 / 續期使管理員存檔常被誤拒, 不可用. 選項 P 之線上格式為對既有 RPC 加選用第 4 參數 `{ baseline, baselineSession }`, 舊前端不送即走不帶基準政策.

### R-CONC-04: 資料列記錄最後修改者之使用者 id; 缺欄補欄; 直寫路徑補填; 擁有者語意不被覆寫(2026-10-22, 原則 10, 規格 §11)

**規則**: 三表皆須有 `userIdUpdate`(伺服器專有)並於**每次寫入**記錄操作者 id(後台存檔 = 操作管理員; app 權杖 = 該 app 使用者 id; 使用者自助流程 = 該使用者 id; 系統計時器 = 固定常數, 見 D7); `tokens.userId` 為擁有者, 不被操作者覆寫.

**現況**: users 有 `userIdUpdate` 但 S05~S08、S15、S16 直呼 `woItems` 不經 `adjustData`, **不更新** `timeUpdate / userIdUpdate`(探測 X2-g); tokens 無 `userIdUpdate`(僅 `userId` 擁有者 / `timeCreate / timeUpdate`); ips 只有 `id / ip / timeBlocked`; `updateTokensList / updateIpsList` 雖算了 `operatorId`(:2144、:2207)卻只用於 `lockSave` 鍵, 呼叫 `updateTabItems` 時未傳(:2130、:2193)→ procOrm 的 userId 為 `''`(探測 p7 輸出 `insert(x) by ` 空).

**現況(2026-10-23)**: **已套**. 實作與下列規劃的差異: ④改為 `procOrm(..., 'insert', rowsAdd, { keepUserId: true })` 單次呼叫(w-serv-orm 1.1.17 `keepUserId`: 列上非空字串 `userId` 保留為擁有者、`userIdUpdate` 恆為操作者; 擁有者為空者以操作者補), 不再依擁有者分組、也不需追加 `save` 補正; ③系統直寫不經 `ormWrite` 而經 `procOrm` + `mustExist`(取得 `adjustData` 戳記與 clearXSS, 副作用: 封鎖寫入失敗之 log 錯誤文字改為核心固定字串). 測試: `SB-S04`(稽核逐站點)、`SB-T01`、`SB-T09`、`SB-I01`~`I03`、`CC-A-002` / `003` / `005`; 變異 M22(拿掉 keepUserId)、M23(不傳 operatorId)、M38(不記 system)、M39(refreshToken 不記擁有者)皆被抓到.

**第二波處置**: ①schema: `src/schema/tables/tokens.mjs`、`ips.mjs` 加 `userIdUpdate`(STRING, 名「最新變更使用者主鍵」, 同 users), `funNew` 不預設(新增時由 procOrm 戳記); ②`updateTokensList / updateIpsList` 傳入 `operatorId`; ③直寫站點改經 `procOrm('save', …, { autoInsert:false })`(w-serv-orm 第 110 項提供)以取得 `adjustData` 戳記與 clearXSS, 或明確帶 `userIdUpdate / timeUpdate`; ④tokens 依擁有者分組 insert(S11)時 `adjustData` 以同一參數同寫 `userId` 與 `userIdUpdate`(=擁有者), 須追加一次 `save({ id, userIdUpdate: operatorId })` 補正, 或請核心提供分離參數(列入對核心之需求); ⑤既有資料**不回填**(`userIdUpdate` 缺值視同空, 規格化摘要中 undefined ≡ '' 且為專有欄不入基準, 無遷移風險). 更新者值: 後台存檔 = 操作者; S05 = 該使用者; S06 / S07 = 該使用者; S08 = 操作管理員; S01 / S02 = token 擁有者; 計時器與自動封鎖(S15~S19)= 常數 `'system'`(D7).

### R-CONC-05: 前端以 `buildBaseline` 對畫面所見之列自算基準, 不另向後端取; 不改 RPC 回傳形狀; 存檔被拒保留草稿(2026-10-22, 原則 10, 規格 §8)

**現況(2026-10-23)**: **已套**. 前端共用工具 `src/baselineOf.mjs`(`baselineOfUsers / baselineOfIps / baselineOfTokens / isSameSnapshot`); 三頁載入時自算基準、存檔送第 4 參數、成功後重新取清單: users 沿用既有「重拉並取代畫面」, tokens / ips 新增重拉——**送出列與伺服端列契約摘要全相同者保留現畫面**(既有標準圖零重產; 否則下次存檔畫面與基準不同快照), 不同者取代; 重拉失敗基準置 null(其後存檔被拒). 純函數以 `w-serv-orm/src/baseline.mjs` 深層匯入, `vue-cli-service build` 通過、**不需** `transpileDependencies`(T2 ④ 核對: 語法限 ES2017 以內且零 import). 測試: `unit-writeContract` WC-05~WC-08; `api-concurrency` CC-A-015(V10 真傳輸); `e2e-concurrency` E2E-CC-001~003(舊畫面存檔被拒、草稿保留、重新載入後成功、連續第二次成功).

**接點(第二波)**:
- `src/components/LayoutContentUsers.vue`: 載入 `mounted` 之 `getUsersList().then`(:573-579)——於 `sortBy / vo.users = res` **之前**對 `cloneDeep(res)` 算 `vo.baseline`; 存檔 `saveUsers` 之 `updateUsersList(token, lang, rows)`(:1554)改傳第 4 參數 `{ baseline: vo.baseline }`; 存檔成功後既有「重拉 `getUsersList`」(:1573-1578)同步重算 `vo.baseline`.
- `LayoutContentTokens.vue`: 載入(:490-496)算 `baseline` / `baselineSession`(選項 P); 存檔(:1123)傳入. **現況存檔成功後不重拉清單**, 基準會過期 → 比照 users 加存檔後重拉並重算(顯示列與基準來自同一快照, 規格 §8), 會使 timeUpdate 等伺服器欄位刷新為新值——屬 e2e-tokens 標準圖可能變動範圍(見 W2-6).
- `LayoutContentIps.vue`: 載入(:329-335)、存檔(:769)同上.
- 契約與純函數: `src/writeContracts/*.mjs` 前後端同一檔; 純函數自 `w-serv-orm` 子路徑匯入(零 import, 前後端同構); 前端由 vue-cli(webpack)打包——`vue.config.js` 目前無 `transpileDependencies`, 若純函數含 `??` / `?.` / BigInt 字面量等舊瀏覽器清單(`> 1%, last 2 versions`)不支援之語法須加入, 屬建置設定變更(共用基礎, 擴大 e2e 範圍).
- 後端 `WWebSso.mjs:1264 / 1284 / 1303` 三個 kpfun 加選用第 4 參數 `opt`(只接受純物件; `baseline` 型別 / 內容由核心驗證, 不識 → `baselineFormat`); 舊前端不送 → 不帶基準政策.
- 草稿保護: sso 後台頁無推播與輪詢重建(`tableNamesSync: []`, 頁面無廣播訂閱), V11 不適用; 存檔被拒時現行流程已「顯示 modal、保留草稿、不清 `isModified`」(`LayoutContentUsers.vue:1559-1569`), 只需新增三個語系鍵並使訊息提示重新載入.

### R-CONC-06: 金鑰清單存檔(`updateTabItems` tokens 路徑)不得新增庫內不存在之 session 列(`isApp !== 'y'`), 不論帶不帶基準; 整次拒收、固定語系鍵(2026-10-23, sso-run03, ADR-092, 原則 3 / 8)

**現況(2026-10-23)**: **已套**. 來源: 獨立實操確認 `sso-verify01` 註記 1——外部應用以具 `writeTokens` 之 app 權杖直呼 `updateTokensList`、不帶基準, 可把已撤銷(登出或自動封鎖)之 session 列送回而使其復活, 繞過自動封鎖(X1 殘留面; run01 原記為已知限制). 主控判定: session 權杖只由登入產生, 後台清單本就無新增 session 列之入口(ADR-042).

**規則**:
1. 守門位置: `server/procCore.mjs` `updateTabItems` 寫入回呼, 表鎖內、`saveNewRowExists` 之後、perms 驗證與 diff 之前. 判準: 送出列 `get(row,'isApp','') !== 'y'` ∧ 庫內(鎖內新鮮讀取)不存在 ∧ 不在 `baseline` / `baselineSession` 內 → `Promise.reject('tokenSessionAddNotAllowed')`(整次拒收、零寫入、同批合法變更亦不寫; eng + cht 固定文字「不可新增登入權杖」, 不回顯值; 並 `srLog.warn`〔`fun-updateTabItems-reject`, 帶該 key〕).
2. 豁免: 帶基準而該列在 `baselineSession` 內者不屬新增(載入時尚在、其後被撤銷): 管理員未動者照舊略過(不復活、不拒收——否則載入後被登出者使正常存檔被拒, 破壞選項 P 與 X1 略過語意), 已動者照舊 `saveStale`.
3. 不變: 應用系統金鑰列(`isApp === 'y'`)之新增(帶 / 不帶基準, 含擁有者保留)、管理員(帶基準)對既有 session 列之刪除與升級為應用系統金鑰、不帶基準時 session 列不刪不覆蓋(D3).
4. 收回之能力: 經清單「鑄造使用者 token(session 列)」(原 A23 斷言可行)——只收回、不放寬.

**盤點指令**: `rg "tokenSessionAddNotAllowed" server` → 3 行(`procCore.mjs` 守門之 `srLog.warn` 與 `Promise.reject` 各 1、`procLang.mjs` 語系鍵 1〔含 eng + cht〕); 測試端 `rg "tokenSessionAddNotAllowed" test` 須含 `unit-saveBaseline`(SB-T16~T18)、`api-concurrency`(CC-A-022~024)、`unit-ormWriteFail`(A23). 判準只認 `isApp === 'y'` 為應用系統金鑰列(與 `updateTabItems` 內 `isApp(r)` 及契約 `scope` 一致).

**站點全集與判準**: 清單存檔寫入新 tokens 列之路徑僅 `updateTabItems`(`checkTokenAndUpdateTokensList` → `updateTokensList` → `updateTabItems('tokens')`; 無其他經清單新增 tokens 之入口; 系統側 `createToken`〔登入〕為 session 列唯一合法來源, 不經清單, 不受影響).

| 路徑 | 判準 | 狀態 | 測試 |
|---|---|---|---|
| 不帶基準 + 已撤銷 session 列 | 拒收 | 已套 | SB-T16、CC-A-022 |
| 帶基準 + 基準外之已撤銷 session 列 | 拒收 | 已套 | SB-T17(前段)、CC-A-023 |
| 帶基準 + 基準內、管理員未動、已被撤銷之 session 列 | 略過(不拒收、不復活) | 已套(刻意不套守門) | SB-T17(後段)、SB-T03、CC-A-011 |
| `isApp` 為 `'n'` / `''` / 缺欄 / `'Y'` / `'yes'` | 皆視為 session 列 → 拒收(帶 / 不帶基準) | 已套 | SB-T18 |
| 同批混入新 app 列與新 session 列 | 整批拒收、新 app 列亦不寫 | 已套 | SB-T18、CC-A-024 |
| 應用系統金鑰列新增(帶 / 不帶基準)、session 刪除(帶基準)、session 升級 | 照常 | 刻意不套 | SB-T19、SB-T07、SB-T09、SB-T10、CC-A-021、CC-A-024、PERM-A-008 |
| 觀察: 送回已撤銷 session 列並把 `isApp` 改為 `'y'` | 成為應用系統金鑰, 屬 `writeTokens` 持有者既有鑄造能力(ADR-042 / ADR-069 信任邊界, 等同管理者), 未增加權限 | 刻意不套 | 決策 `sso-run03`(`decisions.tsv`) |

**測試與修前紅 / 修後綠**: `unit-saveBaseline` SB-T16~T19(修前版 SB-T16~T18 紅、T19 對照綠; 修後全綠)、`api-concurrency` CC-A-022~024(修前版 3 / 3 紅——三案皆 `ok:true`, 即已撤銷列被寫回、新 session 列被接受; 修後 24 / 24 綠). 修前版 API 層取得方式: 單一取鎖期間暫時換入修改前之 `server/procCore.mjs`、`procLang.mjs`(複本 sha256 回驗, 結束必還原並以 sha256 回驗相符), 跑 CC-A-022~024 後還原再跑回歸. 變異驗證: `tmp/sso-run03/mutate.mjs`(歸檔 `agent-out/sso-run03-probes/`)12 項全數被抓到、對照組全綠: 拿掉守門 M01、不豁免基準內 M02 / M09、只管帶基準 M03、只管不帶基準 M04、判準改 `=== 'n'` M05、不看庫內已存在 M06、拒收鍵非專用鍵 M07、只檢查第一列 M08、cht 文字缺 M10、不記 log key M11、未限 tokens 路徑 M12.

**改動範圍 → 測試檔**: 同本冊「改動範圍 → 測試檔」第 1 列(`updateTabItems`): 本輪跑 unit 全部(330)、api 7 檔(`api-concurrency`、`api-apptoken-perms`、`api-ormopts`、`api-doubleclick`、`api-httpendpoints`、`api-adduser`、`api-deleteuser`)、e2e `e2e-tokens`、`e2e-concurrency`(UI 不變、標準圖 0 張改變); 其餘 e2e 與本改動無執行路徑關聯(未改 `src/`), 留待全套.

## 現存缺陷實證(inv01, 2026-10-22; 腳本與輸出全文見下方「重現法」)

探測以真實 `procCore` / `procProtect` 工廠 + 真實 w-serv-orm + w-orm-lmdb(暫存於 `./tmp/inv01/dbs/<名>`)進行, 管理員動作走 `checkTokenAndUpdate*List`(同 kpfun 路徑), 系統動作走真實入口(`verifyEmail`、`createUser`、`refreshToken`、`logoutByToken`、`pp.loginByAccountAndPassword` 連續失敗觸發自動封鎖等). 全部 9 支、21 個判定: **RED 19 / GREEN 2(對照組)**.

| 編號 | 缺陷 | 探測 | 結果 | 程式位置 | 修於 |
|---|---|---|---|---|---|
| **E1** | 管理員存權杖清單時, 載入後才登入之 session token 被刪(使用者被登出) | `p1-e1-session-deleted.mjs` | RED: u2 登入後 token 有效, 管理員存舊清單(只改 app 權杖權限)後 `checkToken` = `tokenExpired`; 對照組(管理員所見之 u1 session 與 app 權杖)仍在 | 刪除集合 = 庫內全部 − 送出(`procCore.mjs:1512、:1582、:1650`) | R-CONC-03 |
| X1 | 載入後被登出 / 被自動封鎖撤銷之 session token 於管理員存舊清單時**復活**(被當新增列重新寫入, 到期時間為原值)——**撤銷被繞過** | `p2-revoked-token-resurrect.mjs` | RED×2: u1 登出後 token 復活為 valid; u2 被自動封鎖(timeBlocked 有值)並撤銷後 token 復活為 valid | 送出而庫內不存在 → `r.add`(`:1582`)→ `procOrm insert`(:1668) | R-CONC-03(選項 P) |
| X2 | 管理員存舊使用者清單時, 所有「與庫內不同」之列被整列以舊值寫回: `timeVerified`(驗證信已點 → 變回未驗證, 無法登入)、`timeBlocked`(自動封鎖被解除)、`isForceChangePw`(重設密碼後之強制變更旗標被蓋回 'n')、`tokenVerify`(重寄驗證信之新連結失效); 且管理員未動之列被標為管理員最後修改 | `p3-users-stale-revert.mjs` | RED×6(a 驗證時間、b 封鎖、c 強制變更旗標、d tokenVerify、f 稽核污染、g 系統直寫不更新 timeUpdate/userIdUpdate); GREEN×1(e: password 已受保護); 後果: u1 登入得 `userRegistrationNotVerified` | `ltdtDiffByKey`(整列 JSON.stringify)+ 整列 save(`procCore.mjs:1581-1582、:1681`); 專有欄保護只有 password(:1566-1579) | R-CONC-02 / 03 |
| X3 | 載入後才出現之使用者(自助註冊、他位管理員新增)於管理員存舊清單時被刪除 | `p4-users-new-rows-deleted.mjs` | RED×2: newbie、byB 皆被刪 | 同 E1(users) | R-CONC-03 |
| X4 | ips: 載入後系統自動登錄之新 IP 被刪; 系統封鎖之 IP 的 `timeBlocked` 被舊值蓋回(解除封鎖) | `p5-ips-stale.mjs` | RED×2 | 同 E1 / X2(ips) | R-CONC-03 |
| X5 | 系統直寫以 `save` 預設 `autoInsert=true`: 讀到列後該列被刪, 寫入時把**只含被寫欄位之殘缺列**新增回庫, 並回報成功; 殘缺 users 列(email 空)使管理員正常存檔被擋 `userEmailEmpty` | `p6-stub-row-resurrect.mjs`(select 後人為暫停, 同 V14 作法) | RED×3: (a) refreshToken 回報續期成功且庫內多一筆缺 token / userId 之殘缺列; (b) verifyEmail 回成功且庫內多 `{id,timeVerified}` 殘缺列; (c) 原樣存回清單被拒 | S02、S05~S08、S15、S16、S18(直呼 `save` 無 `autoInsert:false`) | R-CONC-01 |
| X6 | 不同管理員之清單儲存不互斥(`lockSave` 鍵為 `${op}:${operatorId}`), 讀 / 寫可交錯, 結果不等於任何串行順序 | `p7-no-table-lock.mjs` | RED: 事件序 `read(a) → read(a) → insert(x) → insert(y)`, 最終 `{a,x,y}` ∉ 串行結果 `{a,y}`/`{a,x}` | `server/lockSave.mjs:28`; `procCore.mjs:2052、2147、2210` | R-CONC-01 |
| X7 | 載入後被續期(`refreshToken` 延長 `timeEnd`)之 session, 管理員存檔時 `timeEnd` 被舊值蓋回(提早到期) | `p8-token-timeend-revert.mjs` | RED: 續期後 00:48 → 存檔後回到 23:13 | 同 X2(tokens 整列 save) | R-CONC-03(選項 P) |
| X8 | 自助註冊與管理員清單新增同帳號可同時成功, 產生重複帳號(全域唯一被破壞) | `p9-createuser-vs-admin-add.mjs` | RED: `account=dup` 共 2 列 | `createUser` 鎖(`cst` 鍵 `createUser:account:*`)與清單儲存鎖(`lockSave`)鍵空間不同(`procCore.mjs:852` vs `:2052`) | R-CONC-01(S04 入 users 鎖) |

**未實證之分析項(不作缺陷宣稱, 第二波以 V14 型人為延遲測試驗證)**:
- 登入 vs 停用 / 刪除交錯: `loginByAccountAndPassword` 查使用者(:329)→ 驗密碼(CPU 密集)→ `createToken`(:364、:411)與 `updateTabItems` 之撤銷(:1695-1709)無互斥, 可能在撤銷後鑄出屬於已停用使用者之 token(帶 `fun` 之權限閘因 `getGenUserByUserId` 只查 `isActive:'y'` 而拒絕, 單純 `checkToken` 不拒). 處置(第二波): 登入於 tokens 鎖內重讀使用者狀態再 insert, 驗密碼維持鎖外.
- `ltdtDiffByKey` 以 `JSON.stringify` 比整列, 對鍵序敏感; 庫內列缺鍵(舊資料)者每次存檔皆視為 diff 而被重寫並戳記. 未取得實例證據, 契約改以 `fields` 摘要比對後自然消除.

**重現法**: 探測腳本於本輪結束時已自 `./tmp/inv01/` 清理, 全套留存於 `C:\opensrcOper\dnow\20261022221854\agent-out\sso-inv01-probes\`(`lib.mjs`、`p1`~`p9`、`runAll.mjs`、輸出 `probes-output.txt`、`splitSgud.mjs`〔sgud 整理腳本〕); 重跑: 將該夾複製為本 repo 之 `./tmp/inv01/`(腳本以相對路徑 `../../server`、`../../src`、`../../test/tools` 引用, 層級須相同)後 `node ./tmp/inv01/runAll.mjs`. 腳本只唯讀引用 `server/`、`src/schema/`、`test/tools/unitProc.mjs`, 寫入僅限 `./tmp/inv01/`(DB 於 `./tmp/inv01/dbs/`). 修好後同組腳本應全 GREEN, 並轉為第二波測試(對應見 W2-5).

## 第二波實作規劃(待 w-serv-orm 第 110 項發布; 屆時依其實際 API 定稿)

### W2-1 改動站點清單(檔:行為盤點時行號, 以 Grep 重定位)

| 檔 | 改動 |
|---|---|
| `src/writeContracts/{users,tokens,ips}.mjs`(新) | 寫入契約(R-CONC-02) |
| `src/schema/tables/tokens.mjs`、`ips.mjs` | 補 `userIdUpdate`(R-CONC-04) |
| `server/procLang.mjs` | 新增 `saveStale`、`saveRowNotFound`、`saveBaselineFormat`(eng + cht) |
| `server/WWebSso.mjs:460-466、543-558` | 取 `withTabLocks / guardWrite` 並傳入 `procCore / procProtect` |
| `server/WWebSso.mjs:1264、1284、1303` | 三個 kpfun 加選用第 4 參數 `opt` |
| `server/procCore.mjs:411(S01)、:684(S02)、:746(S03)、:888(S04)、:952(S05)、:1027(S06)、:1185(S07)、:1322(S08)、:1403(S09)` | 各自包入表鎖; 系統直寫改只改不增 + 補更新者; S09 拆持鎖版 |
| `procCore.mjs:1419-1733`(`updateTabItems`) | 重寫為鎖內「讀 → 驗證 → 比對 → diff(fields 摘要)→ 寫 → 撤銷」; 刪除集合 / tokens 雙層(R-CONC-03); `operatorId` 由 `updateTokensList(:2101)`、`updateIpsList(:2190)` 傳入 |
| `procCore.mjs:2004-2060、2137-2154、2200-2217`(三個 `checkTokenAndUpdate*`) | `lockSave` 保留於外層(雙擊防護, `saveInProgress`); 傳 `opt.baseline` |
| `server/procProtect.mjs:198(S15)、:396(S16)、:789(S17)、:817(S18)、:915(S19)` | 取表鎖; S15 / S16 以 `[tokens, users]` 鎖同鎖完成「重讀是否已封鎖 → 寫 timeBlocked → 撤銷 tokens」; ips 取 ips 鎖; 更新者 `'system'` |
| `src/components/LayoutContentUsers.vue、LayoutContentTokens.vue、LayoutContentIps.vue` | 基準自算與送出(R-CONC-05); tokens / ips 存檔後重拉 |
| `README.md`(Upgrade Notes) | 新第 4 參數、舊前端不送者走不帶基準、已開啟之舊頁不受保護 |

### W2-2 鎖之設計

- 每表一鍵: `users` / `tokens` / `ips`; 實例為 `WServOrm` 回傳之 `withTabLocks`(單一行程、同表同一 ORM 實例, 規格 §12).
- 取鎖層次(由外到內): `lockSave`(雙擊, 同操作者)/ `kmx`(使用者鍵)/ `cst.setWithFree`(S04 唯一性)→ **表鎖** → ORM 呼叫. 持表鎖之程式碼不得呼叫上述外層鎖(現無此情形; 以 `unit-tablock` 站點案例守護).
- 多表: 凡 users 寫入後須撤銷 tokens 者——`updateTabItems('users')`(刪除 / 停用)、S15 / S16、第 113 項匯入刪除——一律 `withTabLocks(['tokens','users'])`(碼元序)一次取兩鎖, 內部呼叫「持鎖版」`revokeTokensByUserIdLocked`; 公開的 `revokeTokensByUserId` 只取 tokens 鎖. 登入(S01)只取 tokens 鎖, 不取 users 鎖(讀 users 不需鎖; 狀態重讀於 tokens 鎖內).
- 不可重入防線: `revokeTokensByUserId` 之兩版並存、`updateTabItems` 內部不呼叫會自取鎖之公開函式; 以 `unit-tablock` 之「持鎖時呼叫各公開函式不死鎖」案例守護.
- 預期影響: 登入每次多一次短暫 tokens 鎖(僅 insert 期間); 驗證密碼(CPU 密集)維持鎖外.

### W2-3 前端自算基準接點與 `userIdUpdate` 補欄

見 R-CONC-05 與 R-CONC-04. 補欄不需資料遷移(LMDB 為無綱要文件, 讀取端缺鍵視為空; 專有欄不入基準).

### W2-4 與第 113 項(外部匯入)銜接

- 匯入取 users 鎖(不帶基準, 規格《外部匯入》§6); 刪除外部列時同鎖撤銷 tokens(`[tokens, users]`).
- 契約屆時加入 `srcKey`(外部擁有身分欄), 並依「外部擁有 / 外部可選 / 本系統擁有」再分欄: 本系統擁有(匯入一律不寫): `password、tokenVerify、timeBlocked、timeVerified、isForceChangePw`(皆已在上表為雙方 / 專有)、權杖; `isAdmin、isActive、redir、timeExpired` 是否屬外部由第 113 項設計時定.
- 本輪的不帶基準整表存檔(app 權杖)保持相容; 第 113 項落地後, 建議把 app 權杖的「刪光清單外使用者」用途導向匯入管道(待主控決定, 非本輪).

### W2-5 V1~V14 逐條對應之測試計畫(檔名依 `api-` / `unit-` / `e2e-` 前綴)

新增檔: `test/unit-writeContract.test.mjs`(契約完整性、摘要穩定性、`scope` 行為)、`test/unit-tablock.test.mjs`(表鎖與交錯, 以 `mkTable` 加延遲 / latch)、`test/api-concurrency.test.mjs`(真後端, 經 `WServHapiClient`)、`test/e2e-concurrency.test.mjs`(兩個瀏覽器脈絡; 語意斷言為主, 標準圖僅「被拒 modal」階段, 需使用者授權產製).

| # | sso 之適配 | 測試(檔: 案) | 層 |
|---|---|---|---|
| V1 | 三表各: A、B 載入, A 存, B 舊基準存 → `saveStale`、DB 與 A 存後快照逐列相同(零寫入)、前端草稿仍在(儲存鈕仍顯示、modal 提示重新載入) | `api-concurrency`: CC-A-001(users)/002(tokens, app 列)/003(ips); `e2e-concurrency`: CC-E-001~003(雙語系) | api + e2e |
| V2 | sso 無「未帶 id 之同步」(`ds.*.funNew` 僅 `createUser / createToken / ipDetectNew` 產 id; `updateTabItems` 要求 id): 適配為「不帶基準無變更重送」零寫入、`userIdUpdate / timeUpdate` 不變、管理員舊基準仍可存. 第 113 項落地後補 I1(同 `srcKey` 重送) | `api-concurrency`: CC-A-004 | api |
| V3 | app 權杖(writeUsers)改一列 → 管理員舊基準被拒 | CC-A-005 | api |
| V4 | 真實自動封鎖(連續登入失敗)→ users 舊基準被拒; 計時器 `blockIpByIp` → ips 舊基準被拒; app 權杖 `refreshToken` 延長 → tokens 舊基準(app 列)被拒 | CC-A-006(三表) | api |
| V5 | `resendVerifyEmail` / `changeUserPassword` 後管理員舊基準可存, 且 `tokenVerify` / `password` 維持系統所寫值(`isForceChangePw` 於 'n'→'n' 不變, 不誤擋) | CC-A-007 | api |
| V6 | 不帶基準修改已刪列 → `saveRowNotFound`、不復活; 系統直寫對已刪列(`verifyEmail`、`refreshToken`、`blockAccount`)→ 拒絕且無殘缺列(X5) | `unit-tablock`: SITE-ROWGONE-S02/S05/S15/S16/S18; `api-concurrency`: CC-A-008 | unit + api |
| V7 | `logoutByToken` 重複 → `invalid token`(既有鍵); 帶基準而 app 列已被刪 → `saveStale`; 不帶基準刪除未命中: 範圍內以「庫內 − 送出」計, 已不存在者天然不在集合; session 已撤銷者依 T1 決議(選項 P: 忽略) | CC-A-009; `unit-tablock` | api + unit |
| V8 | E1(載入後新 session 不被刪且仍有效)、X3(載入後新使用者不被刪: 帶基準即整次拒收, 列仍在)、X4(ips 同)、X1(已撤銷 session 不復活) | CC-A-010~013(對應 p1~p5 轉綠) | api |
| V9 | users 他人拖曳重排 → 舊基準被拒; 存檔重編號(`order` 值變而名次同)→ 舊基準可存 | `unit-writeContract`(摘要與名次); CC-A-014 | unit + api |
| V10 | 三表: 經 `WServHapiClient` 取清單 → Node 端 `buildBaseline` = 伺服端新鮮讀取所算(含 users 缺欄 / null、tokens `perms` 陣列 / null / 缺、ips 缺 `timeBlocked`); e2e 以 `page.evaluate` 讀頁面 `baseline` 與 Node 端以 DB 重算相等(瀏覽器 ↔ Node 同構) | CC-A-015; CC-E-004 | api + e2e |
| V11 | **不適用**(無推播 / 輪詢重建: `tableNamesSync: []`, 頁面無廣播訂閱); 以盤點指令 R-CONC-01 第 4 條與 `rg "broadcast|onBroadcast|setInterval" src/components/LayoutContent*.vue` 空結果守護 | — | 盤點 |
| V12 | 多列提交中一列庫內已被改 → 整次拒收, 其餘列零寫入 | CC-A-016 | api |
| V13 | 非陣列 / 字串 / `[[id,'h9:x']]` / 重複 id / 缺 id / 過長 → `saveBaselineFormat`, 不降級(DB 不變) | CC-A-017 | api |
| V14 | 人為延遲: A 讀後暫停, B(另一管理員存檔 / 系統直寫)嘗試寫 → B 等待至 A 完成; **19 站點逐一**「他人持表鎖時該站點等待、不先寫」(SITE-LOCK-S01~S19)及「持鎖不死鎖」案例 | `unit-tablock` | unit |

### W2-6 預估影響之既有測試

- `test/tools/unitProc.mjs`: `mkOpt / buildProc / buildProtect` 增注入 `withTabLocks`(真 w-serv-orm 或替身); `mkTable` 增 `autoInsert:false` 與 save 未命中語意、可注入延遲 / latch; `mkProcOrm` 對應核心新選項(共用基礎, 改動後 unit 全跑).
- `unit-ormWriteFail`(41 案: D1~D4、A1~A23、B1~B8、C1~C3b): A / B / C 系列依賴寫入順序與 `mkTable.log` 之寫入內容——寫入改為只寫 `fields` 後 `log.save` 之內容變; B1~B8 系統直寫改只改不增; C1~C3b 封鎖寫入改取表鎖. 估計(未逐案驗證)半數以上案例需改期望值或簽名.
- `unit-iterClientObj`、`unit-queryKey`、`unit-register`、`unit-countKeys`、`unit-protectTimers`、`unit-sourceIp`: 僅 `buildProc / buildProtect` 簽名更新.
- `api-doubleclick`(DC-01~08): `saveInProgress` 不變; `saveNewRowExists` 在不帶基準路徑保留, 帶基準路徑改由基準不符拒收——須補一案確認兩路徑皆擋.
- `api-adduser`(13)、`api-deleteuser`(3)、`api-apptoken-perms`(7, PERM-A-001 讀回、PERM-A-008 鑄造擁有者)、`api-ormopts`(8)、`api-httpendpoints`(12, 對外 verify / refresh / logout 端點): 預期語意不變, 需跑; `api-apptoken-perms`(:190-433)、`api-ormopts`(:162、:171)、`api-doubleclick` DC-07 以管理員 / app 權杖不帶基準直呼 `updateTokensList`——不帶基準之刪除集合改限 app 範圍、整列寫入改只寫 `fields`, 依賴「以此刪 session 列」或「整列覆寫專有欄位」者須逐案核對(本輪未逐案讀; e2e-tokens E2E-003 為 UI 路徑, 屬選項 P 涵蓋).
- e2e: 見 W2-7.

### W2-7 改動範圍 → e2e 檔對照(全域守則第 12 條所需; 與「spec → 測試檔對照」互補)

| 改動範圍 | 須跑之 e2e |
|---|---|
| `updateTabItems` users 路徑、`LayoutContentUsers.vue` | `e2e-adduser`、`e2e-modifyuser`、`e2e-deleteuser` |
| tokens 路徑、`LayoutContentTokens.vue`(含存檔後重拉) | `e2e-tokens`(14 案 × 2 語系, 標準圖可能因重拉刷新 timeUpdate 等而變) |
| ips 路徑、`LayoutContentIps.vue` | `e2e-ips` |
| S15 / S16 / S17 / S18 / S19(`procProtect`) | `e2e-autoblock`(含 33s / 12s 到期等待) |
| S04、S05(註冊、驗證) | `e2e-register`、`e2e-login` |
| S06~S08(改密碼、重設密碼) | `e2e-changepassword`、`e2e-resetpassword` |
| S01~S03(登入、續期、登出) | `e2e-login`、`e2e-logout`、`e2e-autologin` |
| `procLang.mjs` 新語系鍵 | `unit-lang` + 觸發新訊息之 e2e(雙語系) |
| 共用基礎(`test/tools/e2e-setup.mjs`、`vue.config.js` 加 `transpileDependencies`、前端新增打包依賴、w-component-vue / w-package-tools-e2e 升版) | 全部 14 檔 |

e2e 全套約 100 分鐘, 依守則第 12 條只在最末輪由主控於凍結碼跑; 第二波各輪只跑上表對應檔. 新增 `e2e-concurrency` 之標準圖與 `e2e-tokens / e2e-ips` 若需重產, 先取得使用者授權.

### W2-8 實施順序(第二波)

1. w-serv-orm 第 110 項發布 → 升版 → 以其實際 API 定稿本規劃(尤其 `guardWrite` 簽名、procOrm `autoInsert:false` / 刪除未命中選項、`compareBaseline` 回傳 id 集合).
2. schema 補欄 + 契約檔 + 語系鍵 + `unit-writeContract`.
3. 後端: 全 19 站點取表鎖與只改不增 → `updateTabItems` 重寫 → kpfun 第 4 參數 → `unit-tablock` / `unit-ormWriteFail` 更新.
4. 前端三頁基準 → `api-concurrency` → `e2e-concurrency` → 受影響 e2e.
5. 探測腳本 p1~p9 改寫為上列測試並確認「修前紅、修後綠」; README Upgrade Notes.

## 待裁示與依原則自行決定

**待裁示(主控 / 使用者)**:
- **T1(必須, 影響第二波契約)**: tokens 清單 session 列之處置——建議選項 P(R-CONC-03「tokens 雙層」: 兩份基準 + 寬鬆 session 層)以保留 spec E2E-001~003 之管理員撤銷 / 升級功能; 備選 A(移除 session 列的編輯與刪除, 另建撤銷 RPC)、B'(全表基準, 不可用). 此項偏離方案 v2 §3.2「session token 之撤銷維持既有專用路徑」之字面, 因該專用路徑實際不存在.
- **T2(對核心之需求, 請主控轉 opensrcOper / 第 110 項)**: ①procOrm 在 insert 分組寫入擁有者時, `userId`(擁有者)與 `userIdUpdate`(操作者)須可分別指定; ②`compareBaseline` 回傳之 `added / removed / changed` 須為 id 陣列(選項 P 需要); ③`guardWrite` 之 `write` 回呼須可在持鎖下呼叫 sso 內部函式(不可重入由呼叫端保證)、且允許 `tables` 為多表; ④純函數子模組須能被 vue-cli 5(webpack 5, 無 `transpileDependencies`)直接打包, 或明載語法層級; ⑤`buildBaseline` 排序規則須定義非數值 `order`(sso 自助註冊新增之 users 列 `order` 為 `''`, 實測 `ds.users.funNew()` 輸出 `"order":""`)之位置——建議視為 +∞(排在全部有數值者之後, 其間依 pk 碼元), 且瀏覽器與 Node 一致.
- **T3(低)**: 第二波可否順手停止 `getUsersList` 回傳 `tokenVerify`(契約生效後前端不再需要整列存回它; 屬憑證類欄位硬化, 與 R-SEC-01 精神一致, 但改變 RPC 回傳形狀, 與規格「不改 RPC 回傳形狀」字面有出入, 故不自行決定).

**依原則自行決定(皆已記入 `decisions.tsv`, phase `sso-inv01`)**:
- D1 欄位分類: `isForceChangePw`、`timeVerified`、`timeBlocked`、`timeEnd` 列雙方; `tokens.timeCreate` 列客戶端(UI 可編且 save 不改寫); `tokens.timeUpdate` 與 users 稽核欄列伺服器專有; `password` 列專有(新增列例外).
- D2 全部 19 個站點皆取該表表鎖(含 insert-only 的 S01、S17、S19 與伺服器專有的 S06), 以滿足 V14「比對與寫入間不得插入任何他人寫入」並免逐站點判斷.
- D3 不帶基準之 tokens 整表存檔: 刪除集合限 `scope`(app 列), 不再刪 session 列.
- D4 `createUser`(S04)納入 users 表鎖(唯一性檢查與 insert 同鎖), 修 X8.
- D5 系統直寫改經 procOrm 的「只改不增」選項(待核心 API), 以同時取得稽核戳記.
- D6 `userIdUpdate` 補欄不回填既有資料.
- D7 無使用者可歸屬之系統寫入(計時器、自動封鎖)的 `userIdUpdate` 記常數 `'system'`; 使用者自助流程記該使用者 id; 管理員流程記操作者.
- D8 tokens / ips 存檔成功後重拉清單並重算基準(同 users 既有作法, 基準與畫面來自同一快照).
- D9 V2 / V7 / V11 對 sso 之適配(見 W2-5).
- D10 users 寫入後撤銷 tokens 於同一組 `[tokens, users]` 鎖內完成.
- D11 `lockSave` 保留於外層作雙擊防護, 表鎖在內層.
- D12 完整性守護: 以 `unit-writeContract` 自動核對「每表每欄皆已分類」.

**風險 / 提醒**: ①ips 頁在繁忙系統因計時器每 2 秒登錄新 IP, 舊畫面存檔較常被拒(符合原則; 使用者需重新載入); ②已開啟之舊版頁面於升級後不帶基準, 不受保護直到重新載入(README 載明); ③tokens / ips 存檔後重拉會使 e2e-tokens / e2e-ips 標準圖可能變動, 需先取得授權再重產; ④第二波完成前, 本冊 R-CONC-01~05 皆為「規劃」, 不得當作現況引用(**2026-10-23 第二波完成後, 以上各條之現況見其「現況(2026-10-23)」段與下節〈第二波實作結果〉; 本段之「③ 標準圖可能變動」已由『保留現畫面』設計避免, 見 R-CONC-05**).


## 第二波實作結果(sso-run01, 2026-10-23; 依 w-serv-orm 1.1.17)

### V1~V14 對應與結果

| # | 情境 | 測試(檔: 案) | 結果 |
|---|---|---|---|
| V1 | 舊基準存檔整次拒收、零寫入、草稿保留、提示重新載入 | `unit-saveBaseline`: SB-U01、SB-I01、SB-T01; `api-concurrency`: CC-A-001~003; `e2e-concurrency`: E2E-CC-001~003(UI: 被拒 modal、草稿保留、重新載入後重存成功) | 已證 |
| V2 | 重送內容不變之同步 → 零寫入 | sso 無「未帶 id 之同步」, 適配為不帶基準無變更重送零寫入且先前基準仍可存: `api-concurrency` CC-A-004; 第 113 項落地後補 I1(同 `srcKey` 重送) | 已證(適配) |
| V3 | 外部改內容 → 舊基準被拒 | CC-A-005(app 權杖 writeUsers) | 已證 |
| V4 | 系統直寫雙方欄位後舊基準被拒 | SB-U05(驗證信)、SB-U06(自動封鎖)、SB-U08(重設密碼)、SB-I03(IP 封鎖)、SB-T11(app 權杖續期)、CC-A-006(真實自動封鎖與續期) | 已證 |
| V5 | 系統寫伺服器專有欄位後管理員可存、該欄維持系統所寫之值 | SB-U07、SB-U09、CC-A-007、CC-A-018 | 已證 |
| V6 | 修改時該列已被刪 → 拒絕、不復活 | 系統直寫: SB-S01~S03、SB-U16、CC-A-008; 帶基準之清單存檔: 整表比對得 `saveStale`(SB-U04、SB-I04) | 已證 |
| V7 | 刪除已不存在之列 | SB-U04、SB-I04、SB-T06(session 冪等)、CC-A-009(重複登出沿用既有鍵 `invalid token`) | 已證 |
| V8 | 整表存檔期間他人新增列不被刪 | E1: SB-T02、CC-A-010; X1: SB-T03、CC-A-011; X3: SB-U04、CC-A-012; X4: SB-I02、CC-A-013 | 已證 |
| V9 | 重排被拒 / 重編號可存 | WC-05、SB-U10、CC-A-014 | 已證 |
| V10 | 前端算之基準(經實際傳輸路徑)= 伺服端新鮮讀取所算 | WC-06(JSON 往返)、CC-A-015(真後端 / 真 LMDB / 缺欄 null 陣列 perms)、E2E-CC-001~003(瀏覽器端打包後之 `buildBaseline`: 存檔成功即證相同) | 已證 |
| V11 | 有草稿時收到推播 | **不適用**: `tableNamesSync: []`、頁面無廣播訂閱 / 輪詢重建; 守護: `rg "broadcast\|onBroadcast\|setInterval" src/components/LayoutContent{Users,Tokens,Ips}.vue` 須無輸出; `rg "tableNamesSync" server/WWebSso.mjs` 須為 `[]` | 不適用 |
| V12 | 多列提交其中一列過期 → 零寫入 | SB-U11、CC-A-016 | 已證 |
| V13 | 格式或版本不識 → `saveBaselineFormat`, 不降級 | SB-U12、SB-I05、SB-T08、SB-U18(基準內含存取器 / 洞 / 長度非 2)、CC-A-017 | 已證 |
| V14 | 比對與寫入間插不進他人寫入 | `unit-tablock`: SITE-LOCK-S01~S19(逐站點等待)、**W01(S01~S19 每個站點之全部寫入皆在自己持有的表鎖內; 抓得到「先空取鎖再釋放」)**、G01~G04; `unit-saveBaseline`: SB-C01(X6)、SB-C02; CC-A-020; 接線靜態守護 `unit-writeContract` WC-09(WWebSso 同一組鎖注入 procCore 與 procProtect)、WC-10(三頁存檔帶基準) | 已證(人為延遲; WC-09 / WC-10 僅證接線, 行為由 unit 共用鎖與 e2e-concurrency 證明) |

### 缺陷 → 修前紅 / 修後綠

修前紅: 以 `git archive HEAD` 取 HEAD 之 `server/`、`src/` 為底, 疊上新增之契約檔與三支 unit 測試(其餘測試依賴新 API 故不同跑): 72 案中 **10 通過 / 62 失敗**; 通過的 10 案皆為「HEAD 無鎖故必然通過」(SB-S06 不死結、SITE-LOCK-G01 / G03)或純新增模組本身之案(WC-02~WC-08); 全部依賴伺服端行為的案例(含逐站點 SITE-LOCK-S01~S19 與 SB-U / I / T / S / C 其餘案)於 HEAD 皆紅. 修後 74 案全綠(其後加 SB-T13、SB-U17).

| 缺陷 | 測試 |
|---|---|
| E1(存舊金鑰清單刪掉載入後登入之 session) | SB-T02、CC-A-010、變異 M18 / M17 |
| X1(已撤銷 session 復活, 繞過自動封鎖; 安全) | SB-T03、CC-A-011、變異 M21; 殘留面(不帶基準 / 基準外送回, sso-verify01 註記 1)於 sso-run03 收回(R-CONC-06): SB-T16~T18、CC-A-022~023、sso-run03 變異 M01~M12 |
| X2(整列回寫 `timeVerified / timeBlocked / isForceChangePw / tokenVerify`, 未動之列被標最後修改者) | SB-U02、SB-U05~SB-U09、CC-A-006 / 007 / 018、變異 M19 / M29 / M32 |
| X3 / X4(載入後新增之使用者 / IP 被刪、封鎖被舊值解除) | SB-U04、SB-I02、SB-I03、CC-A-012 / 013 |
| X5(系統直寫新增殘缺列) | SB-S01~S03、SB-U16、CC-A-008、變異 M15a / M15b / M37 |
| X6(清單儲存不互斥) | SB-C01、CC-A-020、變異 M10 |
| X7(續期後 `timeEnd` 被蓋回) | SB-T04、SB-T10、變異 M20 / M28 |
| X8(自助註冊與後台新增同帳號並存) | SB-U13、CC-A-019、變異 M04 |

### 變異驗證(`tmp/sso-run01/mutate.mjs`, 歸檔 `agent-out/sso-run01-probes/`)

於 `./tmp/sso-run01/mut/<編號>/` 複製 `server/`、`src/`(元件只複製三個清單頁供靜態接線守護)與 4 支 unit 測試後套用單一變異, 跑 `unit-saveBaseline / unit-tablock / unit-writeContract / unit-ormWriteFail`; 對照組 M00(無變異)全綠. **52 項變異全數被抓到**(外審前 41 項, 其中首輪 40 / 41, 存活之 M37「帳號封鎖不於鎖內重讀使用者」經強化 SB-S03 後被抓到; 外審 sol 後修補與測試補強新增 M40~M50 共 11 項, 並重跑全矩陣): 逐站點取錯表鎖 M01~M09、M10 / M10b、M11~M14; 拿掉 `mustExist` M15a / M15b; 不比對基準 M16; session 列寬鬆改嚴格 M17; 刪除集合改回「庫內全部 − 送出」M18、不帶基準時亦刪 / 覆蓋 session 列 M27 / M28; 伺服器專有欄位採客戶端值 M19; 管理員未動之 session 也寫 M20; 已撤銷 session 當新增復活 M21; 拿掉 `keepUserId` M22; 稽核(不傳 operatorId M23、不記 system M38、refreshToken 不記擁有者 M39); T3 M24; opt 降級 M25; 登入不鎖內重讀 M26; 契約欄位 / scope 誤改 M29~M32; 前端工具 M33 / M34; 吞掉 `saveWriteFail` M35; 拒收鍵不轉語系鍵 M36; **外審後新增**: S15 帳號對應不於鎖內再驗 M40、S16 token 身分不於鎖內重讀 M41、登入鎖內不再判密碼 / 驗證 / 到期 M42、登入回傳值取鎖外舊使用者 M43、perms 驗證不略過摘要同基準之列 M44、不帶基準以送入原值比對有無編輯〔sol#8 之作法, 與 ADR-069 衝突, 此變異鎖定現行行為〕M45、`parseSaveOpt` 不做防禦性複製 M46、站點「先空取鎖再釋放、於鎖外做原讀寫」(S07 M47、S17 / S18 M48; 只有 SITE-LOCK-W01 抓得到, 逐站點「等待」案抓不到)、WWebSso 注入 procProtect 之鎖改為另一組 M49(WC-09)、使用者清單頁存檔不帶基準 M50(WC-10).

### 外審 sol 後之修補(2026-10-23)

外審 sol(gpt-6.1-sol, max)提出 14 條, 逐條讀碼核對後: **採納並修補 4 條**——#3(S15 / S16 鎖內再驗身分)、#4(登入鎖內再判密碼 / 驗證 / 到期, 回傳取新鮮使用者)、#5(帶基準時 perms 驗證略過摘要同基準之列)、#10(`parseSaveOpt` 防禦性複製); **採納後撤回 1 條**——#8(不帶基準以送入原值比對有無編輯, 令 null / 缺欄 perms 原樣重送零寫入): 與 ADR-069 及 `api-apptoken-perms` PERM-A-005(DB 既有毀損 / 缺欄 perms 存回時正規化為空陣列)衝突, 該 api 測試於全跑時發現後撤回, 以 SB-T15 與變異 M45 鎖定現行行為; **補測試 4 條**——#11(S16 讀後刪除、S06 稽核真正觸發)、#12(SITE-LOCK-W01)、#13 / #14(WC-09、WC-10 靜態接線守護; #13 之行為層由 e2e-concurrency 證明); **不改 5 條**——#1、#2(不帶基準固有限制, 見「已知限制與風險」)、#6(畫面 `sortBy('order')` 與存檔 `resetOrder` 為 HEAD 既有設計, 不致誤拒)、#7(已封鎖分支不重試撤銷為 HEAD 既有, 改之會變更封鎖流程語意)、#9(HEAD 存檔成功後即保留送出之列, 非本輪引入). 逐條核對與證據見 `agent-out/sso-run01-實作報告.md`〈外審評分表〉.

### 改動範圍 → 測試檔(全域守則第 12 條; 取代 W2-7 規劃表)

| 改動範圍 | 須跑 |
|---|---|
| `server/procCore.mjs` `updateTabItems` / `parseSaveOpt` / 三個 `checkTokenAndUpdate*List`、`src/writeContracts/`、`src/baselineOf.mjs` | unit 全部 + `api-concurrency`、`api-apptoken-perms`、`api-ormopts`、`api-doubleclick`、`api-adduser`、`api-deleteuser`、`api-httpendpoints`; e2e: `e2e-adduser`、`e2e-modifyuser`、`e2e-deleteuser`、`e2e-tokens`、`e2e-ips`、`e2e-concurrency` |
| 系統直寫站點(S01~S09、S15~S19: 登入 / 續期 / 登出 / 註冊 / 驗證 / 改密碼 / 重設 / 自動封鎖 / 計時器) | unit 全部 + `api-concurrency`、`api-autoblock-*`、`api-resetpassword`; e2e: `e2e-login`、`e2e-logout`、`e2e-autologin`、`e2e-register`、`e2e-changepassword`、`e2e-resetpassword`、`e2e-autoblock` |
| `LayoutContent{Users,Tokens,Ips}.vue` | `e2e-adduser / modifyuser / deleteuser`(users)、`e2e-tokens`、`e2e-ips`、`e2e-concurrency` |
| `server/procLang.mjs` 新語系鍵 | `unit-lang` + `e2e-concurrency`(雙語系) |
| 共用基礎(`test/tools/e2e-setup.mjs`、`vue.config.js`、前端新增打包依賴、w-component-vue / w-package-tools-e2e 升版、w-serv-orm 升版) | 全部 e2e(14 flow + concurrency); **例外(依差異範圍, sso-run02)**: `e2e-setup.mjs` 之改動若為純新增 export(`git diff` 僅新增行, 既有函式 / 常數不動), 可只以 `mocha --dry-run test/*.test.mjs`(載入全部測試檔)+ 使用該新 export 之檔全跑代之 |

### 與規劃(W2-1~W2-8)不同處

1. 不帶基準之 tokens 新增列限應用系統金鑰(2026-10-23 sso-run03 起; 原「含鑄造使用者 token」已收回, 見 R-CONC-06), 刪除 / 修改限應用系統金鑰列(見 R-CONC-03 現況).
2. 系統直寫經 `procOrm + mustExist` 而非自行補欄位(規劃 D5 之「待核心 API」已由 w-serv-orm 1.1.17 滿足); `keepUserId` 取代規劃的分組寫入與補正.
3. 登入於 tokens 鎖內重讀使用者(規劃列為「未實證分析項」, 本輪納入並以 SB-S05 守護); 外審 sol#4 後擴充為鎖內再判密碼未變 / 已驗證 / 未到期並回傳新鮮使用者(SB-S10); 自動封鎖(S15 / S16)亦於鎖內再驗身分(SB-S07、SB-S08).
4. 前端存檔成功後 tokens / ips 以「摘要相同則保留現畫面」重拉, 而非一律取代(避免既有標準圖變動).
5. `rowsInvalid`、基準格式不識、`saveWriteFail` 之映射見 R-CONC-03 現況.
6. 純函數無須 `transpileDependencies`(T2 ④).

### 依原則自行決定(本輪; 全數已記入 `decisions.tsv`, phase `sso-run01`)

不帶基準之 tokens 刪 / 改限應用系統金鑰列且新增照常; 第 4 參數白名單 + 成對 + 不降級; 注入 `withTabLocks / guardWrite` 為必填; 系統直寫改經 `procOrm + mustExist` 與更新者歸屬; 寫入階段失敗一律 `saveWriteFail`; `rowsInvalid` 回 `anUnexpectedErrorOccurred`; 登入鎖內重讀; 前端重拉策略; T3 隨 `deletePassword` 旗標; api 層不加 web 鎖. 另: 既有測試調整依「保留意圖、調整 fixture / 預期」(清單見 ADR-091 Consequences).

### 已知限制與風險

- 不帶基準的舊版頁面 / app 權杖不受先動先贏保護(後者蓋前者), 且 session 列不可由它們刪除; 下一 major 起後台必帶基準.
  - 不帶基準者無從分辨「新增」與「載入後已被刪之舊列」: 送回已被刪除 / 撤銷之舊列(app 金鑰、IP、使用者)會被當新增寫回(外審 sol#1); 送出 `isApp='y'` 之 session 升級會以送入值寫入該列(含舊的 `timeEnd`, 外審 sol#2; session → 應用系統金鑰之升級是 spec 金鑰清單 E2E-002 之既有功能). 帶基準之後台頁皆不受影響.
  - **session 列已收回(2026-10-23, sso-run03, R-CONC-06)**: 送回已被登出 / 自動封鎖撤銷之 session 列不再復活(整次拒收 `tokenSessionAddNotAllowed`), 不再屬已知限制. 上列仍成立者只剩 app 金鑰 / IP / 使用者之舊列(其新增本屬合法操作, 且不涉撤銷繞過)與 session → app 升級之舊 `timeEnd`.
- IP 清單在繁忙系統因計時器登錄新 IP, 舊畫面存檔較常需重新載入.
- 管理員刪除 / 修改一個載入後被續期之 session 時整次拒收(現行前端不自動續期, 僅 API 端續期會觸發).
- `rowsInvalid` 無法在真 ORM 下自然重現, 以測試替身回傳重複主鍵之列守護(SB-U17).
- 離線工具 `g_initialData.mjs` 4 處直寫不取表鎖(前提: 服務已停止, 規格 §12).
- 單一行程部署前提; 多行程需另採資料庫交易或條件寫入.
