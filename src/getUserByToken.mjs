import get from 'lodash-es/get.js'
import isestr from 'wsemi/src/isestr.mjs'
import iseobj from 'wsemi/src/iseobj.mjs'
import isfun from 'wsemi/src/isfun.mjs'
import { fetchSsoMsg, convertUser, hasUrlParam } from './fetchSsoMsg.mjs'


async function getUserByToken(url, tokenSelf, tokenTar, opt = {}) {
    //供外部系統於伺服端直接調用; tokenSelf 為應用系統金鑰, 不可於瀏覽器端呼叫: 使用者用途須綁系統管理者(授權同所綁使用者); 系統服務用途依 perms(基本權限 readUsers 即可查, ADR-069、ADR-095;
    //原載「app token 等同系統管理者, ADR-005」不成立, 已由 ADR-069 取代)
    //回傳目標權杖(tokenTar)所代表之身分(ADR-095): 使用者 token 為該使用者; 使用者用途金鑰為所綁使用者之實際資料(isApp='y'); 系統服務用途金鑰為應用系統身分(id=app:<金鑰主鍵>、isApp='y'、isAdmin='y'、name=金鑰名稱);
    //目標權杖逾期、查無或其使用者目前不可用(停用、封鎖、帳號到期、未驗證)一律回固定鍵 reject(cannotGetUserDataByUrl 系)
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
    if (!hasUrlParam(url, 'token', '{sysToken}') || !hasUrlParam(url, 'key', 'token') || !hasUrlParam(url, 'value', '{token}')) { //三者缺一即拒, 且須為完整參數(key=tokenVerify 不算 key=token)
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
