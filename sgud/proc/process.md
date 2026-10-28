# 重要處理要點

本檔為特有之重要處理要點,為業務端之特化要求事項與處理流程,包含事項、關聯什麼、怎麼判斷與處理方式等,由agent自行編列、擴充與維護.

體例: 每一事項一節, 固定三欄——**關聯**(牽涉哪些檔案 / 機制 / 文件)、**判斷**(何時適用、怎麼分辨)、**處理**(照做的步驟與禁止事項). 指令與測試檔清單不重抄, 一律指向 `sgud/rule/rulebook.md`「測試配置」; 決策緣由指向 `spec/設計要點與取捨.md` 之 ADR 編號; 服務 port 見 `CLAUDE_settings.md`.

## 資料初始化與測試 seed

- **關聯**: 正式初始化 `g_initialData.mjs`; 測試 seed 由 `test/tools/e2e-setup.mjs` 之 `resetToBaseSeed()` / `deleteNonBaseSeed()` 與各檔 `insertTestUsersAndTokens()` 以 DB API 建立(base seed 實名見 rulebook「測試資料」); `startServersOnce` 不做 seed.
- **判斷**: 正式初始化只在使用者明確要求時重跑; e2e / api 之 hermetic seed 由測試自動做, 不需也不應手動介入. 測試中資料跨 case 殘留, 先查是否多個後端同連一個 DB(`restartBackend` 留孤兒、手動多開、中途砍 mocha), 不是 seed 問題.
- **處理**: 不主動重跑正式初始化; 資料異常先 `netstat` 確認 11007 只有一個監聽者再判斷.

## 跑測試: 統一入口與自身驗證分流

- **關聯**: `package.json` scripts 之 `test`(唯一 script, 全域 §16.5 標準字串); 各層指令與 runner 見 rulebook「執行入口」.
- **判斷**: `npm test` 是跨套件批次維護、確認套件能完整測試之保證手段, **字串固定不得改, 不因專案測試結構調整 glob, 不加任何變體**. agent 自身要驗證什麼, 一律自編指令執行(單層 / 單檔 / 全套 / 重產), 不進 scripts.
- **處理**: 起跑前 `netstat -ano | grep -E ":(11007|8080) " | grep LISTENING` 看是誰的——非自己起的先回報不殺(harness 之 `killPort(11007)` 為明文例外, 見 `CLAUDE.md` 服務 port 要點); e2e 全套約 100 分鐘走 `run_in_background`; **同一時間只有一條鏈**(重產與 mocha 共用 11007 後端與 DB); log 檔名每輪不重用. 背景起 dev server 後**須等其 log 出現 `App running at` 才跑 api / e2e**——api 與 e2e 之 `startServersOnce` 見 8080 尚未監聽即自起前端, 與編譯中之 dev server 搶埠, 一方 `EADDRINUSE` 退出(2026-09-24 實際踩到: 起 dev server 後隨即跑 unit+api, dev server 綁定失敗). 跑完判準不只綠: `test/_tmp/` 無殘留、`./testPending/` 無本輪新增(或已分析)、`netstat` 無自己起的殘留、`dist/index.html` 已刪(見下節)、`./tmp/` 清乾淨.

## api 測試層之強制退出與檔級清理

- **關聯**: `test/tools/api-setup.mjs` 保存 `WServHapiClient` 實例, root `after` 先 `clearBroadcast()` + `clearSync()` 再 `process.exit()`; ADR-057、ADR-085.
- **判斷**: 原「client 無法 close, 唯一可靠的中止方式是 process.exit()」自 w-serv-hapi 1.1.6 起不成立(兩者皆呼叫即停止輪詢計時器與在途請求; 只呼叫其一無效); exit 保留為保險(停止前已送出之 callFapi 仍依重試撐住行程, 單一 mocha 行程尚有 g_mOrm 之資料庫連線等資源), 屬全域技能 §9.1 明文例外. 單一 mocha 進程併跑多個 `api-*` 檔時共用同一個 backend. e2e-tokens 之 API client 檢查只在比對端之例外, 前提同樣失效, 改造列帳本已知缺口.
- **處理**: 檔級 `after` **不得**呼叫進程級 `cleanup()`(會殺掉後續檔案共用的 backend → 整批 ECONNREFUSED); 需要換設定的檔以 `restartBackend` + `try/finally` 還原; 新增建立 WServHapiClient 之測試工具時一併保存實例並於結束時兩者皆呼叫.

## 改動 `src/` / `server/` 後的驗證範圍

- **關聯**: rulebook「spec → 測試檔對照」; `sgud/exp/experience.md`「baseline 過期 10 天無人知」.
- **判斷**: 改 UI 元件 → 對照表找受影響 flow 之 e2e; 改 `server/` → 重啟後端(改後自動 kill 重啟, 見 `CLAUDE.md`)+ api 層; 改 `procLang.mjs` 或語系機制 → `unit-lang` + 受影響 e2e 雙語系; 改 `test/tools/` → 至少一個 e2e 單檔 + `npm test`.
- **處理**: e2e 紅先開 `./testPending/` 之 `__diff.png` 定位差異區, 再以「換回舊版套件 / 舊 commit」介入實驗分辨 baseline 過期 vs 真回歸, 不憑時序猜; 不改測試遷就現狀.

## UI 變更牽動 baseline 之處理流程

- **關聯**: `test/pics/<flow>/`; 全域技能 §7.9 重產政策; ADR-053(六旗標 210 張)、ADR-060(drawer 接線 180 張)為落地先例.
- **判斷**: 先**不重產**, 跑受影響 flow 之 e2e 取失敗三聯組, 以 diff 紅像素 bbox 判定差異是否只落在預期區域, 純位移者以「capture 與舊 baseline 平移 dx 後吻合度」證明非重繪; 帶外差異須另查, 不得混入重產. 失敗張數常少於受影響張數(mocha 於 case 內首張不符即中止, 後續階段未比對到).
- **處理**: 取得使用者授權 → 只產受影響者(`--names` 手術式; 整 flow 全案例失敗時可整 flow 重產, 但重產後逐張與 git HEAD 版 pixelmatch, `diff ≤ maxDiffPixels` 者 `git checkout --` 還原, 不換掉已審過的圖——已遷移至 `createBaselineGate` 之流程(目前 tokens)改用 `--write-mode changed` 直接只寫超過容差者; **多階段案例(同 case 多張, 如 `E2E-007-1` / `E2E-007-2`)須以案例為單位把全部階段圖列入 `--names`**——失敗清單只含首張不符者, 後續階段根本沒被比對, 只照清單產會漏(殷鑑: ADR-063 resetpassword 007-2 重跑才現形))→ 記錄重產前後 mtime 回驗未受影響者未動 → 受影響 flow 重跑到綠 + 抽一案 `--grep` 單跑與全跑一致 → ADR 記張數分佈與把關證據(bbox、對齊吻合度、LCD 彩邊 0→0).

## e2e 共用設施(w-package-tools-e2e)

- **關聯**: devDependency `w-package-tools-e2e`(2026-09-29 起 `^1.0.2`, 2026-09-30 起 `^1.0.3`(ADR-078), 2026-10-01 起 `^1.0.6`(ADR-079); 規格、API、採用步驟、等價驗證協定見其 README); 單一橋接 `test/tools/e2eLib.mjs`(53 個匯出, 皆 `'w-package-tools-e2e/src/<模組>.mjs'`); w-web-perm / w-web-api / w-web-task 各以自己之 `test/tools/e2eLib.mjs` 引用同一套件. 沿革: 2026-09-27 起本專案 `./srcPack` 為抽提種子, 四專案以相對路徑共用; 2026-09-29 套件發布 1.0.2(內容即 srcPack: 逐檔比對僅 JSDoc 與引號寫法差異, `launchChromium` 轉接檔所轉呼叫之實作與已裝 1.0.1 相同; 見 ADR-073)後四專案改指套件, `./srcPack` 刪除.
- **判斷**: 套件由其主責者審計、擴充、發布; 本專案不改套件內容. 在本專案(或姊妹專案)遇到共用設施之缺陷或需擴充之功能, 整理成「徵狀、重現步驟、建議修法與測試」回報業主, 由套件端改版; 不在本專案另寫 patch 或複製模組回來改. 建議檔落專案根目錄(如 `建議w-package-tools-e2e調整.md`), 業主發布後自行刪除; 升版後本專案文件中指向該檔之句改寫為「已發布 x.y.z」並附修復紀錄(2026-09-30 1.0.3 為例, ADR-078).
- **處理**:
  - 套件升版: 先以 `npm pack w-package-tools-e2e@<版>` 取 tarball 與已安裝版逐檔 diff, 列出**行為差異清單**(只改註解 / 排版者不算); `npm install -D w-package-tools-e2e@<版>`(四專案同步). **驗證範圍依差異清單決定, 不預設重跑全套**: 無行為差異 → 橋接檔載入檢查(全部匯出皆為函式, 1.0.3 為 53 個)＋抽查一個 e2e 檔即可; 會改像素之變更 → 先以呼叫處與分支盤出受影響之案例, 以 `--write-mode changed` 只重產該些案例(`[write]`／`[keep]` 逐張印原因, 可與盤點互證), 產前後全目錄 md5 比對只變預期者, 逐張審圖後經 `runIsolatedE2e` 之 `targets` 比對(1.0.3 之做法, ADR-078); 有差異 → 只跑用到該模組之測試(截圖 / 紅框 / 遮罩 / 管線之變更會動到標準圖, 依套件 README「改版須知」與等價驗證協定: 快照 → `E2E_BASELINE_OUT_DIR` 產到 `test/_tmp/` → `compareImageDirs` 對 `test/pics` → `--write-mode changed` 須零寫出). 殷鑑: 2026-09-29 切換 1.0.2 時已證明程式碼一致仍四專案全套重跑, 業主指正浪費時間.
  - **差異清單要含依賴, 不只看 `src/`**: 套件之 `dependencies` 升版(尤其 `playwright`)即換截圖用之 Chromium, 每張標準圖都可能變, 此時依差異推出之驗證範圍就是全部 e2e 比對(1.0.6 實例: src 與 1.0.3 逐檔相同, 但 playwright `^1.62.1` → `^1.63.0` 使 Chromium 151 → 153, ADR-079). 先查 `node_modules/playwright-core/browsers.json` 之 chromium revision 新舊是否不同, 相同則不必全跑.
  - 盤點 CLI: `node node_modules/w-package-tools-e2e/tools/auditBoxes.mjs <pics目錄>`、`node node_modules/w-package-tools-e2e/tools/auditWaits.mjs <專案根>`.

## 標準圖之審查與判定由 agent 先行

- **關聯**: `test/pics/<flow>/`; 全域技能 §7.6(產製流程與交付門).
- **判斷**: 業主 2026-09-27 授權「e2e 標準圖皆由你先行檢查與做出判定與審查」(2026-09-28 經三方獨立複審定案, 擴及 perm / api / task, 見 `spec/設計要點與取捨.md` ADR-072 決定 4⑧; 各專案 process 同步): 標準圖之逐張審查與是否可凍結為 baseline 之判定由 agent 負責, 審完即可跑 mocha 比對, 不必等業主審圖; 但產圖本身(重產 / 新產)仍須先有授權(§7.9). 業主裁示者限於設計取捨或產品介面變更; 紅框「亂框、亂壓以致遮蔽有效資訊或使用者誤解」一律屬缺陷、直接修, 不列裁示(2026-09-28 業主明示; 原載「2026-09-27 權限清單紅框壓到相鄰項, 裁示維持現狀」為誤記, 已更正).
- **處理**: 每張以使用者視角判斷「照圖能否操作、畫面有無被改壞」, 不只看有無紅框: ①既有圖與 git HEAD 版逐像素比, 差異須全落在預期區域, 帶外差異查到原因; ②逐張目視對照 spec 框住句與操作順序(點擊前框要點之元素、點擊後框反應); ③掃描(每張恰一框、黑字 LCD 彩邊、共通區 hash 分群兩語系對稱)與抽張重產逐位元比對; ④審圖報告(圖文對照)仍產出供業主隨時查閱, 需裁示者列於報告首節.

## 自有套件(wsemi / w-*)升級之查核

- **關聯**: `package.json` 之 `w-serv-hapi` / `wsemi` / `w-*`; ADR-061.
- **判斷**: 自有套件無 CHANGELOG, 版號跳動不代表相容; **改名類變更(如 `showLog`→`useShowLog`、`fnTableTags`→`fpTableTags`)傳舊名不報錯、只靜默失效**, 測試綠燈抓不到, 必須 diff 原始碼.
- **處理**: `npm pack <pkg>@<舊版> --pack-destination <scratchpad>` 取舊碼(git-bash 下 `tar --force-local` 解壓)→ 與 `node_modules/<pkg>/src` 逐檔 diff → 以 `get(opt, '…')` 列出新版接受之選項鍵 → grep 專案所有呼叫端是否仍傳舊鍵、仍 import 已移除之依賴 → 專案 import 之 `wsemi/src/*.mjs` 逐一確認仍存在 → **驗證範圍依差異決定**(記憶「verify by diff scope」, 業主 2026-09-29 兩度指正): 只動到後端函式 → 後端裸啟動 + 用到該函式之 unit / api 測試; 動到前端元件或 DOM 偵測(如 wsemi `domDetect`、w-component-vue 元件) → 用到該元件之 e2e 案例, 元件遍及全站版面者即 e2e 全套; 無行為差異 → 載入檢查 → ADR 記三類變更(破壞 / 修復 / 新增)與處置. 依賴出問題一律由套件端統一改版, 不在專案端補裝或繞道(全域 §7).
  - **差異清單要含「上游不再代做之事」**(2026-10-14, ADR-085): 上游移除其代為處理之全域行為(w-serv-hapi 1.1.6 移除 process 層 `unhandledRejection` / `uncaughtException` 監聽)時, 本套件依賴該行為之站點即由「印 log」變「行程結束」——盤點 `server/` 之 fire-and-forget(`setInterval` / `setTimeout` 之 async 回呼、未 await 之 async 呼叫), 依 R-ERR-01 經 `wrapTimer` 收斂, 並以 unitProc 攔得之計時器回呼注入失敗驗證(不在本套件註冊全域監聽). 同理, 上游新增可停止之能力(client 之 `clearBroadcast` + `clearSync`)時, 回頭檢查以「無法停止」為前提之測試例外(api-setup 強制 exit、e2e-tokens 只在比對端).
  - 設定轉交: 本套件正規化過之設定值一律以正規化後之值轉交(殷鑑: `serverPort` 正規化後仍交未正規化之 `opt.serverPort`, 未給時 hapi 改聽 8080, ADR-085).

## ORM 寫入點與 w-serv-orm 升級

- **關聯**: `package.json` `w-serv-orm`(2026-10-12 起 `^1.1.8`, ADR-081; 2026-10-14 起 `^1.1.10`, ADR-085; 同日發布前升 `^1.1.11`, ADR-087; 同時宣告其相依之 `w-data-collector ^1.0.46`、`wsemi`(2026-10-14 起 `^1.9.16`))、`w-orm-lmdb`(直接宣告; 2026-10-12 起 `^1.0.38`, ADR-082; 2026-10-14 起 `^1.0.39`, ADR-087); `server/ormWrite.mjs`; procCore `updateTabItems` / `createUser` / `revokeTokensByUserId`; procProtect 三種封鎖; rulebook R-ORM-01 / R-VAL-01; 測試 `unit-ormWriteFail`(記憶體資料表 `test/tools/unitProc.mjs` 之 `mkTable`、真實 procOrm 之 `mkProcOrm`)、`api-deleteuser` API-002 / API-003 與 `api-adduser` API-011～013.
- **判斷**: w-orm 系列 `save` / `del` 遇單筆失敗不 reject, 只回 `{ ok: 0, err }`; w-serv-orm 1.1.7 起 procOrm 遇逐筆失敗即 reject(其餘筆已寫入). 寫入點只有兩種寫法: 經 procOrm(清單儲存、註冊)與經 `ormWrite`(其餘直接寫入點); 失敗一律回語系鍵、原文寫 srLog.error; 寫入後之撤銷令牌與清快取不依寫入成敗.
- **處理**:
  - 新增寫入點: `save` / `del` 一律經 `ormWrite`(或 procOrm); 失敗之 key 新增時 eng + cht 齊備於 `procLang`, 並決定是否為後端專用鍵(結果頁 / 信件 → 加入 WWebSso `emTextKeys`, 見下「新增或修改寄信 / 語系文字」); 後續動作(寄信、節流、回成功)放在檢查之後; 以 `unit-ormWriteFail` 之 `mkTable` 注入逐筆與整批失敗各一案(先紅後綠); 依 R-ORM-01 盤點指令複核站點全集.
  - 升級 w-serv-orm / w-orm-lmdb: 依「自有套件升級之查核」取新舊 tarball 全量 diff(含其相依 wsemi、w-data-collector 之差異), 特別核對 procOrm(`getMapOrm` 之 `mapOrm` / `adjustData`、`getProc`)之 reject 條件與訊息、**寫入時對輸入之改寫(clearXSS、補主鍵)**、逐筆結果之形式(`ok` / `err` / `n` / `nDeleted` / `nModified`)、`getItemsFail` 之判準與所在套件; 上游新增之寫入時拒絕或改寫, 一律對照 R-VAL-01 前移至本套件之驗證階段(本套件無交易, 寫入中段之拒絕即部分寫入); 語意有改即跑 `unit-ormWriteFail`(以真實 procOrm 執行, 反映套件語意)與清單儲存及撤銷之 api 案例(`api-adduser` / `api-deleteuser` / `api-doubleclick` / `api-apptoken-perms`); 語意不變者載入檢查即可. 本套件之判準引用與上游同一 wsemi 實體, 升版後 `npm ls wsemi` 須只有一份.
  - 單元測試之 procOrm 以 `mkProcOrm(ds, woItems)`(getMapOrm → getProc, 與正式之 WServOrm 同樣不傳 opt)組出; 1.1.8 起兩者為各實例狀態, 不影響同行程內 `g_mOrm` 之正式實例(1.1.7 時期之 `loadMapOrm` 另載模組繞道已移除). 記憶體資料表 `mkTable` 之語意須與 w-orm-lmdb 一致(insert 既存略過、save 以 merge、鍵長 1978), 升級 w-orm-lmdb 時一併核對.
  - 本套件不轉交 w-serv-orm 已移除之使用者檢查設定(R-ORM-02 / ADR-083 / ADR-085): `WServOrm` 與 `getProc` 一律不傳 opt; settings / optExt 之 `useCheckUser` / `getUserById` / `useExcludeWhenNotAdmin` 由 `server/getIgnoredOrmKeys.mjs` 逐鍵委派上游 `checkOptRemoved` 判定, 會被上游拒絕者忽略並於啟動時記警告(undefined / null / false 不列); 擋板不可拆——透傳即令舊設定使後端啟動失敗. 新增經 procOrm 之寫入點須先於 kpFunExt 授權(checkToken 之系統管理者 / 權限; 上游 procOrm 不做授權). 升級 w-serv-orm 時另核對 `src/checkOptRemoved.mjs` 仍在且接受集未變(`unit-ignoredOrmKeys` IOK-007), 與 adjustData 之 `userId` / `userIdUpdate` 戳記(R-ORM-03: 非建立者語意之 `userId` 欄, 如 tokens 擁有者, 新增時依該欄分組並以其值為參數, ADR-084).
  - 診斷輸出導入 srLog(R-ORM-04 / ADR-098, 2026-10-28): `WServOrm` 之 opt 只給 `{ funLog: mkOrmFunLog(srLog) }`(`server/ormDiagLog.mjs`), `WWebSso` 內 procCore / procProtect 取得的 `procOrm` 為 `wrapProcOrm` 包裝後者(記下呼叫輸入供遮罩). 新增建立 `WServOrm` 之站點須同樣接 funLog(或在 R-ORM-04 登錄刻意不套之理由, `unit-ormDiagLog` SITE-ODL-001 守門站點全集); 不得傳 `logDetail`(會把含主鍵與錯誤原文之細節還原到 console). 升級 w-serv-orm 時另核對: `funLog(label, safe, detail)` 簽名與「給予時不寫 console」仍成立、預設 console 格式仍為 `console.log(label, safe)`(`ODL-F02` / `ODL-W01` 以此斷言)、細節形狀(失敗清單 `{ k, id, err }`、catch 路徑為 Error 或字串)未變; 跑 `unit-ormDiagLog` 與 `api-ormdiag`; 換 ORM 或升級 w-orm-lmdb 時以 `ODL-L01`(真 LMDB 鍵長超限)核對錯誤原文是否夾帶資料值(殘餘風險見 ADR-098).
  - 測試行程直讀 LMDB 之跨行程舊快照已由 w-orm-lmdb 1.0.38 修復(2026-10-12, ADR-082; 寫交易外之讀取前重設讀交易), 直讀可見後端已提交之資料. 升級 w-orm-lmdb 時以 `spec/evidence/2026-10-12-worm-lmdb-cross-process-stale-read.mjs` 回歸(各情境應為 0), 並連跑 `api-apptoken-perms` 之 PERM-A-001(修復前 10 輪 6 輪失敗, 為此問題最靈敏之案例). 2026-10-14 升 1.0.39(ADR-087): 回歸 4 情境 × 100 次皆 0、PERM-A-001 連跑 10 輪皆 13 / 13.

## 跨套件改動須經業主同意

- **關聯**: 姊妹套件 w-web-perm / w-web-api / w-web-task 等(各自獨立 repo 與發版); 本套件對外 helper 之消費端.
- **判斷**: 業主 2026-09-25 明示「沒我同意, 就不要同步去改 perm api 等其他套件, 我有要你才去做, 你可問我, 但不要未經我同意就去改」; 2026-09-27 再示「其他套件暫時都不要動, 除非你發現連鎖或類似問題, 再跟我說」. 本專案任務之「執行方案」授權只及於本套件; 即使全盤思考(類別完整、對稱性)查出姊妹套件有同型缺陷, 亦不構成修改授權.
- **處理**: 姊妹套件之同型問題只查證(`file:line` 或實測)並列入回報, 附建議與代價, 逐套件詢問是否要改; 業主同意後才動該套件. 不派子代理去改姊妹套件, 不在姊妹套件跑會改寫其 `dist` / DB / 追蹤檔之測試. 殷鑑: 2026-09-24 ADR-068 之消費端修正(perm / api / task)係在未逐套件取得同意下實作.

## 部署專案回饋之處理

- **關聯**: 引用方(如 `rddmanager_1_sso`)以建 e2e spec 時查得之缺陷回饋文件(例 `建議w-web-sso調整.md`); ADR-054、ADR-055 為先例.
- **判斷**: 逐項以本套件源碼 + 實機(Playwright 雙語系)查證屬實再分類: 缺陷(待修)/ 設計事實(記錄備查)/ 待裁示(業主決定)/ 已修復; 因果鏈靜態不可證者以 spy 實測(如 `rowsChange` 觸發鏈). **每一項先展開所屬類別再修**(全域 §2.1-1/3): 投訴句只是類別的一個成員——列出該類別在本系統的全部入口(如「程式端重建表格 → rowsChange」有同步回填 / 存檔回填 / showKeys / genOpt 四入口)成表, 逐格看已蓋 / 未蓋, 並 grep 姊妹專案(perm / api)同機制之寫法; 只修投訴那格會在下一輪被同類別的另一格退回(殷鑑: 2026-09-07 只修 toggleTabKeys, 09-14 被編輯模式開關退回).
- **處理**: 待裁示只呈報必須由業主決定者, 附選項與代價; 修復後 ADR 記錄並於回覆逐項標狀態; 已裁示者查裁決紀錄不重提(如 ADR-055 非系統管理者可進後台版面). **驗收以回報方原話之條件為準, 並在回報方之環境實測**: 回報方 e2e 為 1600×900, 本專案 e2e 為 Playwright 預設 1280×720——「全套 e2e 全綠」對回報方 viewport 之版面問題零證明力, 須另以探測腳本在 1600×900 量測驗收條件(如「末列完整可見」), 且 ADR 之驗證清單須逐項對應建議書條目, 缺一即該項未驗(殷鑑: ADR-054 第 4 項自陳「1600×900 為 no-op」仍標已修).

## 對外查詢 helper 之變更

- **關聯**:
  - `src/{getUserByToken,getUsersByToken,getUserByUserId}.mjs`(外部系統於伺服端直接 import);
  - 共用核心 `src/fetchSsoMsg.mjs`、`src/httpGetJson.mjs`、`src/maskUrl.mjs`;
  - 契約測試 `test/api-external-helpers.test.mjs`(真後端)、`test/unit-external-helpers.test.mjs`(不起後端, data: 網址);
  - `spec/流程_查詢使用者資訊.md`; ADR-056、ADR-068.
- **判斷**: 屬對外契約, 不得順手改——參數順序、網址佔位符(`{sysToken}` / `{token}` / `{userId}`)、查詢鍵(`key=token` / `key=id`)、reject key(ADR-068 K 契約, 詞彙與 w-web-perm helper 一致).
- **處理**:
  - 任何改動同步契約測試; 範例網址、檢查條件、reject key 三者須一致(殷鑑: 範例寫 `key=userId` 而後端只認 `key=id`).
  - 不新增 axios 類直接依賴, 沿用內建 fetch.
  - **權杖不得進入任何輸出**:
    - reject 值只能是固定 key(不得帶網址、錯誤原文或部署端錯誤);
    - console 只印一行診斷(範本之 origin + pathname、錯誤 name / code / status、key 形狀之 SSO msg), 不得印代入後網址或錯誤物件;
    - 代入一律 split / join + `encodeURIComponent`(不用 `replaceAll`).
  - 新增失敗分支時, 測試須含「reject 值與 console 不含權杖」之負向斷言, 並先對舊碼跑紅. 殷鑑: 2026-09-07 把含權杖之網址逐字斷言為契約, 凍結了外洩.
  - 新增或更名 key 時同步:
    - `server/procLang.mjs`(eng + cht);
    - README 對照表;
    - 消費端(w-web-perm / w-web-api / w-web-task)`server/wrapInjected.mjs` 之白名單.
  - console 政策刻意與 w-web-perm helper 不同: 本套件失敗印一行, perm 不印; 兩者皆不含權杖.

## 來源 IP 之取值與信任邊界(使用者 2026-10-20 裁示)

- **關聯**: `server/procProtect.mjs` 之 `getIpByHeaders` / `warnInvalidForwardedFor` / `pruneKpKey`; rulebook R-IP-01 / R-CNT-01 / R-KEY-01; ADR-040(IP 來源為部署契約)、ADR-089; README Upgrade Notes〈來源 IP 之信任邊界〉; 測試 `unit-sourceIp`、`unit-countKeys`、`api-sourceip`.
- **判斷**: 使用者 2026-10-20 裁示: 線上系統常有多層反向代理, 使用者 IP 由反代提供; 能經跳板自填者, 反代拿到的也是自填值, 此類防護屬專門防火牆, **SSO 不做防偽造系統**. 故取 `X-Forwarded-For` **最左段**(第一個非空段)之語意不變——不預設不信任標頭、不改取最右段(多層反代下最右為上一層代理 IP)、不提供 `trustProxy`. 外審或日後任務若提出此類主張, 依裁示不採, 於報告表中註明; 不重提為待裁示. 屬衛生而不改語意者照辦: 取得之值須為合法 IP(格式驗證)、計數容器之空鍵清理.
- **處理**: 改 `getIpByHeaders` 先讀 R-IP-01; 合法 IP 一律原樣採用(不剝 `::ffff:`、不改大小寫——`ips` 表既有封鎖列以原字串精確比對), **唯一之正規化是去 port**(`IPv4:port`、`[IPv6]:port` 取 IP 本身, `pickForwardedIp` 單一擁有; 使用者 / 主控 2026-10-20 run02 裁示: 帶 port 者退回連線位址在多層反代 / 雲端閘道下會使全部使用者被視為同一閘道位址, 與「不改語意」相悖), 去後仍非 IP 才退回連線位址並限流記 warn; 全套件只有 `getIpByHeaders` 讀 `x-forwarded-for`(`SITE-IP-001` 守), 兩個本機放行端點(`/api/cleanKpIpCallApi`、`/api/cleanKpAccountLoginFailed`)只取 socket 位址. e2e / api 測試若以標頭製造虛擬 IP, 值須是合法 IP(`1.2.3.x`、`11.0.0.x`); 要讓 `length`、`constructor` 等字串成為統計鍵只能寫入歷史 log(`api-iterclient` IT-A-001 作法), 不能經標頭. 新增以使用端字串為鍵之計數容器須同時規劃退場(R-CNT-01), 剪枝統一經 `pruneKpKey`.
- **兩處依賴行為(2026-10-20 實測)**: wsemi `sep` 各段 trim 後略過空段, 故 `', 203.0.113.9'` 取 `203.0.113.9`; `net.isIP` 對 IPv6 zone 識別碼長度無上限, 故另設長度上限 64. 升級 wsemi 或 Node 時以 `unit-sourceIp` IP-U-001 / 002 / 003 / 004 回歸.

## 使用端給定之查詢欄位名(`getSsoUserInfor` / kpfun `getUserInfor`)(主控 2026-10-20 run02 裁示)

- **關聯**: `server/procCore.mjs` 之 `getUserInfor`(單一擁有者)、`server/srLog.mjs` 之 `keysUserQuery` / `maskKv`、`src/fetchSsoMsg.mjs` 之 `hasUrlParam`; rulebook R-QKEY-01; ADR-090; README Upgrade Notes〈查詢使用者之欄位名限 …〉; 測試 `unit-queryKey`、`api-getuserinfor` QK-A、`api-srlog-noleak` LOG-003 / 004、`unit-external-helpers` HLPU-002b.
- **判斷**: 欄位名白名單 `id / account / email / name`; 白名單外 reject 固定 key `invalidUserQueryKey`, 不回顯欄位名與查詢值. HTTP `key=token` 在 `WWebSso` 上游分流, 不受影響; kpfun 無 `token` 分支, 傳 `key='token'` 屬白名單外.
- **處理**: 白名單檢查在 `checkToken` **之後**(未授權者先得 `tokenExpired`)、在入口 `srLog.info` **之後**(被拒之查詢仍留稽核紀錄, 查詢值已遮罩); 要驗 log 遮罩仍可用 `key=tokenVerify` 探測(`api-srlog-noleak`), 該探測現同時驗被拒. 新增使用端給定欄位名之入口須經 `getUserInfor`, 不得自行把欄位名當資料庫選擇器鍵. 對外 helper 之網址範本檢查一律經 `hasUrlParam`(完整參數比對), 不用 `indexOf` 子字串; 單元測試以 `data:` 網址(佔位符在 JSON 字串內、無 `?`)模擬 SSO, 故不得改成 URL 解析器.

## 應用系統金鑰(app token)之權限

- **關聯**:
  - 權限全集與計算 `src/appPerms.mjs`(前後端共用); tokens 表 `perms` 欄(`src/schema/tables/tokens.mjs`);
  - 權限閘 `server/WWebSso.mjs` 各呼叫點之 `opt.perm`、`server/procCore.mjs` 之 `_checkTokenByObj` / `adminResetUserPassword` / `checkTokenAndUpdateUsersList`(app 操作者免自我保護)/ `updateTokensList`(perms 驗證)/ `updateTabItems`(陣列欄縮短);
  - 後台 `src/components/LayoutContentTokens.vue`、`src/components/AppPermsTags.vue`; 種子 `g_initialData.mjs` 之 `token-for-app`;
  - 測試 `unit-appPerms` / `api-apptoken-perms` / `e2e-tokens` E2E-005～007; ADR-069; rulebook R-PERM-01.
- **判斷**: 業主 2026-09-25 裁示——權限以字串表示、`perms` 陣列多元素即聯集、預設只提供查使用者(`readUsers` 為基本權限恆具備); 同日另裁示「營運處置不需要, 安裝端仍然是測試資料, 尚未上線」, 故 README 與 ADR 不列輪替權杖 / 撤 session / 清 log 等步驟, 日後亦不再提出(除非業主告知已上線). 需系統管理者之新功能一律要決定歸屬哪個權限, 不得只給 `fun`.
- **處理**:
  - 新增需系統管理者之功能: 依 R-PERM-01 宣告 `perm`, 並把該功能加入 `api-apptoken-perms` 之 ops 矩陣(先紅後綠).
  - 新增權限字串: 同步 `keysAppPerm`(可取得系統管理者權限者另列 `keysAppPermHigh`)、`procLang` 之 `appPerm_<權限>`、README 權限表、兩測試檔; 後台清單由 `keysAppPerm` 自動列出, 不需改 UI.
  - 陣列欄之寫入: w-orm-lmdb `save` 以 lodash `merge` 合併, 陣列不會縮短; 經 `updateTabItems` 者已處理, 其他路徑若以 `woItems.<表>.save` 直接寫陣列欄, 須先存 `null` 再存新值(或改寫為字串), 並以「由長改短」之案例驗證.
  - 不改姊妹套件之消費端(其 helper 只用 `readUsers`, 不受影響); 若姊妹套件需要後台功能之權限, 由系統管理者於金鑰清單授予, 不在程式端放寬.

## 打包後之可用性(本套件 dist、被下游再打包)

- **關聯**: `toolg/gDistRollup.mjs`(w-package-tools `rollupFile`, umd, 入口 `server/WWebSso.mjs`); `server/staLogs/resolveShellWorker.mjs`、`staLogsCore.callWorker.mjs` 之 `getShellWorkerPath`; rulebook R-PKG-01; ADR-086(X1, 與 w-web-api / w-web-perm 同一實作).
- **判斷**: 打包範圍(入口之相對 import 閉包＋未列 external 之相依)內, 頂層之 `__filename` / `__dirname` 宣告使 bundle 載入即 TDZ(rollup 之 `import.meta.url` 墊片引用 `__filename` 且不避讓), `import.meta.dirname` / `filename` / `resolve` 於 umd 為 undefined; 以模組位置定位之檔案於打包後落在 `dist/`, 其下沒有該檔. 測試全綠抓不到——所有測試都跑源碼.
- **處理**: 新增「以模組位置定位檔案」之站點一律經首次使用時解析並快取(`resolveShellWorker` 之 (a)(b)(c)(d)), 並加入 R-PKG-01 站點全集; 改動 `resolveShellWorker.mjs` 須三套件同步. 升級 bundle 內之相依(現為 w-syslog)時以 `grep -rln "import\.meta\|^let __filename" node_modules/<相依>/src` 複查. 驗證打包: 於 `./tmp/` 以 gDistRollup 同設定建 umd、子行程 `require`(作法見 R-PKG-01「打包實測之作法」); 「由 src 建出 dist → 載入 → 實際觸發一次統計並寫出 log」以發布前之 dist 冒煙驗收(R-PKG-01「dist 冒煙」; 相依升級或改動打包範圍時執行, 2026-10-14 起; 暫存 cwd 須含已安裝佈局 `node_modules/w-web-sso`, 否則模板讀檔即拋).

## 後端啟動材化之 `dist/index.html`

- **關聯**: `WWebSso` 啟動時自 `dist/index.tmp` 代入 `{sfd}` / `{language}` 寫出 `dist/index.html`; `e2e-init` 之 `ensureIndexTmpl` 冪等還原; ADR-058.
- **判斷**: `dist/index.html` 是衍生檔, 每次後端啟動重生, 不入版控(2026-09-27 業主加入 `.gitignore` 與 `.npmignore`, 並以 `git rm --cached` 自版控移除; 此前曾被一併 commit); `dist/index.tmp` 是模板, 其佔位符不可被洗掉.
- **處理**: 測完 / 收工刪 `dist/index.html`; 動到 `dist/index.tmp` 或 `ensureIndexTmpl` 後以 `git diff dist/index.tmp` 確認 `{sfd}` 仍在.

## 新增或修改寄信 / 語系文字

- **關聯**: `server/procLang.mjs`(單一字典)、settings `*EmTitle` / `*EmContent` 鍵、`kpLangExt`; `unit-lang` 守護合併順序; 架構與殷鑑見 `sgud/exp/experience.md`「語系字典與信件文字架構」.
- **判斷**: 信件文字是 settings 對外契約, 既有鍵之支援不可移除; 後端專用鍵不得外洩至前端酬載.
- **處理**: 三處齊備——內建預設(eng + cht 成對)、settings 覆寫鍵、`settings.json` 範本展示; 後端專用鍵同步加入 `emTextKeys` 剔除清單; 跑 `unit-lang` 與受影響 e2e 雙語系.

## 新增或修改 users / tokens / ips 之寫入點(多人同時編輯之寫入契約, 第 111 項)

- **關聯**: `server/procCore.mjs`(`updateTabItems`、`parseSaveOpt`、S01~S09 系統直寫)、`server/procProtect.mjs`(S15~S19)、`src/writeContracts/{users,tokens,tokensSession,ips}.mjs`、`src/baselineOf.mjs`、三個 `LayoutContent*.vue`; rulebook `rulebook_concurrency.md` R-CONC-01~05; ADR-091; `spec/流程_多人同時編輯.md`; 測試 `unit-writeContract`(契約摘要凍結)、`unit-saveBaseline`、`unit-tablock`(逐站點)、`api-concurrency`、`e2e-concurrency`.
- **判斷**: 三表之寫入一律先取該表鎖(`withTabLocks`, 非重入, 排序取得; users 相關撤銷為 `[tokens, users]` 同鎖), 鎖內重讀再寫, 寫經 `procOrm` 並帶 `mustExist`(只改不增; 新增走明確的新增路徑); 後台整表存檔走 `guardWrite` 比對基準(先動先贏, 整次拒收、零寫入), 只寫契約 `fields`, 伺服器專有欄位恆取庫內值. 契約 `fields` / `serverOnly` / `scope` 的增減會改變基準摘要, `unit-writeContract` 之凍結值會紅——這是提醒「全部舊頁面基準失效」, 須有意識地更新並在 README Upgrade Notes 註明.
- **處理**: ①新增任何寫 users / tokens / ips 之站點 → 補進 `unit-tablock` 站點清單(SITE-LOCK-S**)並跑變異(拿掉鎖須變紅); ②新增表欄位 → 先在契約分類為 client / dual / serverOnly, 再改 schema 與元件; ③動前端清單頁 → 基準須由「畫面顯示列」自算(`baselineOf.mjs`), 存檔成功後重拉列表當新基準, 拒收時保留草稿; ④不帶基準之寫入本 major 照舊允許(鎖 + 只改不增 + 專有欄位不採信), 下一 major 改為必帶——勿提前收緊(**唯一例外**: 金鑰清單存檔不論帶不帶基準都不得新增庫內不存在之 session 列〔`isApp !== 'y'`〕, 整次拒收 `tokenSessionAddNotAllowed`, ADR-092 / R-CONC-06; 應用系統金鑰列之新增照舊); ⑤受影響 e2e 範圍見 `rulebook_concurrency.md`「改動範圍 → 測試檔」.
