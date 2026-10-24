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
- **內部狀態要有觀察點, 而且不能靠實作細節**: 初版以「`getInforsBy*` 連呼兩次是否同一陣列」判定鍵是否存在(不新增對外函式), 外審指出該判準依賴 getter 回傳內部陣列本體、且觀察不到帳號容器(完全停用帳號剪枝仍全綠). 改加診斷用 `pp.getKpKeyCounts()`(`pp` 為套件內部物件, 非對外 API)後, 三容器皆可斷言鍵數, 並以「帳號剪枝計時器停擺」變異證明轉紅. 端到端另以「管理者刪除的 `ips` 列是否被偵測計時器復活」證明鍵確實退場.
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
- **新案例標準圖若含隨機值先固定資料**: `ds.tokens.funNew` 產生之 token 為隨機 UUID, 管理員 session 列顯示於金鑰清單畫面, 使 `E2E-CC-002` 比對差 127~130 px(> maxDiffPixels 100); 固定 token 字串後只重產該案兩張(`--baseline --names E2E-CC-002`)即可, 不需遮罩.
- **e2e 檔間隔離: `ips` 表之列不只來自 DB, 清庫不等於回到固定種子(sso-run02, 2026-10-23; 主控全套 759 / 2 失敗 `E2E-CC-003` 差 134 px)**: `procProtect` 之 `ipDetectNew` 計時器(每 2 秒)把 `kpIpCallApi` 內「`ips` 表尚無」之 IP 補登進表; `e2e-autoblock` 以 `X-Forwarded-For` 登記之 `1.2.3.x`(最後一案 E2E-010 為 `1.2.3.203`)留在後端記憶體, 其 `afterCase` 只清 DB 不清計數(原註解載「由下一案 prepare 重置」, 但最後一案之後沒有下一案), 之後任一檔重設 `ips` 表, 數秒內殘留 IP 即被補登回來, `e2e-concurrency` 之 IP 清單畫面因此多一列(標準圖 4 列、全套 5 列). 單獨跑無前序測試故綠, 單一 mocha 行程依序跑 autoblock → concurrency 即可穩定重現(修前 6 綠 2 紅, 皆 `diff=134px`); 計數留 10 分鐘(`minForIpCallApi`)才因無新請求被剪枝, 故中間隔著幾個檔仍中. 處置三層: ①`test/tools/e2e-setup.mjs` 收斂 `cleanKpIpCallApi` / `cleanKpAccountLoginFailed`(原只在 autoblock 內, 補丁堆積); ②殘留來源(autoblock `afterCase`)**先清記憶體計數、再清 DB**(反之計時器可於兩者之間補登回已清空之表); ③受害檔(concurrency `prepare`)同序處理, 並以 `assertSeedOnly` 守門: users / tokens / ips 三表主鍵集合須恰為「base seed + 本檔種子」(多出者連 ip 一併列入錯誤訊息), 把隔離被破壞報成明確隔離錯誤而非事後像素差. 不重產標準圖(標準圖正確, 錯在輸入狀態). 規則: **凡顯示 `ips` 清單畫面之 e2e 檔, `prepare` 須先清 `kpIpCallApi` 再重設; 凡以 `X-Forwarded-For` 登記虛擬 IP 之檔, `afterCase` 須清計數**——「前序檔之 server 記憶體殘留」與「前序檔之 DB 殘留」是兩種獨立之隔離缺口, 重設 DB 只擋後者. 驗證法: 單一 mocha 行程依序跑「殘留來源 + 受害檔」之最小組合, 而非各檔單跑(單跑永遠綠).
- **審查者說「已讀碼確認」仍須自己追**: sol 14 條中 4 條採納(#3、#4、#5、#10, 皆有可重現測試且修前紅)、1 條採納後撤回(#8)、4 條屬測試缺口(補測試)、5 條為不帶基準固有限制或 HEAD 既有行為(#1、#2、#6、#7、#9). 判斷是否採納的三問: ①是本輪引入還是 HEAD 既有(`git show HEAD:<檔>` 對照)? ②修了會不會改變不得改變的流程語意(封鎖 / 登入 / 既有 UI)? ③審查者假設的前提是否成立(例如『不帶基準不能覆蓋 session』是審查者對任務的解讀, 與規格 §6 / §8 不符)?
- **「已知限制、不改」若牽涉撤銷 / 封鎖被繞過,獨立實操會再挑出來,應改問另一個問題(sso-run03, 2026-10-23)**: 外審 sol#1 把「不帶基準送回已撤銷 session 列會復活」當『無從分辨新增與舊列』之固有限制不採,獨立實操(sso-verify01 註記 1)證明它是可繞過自動封鎖之安全缺口。換個問法即解:不必分辨「是不是舊列」,只要問「這個新增本身合法嗎」——session 權杖只由登入產生,清單從無新增 session 列之入口,故庫內不存在之 `isApp !== 'y'` 列不論新舊一律拒收,與基準有無無關。凡限制與『撤銷、封鎖、權限』相關者,先找「這個動作本就不該有此入口」之解,再考慮分辨舊新。
- **新守門要先列『合法但長得像』之路徑並豁免,再以變異鎖定(sso-run03)**: 守門若直接套「所有庫內不存在之 session 列」,載入後才被登出者(基準內、管理員未動、庫內已無)會使正常存檔被拒,破壞選項 P 與 X1 之略過語意(SB-T03、CC-A-011)。故豁免『在 `baseline` / `baselineSession` 內者』,並以變異 M02(不豁免)、M09(只豁免 app 基準)、M06(不看庫內)鎖定;拒收判準用 `!== 'y'`(缺欄、空字串、大小寫變體皆是),以變異 M05 鎖定。
- **修前紅之 API 層可在單一取鎖期間換入修改前複本,但必須 finally 還原並以 sha256 回驗、再確認 11007 / 8080 無殘留監聽(sso-run03)**: 先把修改前之 `server/procCore.mjs`、`procLang.mjs` 存複本,取鎖後換入、跑新增之 api 案(後端子行程載入修改前版)、還原、回驗 sha256 相符、殺殘留後端,再跑修後綠與回歸,全程一次取鎖(排隊 37 分鐘,不宜分兩次取)。純記憶體之 unit 不開 port、不起瀏覽器,不取 web 鎖,可在排隊期間先做完紅綠與變異。
- **既有測試遇行為收回時,逐案分『意圖』與『fixture』(再次驗證)**: A13 / A18 / IT-C-003 意圖在主鍵標記 / 鍵長 / 原型鍵名,fixture 的 `isApp:'n'` 改為應用系統金鑰列即可;唯 A23 的意圖本身(鑄造使用者 token 可行)被收回,改為斷言整批拒收並以應用系統金鑰列續驗擁有者保留——不是改斷言遷就,是規格變了(ADR-092)。

## 改密碼後之 session 處置與 redir 檢查範圍(2026-10-23, sso-run04, 第 117 / 116 項, ADR-093 / ADR-094)

- **規格翻案時,舊決定會同時躺在 ADR、spec 多處、程式註解與「測試斷言」**: 第 117 項推翻 ADR-009(重設 / 改密碼不清 token)。unit 全綠、api 全跑才露出 `api-resetpassword` API-008 斷言「重設後兩 token 仍存在」——它編碼了舊決定, 屬「規格變了」而非「放寬測試」: 同案號改斷言新規則(並加 app 權杖當對照組), 於帳本與 ADR 註明。動手前先 Grep 測試與 spec 之「不清除 / 仍存在 / 保留 / 不觸及 tokens」類字樣(本輪事後才找: spec 4 處、ADR 3 處〔ADR-009 / ADR-001 / ADR-037〕、測試 1 案)。
- **「全有或全無」在無交易之 DB 上不可能嚴格達成, 要明確選最壞狀態可接受之次序並寫進 ADR**: 密碼寫入與 session 撤銷是兩次寫入。先撤銷後寫密碼的最壞狀態是「多登出一次」; 反過來撤銷失敗會留下「新密碼生效、舊 session 仍有效」。不採補償回滾(回滾本身可失敗)。測試要把兩種失敗(撤銷失敗、密碼寫入失敗)各鎖一案, 並斷言「驗證未過時一個權杖都不撤」。
- **刪除 / 停用 / 封鎖之撤銷函數不可共用於改密碼**: `revokeTokensByUserIdLocked` 按 `userId` 刪名下一切權杖, 而 app 權杖之 `userId` 是擁有者——共用會把使用者擁有之 app 權杖一併撤掉。另立 `revokeSessionTokensLocked` 加 `isApp !== 'y'` 與 `exceptToken`; 測試必含「以被改密碼者為擁有者之 app 權杖」當對照(變異 S4 只有它抓得到)。
- **api 層測管理員重設: 後端對同一 targetUserId 有 30 秒節流(`adminResetPasswordAlreadyTriggered`)**, 同一後端行程內多案重設同一對象, 第二案起回節流錯誤而假紅(本輪第一版 PSA-002 / 005 即如此)。每案各建自己的被重設對象(`mkTarget(key)`), 不要靠前一案之間隔。
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
- **前端不得對「伺服器時間相關之判定」自行推算**: 初版為使未定案列顯示一致而在前端以 `ot()` 重算用途, 瀏覽器時區 / 時鐘 / 存檔後保留之舊清單皆使它與授權判定分歧, 且分歧方向可使可用之金鑰被顯示成已失效(管理員可能據以誤刪)。改為後端 `getTokensList` 回傳即時判定值(伺服器專有欄位, 不入基準、存檔不採用), 前端只顯示。
- **缺圖(待授權)之標準圖案例仍須有語意層之視覺不變量**: `innerText` 於欄寬截斷時仍為完整字串, 英文「Invalid (before upgrade)」被截成「…upgr…」靠 dry-run 目視才發現; 缺圖期間比對端跳過 pixel 時, 補「儲存格 `scrollWidth ≤ clientWidth`」之幾何斷言, 以長標籤變異驗證會紅(158 > 148)。
- **MX-DEAD 擴格比解釋「單一咽喉保證」更可靠**: 已失效之列各入口一律不可用, 原可由 `loadActor` 單一咽喉論證; 仍補成 27 入口 × 已失效列 = 27 格(拒絕鍵、零寫入、`refreshToken` 維持 `tokenAppNoRefresh`、登出類放行並刪本列), 失效 token 子類 54 → 81 格.
