# 規則帳本分冊:外部匯入(w-web-sso)

本冊由 opensrcOper 主控 2026-10-22 依使用者裁示寫入(原則 11).索引見 `rulebook.md`.

## R-IMPORT-01 外部匯入(原則 11):本系統只提供匯入管道,依外部自訂之來源鍵差異同步

- **規格(真理源)**:`C:\opensrcOper\dspec\外部匯入之定義與機制.md`;上位原則 `C:\opensrcOper\sgud\proc\process_principle.md` 第 11 條.
- **需求來源**:使用者 2026-10-22——sso 須能納入例如業主之 AD 使用者清單.
- **規則**:
  - 入口 `POST /syncAndReplaceTabs?keyTable=users&token=`.
    - 以 app 權杖驗證,須具 `syncAndReplaceTabs` 權限.
    - 路由名與 perm、w-web-api 一致.
    - 其他表是否開放,於第 113 項設計時定.
  - 本文 `{ from, rows }`.
    - `from`:來源名,非空字串;users 表之 `from` 欄已在 schema(`src/schema/tables/users.mjs:45`).
    - `rows`:該來源之完整清單.
    - 每列帶外部自訂之來源鍵 `srcKey`(例 AD 之 objectGUID),於該 `from` 內唯一且穩定.
    - 內部 `id` 由本系統產生.
  - 於 users 表鎖內(與後台清單存檔、系統直寫同一把),以 `srcKey` 比對庫內該 `from` 之列:
    - 新增:配新 `id`.
    - 刪除:同鎖撤銷其權杖,依表名排序取 `[tokens, users]`.
    - 修改:保留 `id`.
    - 不變:不寫.
  - **欄位歸屬**(初稿,第 113 項設計時定案):
    - 外部擁有:`account`、`name`、`email` 等身分資料.
    - 本系統擁有:`password`、`tokenVerify`、`timeBlocked`、`timeVerified`、`isForceChangePw`、權杖;匯入一律不寫.
    - 歸屬待定:`isAdmin`、`isActive`.
  - 整批驗證、全有或全無:下列情形拒收、零寫入.
    - 缺 `srcKey`、`srcKey` 為空或同批重複.
    - `from` 為空.
    - 觸及他來源或後台自建之列.
    - 帳號/email 與他來源或後台列衝突(原則 3 收嚴＋提示).
    - 空批次.
  - 回 `{ nAdd, nUpdate, nDel, nSame }`;錯誤回固定鍵、不回顯值.
- **待設計(第 113 項)**:
  - 外部匯入之使用者如何登入:sso 密碼、外部驗證,或首次登入設定密碼.
  - 後台可否停用外部列.
  - 外部列在後台使用者清單之唯讀範圍(比照 perm `lockExternalRows`).
- **刪除防護**:本條為**預期功能**.未實作或未完成之匯入程式(含雛形、外部端輔助 `provideTabs`)不是死碼,不得以「無引用／orphan」刪除(opensrcOper 帳本 G8).
- **歷史**:
  - 本套件原有雛形:`server/provideTabs.mjs`、根目錄 `g.provideUsers.mjs`(永遠 reject `incompleted`)、`WWebSso.mjs` 內註解之 `delAll({ from })` 同步.
  - 2026-06-09 稽核(`06966d8`)以 zero ref／orphan 為由當死碼移除,其後無人察覺本套件已無外部匯入管道.
  - 現行外部只能以 app 權杖呼叫整表存檔 `updateUsersList`,會刪光清單外之使用者(含後台自建者).
- **狀態:未做**(排程第 113 項;與第 111 項同輪設計,第 110 項發布後實作).
- **驗收**:規格第 10 節 I1–I14,逐條對應測試檔(實作時建立).
- 盤點:`git grep -nE "path: '/syncAndReplaceTabs'|srcKey" -- server`(現 0 筆;完成後應有入口與 `srcKey` 比對).
