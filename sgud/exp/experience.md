# 累積經驗

本檔為執行工作時特有之累積經驗,留給後續之嘗試、執行與判斷,由agent自行編列、擴充與維護.

## 已抽出之舊經驗

2026-10-22 依全域設定 §14 把標題內首個日期 <= 2026-10-12 之經驗(共 42 節)抽出至 `experience_20261022.md`(原 79276 位元組); 常駐規則(套件身分與升級相容紀律、語系字典與信件文字架構)與 2026-10-14 起之經驗留於本檔. 抽出之節標題以 Grep `^## ` 於該檔檢索(含 e2e 標準圖 / 截圖穩定性、UI 元件陷阱、三方審查、w-serv-orm 1.1.7 / 1.1.8 適配等).

## 套件身分與升級相容紀律(最高優先, 違反即擋)

本專案是**發佈到 npm 供外部專案安裝引用的套件**(已知引用方: `rddmanager_sso`), 不是只服務自己的應用程式.任何改動先想「引用方原封升級會發生什麼」.鐵則(完整版與根因事證見 `spec/設計要點與取捨.md` ADR-050 與 `z修正規劃書.md` 升級破壞事件節):

1. **啟動契約不可破壞**: 舊版 settings 原封不動, 新版必須能啟動.新增設定鍵一律有程式內建預設值;「未給即 throw」僅限「有給但給錯」.
2. **新功能開關一律 opt-in**: 預設 `false`, `=== true` 嚴格判定才啟用.絕不讓新功能對既有引用方預設開啟.
3. **廢棄 settings 鍵須 WARN**: 停用鍵時於 `WWebSso.mjs` 啟動段以 `logBoot('warn', …)`(console 與 srLog 之 boot 事件)告知並說明替代或理由, 不允許靜默失效; 判定獨立成檔以便單元測試(現行唯一實例: `server/getIgnoredOrmKeys.mjs`, R-ORM-02). (2026-10-14 更正: 原載「加入 `kpDeprecatedKeys` 掃描」, 該機制從未存在於 git 歷史, `git log -S kpDeprecatedKeys` 為空.)
4. **內建資源須有覆寫管道**: 引用方改不了 `node_modules` 內檔案;模板走 `pathTemplate`, 語系走 `kpLangExt`, 內建值僅為預設.
5. **驗收須含「舊 settings 缺鍵啟動」情境**: `genTempSettings` 只能改值不能缺鍵, 抓不到此類破壞;須另以移除新鍵之 settings 實測啟動.
6. **主檔單一出口**: `server/WWebSso.mjs` 僅 `export default WWebSso`, 內部 helper 要測就搬獨立檔, 不得自主檔具名匯出.

## 語系字典與信件文字架構(單一字典, 分層覆寫)

**核心原則**: 所有語系文字(含信件標題與內容)統一存於單一語系字典 `kpLang`, **不得散落**.分層覆寫順序(於 `procLang.mjs` 初始化合併):

> **內建預設(`server/procLang.mjs` 語系鍵)** → **settings 信件文字鍵(逐語系覆寫, `kpLangExtEmail`)** → **`kpLangExt`(整鍵覆寫, 最終層, 供測試/CI 全面覆寫)**

新增 / 修改任何寄信功能時三處齊備:

- **內建預設(標題與內容)** → `server/procLang.mjs` 新增語系鍵(eng + cht;`*EmTitle` 與 `*EmContent` 成對), 內容鍵含 `{placeholder}` 由 `procCore.renderEmailText` 發信時自 kpLang 代入(值經 htmlEscape).信件文字皆為單行 HTML 字串, **不做檔案模板**;`server/template/` 只存放複雜到不好用純文字給的模板(現僅 `verifyEmailResult.html` 驗證結果頁).

- **安裝方覆寫(settings 鍵, 必須提供)** → 每個信件功能須支援對應之 settings `*EmTitle` / `*EmContent` 鍵(逐語系物件, 各值可給**文字**或**檔案路徑**——絕對或基於啟動路徑之相對, 檔案存在即於初始化讀檔作為內容, 不存在則原樣視為文字), 於 `WWebSso.mjs` 收斂為 `kpLangExtEmail` 傳入 `procLang` 逐語系覆寫入字典;此為安裝方於設定檔客製信件之**正式介面**(對齊「套件身分與升級相容紀律」第 1、4 條), **絕不可移除既有鍵之支援**.既有鍵: `chpwEmTitle` / `chpwEmContent`(變更密碼通知信, `{sender}`/`{name}`)、`regVerifyEmTitle` / `regVerifyEmContent`(註冊驗證信, `{sender}`/`{name}`/`{verifyUrl}`)、`resetPwEmTitle` / `resetPwEmContent`(重設密碼通知信, `{sender}`/`{name}`/`{account}`/`{newPassword}`)、`verifyEmailResultContent`(驗證結果頁, `{title}`/`{message}`, 單一字串非逐語系, 不入字典).

- **settings.json 範本展示** → 套件自帶 `settings.json` 須含上述全部鍵與預設文字, 供安裝方直接參考複製;新增鍵未展示於 settings.json = 功能沒交付完.

**前後端字典分流**: 傳送前端之 `webInfor.kpLang` 為 `kpLangWeb`(於 `WWebSso.mjs` 自 kpLang 剔除後端寄信專用鍵 `emTextKeys`)——後端專用文字**不得**外洩至前端酬載;新增後端專用語系鍵時須同步加入剔除清單.

- 結果頁另可用 settings `pathTemplate` 指定自訂模板資料夾(內放 `verifyEmailResult.html`, 缺檔回退內建).

- 合併順序由 `test/unit-lang.test.mjs` 直測守護(L1-L4), 改壞即轉紅.

**殷鑑(2026-08-20 升級破壞事件)**: 先前版本把 settings 之 `chpwEmTitle`/`chpwEmContent` 停止讀取並要求安裝方改用其他管道, 導致安裝方既有客製靜默失效——套件自帶預設怎麼存放是內部自由, 但 settings 既有鍵之支援是對外契約, 擴充不可破壞.

## 上游移除設定與全域行為: 擋板留著、判準交給上游; 盤點「上游不再代做之事」(2026-10-14, ADR-085)

- **上游移除設定時, 先問「若直接轉交會怎樣」**: w-serv-orm 1.1.10 對已移除之三鍵給予非 null / false 即建構拋錯; 本套件交的是固定 false / null / false, 不會壞, 但若有人「清理」成把 settings 直接轉交, 部署方舊設定立刻使後端啟動失敗. 擋板必須保留, 只換判準: 逐鍵委派上游之 `checkOptRemoved`(上游註解明載供包裝層用), 使「警告」恰為「若轉交即被拒絕」之值, 判準只有一份. 原判準 `v !== 固定值` 是 1.1.8 語意(null 視同 true)之產物, 以三鍵 × 12 種值之語料逐格比對才看出 3 格不一致與三鍵不對稱.
- **建議書之理由要對已安裝之版本重驗**: 建議書寫於上游下一版發布之前, 其「1.1.9 起 OPT-006 已不能分辨」在 1.1.10 不成立(getProc 對誤交之 true 拋錯). 以模組解析 hook 把 `w-serv-orm/src/*` 導向 `npm pack` 之舊版發佈包, 三版各跑一次 unit 與取證腳本, 不動 node_modules.
- **上游拿掉它代做的全域行為, 依賴它的站點會靜默變成崩潰點**: w-serv-hapi 1.1.5 在建構子註冊 process 層監聽(吞掉未處理之 rejection), 1.1.6 移除後, procProtect 計時器內未接住之 reject 使後端行程結束; 1.1.5 下雖存活, 手寫之重入鎖只在成功路徑釋放, 失敗一次即永久停擺——兩個缺陷疊在一起, 測試全綠也看不到(自然情況下 LMDB 之讀取很少失敗). 以 unitProc 攔得之計時器回呼注入失敗、在子行程中分別「有／無 1.1.5 同款監聽」執行, 才看得到兩種失敗形狀. 修法收斂為單一包裝(`server/wrapTimer.mjs`), 不在本套件註冊全域監聽(那正是上游移除之理由).
- **「無法停止」之前提要隨上游能力回頭檢查**: api-setup 之強制 exit、e2e-tokens 之「API client 只在比對端」都以「WServHapiClient 無法關閉」為前提; 1.1.6 起 `clearBroadcast()` + `clearSync()` 可停止(只呼叫其一無效), 但 api-setup 未保存實例, 拿掉 exit 仍會卡住——前提失效不等於可以直接拆, 先保存實例並呼叫停止, exit 留作保險.
- **基準與修改分開, 驗紅不靠還原工作樹**: 基準 `npm test` 跑完(538 / 538, 約 99 分鐘)才把 `./tmp/run02/stage/` 之修改套用到工作樹; 驗紅以 `git archive HEAD` 之沙箱(單元)與 NODE_OPTIONS 帶入之模組解析 hook(把後端子行程之 `server/WWebSso.mjs` 導向 HEAD 副本, api)執行, 不用 stash / checkout.

## 打包後 TDZ 之歸屬要以 2×2 拆, 不看錯誤拋在哪一段(2026-10-14, X1 / ADR-086)

- **錯誤位置 ≠ 綁定之主人**: HEAD 之完整 bundle 有兩處頂層 `__filename`(本套件 callWorker 與 w-syslog 1.0.32); rollup 為避名把 w-syslog 者改名, 但兩處 `import.meta.url` 墊片都引用原名 → 都綁到 callWorker 之綁定. 錯誤拋在 w-syslog 段(先求值), 被存取而 TDZ 的卻是 callWorker 之綁定. 只看「拋在 w-syslog」會誤判為「X1 與本套件無關」. 歸屬以該綁定之**宣告處**判定(其後是否接 worker 檔名).
- **minify 後之 bundle 用型態找宣告**: terser 改名後 `__filename` 字樣消失, 以 `<名>=<x>.fileURLToPath(` 找宣告、以 `pathToFileURL(<名>)` 看墊片綁到誰; 單行 bundle 之「附近文字」啟發式無效(整份都在同一行).
- **上游尚未發布之修正, 以 `./tmp` 內副本模擬, 做成 2×2**: {HEAD, 現行} × {w-syslog 原樣, 副本把頂層 `__filename` / `__dirname` 移入函數}, 在 `./tmp` 之 server 副本把 `srLog.mjs` 之 import 改指該副本(不動 node_modules、不動他套件 repo). 結果只有「現行 × 模擬修正」載入成功——同時證明 X1 為必要條件、剩餘 TDZ 只屬上游.
- **解析器之變異測試找到一個釘不住之分支**: 7 個變異以模組解析 hook(`X1_MUT_FILE`)逐一導向後跑單元測試, 「模組解析後不驗存在」存活. 查證: 真 Node 之 `createRequire().resolve()` 對缺檔之深層路徑一律拋 `MODULE_NOT_FOUND`(有無 `exports` 皆然), 該分支只在替換解析器時可達; 補 RSW-008(注入回傳不存在之路徑)後 7 / 7 皆被抓到. 姊妹套件之同組案例尚無此案(報告主控).
- **`npm pack --dry-run --json` 之輸出形狀**: 此環境(npm 11)為以套件名為鍵之物件, 不是陣列; 取 `Object.values(j)[0].files`.
- **兩槽測試鎖之 detached 包裝**: 由 detached 程序輪詢兩槽之 `mkdir`(原子), 寫入 `owner.txt` 後跑單一指令, finally 只在 owner 與自己寫入者逐字相同時刪除; 等待與執行皆不掛在工具呼叫上(背景只輪詢結果檔), 工具逾時不會留下孤兒鎖(`tmp/run03/locked-run.mjs`).

## 發布前升級輪: dist 冒煙之 cwd 假設、專案流程之升級附加項、持鎖閘門(2026-10-14 run04, ADR-087)

- **冒煙之 cwd 要像「已安裝之專案根」**: 第一次把 bundle 交給空的暫存 cwd 啟動, `WWebSso` 於讀內建模板 `./server/template/verifyEmailResult.html`(cwd 相對; 已安裝時為 `./node_modules/w-web-sso/server/template`)同步拋 ENOENT. 姊妹套件(w-web-task)同場景只有被捕捉之 `invalid fpEntryIn`, 照抄其佈局會誤判. 改為暫存 cwd 下放 `node_modules/w-web-sso`(發佈包內容之副本＋建出之 bundle): 模板與 `index.html` 都落在副本, 不寫 repo 之 `dist/`; 暫存夾位於 repo 內, worker 與 formatter 之相依自然由 repo 之 `node_modules` 解析. 此行為屬設計限制(帳本已知缺口「套件自帶檔以 cwd 相對路徑定位」), 不是升級造成.
- **升級時翻專案流程之「升級某套件時另做」**: 主控之指示只列 unit / api 全跑＋e2e 子集＋冒煙; `sgud/proc/process.md`〈ORM 寫入點與 w-serv-orm 升級〉另規定升 w-orm-lmdb 時跑跨行程舊快照回歸腳本並連跑 PERM-A-001. 每次升級都要對照專案流程逐條找附加項, 不只照派工清單做.
- **e2e 子集依「寫入機制」挑, 不依檔名**: 後端寫入有五種機制(清單儲存經 procOrm、自助註冊之 procOrm insert、`ormWrite` save、直接 `woItems.insert`、`del`), api 全層已以真後端與真 LMDB 覆蓋各機制, e2e 子集只需補 UI 可見之流程(統計、登入、一個清單儲存). 理由與未跑之檔要寫進報告.
- **持鎖期間不改檔: 等鎖包裝加閘門檔**: run03 由 detached 包裝於等鎖時自動取鎖, 取鎖時我仍在寫文件. run04 之包裝先等閘門檔(主代理改完碼與文件才建立)再輪詢鎖, 等閘門之時間不計入等鎖.
- **報告之數字由產物算, 不憑印象**: 冒煙之檢查項先口頭說成 21 項, 以 `Object.keys(result.checks).length` 核對為 20, 已更正; 凡報告引用之計數一律以指令自產物取得.

## 建議書只列一角, 同根因要連容器與消費端一併盤: 使用端 / log 字串作物件鍵(2026-10-20, 主控第 90 項, ADR-088)

- **建議書範圍之外才是重點**: 建議書(w-web-perm 唯讀盤點)列的是統計頁 `each(v.data)` 4 站(鍵為 `length` 時被當陣列樣迭代). 以「使用端 / log 字串為鍵之容器」為軸全量盤點後, 同根因另得: 未登入單一請求使後端結束(`X-Forwarded-For: constructor`——`kpIpCallApi[ip].push` 拋 `TypeError`, 呼叫處為未 `await` 之 async)、統計計數累加成字串、`haskey`(以 `in` 判)誤判重複、新使用者密碼被清空、前端把含 `.` 之 IPv4 當 lodash 路徑. R-ERR-01 規則 4 原載「不會 reject」, 前提(容器無原型)從未成立過——帳本上的「已核對」要連前提一起驗.
- **修一端要看另一端**: 伺服端修正後 `length` 成為輸出中的真實鍵, 前端 `each(omit(entry.data,'count'))` 同型缺陷就從「資料被吃掉」變成「前端迭代走偏」; 兩端同輪修. 前端邏輯從 `.vue` 抽成純函式模組(`src/plugins/staUsage.mjs`)才可單元測試, 並以「修改前逐行複本」作一般資料下之等價對照(`refCalc`).
- **JS 字面量陷阱**: 測試資料寫 `{ '__proto__': 2 }` 不會建立自有屬性(非計算屬性名、值非物件時被忽略), 要用 `['__proto__']: 2` 或 `JSON.parse`; ESLint 之 `quote-props` 要求同一字面量鍵引號一致、`no-proto` 擋 `obj['__proto__']`(用 `// eslint-disable-line no-proto`).
- **同埠不並行, 探測腳本也算**: e2e-stainfor 跑到一半, 我用同一專案埠(11007)的探測腳本 `restartBackend` 並 `resetToBaseSeed`, 使 e2e 兩案失敗、後端被殺; 停掉後須自查殘留之 web 鎖(自己的 `quiet-run` 被 TaskStop 終止時鎖不會釋放, 確認 pid 已不存在且 owner 為自己再移除)後整檔重跑. 探測與 e2e 一次只能一條鏈, 探測改在 e2e 之前或之後.
- **Windows 工作樹為 CRLF、HEAD blob 為 LF(`core.autocrlf`)**: 變異腳本以字串比對原始碼時要先把 `\n` 轉 `\r\n`, 否則整批 `SKIP`; `git diff` / `git show HEAD:` 看到的是 LF.
- **統計實測不污染 `./logs`**: 統計頁讀 `logFd` 全部 log, 植入標頭值的測試以臨時 settings 的 `logFd`(`test/_tmp/<案名>/logs`)重啟全新後端, 同時得到空的 30 秒統計快取; 結束時以預設 settings 重啟並還原 base seed(`ips` 表會被偵測計時器填入標頭值).
- **HTTP 端點與資料通道的差別**: `/api/checkToken` 這類 HTTP 路由不經 `verifyConn`(不讀 `X-Forwarded-For`、不登錄 IP); IP 封鎖與計次只發生在資料通道 `/api/main`. 探測 IP 相關行為要打 `POST /api/main`(本體無效不影響, `verifyConn` 先記 log 再解析本體).

## 來源 IP 衛生與計數鍵清理: 測試先對 HEAD 跑、三處預期被實測推翻、外審補出清理與記錄路徑之邊(2026-10-20, 主控第 93 項, ADR-089)

- **先寫測試、先對未改程式跑, 才抓得到「我以為的語意」**: 初版 IP-U-003 預期「首段為空 → 退回連線位址」, 對 HEAD 一跑, `', 203.0.113.9'` 回 `203.0.113.9`——wsemi `sep` 各段 trim 後略過空段; 語意要沿用(使用者裁示不改取值語意), 改的是測試. 另: `net.isIP('::1%' + 'b'.repeat(15000))` 回 6(zone 識別碼長度無上限), 單靠 `isIP` 會放行萬字元「IP」, 才加長度上限 64. 依賴行為(`sep`、`isIP`)先以一行 node 實測, 不憑記憶.
- **內部狀態要有觀察點, 而且不能靠實作細節**: 初版以「`getInforsBy*` 連呼兩次是否同一陣列」判定鍵是否存在(不新增對外函式), 外審指出該判準依賴 getter 回傳內部陣列本體、且觀察不到帳號容器(完全停用帳號剪枝仍全綠). 改加診斷用 `pp.getKpKeyCounts()`(`pp` 為套件內部物件, 非對外 API)後, 三容器皆可斷言鍵數, 並以「帳號剪枝計時器停擺」變異證明轉紅. 端到端另以「系統管理者刪除的 `ips` 列是否被偵測計時器復活」證明鍵確實退場.
- **identity 守門只防「寫回」, 不防「依舊快照做決定」**: 計時器停在第一個鍵的封鎖寫入時, `cleanKpIpCallApi()` 換掉容器; 初版 `pruneKpKey` 只跳過覆蓋 / 刪鍵, 呼叫端仍以舊陣列之 recs 判定封鎖(清空計數後, 尚未處理的鍵仍被封鎖)——外審兩位皆指出. 修為舊快照回 `null`、計時器略過(CNT-009). 用「在 `p.getIpByKV` 放控制閘門讓計時器停在 await 中途」的測試重現競態, 靜態讀碼不易看出.
- **在兩個 await 之間取快照要放在最後**: `ipDetectNew` 原先先取 `Object.keys(kpIpCallApi)` 再 `await p.getIpsList()`, 讀取期間被剪枝刪鍵的 IP 仍被登錄. 取鍵移到讀完清單之後(CNT-011); 在途輪次(取鍵之後的 `insert`)仍可能登錄, 帳本載明為限制.
- **使用端可觸發的記錄路徑要吞錯並清控制字元**: 非 IP 標頭可使 `warnInvalidForwardedFor` 執行, `srLog.warn` 拋錯會使取 IP(進而 `verifyConn`)失敗; 時鐘回撥使限流窗口失效; `preview` 未置換控制字元與既有 `maskToken` 衛生不一致. 皆為外審補出, 修後各有轉紅測試(IP-U-006b / 008 / 009). `safeText` 抽至 `srLog.mjs` 單一擁有.
- **窗口類整合測試的餘裕要算**: IP-A-004 初版用 3 秒窗口(偵測與剪枝計時器皆每 2 秒), 登錄與剪枝之間只剩約 2 秒, 負載稍高即不穩; 放大為 6 秒窗口(`minForIpCallApi: 0.1`)、等待 11 秒 + 7 秒, 全案約 30 秒.
- **變異要先確認它真的改了語意**: w-web-api 的 A5 變異(把讀取改成 lodash 陣列路徑)第一次植入「全部測試仍綠」, 原因是自有屬性判斷還留在前面、變異等價; 改成整個函式換成 `get(item, ['data', key], def)` 後才轉紅(SF-003 原型鍵名). 變異腳本要印出 SKIP 與等價疑慮, 不只看紅綠.
- **變異期間不得同時跑會重啟後端的測試**: 變異腳本暫改 `server/procProtect.mjs`, e2e / api 的 `restartBackend` 會載入半成品. 變異全跑完、以 sha1 核對還原後, 才啟動 api / e2e 鏈; e2e 進行中不改 `server/`. 外審修正後(程式再改)須重跑變異、api 層與 e2e.
- **外審的探測夾具可能建立連接點**: minimax 在其輸出夾中建了 `out/mm/node_modules` → 本 repo 之 `node_modules` 的連接點; 清理外審副本前須先以 `cmd //c rmdir` 移除連接點(只移除連結本身), 不可對含連接點的目錄遞迴刪除.
- **工作樹的行尾因檔而異**: `server/`、`README.md`、`CLAUDE_*.md`、`spec/` 為 CRLF, `test/` 為 LF(`git ls-files --eol` 可驗); 本機 Bash 的 `grep -c $'\r'` 不可靠, 以 node 計 `\r\n` 與單獨 `\n`. 多行改動用腳本(讀入 → 轉 LF → 取代 → 寫回原行尾), 避免混行尾.
- **run02(2026-10-20)裁示 1: 帶 port 的 `X-Forwarded-For` 不得退回連線位址**: run01 把 `1.2.3.4:80` 歸為「非 IP → 退回連線位址」, 方向上與「不改語意」相悖——多層反代 / 雲端閘道(標頭常帶來源 port)下全部使用者都會變成閘道位址, 頻率限制與自動封鎖誤封所有人. 判斷這類「衛生」是否改了語意, 要問「在使用者實際部署下, 被判成同一個 IP 的人變多了嗎」. 去 port 只收 `IPv4:port` 與 `[IPv6]:port` 兩種形式、port 1~5 位且 ≤ 65535、去後 `isIP` 版本須與形式相符, 其餘維持原樣或退回; `[::1]`(無 port)、`[1.2.3.4]:80`(括號 IPv4)刻意不收.
- **測試框架本身的請求會登錄 `127.0.0.1`**: `restartBackend` 的就緒探測不帶標頭, 其請求經 `verifyConn` 進 `ips` 表與統計; 斷言「ips 表恰為某集合」會被它污染(IP-A-006 初版即因此失敗). 改斷言「預期各恰一列 + 其餘只可能是連線位址」, 「不退回連線位址」的證據由 IP-A-007 的封鎖行為(8 個不同 port 若退回連線位址會封鎖連線位址)與 IP-A-006 的各 IP 計數(退回則為 0)提供.
- **白名單的位置決定它對稽核與探測是否仍有意義**: 欄位名白名單若置於入口 `srLog.info` 之前, 白名單外之查詢無稽核紀錄, 且 `maskKv` 對非識別欄的遮罩不再有可觀察路徑(`api-srlog-noleak` 的 `tokenVerify` 探測失去目標). 置於其後、`checkToken` 之後: 被拒仍有紀錄(value 已遮罩)、未授權者先得 `tokenExpired` 不能探測白名單; 該探測反而可同時驗被拒(固定 key、不回顯).
- **網址範本的完整參數比對不能依賴 `?` 與 URL 解析器**: `unit-external-helpers` 以 `data:application/json,{"x":"token={sysToken}&key=token&value={token}"}` 模擬 SSO, 佔位符在 JSON 字串內、無 `?`; 故 `hasUrlParam` 用前後字元類別(`(?<![A-Za-z0-9_.~%-])name=value(?![A-Za-z0-9_.~%-])`)比對, 不先解析查詢字串.
- **Bash 工具誤 `cd` 後 cwd 會被 harness 改成該目錄**: 本輪在審查包目錄用 `cd ... && sed` 後, 其後 `quiet-run` 的 `./tmp/quiet-run` 與相對路徑指令都落在錯處; `quiet-run` 有 `--cwd`, 其餘用絕對路徑或 `git -C`.
- **呼叫鏈文件(`spec/流程_自動封鎖機制.md`)的行號與步驟會悄悄過時**: 本輪核對 B / C / D 段, 發現 `lockingForXxx` 互斥旗標(2026-10-14 已改 `wrapTimer`)與數十處行號皆已不符; 行號改以腳本由現行原始碼 grep 重取(冪等, 可重跑), 並在〈已知落差〉留「原載不成立」紀錄. A 段(登入失敗封鎖)本輪未動, 行號未重取.


## 多人同時編輯之寫入契約第二波: 站點全取表鎖、先動先贏、選項 P; 測試替身與變異驅動之坑(2026-10-23, 主控第 111 項 sso-run01, ADR-091)

- **替身資料表要跟著核心的新語意一起升級, 否則一片假紅**: w-serv-orm 1.1.17 的 `mustExist` 以 `select({ id: { $in: [...] } })` 檢查存在、並轉傳 `save(data, { autoInsert: false })`; `test/tools/unitProc.mjs` 的 `mkTable` 原不支援 `$in`(以 `===` 比對), 一接上 `procOrm` 全部判為不存在而 26 案紅. 先補替身(`$in`、`autoInsert:false` 未命中回 `n:0`)再看真紅. 以 `StubWOrm` 令真實 `WServOrm` 的 `woItems` 即替身表(`mkServ`), `withTabLocks / guardWrite` 因而是核心真實作, 不自寫鎖替身.
- **改變行為的既有測試要分「意圖」與「 fixture」**: `ormWriteFail` / `api-ormopts` 數案用 `isApp:'n'` 的 session 列測「清單儲存刪除 / 修改之寫入失敗處理」, 其意圖是 ORM 失敗處理而非 session 語意; 不帶基準的 tokens 改為「session 列不刪不覆蓋」(D3)後, 把這些案例的 fixture 改成應用系統金鑰列即保留意圖, 不要改斷言去遷就. 凡新增列(A23 鑄造使用者 token)仍須照常新增——ADR-084 已接受該能力, 勿因 D3 字面連新增一併收掉.
- **單元替身會被新依賴打穿, 逐個補**: `procProtect` 改成在表鎖內重讀使用者並經 `procOrm` 寫入後, `unit-countKeys` / `unit-iterClientObj` 的手寫 `woItems`(只有 `save`)與 `p`(只有 `revokeTokensByUserId`)要補 `select` 與 `revokeTokensByUserIdLocked`, 且 `save` 收到的是陣列(procOrm), 斷言要攤平.
- **「讀到之後被刪」的深度防禦要用第 n 次 select 當鉤子, 且數清楚是哪一次**: `afterSelectDelete(table, id, nth)` 在第 nth 次回傳該列的 select 之後刪列; 登入失敗封鎖路徑會先讀該使用者 4 次(`getBlockedByAccount` 與 `p.loginByAccountAndPassword` 各一, ×2), 第 5 次才是 `blockAccount` 的鎖外讀取, 第 6 次是鎖內重讀. 第一版測試只斷言「列不復活」, 刪掉鎖內重讀的變異(M37)照樣綠——要再斷言「鎖外讀後被刪 → 靜默無從封鎖、不記失敗」與「鎖內讀後被刪 → mustExist 拒絕並記失敗」兩種不同結果.
- **變異驅動自身要先驗證, 對照組必跑**: 第一版驅動以離開碼判 KILLED, 全部「被抓到」實為副本缺 `src/plugins` 等檔而載入失敗(`ERR_MODULE_NOT_FOUND`); mocha `json` reporter 的 `output` 選項不被接受; 專案檔為 CRLF 致多行 `find` 全不匹配. 修正: 副本複製整個 `src`(排除 components)、解析 spec reporter 的 passing / failing 數、無變異對照組(M00)須全綠、載入失敗另列 RUNERR、比對前正規化 CRLF. 驅動腳本歸檔於 `agent-out/sso-run01-probes/mutate.mjs`.
- **站點取錯表鎖當變異最省**: 把 `withTabLocks(['tokens'], ...)` 的表名換成無關的 `['ips']` 即等於該站點不受該表鎖保護, 單行文字替換、不改語法, 19 站點逐一可做(M01~M14); 對照 `unit-tablock` 的「他人持鎖時等待」案例一對一抓到.
- **外審 beam 對跨層檢查看不到**: beam#1(session 列被他人升級為 app 後持舊畫面者刪除該列會被「靜默略過」)忽略了 `guardWrite` 的 app 層嚴格比對會先因多出一列而整次拒收; 以 `SB-T13` 實測證偽. 審查者質疑「某分支靜默略過」時, 先問「更前面的檢查是否已擋掉進入該分支的所有路徑」.
- **LMDB 舊版列與 `order` 重編**: 後台使用者存檔以 `resetOrder` 依位置重編 `order`, `order` 值與名次不同的列(如 fixture 的 900、舊資料的空字串)首次存檔即被判為修改而重寫並戳記更新者. 測「未動之列不被重寫」時, 舊版列的 `order` 要設成與名次相同(6 列的最後一列為 6).
- **密碼政策 `noConsecutiveCharsFromAccount` 會讓測試帳號與密碼互撞**: 帳號 `dupacct` 配密碼 `Pass@9876` 因連續 2 字 `pa` 被拒; 測試帳號與密碼用互不重疊的字串(`dupone` / `Zq#8765Wm`).
- **web 測試鎖的兩個槽可能被他專案占數小時**: 排隊中的 `quiet-run --lock` 本身不輸出; api 層(無瀏覽器)不需鎖, 先跑; e2e 以隱藏 `Start-Process node quiet-run ... -- node tmp/<名>/run-e2e.mjs` 排隊(PowerShell 命令列不可含 `>` 重導), 進度看 `Get-CimInstance Win32_Process` 的 mocha 命令列與 `./testPending/` 有無新檔(quiet-run 的 log 結束才落地).
- **守門 hook 的長相**: `cd`(改用 `quiet-run --cwd`、絕對路徑)、heredoc(`node -e` 內的 heredoc 也算; 改 Write 腳本)、PowerShell `>` 重導皆被擋; 不繞道, 照訊息作法.
- **「鎖外判定、鎖內只重讀一部分」是最容易漏的一格(外審 sol 抓到 #3、#4)**: 先在鎖外判定身分 / 登入條件、再進鎖寫入時, 鎖內重讀要涵蓋**鎖外判定所依據的每一項**, 不只「列還在不在」: 自動封鎖(S15)依帳號名、(S16)依 token 的 `isApp` 與擁有者決定封鎖對象, 等鎖期間後台可改名 / 升級 / 換擁有者; 登入(S01)依密碼、`timeVerified`、`timeExpired` 通過驗證, 重設密碼(同鎖撤銷 token)之後仍可能鑄出以舊密碼通過驗證之 token, 且回傳值也要取鎖內新鮮資料. 檢查法: 列出每個站點「鎖外讀了什麼、據以決定了什麼」, 逐項在鎖內再驗; 測試用 `holdLocks` 讓站點卡在鎖前, 再以直接寫替身表的方式改掉該項, 放行後斷言結果.
- **只驗「曾經等待」的鎖測試抓不到『先空取鎖再釋放、於鎖外做事』(外審 sol#12)**: `assertWaits` 驗他人持鎖時站點不完成, 但站點若先 `withTabLocks(t, async () => {})` 再在鎖外做原讀寫, 一樣會等待而通過. 補一支不另持鎖的案: `mkEnvSso({ trackLocks: true })` 包裝 `withTabLocks / guardWrite` 計算站點自己持有的表鎖、包裝資料表的 `insert / save / del`, 寫入發生時該表鎖未被持有即記入 `env.outsideWrites`; 變異 M47 / M48 只有這一案抓得到.
- **接線錯誤用靜態守護先擋、行為另證**: 鎖管理器接錯(procProtect 拿到另一組)或清單頁漏帶第 4 參數, 單元層的 `mkServ` 共用鎖與 API 層皆不會發現(前者自行注入正確的鎖, 後者進程分離). 以讀原始碼的 `WC-09 / WC-10` 當最快的一層警報(去掉行尾註解後數 `withTabLocks` 出現次數與注入形式), 並明說它只證接線; 真正的行為證明是 `e2e-concurrency`(舊畫面存檔被拒必須經頁面真送基準才成立).
- **採納外審修補後必須重跑相關 api/e2e 全檔, 不能只跑自己新增的單元測試**: sol#8(不帶基準以送入原值比對有無編輯, 令 null / 缺欄 perms 原樣重送零寫入)與 sol#5(perms 只驗將寫入之列)兩項修補, 單元層全綠, 全跑 `api-apptoken-perms` 才發現與 ADR-069 既有行為衝突(PERM-A-005:DB 既有毀損 / 缺欄 perms 存回時須正規化為空陣列;PERM-A-004:字串 perms 即使正規化後與庫內相同亦須 `tokenPermsInvalid`)。#8 撤回、#5 改為「帶基準時略過摘要同基準之列」。教訓: 審查者提議的『更嚴 / 更少寫入』常與既有規格化行為衝突, 先查既有測試與 ADR 再採納; 採納後以受影響層全檔驗證。
- **web 測試鎖(`quiet-run --lock`)非 FIFO、每 20 秒輪詢, 兩槽被他專案長期占用時排隊可達 1 小時**: 取得後要在**單一鎖持有期間**串完所有需瀏覽器之步驟(寫成 `chain-*.mjs` 逐步 `spawnSync`: 產標準圖 → 比對 → 重跑受影響 e2e), 不要每步各自排隊; api 層(無瀏覽器)不需鎖, 但與排隊中的 e2e 共用 11007 埠, 排隊期間勿跑 api(鎖一到手兩者撞埠). 若須中途放棄持鎖行程: 殺 quiet-run 會**留下殘留鎖目錄**(`C:/opensrcOper/tmp/locks/<槽>/owner.txt` 之 pid 已死), 確認 owner 為自己之 pid 後才可自行 `rm -rf` 該槽目錄(只釋放自己建立者).
- **新案例標準圖若含隨機值先固定資料**: `ds.tokens.funNew` 產生之 token 為隨機 UUID, 系統管理者 session 列顯示於金鑰清單畫面, 使 `E2E-CC-002` 比對差 127~130 px(> maxDiffPixels 100); 固定 token 字串後只重產該案兩張(`--baseline --names E2E-CC-002`)即可, 不需遮罩.
- **e2e 檔間隔離: `ips` 表之列不只來自 DB, 清庫不等於回到固定種子(sso-run02, 2026-10-23; 主控全套 759 / 2 失敗 `E2E-CC-003` 差 134 px)**: `procProtect` 之 `ipDetectNew` 計時器(每 2 秒)把 `kpIpCallApi` 內「`ips` 表尚無」之 IP 補登進表; `e2e-autoblock` 以 `X-Forwarded-For` 登記之 `1.2.3.x`(最後一案 E2E-010 為 `1.2.3.203`)留在後端記憶體, 其 `afterCase` 只清 DB 不清計數(原註解載「由下一案 prepare 重置」, 但最後一案之後沒有下一案), 之後任一檔重設 `ips` 表, 數秒內殘留 IP 即被補登回來, `e2e-concurrency` 之 IP 清單畫面因此多一列(標準圖 4 列、全套 5 列). 單獨跑無前序測試故綠, 單一 mocha 行程依序跑 autoblock → concurrency 即可穩定重現(修前 6 綠 2 紅, 皆 `diff=134px`); 計數留 10 分鐘(`minForIpCallApi`)才因無新請求被剪枝, 故中間隔著幾個檔仍中. 處置三層: ①`test/tools/e2e-setup.mjs` 收斂 `cleanKpIpCallApi` / `cleanKpAccountLoginFailed`(原只在 autoblock 內, 補丁堆積); ②殘留來源(autoblock `afterCase`)**先清記憶體計數、再清 DB**(反之計時器可於兩者之間補登回已清空之表); ③受害檔(concurrency `prepare`)同序處理, 並以 `assertSeedOnly` 守門: users / tokens / ips 三表主鍵集合須恰為「base seed + 本檔種子」(多出者連 ip 一併列入錯誤訊息), 把隔離被破壞報成明確隔離錯誤而非事後像素差. 不重產標準圖(標準圖正確, 錯在輸入狀態). 規則: **凡顯示 `ips` 清單畫面之 e2e 檔, `prepare` 須先清 `kpIpCallApi` 再重設; 凡以 `X-Forwarded-For` 登記虛擬 IP 之檔, `afterCase` 須清計數**——「前序檔之 server 記憶體殘留」與「前序檔之 DB 殘留」是兩種獨立之隔離缺口, 重設 DB 只擋後者. 驗證法: 單一 mocha 行程依序跑「殘留來源 + 受害檔」之最小組合, 而非各檔單跑(單跑永遠綠).
- **審查者說「已讀碼確認」仍須自己追**: sol 14 條中 4 條採納(#3、#4、#5、#10, 皆有可重現測試且修前紅)、1 條採納後撤回(#8)、4 條屬測試缺口(補測試)、5 條為不帶基準固有限制或 HEAD 既有行為(#1、#2、#6、#7、#9). 判斷是否採納的三問: ①是本輪引入還是 HEAD 既有(`git show HEAD:<檔>` 對照)? ②修了會不會改變不得改變的流程語意(封鎖 / 登入 / 既有 UI)? ③審查者假設的前提是否成立(例如『不帶基準不能覆蓋 session』是審查者對任務的解讀, 與規格 §6 / §8 不符)?
- **「已知限制、不改」若牽涉撤銷 / 封鎖被繞過,獨立實操會再挑出來,應改問另一個問題(sso-run03, 2026-10-23)**: 外審 sol#1 把「不帶基準送回已撤銷 session 列會復活」當『無從分辨新增與舊列』之固有限制不採,獨立實操(sso-verify01 註記 1)證明它是可繞過自動封鎖之安全缺口。換個問法即解:不必分辨「是不是舊列」,只要問「這個新增本身合法嗎」——session 權杖只由登入產生,清單從無新增 session 列之入口,故庫內不存在之 `isApp !== 'y'` 列不論新舊一律拒收,與基準有無無關。凡限制與『撤銷、封鎖、權限』相關者,先找「這個動作本就不該有此入口」之解,再考慮分辨舊新。
- **新守門要先列『合法但長得像』之路徑並豁免,再以變異鎖定(sso-run03)**: 守門若直接套「所有庫內不存在之 session 列」,載入後才被登出者(基準內、系統管理者未動、庫內已無)會使正常存檔被拒,破壞選項 P 與 X1 之略過語意(SB-T03、CC-A-011)。故豁免『在 `baseline` / `baselineSession` 內者』,並以變異 M02(不豁免)、M09(只豁免 app 基準)、M06(不看庫內)鎖定;拒收判準用 `!== 'y'`(缺欄、空字串、大小寫變體皆是),以變異 M05 鎖定。
- **修前紅之 API 層可在單一取鎖期間換入修改前複本,但必須 finally 還原並以 sha256 回驗、再確認 11007 / 8080 無殘留監聽(sso-run03)**: 先把修改前之 `server/procCore.mjs`、`procLang.mjs` 存複本,取鎖後換入、跑新增之 api 案(後端子行程載入修改前版)、還原、回驗 sha256 相符、殺殘留後端,再跑修後綠與回歸,全程一次取鎖(排隊 37 分鐘,不宜分兩次取)。純記憶體之 unit 不開 port、不起瀏覽器,不取 web 鎖,可在排隊期間先做完紅綠與變異。
- **既有測試遇行為收回時,逐案分『意圖』與『fixture』(再次驗證)**: A13 / A18 / IT-C-003 意圖在主鍵標記 / 鍵長 / 原型鍵名,fixture 的 `isApp:'n'` 改為應用系統金鑰列即可;唯 A23 的意圖本身(鑄造使用者 token 可行)被收回,改為斷言整批拒收並以應用系統金鑰列續驗擁有者保留——不是改斷言遷就,是規格變了(ADR-092)。

## 改密碼後之 session 處置與 redir 檢查範圍(2026-10-23, sso-run04, 第 117 / 116 項, ADR-093 / ADR-094)

- **規格翻案時,舊決定會同時躺在 ADR、spec 多處、程式註解與「測試斷言」**: 第 117 項推翻 ADR-009(重設 / 改密碼不清 token)。unit 全綠、api 全跑才露出 `api-resetpassword` API-008 斷言「重設後兩 token 仍存在」——它編碼了舊決定, 屬「規格變了」而非「放寬測試」: 同案號改斷言新規則(並加 app 權杖當對照組), 於帳本與 ADR 註明。動手前先 Grep 測試與 spec 之「不清除 / 仍存在 / 保留 / 不觸及 tokens」類字樣(本輪事後才找: spec 4 處、ADR 3 處〔ADR-009 / ADR-001 / ADR-037〕、測試 1 案)。
- **「全有或全無」在無交易之 DB 上不可能嚴格達成, 要明確選最壞狀態可接受之次序並寫進 ADR**: 密碼寫入與 session 撤銷是兩次寫入。先撤銷後寫密碼的最壞狀態是「多登出一次」; 反過來撤銷失敗會留下「新密碼生效、舊 session 仍有效」。不採補償回滾(回滾本身可失敗)。測試要把兩種失敗(撤銷失敗、密碼寫入失敗)各鎖一案, 並斷言「驗證未過時一個權杖都不撤」。
- **刪除 / 停用 / 封鎖之撤銷函數不可共用於改密碼**: `revokeTokensByUserIdLocked` 按 `userId` 刪名下一切權杖, 而 app 權杖之 `userId` 是擁有者——共用會把使用者擁有之 app 權杖一併撤掉。另立 `revokeSessionTokensLocked` 加 `isApp !== 'y'` 與 `exceptToken`; 測試必含「以被改密碼者為擁有者之 app 權杖」當對照(變異 S4 只有它抓得到)。
- **api 層測系統管理者重設: 後端對同一 targetUserId 有 30 秒節流(`adminResetPasswordAlreadyTriggered`)**, 同一後端行程內多案重設同一對象, 第二案起回節流錯誤而假紅(本輪第一版 PSA-002 / 005 即如此)。每案各建自己的被重設對象(`mkTarget(key)`), 不要靠前一案之間隔。
- **修前紅的「紅點」要照實寫, 別憑推論寫成預期畫面**: 換入 HEAD 版 `LayoutContentUsers.vue` 實跑 E2E-016, 紅在儲存前斷言(自助註冊者空 redir 格已標警示圖示, `img` 數 1 ≠ 0), 不是我先前設想之「儲存後出現錯誤 modal」; spec、ADR 與帳本之「修前紅」敘述須以實跑為準(儲存被擋另引獨立實操 sso-verify01 之實測, 不自行宣稱)。
- **以「值」為鍵之錯誤表遇空字串會把所有空值格一起標**: 舊 `errItemsByRedir` 以 redir 值(`''`)為鍵, 任一列觸發即全部 redir 為空之儲存格亮警示。改以列主鍵為鍵(同 `cellPasswordErr`)並抽成純函式 `src/usersRedirCheck.mjs`(容器無原型, R-KEY-01)才可單元測試; 元件只留接線, 接線以靜態守護(UR-W01~03)加 e2e 補。僅 e2e 抓得到之變異(元件不傳基準)須另用 e2e 驗。
- **新 e2e 案例所需之額外 seed 不可併入 `testUsers`**: `insertTestUsersAndTokens` 對 `Object.values(testUsers)` 逐一插入, 併入即改變所有案例之清單列數而動既有標準圖; 另立常數(`selfRegUser`)於該案之 run 內以 woItems 預置(setup 例外)。新增前後以 `tmp/<名>/hashpics.mjs` 對 `test/pics` 全檔算 sha256 比對, 證明既有圖 0 張改變、只新增 4 張。
- **變異驗證可在 `./tmp/<名>/mut/` 之 repo 子集副本施作, 不必 junction**: node 之模組解析從檔案位置往上找, `./tmp/.../mut/server/x.mjs` 會一路找到 repo 根之 `node_modules`; 副本只要 `server`、`src`、`test/*.mjs`、`test/tools`、`package.json`。好處: 完全不動 repo 根之檔, 可與 e2e 長鏈同時跑。驅動要點(承 sso-run01): 對照組必跑、from 須恰命中 1 次、換行依檔案正規化(CRLF)、還原後逐項驗 sha256; 僅 e2e 抓得到者(`e2eOnly`)另標。需真後端 / 瀏覽器之變異才在 repo 根施作, 並排在 e2e 鏈之後。
- **外審(sol, 15 分鐘, 6 條)全數有效, 且「先審後跑長鏈」才不浪費**: 本輪先啟動 e2e 長鏈再等外審, sol 回來後須改程式, 只好停掉鏈(鏈內已跑完之 `e2e-resetpassword` 作廢)重跑全部受影響檔——外審之提示詞與材料齊備後應**先派審、審完修完再開 e2e 長鏈**; 單元層變異與 unit / api 全跑可與外審並行(不動 repo 根)。sol 抓到之四類通則: ①**鎖外驗證、鎖內寫入之請求要於鎖內再驗「發出請求之憑證仍有效」**(本項: 自行改密碼等鎖期間 session 被另一請求撤銷, 仍可改密碼並連對方保留之 session 一併撤銷; 與 sso-run01 之「鎖內重讀鎖外判定所依據之每一項」同源, 憑證本身也是一項); ②**`let err = null … .catch(e => { err = e }) … if (err !== null)` 之哨兵在 reject 值為 null / undefined 時失效**, 新寫之程式改用布林旗標(HEAD 既有之同型寫法未動); ③**存於 Vue data 之物件若以使用端字串為鍵, Vue 2 響應式會以 `__ob__` 鍵覆蓋同名鍵之值**——改用 `Map`(Vue 不處理, 亦無 `__proto__` 衝突), 並以真 `new Vue({ data })` 驗證加純物件對照(測試證明舊作法確被覆蓋); ④**前端 fail-closed 若後端必拒, 前端先擋反而遮住有用之提示**(redir 比對基準 null 時後端對無基準之存檔一律拒收並提示重新載入, 前端不必也不應對既有列先擋)。另: 靜態接線守護以字串計數時, 註解也會被算進去——計數前先去行尾註解, 並斷言兩處賦值各緊接 baseline 賦值(同一快照)。
- **免費外審模型之實際行為(2026-10-23)**: `opencode/beam-free`(xhigh, edit deny, bash ask)兩次皆在讀完檔後試圖以 `find` / `wc -l` 量東西, bash 被自動拒絕, **整個 run 隨即結束且 stdout 空白**(`OUTPUT_VALIDATION_FAILED`, 非額度問題), 重試一次(提示詞補「不要嘗試其他工具、最後訊息不得空白」)仍同; `opencode/nemotron-3.5-super-vl-free` 6.4 分鐘完成、含步驟 0 之原文引用、3 條有效建議(皆為測試缺口)。審查者之工作目錄用 `tmp/<名>/review/snap/` 唯讀快照(`server`、`src`、`test/*.mjs`、材料, 無 node_modules / 標準圖 / spec), 與同時進行之變異與 e2e 互不干擾; 提示詞預先給檔案路徑與行段, 免其用 bash 量。

## 應用系統金鑰兩種用途與使用者身分驗證缺口(2026-10-24, sso-run01, ADR-095 / R-APPTOK-01)

- **「與登入同一判準」要逐字用登入之謂詞, 不要用名字像的共用函式**: 新寫「使用者目前可用」判準時直覺取 `mShare.checkUserBasic`, 它與登入(`isestr(timeVerified)`、`tn > timeExpired`、`isActive !== 'n'`)不同——`getIsVerified` 要求 timemsTZ、`getIsActive` 要求 `'y'`、到期含等號. 舊版(`now2str` 秒級)寫入之驗證時間可登入卻立即被判失效, 是外審才抓到的缺陷, 自測全綠(自測之使用者資料全是新格式). 通則: 判準宣稱「等同 X」時, 先把 X 之謂詞抄出逐條對照, 並把「X 放行之邊界資料」(舊格式、缺欄、空值)放進測試.
- **加欄位改畫面會牽動「別的 flow 之標準圖」**: 金鑰清單加「用途」「名稱」兩欄, `e2e-concurrency` E2E-CC-002 之背景含金鑰清單, 其標準圖必須重產; 任務若限制只可動 `test/pics/tokens/`, 改動前先用 `Grep` 找「背景含該頁之他 flow」(含訊息框底圖), 提前在報告列為裁示, 不要到比對紅燈才發現. 同案另有「測試劇本本身違反新規則」(該 flow 雙擊改應用系統金鑰字串, 而字串建立後已鎖)——改劇本時保留場景本質(他人直寫庫改應用系統金鑰列 → 嚴格整表比對 → 舊畫面存檔被拒), 只換畫面上改的那一格.
- **橫向捲動之表格要自己決定「停在哪」**: 欄一多, 權限欄、到期欄於 1280 寬即在可視範圍外; `ensureColumnVisible` 預設把欄標頭置中, 會把相鄰欄擠出(到期欄被切掉); 要「權限欄 + 其後兩欄」同框須貼齊左緣(`align:'start'`). 橫向捲動後 `rowBoxSel`(固定欄列 ∪ 捲動欄列)之捲動欄矩形左端落到視窗外, 紅框左緣被夾到圖緣而蓋住側欄, 且 `captureStableWithBox` 之被蓋住檢查會對「固定欄蓋住捲動欄中心」報錯(凍結欄設計)——用量測型目標(夾在表格框內之可見部分)取代 `coverCheck:'off'`.
- **審圖用「裁切放大」量框與字之距離**: 目視 1280×720 全圖判不出 1~2 px 之壓字; 以 `sharp` 對框邊區域裁切並 3 倍最近鄰放大(`tmp/sso-run01/crop.mjs`), 框內緣至文字墨跡之距離一眼可見. 成對語系之圖版面相同時, 逐位元相同者(檔案大小相同可先疑, 以 sha256 確認)只審一張.
- **單元測試以「第 N 次讀取後刪列」模擬競態者, 新增任何一次讀取都會移位**: `SB-S02` 之 changePassword 以 `afterSelectDelete(env.users, id, nth)` 在第 nth 次 `users.select` 後刪列; 在鎖內新增一次 `getActorByToken` 即使 nth 由 4 變 5. 改動鎖內之讀取次數時須同步檢視此類計數型測試(註解已寫明各次讀取之來源, 照改).
- **procStaInfor 之單元替身須提供 `getTokensListCache`**: 統計頁 `getStaToken` 現讀金鑰清單以顯示系統服務用途之金鑰名稱; `unit-iterClientObj` 兩處 `procStaInfor({}, { getUsersListCache })` 缺此函式即整支 `getStaDataFailed`.
- **鑄造類入口之失敗判定一律用旗標**: `.catch((err) => { errTemp = err })` 之後 `if (errTemp)` 在 reject 值為 `null` / `undefined` / `0` / `''` 時誤判成功, 回傳一把未入庫之金鑰; 以 `isErr` 布林旗標判定並補假值拒絕之單元案(AU-22). 同型之 HEAD 既有寫法(`createToken` 等)未動.
- **等鎖後之寫入類入口要在鎖內再驗「發請求者仍有權」**: 簽發永久憑證者(`createAppToken`)尤須如此(`recheck` 於鎖內呼叫只讀之 `checkToken`); 驗證以 `holdLocks` 持鎖 → 觸發 → 於等待期間直寫替身表停用操作者 → 放行 → 斷言 `tokenExpired` 且零寫入(SITE-LOCK-S11b); 同法以第二次同操作者呼叫驗 `lockSave` 占位(S11c: 第一次等鎖中, 第二次立即 `saveInProgress`)——比「兩次並發」之 api 測試確定得多(後者在移除 lockSave 後兩次皆成功仍符合 `okN>=1`).
- **失效 token 子類不能只測空字串**: 矩陣之「無 token」格以 `''` 呼叫, 另有未知字串(不得洩漏 `invalid token` / `duplicate tokens` 等內部字串)與已逾期之登入 token 兩子類(MX-DEAD, 27 入口 × 2); 登出類入口對已逾期登入 token 刻意放行(持有者清理自己之權杖), 以矩陣鎖定此例外而非留作隱性行為.
- **外部工具**: 此環境之 hook 擋 `sed -i`、`cat >`、`cd`, 改檔一律 Edit/Write; 暫時換檔與變異測試用 `tmp/sso-run01/swap.mjs`(備份 → 套用 → 跑 mocha → finally 還原並比對 sha256 → 印摘要), 在 `quiet-run --lock` 之下執行; 長鏈以 `nohup bash chain.sh &` 脫離工具呼叫, 進度寫檔(同 `dispatch-codex` 之 detached 作法). 免費外審模型(nemotron、beam)於 13:45 起額度用盡("Free usage limit reached"), 先試單次探測再決定是否派工, 不要把額度用盡之回應當作審查結果.
- **`quiet-run --lock` 之等待上限約 7 分鐘, 逾時即放行而非繼續等**(2026-10-24 實測: 兩個排隊中之 `--lock` 行程皆顯示「等待 7m00s」後與前一個持鎖行程並行執行): 同時排入多個會占 11007 / 8080 之行程時, 先排者若超過 7 分鐘, 後排者會與之重疊, 變異驗證換入之檔案與 `restartBackend` 皆會汙染正在跑之 e2e(本輪 `e2e-deleteuser` 因此一輪 4 敗, 棄用重跑). 通則: 長鏈一律**單一腳本依序執行**(一個 `chain.sh`), 不另開第二條鏈去排隊; 要插入新步驟時等當前鏈結束再開新鏈, 或停掉鏈驅動(殺 bash 不殺 quiet-run 子行程)改寫新鏈.
- **變異腳本之換行**: repo 檔案為 CRLF, 多行 `from` / `to` 須轉 `\r\n` 才找得到(`swap.mjs` 原版以 LF 比對, m1 / m3 一開始整個沒套用, 離開碼 1 但被誤當「已跑」); 每個變異 config 用前先 `node -e` 對檔案 `includes(from)` 驗證恰一次, 變異結果須讀 summary 之 `results.length` 不為 0.
- **互為備援之兩道防線, 單點變異抓不到屬預期**: S-6 前端之模板 `allowUserRegistration &&` 與 `showResendVerify = vo.allowUserRegistration` 任一單獨移除, e2e 仍綠; 驗證改以兩處同時還原為 HEAD 版(`mode: 'head'`)證明斷言有牙, 並於報告如實寫明.
- **外審「先審後跑長鏈」又一次成立**: sol 於 14:07 回覆 15 條, 其中 6 條需改程式(綁定值 XSS、鎖內再驗、即時判準、旗標、統計身分、前端重載生命週期), 全在長鏈啟動前修完; 未先審即跑鏈者(第 117 項輪)得停鏈重跑.

## 升級不得使已失效之應用系統金鑰復活(2026-10-24, sso-run02, ADR-095 補記 / R-APPTOK-01 第 11 點)

- **「升級時尚未逾期者日後不得失效」+「升級前已逾期者維持失效」兩條同時成立, 只能靠持久標記, 不能讀取時由欄位推導**: 讀取時只看 `timeEnd` 無法區分「升級時未逾期、日後才成為過去值」與「升級前已逾期」; 唯一做法是在升級當下(伺服器啟動)一次性寫入標記(`appUsage`: `system` / `retired`)。標記寫進既有伺服器專有欄位(不入基準), 開啟中之後台清單不因遷移而過期; 冪等靠「只處理仍缺標記者」。測試須含「假時鐘前進後重啟零寫入且未逾期者仍可用」(UP-13), 否則誤把推導當標記時會一直綠.
- **「升級前」之判定要取自舊碼實跑, 不取自讀碼**: `git archive <舊 commit> server src` 解到 `./tmp/<名>/old/`, 以舊 `procCore` 搭記憶體資料表實跑 `checkToken`(舊碼一路往上解析套件到 repo 根之 `node_modules`, 不需 junction), 得「逾期 / 缺欄 / 空字串 / 格式錯」皆 `tokenExpired`、未逾期可用; 判準函式 `classifyLegacyAppToken` 與測試表 `BEFORE_UPGRADE` 皆以此為源, 不是憑記憶寫. 缺欄與格式錯在舊碼是 `invalid timeEnd`(reject, 對外仍 `tokenExpired`), 與逾期同結果——會被誤當「無期限」而視同可用.
- **未定案之列一律「依舊規則即時判定」勝過「進行中 / 失敗時全拒」之狀態機**: 初版用 `running / failed` 狀態旗標使未定案列一律不可用(fail closed), 隨即發現①遷移進行中會中斷升級前可用之整合, ②在鎖內等待遷移會與已持鎖之站點互鎖, 所以只能靠旗標不能 await; 改為讀取端(`loadActor`)以同一判準即時判定、`getTokensList` 回傳該判定之用途供後台顯示與統計(前端不推算, 見下)——永不比升級前更寬、失敗與進行中皆不改變可用性、無狀態機, 程式更小. 通則: 「遷移失敗時之行為」先問「降級後之行為是否就是升級前之行為」, 是則不必另設拒絕路徑.
- **改變某類列之語意後, 測試種子中「半新半舊」之列會悄悄變成另一種**: e2e `test-token-4`(無用途欄之舊格式列, `timeEnd` 空字串, 在 E2E-005 當憑證做端到端不變式)依新判準已是已失效而不可用; 改為固定遠期 `timeEnd`(畫面對應用系統金鑰一律顯示「不設期限」, 故 92 張標準圖 sha256 0 變動)。凡植入無 `appUsage` 之 app 列並作憑證使用者, 須給合法未逾期之 `timeEnd`(`api-apptoken-usage` LEGACY 同改).
- **新增欄位文字須在「最窄欄寬」下逐語系實看**: 英文「Invalid (before upgrade)」在用途欄(150px)被截成「Invalid (before upgr…」, 靠 dry-run 目視才發現(語意斷言讀 `innerText` 抓不到截斷); 改 `Invalid (legacy)`(約 19 字元為上限). 新增畫面文字之同一輪即應各語系截圖看.
- **新標準圖待授權之作法(共通守則 19)**: 案例照常實作並以 `E2E_BASELINE_OUT_DIR=./tmp/…` 實跑確認產出圖鍵與檔名; 比對端以案例旗標 `pendingBaseline` 換用 `matchPendingBaseline`(缺檔只記 `[pending-baseline]`、存在即照常比對), 語意斷言與端到端不變式不鬆; 授權產製後旗標可拿掉。產圖指令不得省略 `E2E_BASELINE_OUT_DIR`, 否則 `--baseline` 直接寫進 `test/pics`.
- **標準圖重產後以全目錄 sha256 證明「只動了授權範圍」**: `hashPics.mjs` 於重產前後各算 462 檔雜湊再 `--diff`; 重產成品另與前輪乾跑成品比對(此次逐位元相同, 即同一程式碼同一環境下產圖決定性)。
- **變異腳本之 `find` 須依檔案現況轉換行尾**: `mutate.mjs` 讀檔後偵測 `\r\n` 並把多行 `find` / `replace` 之換行轉為同款(sso-run01 之 `swap.mjs` 曾因 LF/CRLF 不符使變異整個沒套用卻被當已跑); 套用前驗 `find` 恰出現 1 次, `finally` 還原並以 sha256 回驗.
- **外審(sol, 20 分鐘, 9 條 + 10 格)全屬實且有 2 條高: 先審後跑長鏈, 且審查者之「變異 + 重現腳本」比讀碼意見更有價值**: 審查者在副本自建夾具, 對本輪單元測試跑三個變異(拿掉 `mustExist`、全表讀取移到鎖外、字串比較改時刻比較)皆 59 / 59 全綠, 直接證明測試漏洞; 另以重現腳本證實①升級同時換伺服器時區會改判(字串序隨 `tn` 之偏移而變)、②未定案之已失效列統計仍計「有效」、③前端以瀏覽器時間推算與後端不一致、④部分落地後 reject 未清快取。收回後逐條自行重現再改: 判準加時刻比較、`getTokensList` 回傳即時判定之用途(統計與前端皆取該值)、前端不推算、不論成敗皆清快取、補 UP-21~24 與截斷幾何斷言, 並對每項做變異驗證(拿掉實作 → 對應測試轉紅). 提示詞之「請特別找 ①~⑥」逐項列出要找之方向, 使審查者把力氣放在「找漏格」而非評價方案.
- **「字串比較時間」與「時刻比較」之差異只在非本機偏移或換時區時才現形, 必須以舊碼實跑當 oracle**: 舊碼 `tn < timeEnd` 為字串序, 對 `Z` / `+14:00` / `-05:00` 與換伺服器時區皆與時刻序不一致(實跑: 同一批 `+08:00` 資料, 伺服器改 UTC 後舊碼對全部 9 列皆判可用); 以假時鐘 + `TZ` 環境變數對舊碼實跑得 oracle 表, 再決定「升級前判定 ∧ 時刻未逾期」從嚴之規則並把與舊碼之差異列成表(UP-23, 差異僅 c6). 不要憑「合法 ISO 時間」之直覺寫期望值。
- **前端不得對「伺服器時間相關之判定」自行推算**: 初版為使未定案列顯示一致而在前端以 `ot()` 重算用途, 瀏覽器時區 / 時鐘 / 存檔後保留之舊清單皆使它與授權判定分歧, 且分歧方向可使可用之金鑰被顯示成已失效(系統管理者可能據以誤刪)。改為後端 `getTokensList` 回傳即時判定值(伺服器專有欄位, 不入基準、存檔不採用), 前端只顯示。
- **缺圖(待授權)之標準圖案例仍須有語意層之視覺不變量**: `innerText` 於欄寬截斷時仍為完整字串, 英文「Invalid (before upgrade)」被截成「…upgr…」靠 dry-run 目視才發現; 缺圖期間比對端跳過 pixel 時, 補「儲存格 `scrollWidth ≤ clientWidth`」之幾何斷言, 以長標籤變異驗證會紅(158 > 148)。
- **MX-DEAD 擴格比解釋「單一咽喉保證」更可靠**: 已失效之列各入口一律不可用, 原可由 `loadActor` 單一咽喉論證; 仍補成 27 入口 × 已失效列 = 27 格(拒絕鍵、零寫入、`refreshToken` 維持 `tokenAppNoRefresh`、登出類放行並刪本列), 失效 token 子類 54 → 81 格.

## 框架系統函數之身分關卡: 「恆回空身分」下只能收窄到前端開機必需者, 以真瀏覽器擷取代替讀碼推論(2026-10-25, sso-run01, ADR-096 / R-SYS-01)

- **任務原目標(「另兩者須身分」)被實測推翻——讀碼推論不是證據**: 讀框架註解可推論輪詢必須公開(用戶端 `openOnce` 是「第 1 次完成 `[sys:polling]` 後才觸發」, 其後才取函數清單、觸發 `getServerMethods`), 但仍暫改 `sysFuncsPublic` 為只列 `[sys:getFuncList]` 實跑一次(E1): 登入頁停在「Connecting...」、輪詢被拒後重試 19 次、`$fapi` 不可用. 結論(輪詢必須公開、`[sys:getTableTags]` 可拒)以 E1 / E2 兩組實驗寫進 ADR-096 與帳本, 並成為 `api-sysfuncs` 的變異(M2 / M3)。
- **擷取請求本體: `request.postDataBuffer()` 對 XHR 二進位本體回 null**(`context.on('request')` 取不到 `__sysInputArgs__` 與 `__sysToken__`)。作法: `context.addInitScript` 攔 `XMLHttpRequest.prototype.send`(ArrayBuffer / 視圖 / Blob 三型), 經 `context.exposeBinding` 把位元組送回 Node, 以 wsemi `u8arr2obj` 解 `{ func, input: { __sysInputArgs__, __sysToken__ } }`; 回應端以 `response.body()` 解 `{ success: { func, output } }`(輪詢輸入另是 `{ clientId, __sysToken__ }`)。只記 token 之「空 / 非空(長度)」, 不記值。
- **預載模式要守衛**: `node --import <預載檔>` 或 `NODE_OPTIONS` 會傳給**所有**子行程(後端 `srv.mjs`、前端 dev server 也會載入並 `import('playwright')`); 預載檔以 `process.argv` 含 `mocha` 才攔 `chromium.launch`。如此直接跑既有 e2e 檔即可彙整整個套件的網路呼叫, 不必改任何測試檔。
- **開機呼叫的 `__sysToken__` 登入前後恆為空字串**: 框架用戶端在前端 store 取得 token 之前就開機(`getFuncList`、`getTableTags` 皆然); 登入後是整頁轉址再開機, 同樣先於 token 設定。⇒ 「登入後改以帶 token 之系統函數呼叫取得」在 sso 不成立, 唯一可行處置是「頁面資料一律走 kpfun 明確 token 參數」(現況即如此); 讓 `getUserIdByToken` 回真實 id 也解不了(登入頁匿名仍須輪詢; 輪詢的 clientId–身分綁定使同一連線由匿名變登入身分被拒; 且改變 1.1.15 行為)。
- **被拒之 `[sys:getTableTags]` 的副作用要看清楚再決定列不列**: 前端用戶端把拒絕當 `error` 事件, 瀏覽器主控台 0 筆錯誤、頁面完全正常; 伺服端每個頁面載入發出一則 `{ msg: 'permission denied', func: '[sys:getTableTags]' }`(`srv.mjs` 的 `on('error')` 會 `console.log`)。不在 `WWebSso` 內吞掉(會遮蔽其他 `permission denied` 事件), 以 README 說明可依 `msg` / `func` 過濾。api 測試共用 client 的 `error` 監聽器對此預期拒絕改印明確訊息, 避免被讀成「連線重試」。
- **變異驗證: 以 Edit 暫改一行 → 跑單檔(約 25 秒)→ 還原 → `git diff` 回驗只剩預期行**: M1 改回預設(註解掉) / M2 只列 getFuncList / M3 只列 polling / M4 明列三者; 分別被 3 / 2 / 2 / 3 案抓到(SF-01~05)。**原始碼不得留實驗痕跡**: 實驗用的暫時行以 `EXPERIMENT` / `M<n>` 標記, 最終用 `git diff` 確認僅留最終行與註解。
- **SF-04 的預期要實測不要憑直覺**: 缺 `__sysToken__` 鍵時框架在身分關卡「之前」就回 `invalid token`(非 `permission denied`); 空字串 / null / 非字串 / 有效 token 才進關卡回 `permission denied`。首版斷言全部寫 `permission denied`, 對最終設定也紅, 靠先在變異(預設)版本跑才發現預期寫錯。
- **共用基礎(連線層)異動的 e2e 範圍與時間**: 每個 flow 的每個頁面載入都經框架用戶端開機; 全套 15 檔 290 案約 35 秒 / 案 ≈ 170 分鐘, 超出單輪(4 小時)預算與外審並行之餘裕; 本輪改依頁面類別選 9 檔並載明未跑檔, 全套由主控凍結碼跑。長鏈以 PowerShell `Start-Process -WindowStyle Hidden` 脫離工具呼叫(先以 `$env:` 設環境變數), 需改排程時對其 PID `taskkill /F /T`, 再以 `quiet-run --release-stale --cwd` 回收本套件殘留鎖(不手動刪鎖)。
- **dist 重建三步**: `npm run build`(vue-cli 會清空 `dist/`, 連帶刪掉 tracked 的 umd)→ `node toolg/genEntry.mjs`(`index.html` 改名 `index.tmp` 並把 `/msso/` 換成 `{sfd}/`)→ `node toolg/gDistRollup.mjs`(重產 umd); 只做第一步會讓 `dist/w-web-sso.umd.js` 消失。`dist/index.html` 為後端啟動時由 `index.tmp` 產生(gitignore)。`docs/`(jsdoc)屬發布流程, 本輪未重產。
- **外審(sol `gpt-6.1-sol` max 12.2 分鐘 35 條; opus `claude-opus-5-5` xhigh 走 API 金鑰 11.7 分鐘 34 條, 皆唯讀審查副本)找出之格, 自審表全漏**: ①「框架封裝鍵」軸(缺 `__sysToken__` → `invalid token`、缺 / 非陣列 `__sysInputArgs__` → `invalid input`, 公開函數亦然; 輪詢另在廣播層先檢 `clientId`); ②「嵌入者」軸(`WWebSso` 回傳實例可 `getInstWConverServer().broadcast` ⇒ 公開輪詢之『恆回空』不是本套件內部事, 靜態守護 SP-01 + 文件); ③「同一 clientId 之 token 序列(匿名 → 有效 → 空)」(擷取摘要把 clientId 遮成 `<id>`, 看不出同一連線之切換; SF-02 序列 + SF-06); ④「舊版框架用戶端 × 最終後端」(只驗協定形狀不是整頁行為, 改以真舊版用戶端實測); ⑤多處過度主張(輪詢『立即』實為 `setInterval` 2 秒後首輪、E2 之 S6 歸屬、『下游不受影響』、『登入後不依賴任何系統函數』、『約 30 個呼叫點』)。**兩家獨立指出同一格(嵌入者 broadcast、token 序列、舊版相容)者價值最高**; 兩家各有數條互補(sol: 封裝鍵與輪詢兩套錯誤封裝、設定檢核邊界、對標連結; opus: 資源面細項〔`sizeMsg` 預設 100 MiB、`useShowLog`、clientId 無上限〕、`dist` umd 是否含設定、log 不進 `srLog`)。
- **外審副本作法**: 只拷貝被審之檔(`WWebSso.mjs`、測試、ADR / README / 帳本之新增節、框架 `src/`)與證據摘要(`summ.mjs` 之彙整、`ui-*.jsonl`)到 `tmp/<案>/review/`, 不放 `node_modules`、不放金鑰; 提示詞以功能正確性措辭(sol 之內容審查), 副本內之註解 / 文件以腳本把敏感字眼中性化(不動程式識別字); sol 於 `out-sol/` 自寫報告(`workspace-write`, 提示詞明寫唯一可寫處與「探測在自建夾具」), opus 唯讀 `--tools Read,Glob,Grep` 以 `--output-format stream-json --verbose` 取最終 `result`。**Claude API 金鑰作法(技能根 `w-dispatch-ai` 1.0.55 無 key 參數時)**: 派工腳本啟動即刪除自身 `process.env` 之 `CLAUDE_CODE*` / `CLAUDECODE` / `CLAUDE_AGENT_SDK*` / `ANTHROPIC_*`(子程序會繼承而沿用訂閱), 再以 `env: { ANTHROPIC_API_KEY }` 傳入; 以 init 事件 `apiKeySource` 為 `ANTHROPIC_API_KEY` 確認; 金鑰只在記憶體(`readEnvFile` → `ANTHROPIC_KEYS` 第一把), 結果落檔前以字串替換遮蔽(實際未出現)。
- **全套中一次性之 pixel 失敗要先看圖再下結論**: `e2e-concurrency` E2E-CC-003 cht 差 340 px, 三聯組顯示 capture 少 `127.0.0.1` 一列(baseline 有); 該列由後端 `ipDetectNew` 計時器(每 2 秒)於瀏覽器首個請求後補登, 擷取時間軸顯示瀏覽器於開機後約 1.8 秒即載入 IP 清單, 早於補登之機率約 10%, 屬測試之計時器相位賭注(既有, 非本輪連線層變更造成)。同案單獨重跑 10 案(5 檔 × 2 語系)0 敗; 修法為偵測驅動等待(`pollUntil` 等 `ips` 表出現 `127.0.0.1` 後才開清單), 非加長固定等待、非放寬容差、非重產標準圖。**判別「測試手段 / 時序」與「產品缺陷」之依據**: 失敗列為標準圖之既有第一列缺席(非新增視覺差異)、同案重跑不重現、時間軸解釋成立。

## schema 欄位顯示名稱(`name`)只改字: 先查消費者、以 bundle 逐字比對代替重產標準圖(2026-10-26, sso-run01, Gitea issue #17)

- **schema 欄位 `name` 在本套件內無消費者**: `src/schema/index.mjs` 經 w-data-collector `build()` 把 `name` 收成 `ds.<表>.kpHead`(`node_modules/w-data-collector/src/build.mjs:113-124`), 但三清單頁各自以 `vo.$t(...)` 組自己的 `kpHead` computed(`LayoutContentUsers.vue:825-850`), 伺服端只用 `ds.<表>.funNew`, 測試只用 `keys` / `funNew`。⇒ 只改 `name` 不改任何畫面, 不須重產標準圖。畫面標題之真實來源是 `server/procLang.mjs` 的語系鍵(`isAdmin` cht「是否為系統管理者」)。
- **證明「只改一字」的便宜作法**: `node node_modules/@vue/cli-service/bin/vue-cli-service.js build --dest tmp/<案>/dist-new`(約 50 秒, 不動 tracked 的 `dist/`)後, 以 Write 寫小腳本對 `dist/js/app.<hash>.js` 與新 `app.<hash>.js` 取最長共同前後綴, 中間差異即全部差異(本案恰一字 `員`→`者`); `chunk-vendors` 與 css 檔名〔內容雜湊〕不變即其餘位元組不變。這同時證明已提交之 `dist` 與 HEAD 原始碼同步。
- **用詞統一的範圍要看提示詞字面**: run01 之提示詞只授權舊「員」字用詞一詞; 未加「系統」前綴之單獨用詞(`procLang.mjs` 6 處 cht、信件範本、README)改了會動既有標準圖(如 `cannotDemoteSelf` 之 modal), 超出當時標準圖重產授權, 故只盤點、不改、列待裁示; 使用者 10-26 裁示後由 sso-run02 全面統一(見下節)。
- **建議書之敘述要逐句核對**: 本案建議書稱角色顯示「系統管理者」「非系統管理者」, 實測非系統管理者角色顯示為「一般使用者」(`userRoleGeneral`), 「非系統管理者」只出現在已註解掉的 `isAdminN`(`procLang.mjs:416-419`); 核心主張(schema 與 `procLang.mjs:410` 不一致)屬實。
- **既有 lint 殘留(未動)**: `src/schema/tables/users.mjs` 第 1 / 5 / 7 行 `map`、`dtpick`、`now2strp` 為未使用之 import(eslint `no-unused-vars` 3 條, HEAD 即如此)。

## 角色用詞全面統一為「系統管理者」: 先掃前綴分布再批次替換; 文字變長使彈窗 / 浮層連外框改變, 超出「差異僅為文字」授權者不重產(2026-10-26, sso-run02, ADR-097)

- **批次替換前先掃前綴分布**: 以腳本統計「管理」+「員 / 者」前 2 字之分布與各一例(`git ls-files` 全追蹤檔, 排除 `dist/`、`docs/`), 確認本套件內此詞皆指 `isAdmin` 之系統管理者而無其他角色, 才套三條規則——`(?<!系統)`負向後行斷言(舊「員」字用詞→`系統管理者`; 單獨「管理」+「員」→`系統管理者`; 單獨「管理」+「者」→`系統管理者`)可冪等、不產生「系統系統管理者」。腳本輸出逐行改前 / 改後之 TSV 供稽核; 替換後再 grep 重複、同語反覆(「X→X」)與標題長度。排除: 提出方建議書原文(其主題即舊用詞)、「系統管理單位」(指組織)。
- **守門測試自己不能含禁用詞**: 專案以 `git grep` 檢查用詞統一, 守門測試之禁用詞須以 Unicode 跳脫寫成正則(`new RegExp('\\u7ba1…')`); **Write 工具會把內容中的 `管` 直接解碼成字元, 須寫成 `\\u7ba1`**, 寫後以 `grep -c` 驗證檔內確實無該字串。同一原則: 歷史敘述(`sgud/`)不得再引述舊用詞字面, 以「舊『員』字用詞」等描述。
- **cht 文字變長會改變容器寬度, 標準圖差異不只文字**: 7 個 cht 鍵改文字後, 19 張 cht 標準圖受影響, 其中 7 張(登入頁訊息行、固定寬度 CheckYes 之提示〔折行位置移動〕、新增金鑰對話框之權限清單)紅框與容器不變、差異外接框只含文字行; 12 張(`cannotDeleteSelf` / `cannotDemoteSelf` 之 modal 寬度隨文字、WPopup 權限浮層寬度隨最長項)連框線與面板一併改變。分流判準: 以舊 / 新兩圖計算差異外接框與「差異像素是否落在框線紅(#ff2266 ±16)上」(`diffOnFramePixels`), 為 0 且外接框僅數十列高者屬文字區域; 否則屬容器重排。授權範圍僅限前者時, 後者列待授權並備候選圖與舊 / 新 / 差異三聯, 不自行重產。
- **失敗案例只回報第一個不符之階段, 後續階段之差異被隱藏**: 一案多階段(如 `e2e-tokens` E2E-008 之 5~8)首個不符即拋錯, 重產前階段 5 後再跑才在階段 6 紅。須以案例鍵(`--names cht-E2E-008`)於 `E2E_BASELINE_OUT_DIR` 把該案全部階段產到暫存目錄, 逐張與現行標準圖比對, 才能列全受影響階段(本案 tokens 4 案共 13 張受影響, 首次執行只回報其中 4 張)。
- **`testPending/` 內同圖名有歷史三聯組**: `ls <label>__*__baseline.png | head -1` 取到最舊者而得到錯誤差異數; 取本輪者用 `ls -t` 或依 mtime 過濾(`tmp` 之 `analyze.mjs` 依 mtime 與時間戳分組)。
- **dist 重建三步之坑**: ①經 `quiet-run -- a "&&" b` 傳 `&&` 會變成 vue-cli 之 entry 參數而 build 失敗, **但 vue-cli 在開始時已清空 `dist/`**(tracked 之 umd 一併消失), 須分三次指令跑(`build`、`toolg/genEntry.mjs`、`toolg/gDistRollup.mjs`); ②production 之 vue-loader scope id 含檔案內容雜湊, 只改 `.vue` 註解也會改變 `app.*.js` / `app.*.css` 檔名雜湊(`chunk-vendors` 不變); ③`docs/`(JSDoc)重產於未改程式之檔也會因「產生時間」不同而全數相異, 只取代有實質差異之檔。
- **等測試鎖之成本**: 兩槽被他套件占用時單次等待 12~48 分鐘; 一次整理成少數幾個鏈(每鏈一次取鎖), 且自己多個 `--lock` 指令會依序而非並行。把候選產圖、比對驗證各合併成一次執行, 避免多次排隊。

## 授權重產後之收尾: 單一鏈保證「先重產後重跑」之次序; spec title 縮短不動測試(2026-10-26, sso-run03)

- **重產與其驗證 e2e 必須同鏈一次取鎖**: 自己排隊之兩個 `--lock` 指令誰先取到鎖不保證, e2e 先於重產跑會對舊標準圖全紅。以一支 node 鏈腳本(`spawnSync` 依序: 重產 → 逐檔隔離 e2e, 重產失敗即不續跑)交給單一 `quiet-run --lock`, 51 分鐘(重產 4 次約 3 分鐘 + 95 案)一次完成。
- **授權前之候選圖即授權後之結果**: sso-run02 以 `E2E_BASELINE_OUT_DIR` 產出之 12 張候選圖, 與 sso-run03 實際寫入 `test/pics` 者逐位元相同(`cmp`), 故主控目視候選圖即等於目視最終圖; 重產後以工作樹 sha256 前後比對證明只有該 12 檔(加 spec)改變、其餘標準圖 0 變動。
- **spec title 縮短之判斷**: 先 `git grep -F "<舊標題>"` 查引用處(本案測試以 `E2E-NNN-<kebab>` 與圖鍵命名, 不含標題, 故測試檔 0 改動); 縮短後以 `git grep -h "title:" | sort | uniq -d` 驗全部 spec 內仍唯一(手冊以 title 為鍵); 長度以字元數計, 英文字(`Users list`、`isAdmin`)與空白各算 1。把按鈕英文標籤(`Reset password`)換成中性描述(「重設密碼鈕」)可省最多字, 且 title 不隨語系; 保留「系統管理者」用詞。下游手冊內容檔在本 repo 外, 無法核對者於報告與 state 註明。

## w-serv-orm 診斷輸出導入 srLog: 先問「上游預設拿掉的是什麼」、funLog 收不到呼叫輸入、遮罩要有「不知情的值」紅燈案例(2026-10-28, sso-run01, 第 154 項, ADR-098 / R-ORM-04)

- **「預設不含個資」拿掉的不只是 id**: w-serv-orm 1.1.20 讓 console 不再有主鍵, 但本套件各 `srLog.error` 站點本就記 `userId` / `account`(識別欄照記是既有稽核政策, 規則帳本並無「日誌不記 id／個資」), 真正失去的是 **ORM 錯誤原文**(procOrm 的 reject 訊息只列主鍵、不含原文; 例: 真 LMDB 回 `Key size is larger than the maximum key size (1978)`). 先對照「接線前後各缺什麼」再決定寫什麼——寫 `safe` 只有筆數 / 位置 / 錯誤類別, 補不回原因; 寫 `detail` 才補得回, 所以必須遮罩後寫。規則帳本找不到明文政策時, 以現有站點的實際寫法 + R-SEC-01 / R-QKEY-01 推導, 並在 ADR 寫明推導過程。
- **funLog 收不到呼叫的輸入, 原文卻可能夾帶輸入值**: 初版只用「同筆細節內出現過的識別值」置換錯誤原文, `catch` 路徑(細節只有一個 Error)的測試(`ODL-W03`: Error 訊息含該列主鍵與信箱)立刻紅。解法是包裝 procOrm 以 `AsyncLocalStorage` 記下 `{ userId, input }`, funLog 同步於同一流程內取用; 並行呼叫各有自己的脈絡(`ODL-W09` 交錯完成)。包裝只多一層脈絡, 且 `procCore` / `procProtect` 取得的須是包裝後者(`SITE-ODL-002` 斷言原始 `procOrmRaw` 僅出現兩處)。**遮罩測試必須含「不在細節裡的值」案例**, 否則只驗得到「顯而易見的那一半」。
- **主鍵同時是字串與個資的邊界**: users 的 `id` 是 uuid(自產), 先套「已知識別值 → `maskToken`(同值同遮罩, 可與他處紀錄對照)」再套信箱 / uuid 樣式標記; 順序反了(樣式先換)會讓 `id` 變成無從對照的 `(uuid)`。頂層字串(沒有鍵名)是錯誤原文位置, 不可當識別值收集, 否則整段原文被換成一個遮罩(`ODL-M04` / `ODL-M11` 曾因此紅)。
- **遮罩函數的工程細節**: 走訪前先轉成有界純資料樹(`toTree`: 不執行 getter / Proxy 陷阱、`__proto__` 鍵以 `defineProperty` 保留、節點數連原始值一起計, 否則 10 萬個字串的陣列不被截); 字串不在 `toTree` 截斷(遮罩要記原長, 真 LMDB 鍵長超限情境主鍵 2112 字元曾被記成 2000), 錯誤原文才在置換前截斷; 識別值長度上限 = 原文截斷長度(更長者不可能出現在已截斷的原文內)。
- **console 照舊**: 傳 funLog 後 w-serv-orm 不再寫 console, 為維持 stdout 可見(pm2 / 容器), funLog 自己以與上游預設相同的格式 `console.log(label, safe)` 補回, 與 `logBoot` 雙寫同理; `ODL-W01` 以「與未傳 funLog 的實例逐行相同」斷言, `ORMDIAG-002` 在真後端以 stdout 診斷行恰為 `users.insert fail { ok: 0 }` 斷言。
- **端到端測試的故障注入**: 真後端以測試專用啟動腳本 `test/tools/srvOrmDiag.mjs`(私有埠 11307、私有 lmdb / log 資料夾於 `test/_tmp/api-ormdiag/`)包裝 `WOrmLmdb`, 開關檔存在時令 `users.insert` 回傳違約形狀 `{ ok: 0, err }`; 觸發用公開入口 `createUser`(免登入)。不改 `restartBackend` / `srv.mjs`, 不碰 11007 與 `./db`; `after` 殺行程後回驗埠已釋放、目錄已刪(LMDB 檔案於行程結束後才釋放, 刪除要重試)。
- **變異驗證沿用 `./tmp/<名>/mut/` 副本法**: 對照組先跑、`from` 須恰命中 1 次(第一輪 `m11` 因 `console.log(label, safe)` 在註解裡也出現而 SKIP, 改用含上下文的唯一片段); 存活變異要判讀是否等價——`m17`(拿掉 `scrubText` 的 `safeText`)存活是因結尾 `capText` 已含 `safeText`, 屬冗餘, 移除冗餘碼而非補測試。副本需含根目錄 `*.mjs`(`SITE-ODL-001` 靜態盤點會讀 `g_mOrm.mjs`), 否則對照組就紅。
- **ADR 編號先查現有最大號再用**: 草稿期間誤用已被「角色用詞」占用的 097, 寫 ADR 前 `Grep "^## ADR-"` 取最大號 + 1。


## 診斷遮罩改用 wsemi 共用模組: 外來值在「入口」遮罩, 不在「出口」遮罩; 站點全集先請子代理盤點再人工收斂(2026-10-29, mig-sso, 第 161 項, ADR-099 / R-ORM-04)

- **做法被推翻一次**: 起初把 `diag.err` / `diag.mask` 套在出口與日誌各處(kpfun 集中出口、九支 HTTP handler、`getErrMsg` 包 11 處 srLog 與 12 處 console、兩處 `Promise.reject(err)` 共約 45 站), 做完回頭對照 dspec R07 才發現: 這些出口同時流過「本套件以固定詞彙組成之 reject」(`tokenExpired`、`failedLoginForCatch`、`userRegistration…`)與外來值, 一律包 = 秘密若為固定 key 之子字串(例: 寄信密碼 `ginForCa`)會把 key 切碎成 `failedLo***tch`, 前端字典查不到, 且形成反推密碼的 oracle. 還原後改為**只在外來值進入本套件時遮罩一次**(`guardOrm` 包 `woItems`、`srEmail.send` catch、`WServOrm` 建構錯誤、`ormWrite` 逐筆 err), 其後固定 key 不受影響、日誌與回遠端之值自然已遮罩. 判準: 遮罩點要放在「值的來源只有外來值」之處; 看到出口同時有固定 key 與外來值就不是遮罩點.
- **站點全集盤點的分工**: 本套件 `server/**` 命中 585 行(程式碼 397 + 補充 111, Grep 抓不到的 srLog 欄位、`pm2resolve` 結果處置、傳參考 reject、未 catch 的 `await woItems.*` 要靠讀碼補), 交 sonnet 子代理產 `./tmp/mig-sso/sites.md`(約 14 分鐘), 我再依「值來源」收斂為四類(外來值入口 / 固定詞彙 / 非憑證類外來值 / 刻意不套). 子代理把「原文可能含查詢條件值」也標為「外來值直接流出」, 其中多數是資料值而非憑證(dspec D3 只遮憑證), 需自行篩.
- **語料驅動的接線測試**: `wsemi/src/_diagCases.mjs` 的 `wire: true` 案(A01、A07、T01、T07、K*、E*、R01、R02、R04、R07、R11、R12…)不能原樣套——其 `call` 跑 wsemi API, `check` 針對該輸出. 做法: 取 `make(ctx)` 產生外來值, 經「本套件的真實入口」(`guardOrm`)後, 以同一 `check` 判定(R02 要自組 `{ r, same, inst, code }`); 只適用於 detail 的案(K、V、S、P、E)不屬 sso(不取細節); R11 / R12 依 Q3 / P1 改為斷言「reject 原物件、不遮路徑與單獨帳號」.
- **`genDiagFunLog` 的行為與舊 `mkOrmFunLog` 不同處**: 回傳 `{ funLog, close }`(不是函數); `safe` 未給時 srLog 物件仍帶 `safe: undefined` 鍵(JSON 序列化後消失, `deepStrictEqual` 要寫 `safe: undefined`); 寫入 promise 由 wsemi 標記已處理(舊版 srLog 回傳 rejected promise 會 unhandled); `write` 非函數建構即拋. w-serv-orm 1.1.22 的 `safe` 形狀對本套件各路徑未變(`{ n, ks }`、`{ ok: 0 }`、`{ errType }`、`{ reason }`).
- **用「getter 讀取次數」驗不取細節無效**: 試過以結果的 `err` getter 計數區分「funLog 取細節」與「不取」, 但 w-serv-orm 自己的 `getItemsFail` 也讀 `err`, 兩者次數相同; 改以(a)srLog 物件鍵恰為 `event / label / safe`、(b)語料 A01 / A07 以本套件轉接器重跑、(c)原始碼盤點 `genDiagFunLog(` 恰一次且無手寫 funLog 三者鎖定.
- **測試鎖與全套時間**: 本機兩槽被他套件的 `npm test` 占滿時, 排隊可達數十分鐘到數小時(本輪單一 3 檔小測試排了 > 15 分鐘仍未取得). 動工前就把「變異＋修前紅＋修後綠」寫成**單一腳本**(`./tmp/mig-sso/campaign.mjs`: 就地改檔、finally 還原並以 sha256 回驗、caught 判定以對照組失敗集為基準)與全套各排一個 `--lock` 指令, 以 `nohup` 脫離(一個指令一取一放); 本套件全套(含 e2e)約 100~170 分鐘, 超過單輪預算時如實回 `FIX=CONTINUE`.
- **`test/_tmp/<案>` 的背景寫檔**: 呼叫 `WWebSso(...)` 會先建 srLog(w-syslog 背景寫檔), 即使隨後建構失敗, `logs/` 仍可能在測試刪除後被重建; 清理要等寫入靜止後重複刪 3 次再斷言不存在.
- **檔案編碼**: 工作樹為 CRLF(`core.autocrlf=true`), `Write` 新檔也是 CRLF; 腳本改檔時 `find` 字串含換行須依檔案 EOL 轉換(`campaign.mjs` 以 `eol` 處理).
- **守門 hook 的作法**: 變異驅動的輸出不能 `>` 重導檔案, 改走 `quiet-run`(完整輸出在其 `./tmp/quiet-run/*.log`); `sed -i` 一樣被擋, 批次替換用 `Edit` 的 `replace_all`。

## funLog 轉接器加白名單(`safeKeys: SAFE_KEYS`): 接線測試取樣自原始碼本身、w-serv-orm 匯入做成封閉全表、升 devDependency 要先確認橋接模組還在(2026-10-30, b-sso, 第 198 項, ADR-100 / R-ORM-04 第 6、7 條)

- **接線行在函數內部、測試拿不到時, 不要手寫「同款」轉接器**: `funLog` 是 `WWebSso` 函數內的區域變數, 只傳給 `WServOrm`, 外部無從取得; 舊測試以手寫 `mkFunLog = genDiagFunLog((o) => srLog.warn(o))` 當替身並用正則鎖住原始碼那一行, 兩處各改一半時測試仍綠. 改為 `test/tools/diagWire.mjs` 自 `server/WWebSso.mjs` 去註解後取出 `let { funLog } = <運算式>` 的運算式字串, 以 `new Function('genDiagFunLog', 'srLog', 'SAFE_KEYS', ...)` 用真實的 wsemi、真實的 `SAFE_KEYS` 與測試的 srLog 求值——原始碼拿掉 `safeKeys`、拼錯鍵、換名單、換出口(`warn`→`error`)，行為測試就跟著紅(變異 M1~M6、M12、M13); 運算式只能引用這三個識別字, 多引用別處即 ReferenceError(接線被改成引用別處時顯式失敗). 該行必須恰一行, 否則拋錯.
- **白名單無法由真實 w-serv-orm 端到端「造出名單外之鍵」**: w-serv-orm 自身的 `getDiag` 已用同一份名單在產生端過濾, 所以真實鏈路只會產生名單內之鍵; 「名單外之鍵不入日誌」只能直接餵 funLog(DGS-01/03), 「名單內之鍵不被誤傷」才用真實 WServOrm 驗: DGS-04 對 6 個既有失敗情境各跑兩次(記錄替身 funLog 取原產出、接線 funLog 取轉接後), 比對 `轉接後 ＝ 原產出`、原產出之鍵 ⊆ 名單 ∪ {errType, errCode}、並斷言情境確實產出各預期鍵(情境失效不得靜默少覆蓋), 不手寫期望的第二份.
- **既有 wsemi 語料案要隨白名單改寫期望**: 語料 A01 / A07 的 safe 用 `a` / `mode`, 不在 `SAFE_KEYS` 內, 經帶白名單的轉接器會被丟棄; 本套件的重跑改用名單內之 `n` 並保留語料的核心判定(第 3 引數 getter 0 次、`userCode: 0`).
- **w-serv-orm 匯入全表做成封閉集合**: 用「行首 `import … from '…'`、多行收尾 `} from '…'`、`import '…'`、`import()/require()/import.meta.resolve()`」四種正則掃 `server/ src/ toolg/ test/` 與根目錄 `*.mjs`, 與寫死的 18 筆全表比對; 不能用「任何 `from '…'` 子字串」掃, 因為測試自己的斷言訊息字串會寫出 `from 'w-serv-orm/src/safeKeys.mjs'` 而自我命中. 判定: 公開入口 = 主入口 `WServOrm.mjs`、純函數子模組 `baseline.mjs`(README 載明)、`safeKeys.mjs`; 內部檔只許在 `test/`、根目錄 `g_*.mjs`、與唯一出貨例外 `server/getIgnoredOrmKeys.mjs`(`checkOptRemoved.mjs`, 上游註解明載供包裝層使用, 與診斷無關; 不自寫等價判準以免與上游接受集分叉, 待主控裁示是否由 w-serv-orm 升格為公開入口). `spec/evidence/` 為歷史取證腳本, 不出貨亦不執行, 不掃.
- **變異放在 repo 內 `./tmp/b-sso/mut/<id>/` 的副本, 不用連結**: 副本位於 repo 之下, 裸模組解析會往上找到 repo 的 `node_modules`, 不必建 junction(也就沒有清理時穿過連結的風險); 測試以 `fileURLToPath(import.meta.url)` 推 `pathRoot`, 在副本跑時讀的是副本的檔. 一個 `--lock` 指令內跑完 16 項(含對照), 約 1 分鐘; 還原靠「副本用完即刪」, repo 全程不動.
- **升 devDependency 前先看橋接模組是否還在**: 一併升 `w-package-tools-e2e` 1.0.11→1.0.12 後, api 測試整批 `ERR_MODULE_NOT_FOUND`——1.0.12 刪了 `src/parseListenerPids.mjs`(改 `listenerPids.mjs`), 而 `test/tools/e2eLib.mjs:36` 橋接它. 不跑 e2e 的輪次不應順手改 e2e 基建: 退回 1.0.11(`npm i -D w-package-tools-e2e@1.0.11`, 範圍仍 `^1.0.11`), 適配橋接另案處理(須 diff 其 src 與 dependencies, 在四個專案同步). 其餘自有相依(`w-orm-lmdb`、`w-screenctl` 等)照升.
- **unit 測試通過不等於 api 載得起來**: 升版後先跑一次 `mocha --dry-run`(或單跑一個 api 檔)確認載入, 再排整批; 這次是 unit 全過 462 案之後 api 才在載入階段整批失敗.

## 升 w-package-tools-e2e 1.0.12: 刪橋接轉出行、核對其餘轉出、以渲染相依版本判定標準圖不受影響; 排鎖時把 dry-run / unit / api 併在同一次取鎖(2026-10-30, b-sso2, 第 198 項)

- **起因與裁定**: 上一輪(b-sso)因 1.0.12 刪了 `src/parseListenerPids.mjs` 而退回 1.0.11; 主控裁定升 `^1.0.12`(今晚全庫連動會升到最新, 屆時 `test/tools/e2eLib.mjs` 的 `parseListenerPids` 轉出使所有載入 e2eLib 的測試〔api 與 e2e〕全部載入失敗). 本專案對 `parseListenerPids` 無使用者(Grep `test/` 只有轉出行), 處置 = 刪該轉出行.
- **逐一核對轉出的作法**: 寫一支唯讀腳本(`./tmp/` 內, 結案刪)讀 `e2eLib.mjs` 的 `export { default as X } from '…'` 行, 對每行(1)檢查來源檔存在於已安裝版本(2)動態載入 `e2eLib` 後 `typeof` 該名稱(`inkRect` 另有具名 `INK_PAD`); 51 個模組轉出全 OK, 命名空間 52 個鍵. 比「只刪一行再看測試綠」可靠——載入失敗時只會看到第一個缺的模組(ESM 載入遇第一個 `ERR_MODULE_NOT_FOUND` 即停), 多個缺失會被分次掩蓋.
- **呼叫端相容要看「誰傳了 `opt.exec`」**: 1.0.12 的破壞性在 `listenerPids` / `killPortListeners` 的 `opt.exec` 形狀(execSync 形 → spawnSync 形)與回傳語意收緊(`[]` 只代表已確認無人, 失敗回 `null`、`killPortListeners` 失敗不下殺). 本專案的呼叫點只有 `run-e2e-isolated.mjs` 的 `killPortListeners(11007)`(忽略回傳, 且該處註解本就寫「查詢工具不可用時不殺」)與 `e2e-setup.mjs` 的 `createServiceManager`(預設 `killListeners`), 皆未傳 `exec`, 故不受影響. 代價(依套件 README 載明, 本專案未另量測): 在 netstat 漏列的系統上查埠每次約 1 秒(走 PowerShell), 逐檔隔離 runner 每檔前殺一次、收尾再殺一次, 總時間略增.
- **標準圖是否受影響看渲染相依的版本, 不只看 src**: 先前教訓(ADR-079): 只比 `src/` 會漏掉 playwright 升版造成的 Chromium 換版. 這次對 `package-lock.json` 比 `playwright` / `playwright-core`(1.63.0)、`sharp`(0.35.5)、`pixelmatch`(7.2.0)、`pngjs`(7.0.0): 皆與升版前相同, 套件 README〈改版須知〉亦載明此次不影響標準圖像素; 新增的相依只有 `wsemi`(查埠用). 因此本輪不跑 e2e, 全套由主控於凍結碼跑.
- **排鎖與長輸出**: 兩槽被他套件占滿時, 單獨排一個 `dry-run` 的前景指令 10 分鐘仍在排鎖, 被工具移到背景(`quiet-run --timeout` 也把排鎖等待算進去, 可能在排到前就被終止). 改為停掉該指令, 寫一支腳本在**同一次取鎖內**依序跑(1)全部測試檔 `--dry-run`(含 e2e 檔, 只載入)(2)全部 unit(3)全部 api, 各步完整輸出寫 `./tmp/` 的 log、對話只印每步的 passing / failing / 離開碼, 失敗才印失敗段落; 一個指令一取一放, 排鎖只等一次.
