import get from 'lodash-es/get.js'
import isestr from 'wsemi/src/isestr.mjs'
import isarr from 'wsemi/src/isarr.mjs'
import isfun from 'wsemi/src/isfun.mjs'
import { fetchSsoMsg, convertUser } from './fetchSsoMsg.mjs'


async function getUsersByToken(url, tokenSelf, opt = {}) {
    //供外部系統於伺服端直接調用; tokenSelf 為 app token(等同管理者, ADR-005)時不可於瀏覽器端呼叫
    //url: http://localhost:11007/api/getSsoUsersList?token={sysToken}
    //失敗一律 reject 固定 key(不含網址與權杖), 呼叫端應映射為自家 key 後再回前端, 見 spec/設計要點與取捨.md ADR-068

    //check
    if (!isestr(url)) {
        return Promise.reject('invalidUrl')
    }
    if (!isestr(tokenSelf)) {
        return Promise.reject('invalidTokenSelf')
    }

    //funConvertUser
    let funConvertUser = get(opt, 'funConvertUser')

    //url
    if (url.indexOf('token={sysToken}') < 0) {
        return Promise.reject('noTokenInUrl')
    }

    //fetchSsoMsg, 代入系統介接用 ssoToken 後打 SSO; 連線 / SSO 錯誤 / 無資料之 reject 與診斷皆於此處理
    //清單須為非空陣列(對稱 getUserByToken 之物件檢查; 原以 size 判定, 非陣列之非空值會被當成清單回傳);
    //不用 isearr: 其於長度 1 時另驗元素, 會依長度分岔
    let us = await fetchSsoMsg('getUsersByToken', url, [['{sysToken}', tokenSelf]], {
        keyRequest: 'cannotGetUsersByUrl', //由SSO取得使用者清單資訊錯誤
        keyData: 'cannotGetUsersDataByUrl', //取得使用者清單資訊失敗
        keyNoData: 'noUsersDataByUrl',
        isValid: (v) => isarr(v) && v.length > 0,
    })

    //funConvertUser, 逐筆依序轉換, 任一筆失敗即 reject
    if (isfun(funConvertUser)) {
        let rs = []
        for (let u of us) {
            rs.push(await convertUser(funConvertUser, u))
        }
        us = rs
    }

    return us
}


export default getUsersByToken
