# 規則帳本

本檔為套件設計與開發階段之規則帳本,為要求程式碼須長成什麼樣,或由規格產出之測試(項目/說明/流程)有哪些,包含軸、單一擁有者、已知限制、破壞性變更紀錄,以及對應是哪些測試檔案或指令等,由agent自行編列、擴充與維護.

## 分冊索引(哪類查哪檔)

2026-10-22 起本帳本依類型拆冊(全域設定 §14: 過長即整理; 原 152008 位元組), 節號與標題不變、內容只搬不刪; 規則編號(R-*)與其中之節名不變, 引用處以編號 / 標題 Grep 即可定位.

| 要查什麼 | 檔 | 內容 |
|---|---|---|
| 測試配置全節 | `rulebook_test.md` | 測試配置全節: 執行入口、spec→測試檔對照、unit / api / e2e 各層、工具層、目錄與資產、seed、e2e 契約映射 |
| 專案特有機制(含補充) | `rulebook_mechanism.md` | 專案特有機制(含補充): 統計頁確定性資料、XFF 本機注入、雙擊 / 並發契約、app token、email、語系、對外查詢 helper 等 |
| R-VUE-01、R-VUE-02、R-UI-01、R-UI-02、R-UI-03 | `rulebook_ui.md` | R-VUE-01、R-VUE-02、R-UI-01、R-UI-02、R-UI-03 |
| R-SEC-01、R-LOG-01、R-PERM-01、R-SESS-01、R-APPTOK-01、R-SYS-01、R-IP-01、R-QKEY-01 | `rulebook_security.md` | R-SEC-01、R-LOG-01(console 診斷不輸出資料值, 2026-10-31 第 191 項, ADR-101; 取代 R-SEC-01 之 console 處置)、R-PERM-01、R-SESS-01(改密碼後之 session 處置, 2026-10-23 第 117 項)、R-APPTOK-01(應用系統金鑰兩種用途與身分驗證缺口 S-1~S-6, 2026-10-24 sso-run01)、R-SYS-01(框架系統函數之身分關卡 `sysFuncsPublic`, 2026-10-25 sso-run01, ADR-096)、R-IP-01、R-QKEY-01 |
| R-OBJ-ITER-01、R-KEY-01、R-CNT-01 | `rulebook_inputkeys.md` | R-OBJ-ITER-01、R-KEY-01、R-CNT-01 |
| R-ORM-01、R-VAL-01、R-VAL-02、R-ORM-02、R-ORM-03、R-ORM-04 | `rulebook_orm.md` | R-ORM-01、R-VAL-01、R-VAL-02(後台使用者清單 redir 檢查範圍, 2026-10-23 第 116 項)、R-ORM-02、R-ORM-03、R-ORM-04(w-serv-orm 診斷輸出導入 srLog 與外來值入口遮罩, 2026-10-28 第 154 項導入; 2026-10-29 第 161 項改依 wsemi 共用模組, ADR-099) |
| R-ERR-01、R-PKG-01 | `rulebook_runtime.md` | R-ERR-01、R-PKG-01 |
| 已知缺口 / 待辦(對照技能 audit)全節 | `rulebook_gaps.md` | 已知缺口 / 待辦(對照技能 audit)全節 |
| 多人同時編輯(原則 10): 欄位三分類、寫入者全集、寫入契約、現存缺陷、第二波規劃與**實作結果**(V1~V14 對應、缺陷 → 測試、變異驗證、改動範圍 → 測試檔) | `rulebook_concurrency.md` | 2026-10-22 盤點輪(第 111 項 inv01)新增; 2026-10-23 第二波實作輪(sso-run01)補「第二波實作結果」 |
| 外部匯入(原則 11): R-IMPORT-01(預期功能,未做;第 113 項) | `rulebook_import.md` | 2026-10-22 主控依使用者裁示新增 |

程式碼規則(`## 程式碼規則`)之各條已依類型分至 `rulebook_ui.md` / `rulebook_security.md` / `rulebook_inputkeys.md` / `rulebook_orm.md` / `rulebook_runtime.md`(見上表).

## 程式碼規則


## 診斷輸出與遮罩(跨套件規格; 摘要, 2026-10-29 第 161 項 mig-sso)

遮罩與診斷輸出**一律用 wsemi 之共用函數**(`getDiag`、`getDiagSecrets`、`maskDiagText`、`maskDiagCopy`、`maskDiagErr`、`maskDiagUrl`、`getDiagBriefErr`、`genDiagFunLog`), 本套件**不得另寫等價實作**; 各套件只宣告「本套件之秘密來源、呼叫點」. 規則全文見:

- 跨套件規格: `C:\opensrcOper\dspec\診斷輸出與遮罩.md`(原則 D1~D5、使用者裁定 Q1~Q4 與 P1~P9、已知限制 §5; 本套件適用 **Q1**: sso 之 orm-diag 只寫安全摘要).
- wsemi 規則: R-DIAG-01(`node_modules/wsemi` 之來源 repo `sgud/rule/rulebook_diag.md`, 唯讀參考); 共用測試語料 `wsemi/src/_diagCases.mjs`(各套件接線測試以其適用子集重跑呼叫點).

本套件須宣告與做到者(逐條對應 `rulebook_orm.md` R-ORM-04 與 `test/unit-diaglog.test.mjs` SITE-DG-001~009):

1. `WServOrm` 之 opt 只給 `{ funLog }`, `funLog` 由 `genDiagFunLog((o) => srLog.warn(o), { safeKeys: SAFE_KEYS })` 產生(`SAFE_KEYS` 自 w-serv-orm 公開入口 `w-serv-orm/src/safeKeys.mjs` 匯入, 2026-10-30 起; 名單外之 safe 頂層鍵丟棄, `errType`、`errCode` 恆保留); 無 detail、不 console 雙寫、等級 warn. 出貨碼只匯入 w-serv-orm 之公開入口(`WServOrm.mjs`、`baseline.mjs`、`safeKeys.mjs`), 唯一內部檔例外 `getIgnoredOrmKeys.mjs`(`checkOptRemoved.mjs`, R-ORM-02), 全表見 R-ORM-04 第 7 條與 SITE-DG-011.
2. 秘密來源 = 資料庫連線字串 `url` + 寄信帳密(`emSrcEmail` / `emSrcPW`), 以 `getDiag({}, { secrets: getDiagSecrets(...) })` 建 `diag`.
3. **外來值(資料庫驅動、SMTP 之 reject)於「進入本套件」之入口遮罩**: `guardOrm(diag, woItems)`、`srEmail.send` 之 catch、`WServOrm` 建構錯誤、`ormWrite` 逐筆 err; 其後之 console、srLog、kpfun、HTTP 端點皆已遮罩.
4. **本套件以固定詞彙組成之 reject 不得包 `diag.err` / `diag.mask`**(dspec R07).
5. 不自寫遮罩; 需要時用 `diag`; 發現 wsemi 函數缺陷依全域設定 §5.2 撰寫建議檔交主控, 不在本套件繞道.
6. **console 診斷不輸出資料值(D2; 2026-10-31 第 191 項, ADR-101, `rulebook_security.md` R-LOG-01)**: console 只印鍵名(名單內)、型別 `(typeof x)`、固定詞彙與錯誤摘要 `{ errType, errCode }`(`diag.brief` / `getDiagBriefErr`, 不自寫); 不印使用者物件、請求本體、傳入參數值、查詢值(含識別欄)、IP、權杖列欄位、設定值、語系值、後端 / 驅動 / SMTP 錯誤原文(遮罩只遮憑證, 不遮其他資料值, 故經 `diag.err` 之錯誤原文亦不印). 站點全集由 `test/unit-consoleNoLeak.test.mjs` 之 SITE-CNL 鎖定, 新增 console 呼叫須屬允許形態.
