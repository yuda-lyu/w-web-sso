//ips 表之寫入契約: 無範圍; timeBlocked 為雙方欄位(自動封鎖會寫, 系統直寫須取表鎖).
//系統計時器自動登錄之新 IP 屬「他人於載入後新增」, 舊畫面存檔即被拒(先動先贏), 使用者重新載入後再存.
export default {
    table: 'ips',
    pk: 'id',
    fields: ['ip', 'timeBlocked'],
    serverOnly: ['userIdUpdate'],
    scope: null,
}
