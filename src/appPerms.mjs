import get from 'lodash-es/get.js'
import isarr from 'wsemi/src/isarr.mjs'
import isestr from 'wsemi/src/isestr.mjs'


//應用系統金鑰(app token, tokens.isApp='y')之權限 (ADR-069)
//
//tokens.perms 為權限字串陣列, 多元素即多權限聯集; 僅 isApp='y' 時生效(使用者 token 仍依其使用者之 isAdmin 判斷).
//基本權限 readUsers 恆具備, 不受 perms 欄影響: 介接之本務為查使用者與驗證使用者 token(對標 GitHub fine-grained token 之 Metadata read 必選).
//新增權限須同時: 於 keysAppPerm 登錄 + 於權限閘宣告(server/WWebSso.mjs 之 opt.perm 或 procCore 內部) + server/procLang.mjs 補鍵 appPerm_<權限>(eng + cht).


//keysAppPerm: 權限字串全集, 順序即後台金鑰清單之顯示序
let keysAppPerm = [
    'readUsers', //讀使用者: 對外 getSsoUserInfor / getSsoUsersList, 後台 getUserInfor / getUsersList
    'writeUsers', //寫使用者: 後台 updateUsersList / adminResetUserPassword
    'readTokens', //讀金鑰: 後台 getTokensList
    'writeTokens', //寫金鑰: 後台 updateTokensList
    'readIps', //讀IP: 後台 getIpsList
    'writeIps', //寫IP: 後台 updateIpsList
    'readStats', //讀統計: 後台 getStaUserSummary / getStaTokenSummary / getStaIpSummary / getStaUserAccountLogin / getStaToken / getStaIp
]


//keysAppPermBase: 基本權限, 每個 app token 恆具備
let keysAppPermBase = ['readUsers']


//keysAppPermHigh: 可取得管理者權限之權限, 授予即等同管理者, 後台清單以提示標註
//- readTokens: 金鑰清單含全部 session token 字串(含管理者), 持有者可冒用
//- writeTokens: 可改寫任一 token 之字串與效期, 亦可改自身 perms 自行擴權
//- writeUsers: 可改寫使用者之 email 與 isAdmin, 再經重設密碼接管帳號
let keysAppPermHigh = ['writeUsers', 'readTokens', 'writeTokens']


//isAppPerm: 是否為已登錄之權限字串
function isAppPerm(v) {
    return isestr(v) && keysAppPerm.includes(v)
}


//isAppPermsValue: tokens.perms 欄之寫入值是否合法; 未設定(undefined / null / '')合法並視同 [], 陣列須全為已登錄之權限字串
function isAppPermsValue(perms) {
    if (perms === undefined || perms === null || perms === '') {
        return true
    }
    if (!isarr(perms)) {
        return false
    }
    return perms.every(isAppPerm)
}


//normAppPerms: 取 perms 欄之合法元素, 去重並依 keysAppPerm 排序; 非陣列視同 [](讀取端 fail closed, 未登錄字串一律忽略)
function normAppPerms(perms) {
    if (!isarr(perms)) {
        return []
    }
    return keysAppPerm.filter((k) => perms.includes(k))
}


//getAppPerms: app token 之有效權限 = 基本權限 ∪ perms 欄之合法元素, 依 keysAppPerm 排序
function getAppPerms(tk) {
    let perms = normAppPerms(get(tk, 'perms'))
    return keysAppPerm.filter((k) => keysAppPermBase.includes(k) || perms.includes(k))
}


//hasAppPerm: app token 是否具備指定權限; perm 未登錄者一律 false
function hasAppPerm(tk, perm) {
    if (!isAppPerm(perm)) {
        return false
    }
    return getAppPerms(tk).includes(perm)
}


export {
    keysAppPerm,
    keysAppPermBase,
    keysAppPermHigh,
    isAppPerm,
    isAppPermsValue,
    normAppPerms,
    getAppPerms,
    hasAppPerm
}
