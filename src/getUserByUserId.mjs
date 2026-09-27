import get from 'lodash-es/get.js'
import isestr from 'wsemi/src/isestr.mjs'
import iseobj from 'wsemi/src/iseobj.mjs'
import isfun from 'wsemi/src/isfun.mjs'
import { fetchSsoMsg, convertUser } from './fetchSsoMsg.mjs'


async function getUserByUserId(url, tokenSelf, userIdTar, opt = {}) {
    //供外部系統於伺服端直接調用; tokenSelf 為 app token(等同管理者, ADR-005)時不可於瀏覽器端呼叫
    //url: http://localhost:11007/api/getSsoUserInfor?token={sysToken}&key=id&value={userId} (後端查詢鍵為 id, 非 userId)
    //失敗一律 reject 固定 key(不含網址與權杖), 呼叫端應映射為自家 key 後再回前端, 見 spec/設計要點與取捨.md ADR-068

    //check
    if (!isestr(url)) {
        return Promise.reject('invalidUrl')
    }
    if (!isestr(tokenSelf)) {
        return Promise.reject('invalidTokenSelf')
    }
    if (!isestr(userIdTar)) {
        return Promise.reject('invalidUserIdTar')
    }

    //funConvertUser
    let funConvertUser = get(opt, 'funConvertUser')

    //url
    if (url.indexOf('token={sysToken}') < 0 || url.indexOf('key=id') < 0 || url.indexOf('value={userId}') < 0) { //三者缺一即拒
        return Promise.reject('noTokenKeyUserIdInUrl')
    }

    //fetchSsoMsg, 代入系統介接用 ssoToken 與目標 userId 後打 SSO; 連線 / SSO 錯誤 / 無資料之 reject 與診斷皆於此處理
    let u = await fetchSsoMsg('getUserByUserId', url, [['{sysToken}', tokenSelf], ['{userId}', userIdTar]], {
        keyRequest: 'cannotGetUserByUrl', //由SSO取得使用者資訊錯誤
        keyData: 'cannotGetUserDataByUrl', //取得使用者資訊失敗
        keyNoData: 'noUserDataByUrl',
        isValid: iseobj,
    })

    //funConvertUser
    if (isfun(funConvertUser)) {
        u = await convertUser(funConvertUser, u)
    }

    return u
}


export default getUserByUserId
