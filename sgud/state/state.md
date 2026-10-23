# 現況(state)

本檔只記**現況**(各功能做到哪裡、對應之規則帳本條目與測試檔、已知缺口與待辦、最近一次驗證或發布之版本); 不寫過程(過程入 `sgud/exp/experience.md`). 接續工作先讀本檔. 完成一項功能或結束一輪工作時更新. 2026-10-22 建立(第 111 項 inv01 盤點輪); 2026-10-23 更新(第 111 項第二波 sso-run01 實作輪; sso-run02 e2e 隔離修正; sso-run03 清單存檔不得新增 session 列).

## 版本與依賴

- 套件版本: `package.json` 1.1.12(**版本號與 `script.txt` 依規定未動, 發布由使用者**); 工作樹 HEAD `26c2c54`(2026-10-20, 第 93 項 run02: strip forwarded port、whitelist query keys、mask logs); 未提交: 本輪(第 111 項第二波)之 `server/`、`src/`、`test/`、`spec/`、`README.md`、`.npmignore`(排除 `sgud`)、`sgud/`.
- 關鍵依賴(`package.json` 範圍 = 已安裝版): `w-serv-orm ^1.1.17`(2026-10-23 自 ^1.1.15 升, 取 `withTabLocks / guardWrite / baseline` 與 `procOrm` 之 `mustExist / keepUserId`)、`w-orm-lmdb ^1.0.42`、`w-serv-hapi ^1.1.7`、`wsemi ^1.9.21`、`w-data-collector ^1.0.47`、`w-syslog ^1.0.34`、`w-component-vue ^2.5.31`、`w-package-tools-e2e ^1.0.8`、`w-screenctl ^1.0.26`.
- 服務與 port 見 `CLAUDE_settings.md`(後端 11007、前端 8080、w-screenctl 7000).

## 功能現況

| 功能(`spec/流程_*.md`) | 現況 | 規則帳本條目 | 測試檔(分層見 `rulebook_test.md`「spec → 測試檔對照」) |
|---|---|---|---|
| 使用者一般登入 / 自動登入 / 登出 | 完成 | `rulebook_security.md` R-SEC-01; `rulebook_mechanism.md` | `e2e-login`、`e2e-autologin`、`e2e-logout` |
| 使用者創建帳密(自助註冊 / 驗證信) | 完成 | R-VAL-01、R-ORM-01(`rulebook_orm.md`) | `e2e-register`、`unit-register`、`unit-ormWriteFail` B1 / B2 / B6 / B8 |
| 使用者變更密碼 / 後台重設使用者密碼 | 完成 | R-ORM-01 | `e2e-changepassword`、`e2e-resetpassword`、`api-resetpassword`、`unit-genRandomPassword` |
| 後台新增 / 變更 / 刪除使用者(使用者清單) | 完成; 多人同時編輯保護**已做**(2026-10-23, 帶基準整表先動先贏; 不帶基準照舊允許至下一 major) | R-VAL-01、R-ORM-01、R-UI-01、R-CONC-01~05 | `e2e-adduser`、`e2e-modifyuser`、`e2e-deleteuser`、`e2e-concurrency`、`api-adduser`、`api-deleteuser`、`api-doubleclick`、`api-concurrency`、`unit-saveBaseline`、`unit-tablock`、`unit-writeContract` |
| 後台金鑰清單(含 app 權杖權限 perms) | 完成; 多人同時編輯保護**已做**(選項 P: app 列嚴格整表、session 列寬鬆; E1、X1、X7 已修); **清單存檔不得新增 session 列**(`isApp !== 'y'`、庫內不存在 → 整次拒收 `tokenSessionAddNotAllowed`, 帶或不帶基準皆然; 不帶基準送回已撤銷 session 列不再復活; 2026-10-23 sso-run03, ADR-092) | R-PERM-01、R-ORM-03、R-CONC-01~06 | `e2e-tokens`、`e2e-concurrency`、`api-apptoken-perms`、`api-concurrency`、`unit-appPerms`、`unit-saveBaseline`、`unit-tablock` |
| 後台 IP 清單 | 完成; 多人同時編輯保護**已做**(X4 已修: 計時器登錄之新 IP 不被舊畫面刪) | R-VAL-01、R-CONC-01~05 | `e2e-ips`、`e2e-concurrency`、`api-concurrency`、`unit-saveBaseline` |
| 多人同時編輯之寫入契約(`src/writeContracts/`、`src/baselineOf.mjs`、19 個 server 寫入站點之表鎖、`mustExist` 只改不增) | **完成**(sso-run01, 2026-10-23); 流程見 `spec/流程_多人同時編輯.md`、取捨見 ADR-091 | `rulebook_concurrency.md` R-CONC-01~05 | `unit-writeContract`、`unit-saveBaseline`、`unit-tablock`、`api-concurrency`、`e2e-concurrency` |
| 後台統計資訊 | 完成 | R-PKG-01、R-OBJ-ITER-01 | `e2e-stainfor`、`api-stainfor`、`unit-staLogs*`、`unit-staUsage` |
| 查詢使用者資訊(對外 HTTP / kpfun / helper) | 完成(欄位名白名單 `id / account / email / name`) | R-QKEY-01、R-SEC-01 | `api-getuserinfor`、`api-external-helpers`、`unit-queryKey`、`unit-external-helpers` |
| 自動封鎖機制(帳號 / 權杖 / IP) | 完成(來源 IP 取 `X-Forwarded-For` 最左段, 驗證格式; 計數鍵剪枝) | R-IP-01、R-CNT-01、R-KEY-01 | `e2e-autoblock`、`api-autoblock-*`、`api-sourceip`、`unit-sourceIp`、`unit-countKeys` |
| 後端計時器錯誤收斂 / 打包後可用 | 完成 | R-ERR-01、R-PKG-01(`rulebook_runtime.md`) | `unit-protectTimers`、`unit-resolveShellWorker` |
| 外部匯入(例:業主 AD 使用者清單) | **未做**(預期功能;無入口.2026-06 雛形被當死碼誤刪;現外部只能以 app 權杖整表存檔,會刪光清單外使用者);排程第 113 項 | R-IMPORT-01(`rulebook_import.md`) | — |

## 第 111 項: 多人同時編輯之寫入契約(第二波已實作, 2026-10-23 sso-run01)

- **第一步「盤點輪」(2026-10-22)**: 成果在 `sgud/rule/rulebook_concurrency.md`——19 個 server 寫入站點 + 4 個離線站點全數歸類、三表逐欄三分類、寫入契約、現存缺陷實證(E1、X1~X8)、第二波規劃.
- **第二波「實作輪」(2026-10-23)已完成**: ①19 個站點全數取表鎖(`[tokens, users]` 同鎖撤銷、`createUser` 唯一性檢查在 users 鎖內)並經 `procOrm + mustExist` 只改不增; ②`updateTabItems` 重寫(新鮮讀取 → 驗證 → `compareBaseline` → 差異 → 寫入 → 撤銷; 刪除集合 = 基準內 − 送出; 只寫契約 `fields`; 伺服器專有欄位取庫內值); ③tokens 選項 P; ④ips 同; ⑤稽核欄(`userIdUpdate`、`keepUserId`、`system`); ⑥前端三清單頁自算基準、拒收保留草稿並提示重新載入、成功後重拉; ⑦不帶基準之寫入本 major 照舊允許(鎖 + 只改不增 + 專有欄位不採信), **下一 major 起後台須帶基準**(README Upgrade Notes); ⑧T3 `getUsersList` 不再回傳 `tokenVerify`; ⑨拒收鍵映射為自有語系鍵 `saveStale / saveRowNotFound / saveBaselineFormat`.
- 規劃與實作之差異、V1~V14 對應、缺陷 → 測試、變異驗證 41 / 41、改動範圍 → 測試檔: 見 `rulebook_concurrency.md`「第二波實作結果」; 取捨見 ADR-091; 流程見 `spec/流程_多人同時編輯.md`.
- **未做 / 後續**: 第 113 項(users 外部匯入管道, 依 `from` 範圍與 `srcKey` 差異同步; R-IMPORT-01)——其 V2 之 I1 同 `srcKey` 重送待該項補; 下一 major 把「不帶基準」改為拒收.

## 已知缺口與待辦(索引; 全文見 `rulebook_gaps.md`)

- 多人同時編輯之已知限制(全文見 `rulebook_concurrency.md`「已知限制與風險」): 不帶基準之舊頁 / app 權杖不受先動先贏保護(但已撤銷 session 列不再因送回而復活, R-CONC-06); IP 清單在繁忙系統較常需重新載入; 管理員刪 / 改載入後被 API 端續期之 session 時整次拒收; 離線工具 `g_initialData.mjs` 4 處直寫不取表鎖(前提服務已停止); 單一行程部署前提.
- 原現存缺陷 E1、X1~X8 **已修**(2026-10-23, 見上).
- `WWebSso` 無完整停止(回傳物件 `stop()` 不清計時器、不關資料庫).
- `e2e-tokens` 之 API client 檢查只在比對端.
- 標準圖「每操作兩張」第 2 期待辦(login E2E-001 為第 1 期已完成).
- 前端 8080 沿用時不驗身分; logFd 解析時點不一致; 套件自帶檔以 cwd 相對路徑定位(皆設計限制 / 觀察).

## 最近一次驗證

- 測試計數(`rulebook_test.md`, 2026-10-23 第 111 項第二波後): unit 23 檔 326 case、api 17 檔 153 case、e2e 15 flow 282 case(eng + cht); 2026-10-23 sso-run03 後: unit 330、api 156(`mocha --dry-run` 載入 768 案).
- **2026-10-23 sso-run01(第 111 項第二波)驗證**: unit 23 檔 326 案全過; 受影響 api 15 檔 147 案全過(未跑 `api-stainfor`、`api-serverport`: 與本輪改動無涉); 受影響 e2e 12 檔 252 案全過、既有標準圖 0 張變動(無新 `testPending`); 新增 `e2e-concurrency` 6 案〈見下〉; 變異驗證 52 項全數被抓到(對照組全綠); 外審 sol 14 條 + beam 4 條逐條核對, 4 條採納修補、1 條採納後撤回、其餘補測試或記為已知限制(見 `rulebook_concurrency.md`〈外審 sol 後之修補〉). 盤點輪(2026-10-22 inv01)探測腳本留存於 `C:\opensrcOper\dnow\20261022221854\agent-out\sso-inv01-probes\`.
- `e2e-concurrency`(2026-10-23 新增, 3 案 × 2 語系): 6 張標準圖(`test/pics/concurrency/`, 被拒訊息框; 每案僅 1 張, 偏離 skill「每步兩張」之理由見 ADR-091 / 報告 D12)經 agent 逐張審圖(紅框框住訊息框面板、訊息為 `儲存○○數據失敗: 資料自您載入後已被其他使用者或系統更動…` 之 eng + cht 原文)後, 比對 6 案全過. 管理員 session 金鑰之 token 字串須固定(`cc-token-admin-session`), 否則該列顯示於金鑰清單畫面使 E2E-CC-002 標準圖每次差 127~130 px(首次比對因此失敗, 已修正並只重產 E2E-CC-002 兩張).
- **2026-10-23 sso-run02(e2e 隔離修正, 只改測試)**: 主控全套 759 過 / 2 敗(`e2e-concurrency` E2E-CC-003 eng + cht, 差 134 px)之成因為測試隔離缺陷, 非產品缺陷、標準圖正確未重產: `e2e-autoblock` 登記之 `1.2.3.203` 留在後端記憶體計數, 被 `ipDetectNew` 補登回 IP 清單(R-E2E-ISO, `rulebook_test.md`「測試資料(seed)」). 修正: `test/tools/e2e-setup.mjs` 新增 `cleanKpIpCallApi` / `cleanKpAccountLoginFailed`(自 autoblock 收斂); `e2e-autoblock` `afterCase` 先清記憶體計數再清 DB; `e2e-concurrency` `prepare` 先清計數再重設種子並以 `assertSeedOnly` 守門三表恰為固定種子. 驗證: 單一 mocha 行程依序跑 `e2e-autoblock` + `e2e-concurrency` 修前 6 綠 2 紅(`diff=134px`)、修後連跑 3 次各 24 / 24 綠; `e2e-concurrency` 單獨連跑 3 次各 6 / 6 綠; `api-concurrency` 連跑 20 次各 21 / 21 綠(同型隔離量測, 0 / 20 失敗); `test/pics` 416 張 sha256 前後 0 變動. 未動 `src/`、`server/`、標準圖、其他測試檔之斷言.
- **2026-10-23 sso-run03(清單存檔不得新增 session 列; 源自 sso-verify01 註記 1)**: `updateTabItems` tokens 路徑加守門——送出列 `isApp !== 'y'` ∧ 庫內不存在 ∧ 不在 `baseline` / `baselineSession` 內 → 整次拒收(零寫入)回新語系鍵 `tokenSessionAddNotAllowed`(eng + cht「不可新增登入權杖」); 基準內而已撤銷者仍略過; 應用系統金鑰列新增、session 刪除 / 升級照舊. 規格見 ADR-092、R-CONC-06. 驗證: 修前紅——unit(修前版 server)SB-T16~T18 紅 / T19 對照綠, api(單一取鎖期間換入修改前版 `procCore.mjs` / `procLang.mjs`, sha256 回驗還原)CC-A-022~024 3 / 3 紅(`ok:true`); 修後 unit 全部 330 案全過(+4: SB-T16~T19)、api `api-concurrency` 24(+3)、`api-apptoken-perms` 20、`api-ormopts` 8、`api-doubleclick` 8、`api-httpendpoints` 12、`api-adduser` 13、`api-deleteuser` 3 全過, e2e `e2e-tokens` 14、`e2e-concurrency` 6 全過, `test/pics` 416 張 sha256 0 變動(`testPending` 1088 檔未增); `mocha --dry-run` 載入 768 案; 變異驗證 12 項全數被抓到(對照組全綠). 既有測試調整(保留意圖): `unit-ormWriteFail` A13 / A18、`unit-iterClientObj` IT-C-003 之新增 tokens 列改為應用系統金鑰列; A23 改以應用系統金鑰驗擁有者並斷言新增 session 列整批拒收. 未跑: 其餘 api 10 檔與 e2e 13 flow(與本改動無執行路徑關聯, 未改 `src/`), 全套由主控最末輪於凍結碼跑.
- **未發布**: 版本號與 `script.txt` 未動, 發布由使用者; 下一 major 起後台必帶基準(README Upgrade Notes).
