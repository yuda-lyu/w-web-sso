import get from 'lodash-es/get.js'
import isestr from 'wsemi/src/isestr.mjs'


//應用系統金鑰(app token, tokens.isApp='y')之用途 (ADR-095; 前後端共用)
//
//用途分兩種, 以 tokens.appUsage 區分:
//- 'user'(使用者用途): 以 tokens.userId 綁定一位使用者(可綁管理員), 代表所綁使用者本人, 授權等同所綁使用者之使用者 token; 不適用 perms; 每次使用皆依所綁使用者「當前」狀態判定
//- 'system'(系統服務用途): 不綁使用者, 代表外部應用系統本身, 授權依 perms (ADR-069); tokens.userId 只記建立者(稽核), 不得當身分使用(不據以反查、撤銷、改密碼)
//- 既有列(升級前建立, 無此欄或 ''): 視同 'system'——升級前之反查即回 isAdmin='y' 且授權依 perms, 預設相容部署中之整合不中斷 (使用者 2026-10-24 裁示, 無須遷移資料)
//- 其餘值(未登錄字串、非字串): 一律不可用(fail closed)


//keysAppUsage: 用途字串全集, 順序即後台新增對話框之顯示序
let keysAppUsage = ['user', 'system']


//keyAppIdPrefix: 系統服務用途之反查身分 id 前綴; id = 前綴 + tokens.id, 於 token 存續期間穩定, 且使用者主鍵不得以此前綴開頭(後台清單存檔拒收), 故不與使用者 id 相撞
let keyAppIdPrefix = 'app:'


//getAppUsage: 取應用系統金鑰之有效用途; 回 'user' | 'system' | ''(未登錄之值, 不可用)
//非應用系統金鑰(isApp !== 'y')回 ''; 缺欄 / '' / null 視同 'system'(既有列)
function getAppUsage(tk) {
    if (get(tk, 'isApp', '') !== 'y') {
        return ''
    }
    let v = get(tk, 'appUsage', '')
    if (v === undefined || v === null || v === '' || v === 'system') {
        return 'system'
    }
    if (v === 'user') {
        return 'user'
    }
    return ''
}


//isAppUsageValue: 新建時之用途值是否合法(須明確給予, 不接受缺欄或 '')
function isAppUsageValue(v) {
    return isestr(v) && keysAppUsage.includes(v)
}


//getAppId: 系統服務用途之反查身分 id
function getAppId(tk) {
    return `${keyAppIdPrefix}${get(tk, 'id', '')}`
}


//isAppIdLike: 使用者主鍵是否落在系統服務用途之保留前綴
function isAppIdLike(id) {
    return isestr(id) && id.startsWith(keyAppIdPrefix)
}


export {
    keysAppUsage,
    keyAppIdPrefix,
    getAppUsage,
    isAppUsageValue,
    getAppId,
    isAppIdLike
}
