import get from 'lodash-es/get.js'
import isestr from 'wsemi/src/isestr.mjs'
import iseobj from 'wsemi/src/iseobj.mjs'
import isfun from 'wsemi/src/isfun.mjs'
import { fetchSsoMsg, convertUser } from './fetchSsoMsg.mjs'


async function getUserByToken(url, tokenSelf, tokenTar, opt = {}) {
    //供外部系統於伺服端直接調用; tokenSelf 為 app token(等同管理者, ADR-005)時不可於瀏覽器端呼叫
    //url: http://localhost:11007/api/getSsoUserInfor?token={sysToken}&key=token&value={token}
    //失敗一律 reject 固定 key(不含網址與權杖), 呼叫端應映射為自家 key 後再回前端, 見 spec/設計要點與取捨.md ADR-068

    //check
    if (!isestr(url)) {
        return Promise.reject('invalidUrl')
    }
    if (!isestr(tokenSelf)) {
        return Promise.reject('invalidTokenSelf')
    }
    if (!isestr(tokenTar)) {
        return Promise.reject('invalidTokenTar')
    }

    //funConvertUser
    let funConvertUser = get(opt, 'funConvertUser')

    //url
    if (url.indexOf('token={sysToken}') < 0 || url.indexOf('key=token') < 0 || url.indexOf('value={token}') < 0) { //三者缺一即拒
        return Promise.reject('noTokenKeyValueInUrl')
    }

    //fetchSsoMsg, 代入系統介接用 ssoToken 與目標 token 後打 SSO; 連線 / SSO 錯誤 / 無資料之 reject 與診斷皆於此處理
    let u = await fetchSsoMsg('getUserByToken', url, [['{sysToken}', tokenSelf], ['{token}', tokenTar]], {
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


export default getUserByToken
