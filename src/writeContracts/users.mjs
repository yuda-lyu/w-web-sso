//users 表之寫入契約(多人同時編輯, 原則 10; 規格見 opensrcOper dspec/多人同時編輯之寫入契約.md §3~§5):
//前端(buildBaseline 自算基準)與後端(compareBaseline 於表鎖內重算)匯入同一檔, 欄位政策只此一處.
//分類依 sgud/rule/rulebook_concurrency.md R-CONC-02:
//- fields: 客戶端欄位 ∪ 雙方欄位(timeVerified / timeBlocked / isForceChangePw 系統亦會寫, 系統直寫須取表鎖; 被系統改動後持舊畫面存檔即被拒)
//- serverOnly: 伺服器專有(password / tokenVerify 與稽核欄), 不入基準, 存檔不採用客戶端值
//- orderKey: 存檔依列序重編 order, 以名次入基準
//新增欄位時須同步補分類(unit-writeContract 核對每表每欄皆已分類)
export default {
    table: 'users',
    pk: 'id',
    fields: ['account', 'name', 'email', 'description', 'from', 'redir', 'isAdmin', 'timeVerified', 'timeExpired', 'timeBlocked', 'isForceChangePw', 'isActive'],
    serverOnly: ['password', 'tokenVerify', 'userId', 'timeCreate', 'userIdUpdate', 'timeUpdate'],
    orderKey: 'order',
    scope: null,
}
