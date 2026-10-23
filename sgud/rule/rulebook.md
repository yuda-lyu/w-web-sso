# 規則帳本

本檔為套件設計與開發階段之規則帳本,為要求程式碼須長成什麼樣,或由規格產出之測試(項目/說明/流程)有哪些,包含軸、單一擁有者、已知限制、破壞性變更紀錄,以及對應是哪些測試檔案或指令等,由agent自行編列、擴充與維護.

## 分冊索引(哪類查哪檔)

2026-10-22 起本帳本依類型拆冊(全域設定 §14: 過長即整理; 原 152008 位元組), 節號與標題不變、內容只搬不刪; 規則編號(R-*)與其中之節名不變, 引用處以編號 / 標題 Grep 即可定位.

| 要查什麼 | 檔 | 內容 |
|---|---|---|
| 測試配置全節 | `rulebook_test.md` | 測試配置全節: 執行入口、spec→測試檔對照、unit / api / e2e 各層、工具層、目錄與資產、seed、e2e 契約映射 |
| 專案特有機制(含補充) | `rulebook_mechanism.md` | 專案特有機制(含補充): 統計頁確定性資料、XFF 本機注入、雙擊 / 並發契約、app token、email、語系、對外查詢 helper 等 |
| R-VUE-01、R-VUE-02、R-UI-01、R-UI-02、R-UI-03 | `rulebook_ui.md` | R-VUE-01、R-VUE-02、R-UI-01、R-UI-02、R-UI-03 |
| R-SEC-01、R-PERM-01、R-SESS-01、R-IP-01、R-QKEY-01 | `rulebook_security.md` | R-SEC-01、R-PERM-01、R-SESS-01(改密碼後之 session 處置, 2026-10-23 第 117 項)、R-IP-01、R-QKEY-01 |
| R-OBJ-ITER-01、R-KEY-01、R-CNT-01 | `rulebook_inputkeys.md` | R-OBJ-ITER-01、R-KEY-01、R-CNT-01 |
| R-ORM-01、R-VAL-01、R-VAL-02、R-ORM-02、R-ORM-03 | `rulebook_orm.md` | R-ORM-01、R-VAL-01、R-VAL-02(後台使用者清單 redir 檢查範圍, 2026-10-23 第 116 項)、R-ORM-02、R-ORM-03 |
| R-ERR-01、R-PKG-01 | `rulebook_runtime.md` | R-ERR-01、R-PKG-01 |
| 已知缺口 / 待辦(對照技能 audit)全節 | `rulebook_gaps.md` | 已知缺口 / 待辦(對照技能 audit)全節 |
| 多人同時編輯(原則 10): 欄位三分類、寫入者全集、寫入契約、現存缺陷、第二波規劃與**實作結果**(V1~V14 對應、缺陷 → 測試、變異驗證、改動範圍 → 測試檔) | `rulebook_concurrency.md` | 2026-10-22 盤點輪(第 111 項 inv01)新增; 2026-10-23 第二波實作輪(sso-run01)補「第二波實作結果」 |
| 外部匯入(原則 11): R-IMPORT-01(預期功能,未做;第 113 項) | `rulebook_import.md` | 2026-10-22 主控依使用者裁示新增 |

程式碼規則(`## 程式碼規則`)之各條已依類型分至 `rulebook_ui.md` / `rulebook_security.md` / `rulebook_inputkeys.md` / `rulebook_orm.md` / `rulebook_runtime.md`(見上表).

## 程式碼規則

