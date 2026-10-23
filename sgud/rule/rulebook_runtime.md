# 規則帳本(分冊: 執行期 / 打包規則)

本檔為規則帳本之分冊(2026-10-22 自 `sgud/rule/rulebook.md` 依類型拆出, 節號與標題不變、內容只搬不刪); 總索引見 `rulebook.md`.

### R-ERR-01: 後端之週期計時器一律經 `server/wrapTimer.mjs` 執行; 回呼之錯誤收斂於包裝, 不得外拋(2026-10-14, ADR-085)

- **規則**:
  1. `setInterval` / `setTimeout` 之回呼一律為 `wrapTimer(<名稱>, fn, onError)` 之回傳: 前一次未結束時再觸發即略過; 回呼之同步拋錯與 reject 一律攔下交 `onError`(procProtect 為 `srLog.error({ event: 'timer-error', timer, err })`); 結束(不論成敗)即釋放, 下一輪照常執行; 包裝本身恆 resolve, `onError` 自身拋錯亦攔下.
  2. 計時器回呼內不得再手寫重入鎖(`lockingForXxx`)與外層 try / catch / finally; 逐項處理之內層 catch(如逐 IP 封鎖失敗不中斷其他 IP)照留. 同一規則只寫在 `wrapTimer` 一處.
  3. 本套件不在 `srv.mjs` / `WWebSso` 註冊 process 層之 `unhandledRejection` / `uncaughtException` 監聽: 全域錯誤政策屬部署方(w-serv-hapi 1.1.6 起亦不再代為註冊).
  4. 未 await 之 async 呼叫(fire-and-forget)須確認函式體不會 reject, 否則接 `.catch`; 現有者為 `pp.callApiByToken` / `pp.callApiByIp`(函式體只 push 陣列, 不會 reject; **2026-10-20 更正**: 僅在容器無原型時成立, 原為一般物件, 鍵為 `constructor` / `__proto__` 等時 `.push` 拋 `TypeError` 而使行程結束, 見 R-KEY-01).
- **理由**: w-serv-hapi 1.1.5 之建構子無條件註冊 process 層監聽, 1.1.6 移除後, 計時器回呼內未接住之 reject 使後端行程結束(Node 24 預設; 注入實測 exit 1); 1.1.5 下雖存活, 各計時器手寫之重入鎖只在成功路徑釋放, 失敗一次即永久停擺(新 IP 偵測不再執行). 4 個計時器 3 種寫法, 只有 1 個完整. 見 ADR-085.
- **盤點指令**:
  - Grep `setInterval\(|setTimeout\(` 於 `server/`(排除 `//` 註解)→ 每筆之回呼皆為 `wrapTimer(` 之回傳.
  - Grep `lockingFor` 於 `server/`(排除 `//` 註解)→ 0; `procCore.mjs` 約 2204 起之 `lockingForCleanTokens` 為整段註解之停用計時器(ADR-013), 不計.
  - Grep `process\.on\(` 於 `server/`、`srv.mjs` → 0.
- **站點全集(2026-10-14)**: `procProtect.mjs` 4 處——`accountLoginFailedPrune`(帳號登入失敗紀錄剪枝)、`tokenCallApi`(權杖調用次數)、`ipDetectNew`(偵測新 IP)、`ipCallApi`(IP 調用次數); 皆已套. 測試: `unit-protectTimers` PT-001～007(包裝本身、偵測新 IP 之讀取與新增失敗、四計時器皆經包裝; 以 HEAD 版 procProtect 驗紅). 規則 4 之 fire-and-forget 站點(2026-10-14 X1 時補盤, run02 漏列): `server/staLogs/staLogsCore.callWorker.mjs` 之 `wk.terminate()`(回傳 Promise 而不 await)——於源頭 `.catch(() => {})`(與 w-web-api / w-web-perm 同一寫法); `pp.callApiByToken` / `pp.callApiByIp` 函式體不會 reject, 不改. 盤點補充: Grep `\.terminate\(\)|\.close\(\)|\.destroy\(\)` 於 `server/` 逐筆確認回傳值是否為 Promise 且未 await.

### R-PKG-01: 打包範圍內之可執行碼不得於頂層以模組位置定位檔案; 以模組位置定位者首次使用時解析並快取(2026-10-14, X1, ADR-086)

- **規則**:
  1. 打包範圍(`toolg/gDistRollup.mjs`: w-package-tools `rollupFile`、format umd、入口 `server/WWebSso.mjs`; 範圍＝其相對 import 之閉包——`server/` 21 檔＋`src/appPerms.mjs`、`src/maskUrl.mjs`、`src/plugins/mShare.mjs`、`src/schema/` 4 檔——與未列 external 之相依)之可執行碼, 頂層不得宣告 `__filename` / `__dirname`(rollup umd 把 `import.meta.url` 換成引用 `__filename` 之墊片且避讓名單不含該名, 本模組或同一 bundle 內任一模組之頂層同名宣告使載入即 TDZ), 亦不得改用 `import.meta.dirname` / `filename` / `resolve`(umd 換成 `undefined`).
  2. 以模組位置定位檔案者一律於**首次使用時**解析並快取(`import.meta.url` 只在函數內求值); 解析統一經 `server/staLogs/resolveShellWorker.mjs`: (a) 由本模組位置往上找最近之 `package.json`, name 為 `w-web-sso` 且其下 `server/staLogs/staLogsCore.shellWorker.mjs` 存在者(最近者名稱不符即不再往上)→ (b) `createRequire(本模組位置).resolve('w-web-sso/server/staLogs/staLogsCore.shellWorker.mjs')`(被下游再打包)→ (c) 同 (b) 以 `process.cwd()` 為基準 → (d) 拋可讀錯誤(含套件名、相對路徑、已試之位置). `runWorker` 解析失敗時 reject 該錯誤而不 spawn; 成功結果快取、失敗不快取(下次重試); 保留 `fpWk` 注入點.
  3. 前提: `.npmignore` 未排除 `server/`(已安裝時 worker 檔存在; 其 `logs` 規則只排除名為 logs 之目錄, 不及 `server/staLogs`)、`package.json` 無 `exports`(深層路徑可解析)——兩者有變須同步改本規則.
  4. 與 w-web-api(R-PKG-1、ADR-039)、w-web-perm(R-PKG-01、ADR-027)同一實作, 只差 `PKG_NAME`; 改動須三者同步.
- **理由**: 原 `staLogsCore.callWorker.mjs:8-11` 頂層 `let __filename = fileURLToPath(import.meta.url)`、`let __dirname`, 並於載入時以 `path.resolve(__dirname, 'staLogsCore.shellWorker.mjs')` 算 worker 路徑: 打包後載入即 TDZ, 改名後 `__dirname` 為 `dist/` 而找不到 worker 檔. 見 ADR-086 與 w-syslog 審計回應 §2(主控 X1 指示).
- **盤點指令**:
  - `git grep -n -E "__filename|__dirname|import\.meta|fileURLToPath|new URL\(|new Worker\(|createRequire|require\.resolve|process\.cwd\(\)" -- server src/appPerms.mjs src/maskUrl.mjs src/plugins/mShare.mjs src/schema`(新檔入版控前加 `--untracked`)→ 只有 `staLogsCore.callWorker.mjs` 之函數內 `import.meta.url` / `fileURLToPath`、`new Worker(fpWk)` 與 `resolveShellWorker.mjs` 之 `createRequire` / `process.cwd()`.
  - bundle 內相依: `grep -rln "import\.meta\|^let __filename" node_modules/<相依>/src` → w-syslog 1.0.32 時只有 `src/WSyslog.mjs` 頂層宣告; 1.0.33 起 `import.meta.url` 只在函數內(`resolveFormatter` 首次使用時解析), 2026-10-14 升級後建出之 bundle 頂層 `fileURLToPath` 宣告 0 處(dist 冒煙).
  - 打包範圍之閉包由 `server/WWebSso.mjs` 之相對 import 遞迴求得(`unit-resolveShellWorker` SITE-X1-001 內建, 不寫死檔名).
- **站點全集(2026-10-14)**: 以模組位置定位者 1 處——`server/staLogs/staLogsCore.callWorker.mjs`(`getShellWorkerPath`、`runWorker`; 原 `:8-11`); 已套. 刻意不套(cwd 相對, 與打包無關): `WWebSso.mjs` 之 `pathStaticFiles='dist'` / `npmPathStaticFiles='./node_modules/w-web-sso/dist'`、`pathTemplateDefault='./server/template'` / `npmPathTemplate='./node_modules/w-web-sso/server/template'`、`fpTableTags`、logFd、settings 路徑. 測試: `unit-resolveShellWorker` RSW-001～008(假套件佈局於 `test/_tmp/unit-resolveShellWorker/`)、RSW-REAL-001～002、SITE-X1-001～002; 既有 `unit-staLogs-golden`(含真 worker)、`api-stainfor`(真後端之統計經 worker)、`e2e-stainfor`; 「由 src 建出 dist → 載入 → 實際觸發一次統計並寫出 log」以發布前之 dist 冒煙驗收(下條; 2026-10-14 起).
- **dist 冒煙(發布前驗收, 2026-10-14 起; 主控帳本 G5)**: 不納入 `npm test`(須另開埠、建置約 10 秒、產物落 `./tmp/`; 打包範圍之靜態不變式由 SITE-X1-001 每次守護), 於相依升級或改動打包範圍時執行. 作法(2026-10-14 之腳本 `tmp/run04/dist-smoke.mjs` / `dist-smoke-child.mjs`, 暫存區可能已清, 依此重建): ①讀 `toolg/gDistRollup.mjs` 原文, 只把 `let fdTar = './dist'` 換成 `./tmp/<案名>/dist`(斷言恰一處)後以 node 執行——不寫 repo 之 `dist/`; ②以暫存夾為 cwd, 其下 `node_modules/w-web-sso` 為發佈包內容之副本(`package.json`、`server/`、`dist/index.tmp`)＋建出之 bundle——`WWebSso` 以 cwd 相對之 `./node_modules/w-web-sso/{dist,server/template}` 取靜態檔與模板(本條「刻意不套」之站點; cwd 無模板時啟動即拋 ENOENT), 暫存夾位於 repo 內使相依由 repo 之 `node_modules` 解析; ③子行程: 以源碼之 WServOrm 於暫存 `./db` 建管理者與權杖 → `require` bundle 以埠(8500 段)啟動 → `/api/checkToken` 與資料通道連線寫出 `fun-checkToken` / `verifyConn` → 等 log 落檔 → `getStaToken` / `getStaIp` 實際觸發統計(本小時桶 ≥ 1)→ `kpfun-getStaToken` 落檔 → stop → 寫結果並結束(本套件之 stop 不清計時器, 見已知缺口); 另一暫存夾驗 logFd 上層為檔案時建構即拋且未建資料庫; ④收尾: 子行程 PID 不存在、埠無監聽、repo 之 `dist/` 未變(`git status --short dist` 與 umd 檔時間).
- **打包實測之作法(2026-10-14, 待補測試時沿用)**: 以 `rollupFile({ fn, fdSrc, fdTar, nameDistType: 'kebabCase', globals, external })`(同 `toolg/gDistRollup.mjs`)於 `./tmp/` 建 umd, 子行程 `require` 之; bundle 經 terser 改名, `Cannot access '<名>'` 之歸屬以該名之宣告(`<名>=<x>.fileURLToPath(`)其後是否接 worker 檔名判定. 完整 bundle 之 2×2(HEAD / 現行 × w-syslog 1.0.32 / 模擬修正之副本, 經改寫 `srLog.mjs` 之 import 指向 `./tmp` 內副本): 只有「現行 × 模擬修正」載入成功——X1 為完整 bundle 可載入之必要條件, 剩餘之 TDZ 只屬 w-syslog.

