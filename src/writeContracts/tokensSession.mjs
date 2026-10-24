//tokens 表之 session 列寫入契約(isApp 非 'y'): 與 tokens.mjs 同 fields, 範圍互補.
//用於逐列寬鬆比對(後端 procCore.updateTabItems tokens 路徑): 只比對管理員有修改或刪除之列, 載入後新增者不刪、已不在庫內者不復活、
//系統續期而管理員未動者不寫、管理員有動且庫內已變者拒收.
export default {
    table: 'tokens',
    pk: 'id',
    fields: ['token', 'userId', 'isApp', 'perms', 'timeCreate', 'timeEnd'],
    serverOnly: ['timeUpdate', 'userIdUpdate', 'appUsage', 'appName'], //同 tokens.mjs: 只由 createAppToken 寫入, 不入基準 (ADR-095)
    scope: (r) => r.isApp !== 'y',
}
