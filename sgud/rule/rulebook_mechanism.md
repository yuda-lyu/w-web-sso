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
- 測試中介資料一律落 `test/_tmp/`(gitignore, 測完即刪): 臨時 settings(`cleanup()` 刪)、`unit-staLogs` 之 `fixture-logs`、`unit-staLogs-golden` 之 `golden-copy` / `golden-tmp`(各自 `after` 清除); 絕不放 `./tmp/`(AI 代理暫存區隨時整個清除).

## 專案特有機制(補充)

- email 信件文字(標題/內文)統一存於 `server/procLang.mjs`(`regVerifyEm*` / `chpwEm*` / `resetPwEm*` 等鍵), settings 之 `kpLangExtEmail` 逐語系覆寫、`kpLangExt` 最終覆寫(2026-08-20 `2f03bc5` 起, 原 `server/template/*.html` 信件模板已移除); `procLang({})` 回傳形狀為 `r[lang][key]`.
- 日期選擇器(WTimeminute)語系化: 三清單頁經 mUI `getTimePickerRenderFuns()` 傳入 funRender*(語系鍵 `dtPicker*`), 見 ADR-054.
- 對外查詢 helper `src/{getUserByToken,getUsersByToken,getUserByUserId}.mjs`(供外部系統於伺服端直接 import; 共用核心 `src/fetchSsoMsg.mjs`, 內建 fetch 經 `src/httpGetJson.mjs`, ADR-056 / ADR-068): 契約測試 `test/api-external-helpers.test.mjs`(真後端 + base seed; `getUserByUserId` 之查詢鍵為 `key=id`)與 `test/unit-external-helpers.test.mjs`(不起後端); reject key 與消費端白名單之同步見 R-SEC-01.

