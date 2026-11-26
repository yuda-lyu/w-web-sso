# 規則帳本(分冊: 專案特有機制)

本檔為規則帳本之分冊(2026-10-22 自 `sgud/rule/rulebook.md` 依類型拆出, 節號與標題不變、內容只搬不刪); 總索引見 `rulebook.md`.

## 專案特有機制

- 統計頁確定性資料: fixture log `logs/e2e-stainfor-fixture.log`(非 ISO 檔名繞過 w-syslog 輪替清理; 4 個固定 IP 使 IP 表恆 ≥5 列); 圖表區 `_staref` 貼圖覆蓋; cards 區只依 DB seed 計數可 live 比對. (2026-10-20 更正: 原載「後端忽略 `X-Forwarded-For`, IP 類統計不用 XFF 製造」不成立——`verifyConn` 取 XFF 第一段為來源 IP, e2e-stainfor 即以 XFF 製造各 IP 之統計; 僅 `/api/cleanKpIpCallApi`、`/api/cleanKpAccountLoginFailed` 兩個本機放行端點取 socket 位址. 見 R-IP-01 與〈已知缺口〉X-Forwarded-For 信任邊界〔已裁示〕.)
- X-Forwarded-For 僅本機注入: `makeXForwardedForContext`(autoblock)以 `ctx.route('**/*')` 只對 `127.0.0.1|localhost` 加 header; 用於封鎖 / 速率測試.
- in-memory 計數清除 API: `/api/cleanKpIpCallApi?token=…`、`/api/cleanKpAccountLoginFailed?token=…`(token 由 settings 佔位符注入, 僅本機放行).
- email round-trip: `e2e-login` 真打 AgentMail API 輪詢(`afterTime` 減 1 分鐘)抓 `/api/verifyEmail` 連結; `agentmailApiKey` 缺失 fail-fast.
- server 注入語系初始畫面: `e2e-init`(`ensureIndexTmpl` 冪等還原 `dist/index.tmp`; `page.route` 懸置 `/api/main`; `$ui.updateConnState` 強制狀態).
- 防帳號列舉: 封鎖 / 密碼錯 / 不存在共用文案 `failedLoginForCatch`, baseline 共用(login E2E-008/015 與 002; autoblock 同款).
- 雙擊 / 並發契約(後端 `pmKeyMutex` / `cacheSt`): key `{op}:{primary-key}`(如 `adminResetUserPassword:id-user-a`; `createUser:account:<account>` + `createUser:email:<email>` 兩段獨立); 同 key 第 2 次回 i18n key(`adminResetPasswordAlreadyTriggered` / `userRegistrationResendThrottled` / `userChangePasswordIncorrectOld` / `userRegistrationAccountExists` / `userRegistrationEmailExists`); 清單儲存(ADR-074)以 `server/lockSave.mjs` 占位 key `updateUsersList:<操作者 id>` / `updateTokensList:<操作者 id>` / `updateIpsList:<操作者 id>`, 同一操作者處理中再送 → `saveInProgress`, 使用者清單之新增列(`_isNew`)已存在 → `saveNewRowExists`; 登入、登出刻意不套(F-046; 登出重送無實害); 由 `api-doubleclick` DC-01～08 驗.
- app token(`isApp='y'`)跳過 token 速率封鎖(ADR-052); `api-autoblock-apptoken` 驗.
- app token 依 tokens 表 `perms`(權限字串陣列)授權, 基本權限 readUsers 恆具備(ADR-069; 權限全集 `src/appPerms.mjs`); 權限閘規則見 R-PERM-01; `api-apptoken-perms` 驗後端、`e2e-tokens` E2E-005～007 驗後台權限清單.
- golden 測試真理來源: `test/staLogs-golden/{gen-expected.mjs,fakeDate.mjs,legacy/}`(改造前原碼 git 5d341b8^ 留存), expected 可重產(ADR-051 修正紀錄).
- 測試中介資料一律落 `test/_tmp/`(gitignore, 測完即刪): 臨時 settings(`cleanup()` 刪)、`unit-staLogs` 之 `fixture-logs`、`unit-staLogs-golden` 之 `golden-copy` / `golden-tmp`、`unit-staLogs-futureBucket` 之 `unit-staLogs-futureBucket/`(各自 `after` 清除); 絕不放 `./tmp/`(AI 代理暫存區隨時整個清除).

## R-STA-01: 統計之桶輸出以「現在」所屬桶為上界(2026-11-03 ss56, Gitea #56, ADR-102; 與 w-web-perm #57、w-web-api #58 同型)

- **規則**: `server/staLogs/staLogsCore.mjs` 之輸出(token、ip、login 三種, hr 與 day)只含「窗內桶補零」與「不晚於 `plan.labelEnd`(『現在』所屬桶)之資料桶」; 晚於它之未來時間桶不輸出; 現在所屬桶內略晚於 `timeNow` 者保留(上界以桶為單位, 非以毫秒為單位). **只在輸出層過濾**: `scanFile` 之窗判斷(`tms > tStartMs`)與檔級快取不動(彙總照存, `timeNow` 前進到該桶時即輸出). 上界以桶標籤字串判定且須符合 `^\d{4}-`(5 位數以上年份之垃圾 `time` 視為未來; `isLabelNotAfter`).
- **來源與判定**: 原 `buildOutputs` 之「資料桶聯集」為 ADR-051 重構時對齊改造前 `merge({}, kpTime, gsLog)` 而保留之舊行為(legacy 只有下界), 全庫 spec / 帳本無任何將其定為需求之記載, 判定為缺陷; 成因為紀錄 `time` 取真實時鐘而統計之「現在」可被 `opt.timeNow` 或程序級假時鐘釘住(或時鐘回撥). **不得於日後重構時「對齊舊行為」而丟失此規則**: 改動 `buildOutputs` / `genPlan` / `run` 之輸出段時須跑 `unit-staLogs-futureBucket` 與 `unit-staLogs-golden`.
- **盤點指令**(站點全集): `Grep "buildOutputs|labelEnd|isLabelNotAfter" server test`(輸出層唯一站點 `staLogsCore.buildOutputs`, 三種輸出共用 `toRs`); `Grep "kpTime" server`(窗內補零, 不受影響); 消費端 `server/procStaInfor.mjs`(`getStaToken` / `getStaIp` / `getStaUserAccountLogin` 為透傳, `getStaIpSummary.conn24h` 以 `t >= 24 小時前` 無上界加總——源頭已過濾, 經 FUT-008 驗)、`src/plugins/staUsage.mjs`(`calcUsageSummary` 之 `now.diff(t,'hour') <= N` 負差仍計入, 為對瀏覽器時鐘落後之容忍, 刻意不套; `groupFreq` 純分組)、`server/staLogs/filterVpfsByWindow.mjs`(檔名層下界, 屬掃描層, 刻意不套).
- **站點判準表(2026-11-03)**:

| 站點 | 輸出或使用未來時間桶? | 處置 |
|---|---|---|
| `staLogsCore.buildOutputs`(`toRs` 之資料桶迴圈) | 是(修前輸出) | **已套**(`isLabelNotAfter`) |
| `staLogsCore.genPlan` | 否(產 `labelEnd`) | 已套(新欄位) |
| `staLogsCore.scanFile` / `mergeAgg` / 快取 | 彙總照存(含未來桶) | 刻意不套(掃描與快取不動; FUT-004 驗 `timeNow` 前進後輸出正確) |
| `procStaInfor.getStaIpSummary.conn24h` | 使用輸出(無上界加總) | 源頭已過濾, 不另改(FUT-008) |
| `procStaInfor._getStaToken` / `_getStaIp` / `getStaUserAccountLogin` | 透傳 | 刻意不套 |
| `src/plugins/staUsage.mjs` `calcUsageSummary` / `groupFreq` | 使用輸出 | 刻意不套(容忍瀏覽器時鐘落後; 源頭已過濾) |
| `filterVpfsByWindow`(檔名層) | 否(只有下界) | 刻意不套(掃描層) |

- **測試**: `test/unit-staLogs-futureBucket.test.mjs`(FUT-001～008); `test/unit-staLogs-golden.test.mjs`(GOLD-001 / 002 / 003 + WORKER-001, expected 由 `gen-expected.mjs` 之 `dropFuture` 剔除 legacy 多出之未來列, 其餘與 legacy 逐位元相同).
- **標準圖**: `test/pics/stainfor` 0 張改變(e2e 以真實時鐘、`./logs` 與 fixture log 皆無未來時間紀錄; 修前修後輸出對真實 `./logs` 逐位元相同).

## R-STA-TIMELENGTH-01: 統計核心之 `timeLength` 以 `parseTimeLength` 單一擁有者檢測, 無效以固定鍵 `errTimeLengthInvalid` 拒絕; `opt.timeNow` 限 1970～2100 年(2026-11-23 tws1, 排程第 301 項, ADR-106; 比照 w-web-perm 1.1.58、w-web-api; 取代 ADR-102 第 4 點「窗為空」)

- **規則**:
  1. `server/staLogs/staLogsCore.mjs` 之 `parseTimeLength(v)` 為 `timeLength` 之唯一檢測(單一擁有者): wsemi `iseint(v, { min: 0, max: 3650 })`(`MAX_TIME_LENGTH_DAY` 3650); 有效為 0～3650 之整數或其數字字串(含頭尾空白), **其後只用轉換後之值**(K4; `Number(trim)`); 其餘回 `null`; 永不拋錯(讀取即拋之值回 `null`)、不回顯值(K9). 不得於他處另寫等價檢測.
  2. `genPlan` 首動作呼叫之(先於 `subtract` 與 `kpTime` 迴圈), 無效同步 `throw new Error('errTimeLengthInvalid')`; `staLogs()` 回 `Promise.reject('errTimeLengthInvalid')`(固定鍵字串, 不同步 throw); single-flight 鍵全用檢測後之值: `plan.timeLength`(轉換後; `-0` 正規化為 `+0`)與 `plan.timeNowPinned ? plan.timeNow : null`(無效 `timeNow` 與未給同鍵; TL-004b).
  3. `opt.timeNow` 須為 number 且在 `[0, 4102444800000]` 內, 否則視為未給(退回現在); 不以 `isValid()` 判定(`8.64e15` 本身有效而其後溢位).
  4. **無遠端入口傳入 `timeLength`**: `procStaInfor` 呼叫三支統計時第一引數恆為常數 7, `WWebSso` 之 `getSta*` 只收 `(_t, token)`(TL-006c 釘住); 日後新增入口須先經 `parseTimeLength`(或使用 `staLogs` 之固定鍵 reject).
  5. 語系鍵 `errTimeLengthInvalid`(eng + cht)入 `procLang`.
- **站點判準表**(`Grep -n "timeLength" server --glob "*.mjs"` 全集 8 檔, 由 TL-006a 鎖定):

| 站點 | 角色 | 狀態 |
|---|---|---|
| `staLogs/staLogsCore.mjs` `genPlan` / `staLogs` | 檢測與拒絕(單一擁有者) | **已套** |
| `staLogs/staLogsCore.callWorker.mjs`、`staToken.mjs`、`staIp.mjs`、`staUserAccountLogin.mjs` 與各 `.callWorker.mjs` | 預設值 7 之轉交, 皆經 `staLogs` 核心 | 已套(經核心; TL-002 逐層驗) |
| `procStaInfor.mjs` | 呼叫端, 第一引數恆為 `7` | 不適用(無外部輸入; TL-006c) |
| `WWebSso.mjs` `getSta*` | 遠端函數, 不收 `timeLength` | 不適用(TL-006c) |

- **盤點指令**: `Grep -n "timeLength" server --glob "*.mjs"`(8 檔, 皆在 `server/staLogs/`); `Grep -n "parseTimeLength" server`(唯一定義於 `staLogsCore.mjs`).
- **測試**: `test/unit-staLogs-timeLength.test.mjs`(TL-001 判準全表、TL-002 無效 35 候選 × 9 層〔genPlan 同步 throw, 其餘 reject 固定鍵; 子行程 + 逾時〕、TL-003 有效 11 候選 × 9 層桶數、TL-004 single-flight(7／'7'／' 7 ' 同一 promise)、TL-004b single-flight 鍵之 `timeNow` 只在被採用時入鍵(無效 `timeNow`〔含 BigInt、循環物件、`toJSON` 拋錯者〕與未給同鍵且不使 `staLogs` 同步拋錯)、TL-005 `timeNow` 範圍外 13 種退回現在 + 範圍內 2 種採用、TL-006a～c 站點不變式、TL-007 語系鍵; 共 68 案); `test/tools/timeLengthChild.mjs`(子行程); `unit-staLogs-futureBucket` FUT-005 改為負值被拒與 `timeLength ∈ {0,1,7}`. 修前紅(修前碼鏡像根): 見 `sgud/state/state.md`〈第 301／206／389 項〉; 變異驗證見 `sgud/state/state.md`.
- **為何子行程**: 修前之無效值使 `genPlan` 為同步無窮迴圈, 同行程內 mocha 之逾時計時器亦無法觸發; 父行程以 `spawnSync` 之 `timeout`(`TL_CHILD_TIMEOUT_MS`, 預設 15 秒)終止, 逾時即判該層卡住.
- **已知限制**: 與 w-web-api 之寬嚴不同(本套件收數字字串、w-web-api 之 `Number.isInteger` 拒字串), 收斂列主控待辦; 上限 3650 對 `hr` 仍可建約 8.8 萬桶(約 1～3 秒).

## R-FS-LEVEL-01: wsemi 列舉函數(1.9.80 起第 2 參數為 `opt`, 未給 `opt.levelLimit` 即窮舉)於本庫之呼叫點, 層數一律於呼叫處明給(2026-11-26 m667c3, 任務 20261126180310, 排程第 667 項; 對應 wsemi 破壞性變更紀錄第 83 項; 與 w-web-perm、w-web-api 同型)

軸: 呼叫形(省略第 2 參數、數字、`{ levelLimit: n }`、`{ levelLimit: <變數> }`、窮舉) × 函數(`fsTreeFolder`、`fsTreeFolderWithHash`、`fsGetFilesInFolder`、`fsGetFilesWithHashInFolder`、`fsGetFoldersInFolder` 及各 `*Core`) × 站點類別(src、test).

- **規則**: 修前形(省略第 2 參數)於 1.9.80 靜默變為窮舉(無拋錯、無警告); 舊版 wsemi 遇物件之第 2 參數亦視為無效層數而取 1 層, 故遷移改寫不必與升版同時發生, 唯「只升版不改寫」會靜默窮舉.
  1. 統計日誌掃描只列 `fdLog` 下第 1 層(子資料夾內之檔不掃; 資料夾項目於其後剔除): 呼叫寫 `fsTreeFolder(fdLog, { levelLimit: 1 })`. 本庫目前無窮舉之站點; 日後要窮舉者省略 opt 並於註解寫明「窮舉」.
  2. 不得以數字為第 2 參數(1.9.80 起拋 `invalid opt: must be an object`), 不得傳第 3 個引數(拋 `invalid arguments: must be fd and opt only`), 不得把未檢測之變數傳入 `{ levelLimit: v }`(`null`／無效值於新版為窮舉, 舊版為 1 層).
  3. 守護: 子資料夾夾具之案(下表)須對「省略 opt(窮舉)」與「`levelLimit: 2`」兩種變異皆轉紅.
- **站點全集(2026-11-26; 指令: `git grep -nE "\b(fsTreeFolder|fsTreeFolderWithHash|fsGetFilesInFolder|fsGetFilesWithHashInFolder|fsGetFoldersInFolder)(Core)?\s*\(" -- . ':!dist' ':!docs'`; 本庫 4 處呼叫, 皆為 `fsTreeFolder`, 原省略第 2 參數)**:

| 站點 | 類別 | 呼叫 | 判定 | 層數鑑別之測試 |
|---|---|---|---|---|
| `server/staLogs/staLogsCore.mjs:128` `listFiles` | src | `fsTreeFolder(fdLog, { levelLimit: 1 })` | 已套(第 1 層) | `unit-staLogs-golden` GOLD-020-subfolder-ignored(`fdLog` 之副本內建子資料夾 `sub`, 其內放一檔 `2026-08-28T01.log`〔事件 `verifyConn`, ip `6.6.6.6`〕, staIp 之輸出須與 expectedHr 相同); 變異「省略 opt」「`levelLimit: 2`」皆紅(2026-11-26) |
| `test/staLogs-golden/legacy/staIp.mjs:44`、`staToken.mjs:44`、`staUserAccountLogin.mjs:45` | test(改造前原碼留存, golden 產生器用) | 同上 | 已套(第 1 層) | 無: 夾具 `logs/` 無子資料夾, 只證重產 `expected-hr.json`／`expected-day.json` 逐位不變(sha256 相同, 2026-11-26) |

- **不得**: 把省略 opt 之呼叫當作「第 1 層」; 於 `listFiles` 後以過濾層數代替 `levelLimit`(會先窮舉整棵樹); 於測試端以 `legacy/` 之輸出當層數之真理(夾具無子資料夾).

## 專案特有機制(補充)

- email 信件文字(標題/內文)統一存於 `server/procLang.mjs`(`regVerifyEm*` / `chpwEm*` / `resetPwEm*` 等鍵), settings 之 `kpLangExtEmail` 逐語系覆寫、`kpLangExt` 最終覆寫(2026-08-20 `2f03bc5` 起, 原 `server/template/*.html` 信件模板已移除); `procLang({})` 回傳形狀為 `r[lang][key]`.
- 日期選擇器(WTimeminute)語系化: 三清單頁經 mUI `getTimePickerRenderFuns()` 傳入 funRender*(語系鍵 `dtPicker*`), 見 ADR-054.
- 對外查詢 helper `src/{getUserByToken,getUsersByToken,getUserByUserId}.mjs`(供外部系統於伺服端直接 import; 共用核心 `src/fetchSsoMsg.mjs`, 內建 fetch 經 `src/httpGetJson.mjs`, ADR-056 / ADR-068): 契約測試 `test/api-external-helpers.test.mjs`(真後端 + base seed; `getUserByUserId` 之查詢鍵為 `key=id`)與 `test/unit-external-helpers.test.mjs`(不起後端); reject key 與消費端白名單之同步見 R-SEC-01.

