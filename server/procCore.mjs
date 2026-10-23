import crypto from 'crypto'
import ot from 'dayjs'
import get from 'lodash-es/get.js'
import each from 'lodash-es/each.js'
import map from 'lodash-es/map.js'
import size from 'lodash-es/size.js'
import keys from 'lodash-es/keys.js'
import filter from 'lodash-es/filter.js'
import isEqual from 'lodash-es/isEqual.js'
import isPlainObject from 'lodash-es/isPlainObject.js'
import { BASELINE_REJECT, digestRow, compareBaseline, isBaselineValid, pickWriteRow, getRejectKey } from 'w-serv-orm/src/baseline.mjs'
import genIDSeq from 'wsemi/src/genIDSeq.mjs'
import iseobj from 'wsemi/src/iseobj.mjs'
import isestr from 'wsemi/src/isestr.mjs'
import ispint from 'wsemi/src/ispint.mjs'
import isearr from 'wsemi/src/isearr.mjs'
import isarr from 'wsemi/src/isarr.mjs'
import ispnum from 'wsemi/src/ispnum.mjs'
import isbol from 'wsemi/src/isbol.mjs'
import isUserPw from 'wsemi/src/isUserPw.mjs'
import istimemsTZ from 'wsemi/src/istimemsTZ.mjs'
import isfun from 'wsemi/src/isfun.mjs'
import ispm from 'wsemi/src/ispm.mjs'
import cint from 'wsemi/src/cint.mjs'
import j2o from 'wsemi/src/j2o.mjs'
import strleft from 'wsemi/src/strleft.mjs'
import strright from 'wsemi/src/strright.mjs'
import strdelright from 'wsemi/src/strdelright.mjs'
import ltdtmapping from 'wsemi/src/ltdtmapping.mjs'
import haskey from 'wsemi/src/haskey.mjs'
import arrHas from 'wsemi/src/arrHas.mjs'
import pm2resolve from 'wsemi/src/pm2resolve.mjs'
import pmSeries from 'wsemi/src/pmSeries.mjs'
import pmKeyMutex from 'wsemi/src/pmKeyMutex.mjs'
import cache from 'wsemi/src/cache.mjs'
import cacheSt from 'wsemi/src/cacheSt.mjs'
import waitFun from 'wsemi/src/waitFun.mjs'
import delay from 'wsemi/src/delay.mjs'
import nowms2str from 'wsemi/src/nowms2str.mjs'
import getErrorMessage from 'wsemi/src/getErrorMessage.mjs'
import clearXSS from 'wsemi/src/clearXSS.mjs'
import ds from '../src/schema/index.mjs'
import * as s from '../src/plugins/mShare.mjs'
import hashPassword, { verifyPassword } from './hashPassword.mjs'
import genRandomPassword from './genRandomPassword.mjs'
import createLockSave from './lockSave.mjs'
import ormWrite from './ormWrite.mjs'
import { maskToken, maskKv, keysUserQuery, capText } from './srLog.mjs'
import { hasAppPerm, isAppPermsValue, normAppPerms } from '../src/appPerms.mjs'
import contracts from '../src/writeContracts/index.mjs'


//keysUserCredential: users 表之憑證欄(密碼雜湊 / 註冊驗證用 token), 對外介接輸出一律剝除 (ADR-068); 新增憑證欄時於此登錄
let keysUserCredential = ['password', 'tokenVerify']


//kpSaveRejectKey: 寫入契約之拒收鍵(w-serv-orm baseline.mjs 之 BASELINE_REJECT, 固定英文) → 本套件語系鍵 (procLang), 一律提示重新載入 (R-CONC-03 規則 5)
let kpSaveRejectKey = Object.create(null)
kpSaveRejectKey[BASELINE_REJECT.mismatch] = 'saveStale'
kpSaveRejectKey[BASELINE_REJECT.rowNotFound] = 'saveRowNotFound'
kpSaveRejectKey[BASELINE_REJECT.format] = 'saveBaselineFormat'


//getSaveRejectKey: 由被 reject 之值取語系鍵; 非契約拒收者回 null. 取鍵一律用核心之 getRejectKey (procOrm 為字串, guardWrite 為帶 key 之 Error)
function getSaveRejectKey(err) {
    let k = getRejectKey(err)
    if (typeof k === 'string' && kpSaveRejectKey[k] !== undefined) {
        return kpSaveRejectKey[k]
    }
    return null
}


//copyBaseline: 基準之防禦性複製, 只取資料屬性(RPC 之 JSON 不會帶存取器, 行程內直接呼叫才可能): 外層與各二元項須為陣列且二元項長度恰為 2,
//存取器 / 洞 / 取值例外一律回 null; 複製後之驗證與其後使用皆不再觸及客戶端物件, 存取器不被執行
function copyBaseline(b) {
    try {
        if (!Array.isArray(b)) {
            return null
        }
        let out = []
        for (let i = 0; i < b.length; i++) {
            let dI = Object.getOwnPropertyDescriptor(b, i)
            if (dI === undefined || !('value' in dI) || !Array.isArray(dI.value) || dI.value.length !== 2) {
                return null
            }
            let d0 = Object.getOwnPropertyDescriptor(dI.value, 0)
            let d1 = Object.getOwnPropertyDescriptor(dI.value, 1)
            if (d0 === undefined || d1 === undefined || !('value' in d0) || !('value' in d1)) {
                return null
            }
            out.push([d0.value, d1.value])
        }
        return out
    }
    catch (err) {
        return null
    }
}


//parseSaveOpt: 驗證前端經 RPC 送入之第 4 參數(clientOpt)並自組伺服端使用之基準; opt 只由伺服端自組, 不展開客戶端物件 (規格 §6).
//- undefined: 不帶基準(app 權杖直呼、已開啟之舊版頁面, 本 major 允許, 後者蓋前者), 回 {}
//- 其餘一律須為純物件且只含白名單鍵(users / ips: baseline; tokens: baseline 與 baselineSession 兩者皆須有), 基準格式或版本不識 → baselineFormat; 不得降級為不帶基準
//回傳 { baseline, baselineSession } 或 { err: 'baselineFormat' }
function parseSaveOpt(woName, clientOpt) {
    let bad = { err: BASELINE_REJECT.format }
    if (clientOpt === undefined) {
        return {}
    }
    if (!isPlainObject(clientOpt)) {
        return bad
    }
    let allow = woName === 'tokens' ? ['baseline', 'baselineSession'] : ['baseline']
    let ks = Reflect.ownKeys(clientOpt)
    if (ks.some((k) => allow.indexOf(k) < 0) || allow.some((k) => ks.indexOf(k) < 0)) {
        return bad
    }
    let o = {}
    for (let k of allow) {
        let d = Object.getOwnPropertyDescriptor(clientOpt, k)
        if (d === undefined || !('value' in d)) {
            return bad
        }
        let v = copyBaseline(d.value)
        if (v === null || !isBaselineValid(v)) {
            return bad
        }
        o[k] = v
    }
    return o
}


//maxKeyBytes: 主鍵 UTF-8 位元組數上限, 同 LMDB 預設鍵長上限(lmdb/open.js 之 DEFAULT_MAX_KEY_SIZE; 實測 1978 位元組可寫、1979 即拒), 供清單儲存於寫入前驗證 (ADR-081)
let maxKeyBytes = 1978


//htmlEscape: email body 內所有 placeholder 值套用, 防使用者可控欄位 (name / account 等)
//把 < > & " ' 注入驗證信 HTML. URL 類值 (verifyUrl) escape 後 & → &amp; 於 href 屬性內仍為合法寫法.
function htmlEscape(s) {
    if (typeof s !== 'string') {
        s = (s === undefined || s === null) ? '' : String(s)
    }
    return s
        .replaceAll('&', '&amp;')
        .replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;')
        .replaceAll('"', '&quot;')
        .replaceAll("'", '&#39;')
}


//timing-safe hash compare: 防 password / token hash 比對之 timing side-channel attack.
//hashPassword 產出固定長度字串, 但仍加長度檢查防呆 (DB 紀錄損壞 / 空字串等邊界).
function timingSafePasswordEqual(a, b) {
    if (typeof a !== 'string' || typeof b !== 'string') return false
    let bufA = Buffer.from(a)
    let bufB = Buffer.from(b)
    if (bufA.length !== bufB.length) return false
    return crypto.timingSafeEqual(bufA, bufB)
}


function proc(woItems, procOrm, { srLog, srEmail, salt, minExpired, kpLang, passwordPolicy, allowUserRegistration, siteUrl, verifyBaseUrl, withTabLocks, guardWrite }) {

    //withTabLocks / guardWrite: 取自 w-serv-orm WServOrm 實例(每實例一個鎖管理器、每表一鍵, 規格 §7); 所有寫入 users / tokens / ips 之站點皆須在該表表鎖內執行 (R-CONC-01),
    //且與 procProtect 共用同一組(同表只由同一鎖管理器寫入, 規格 §12). 缺少即無法保證互斥, 故不提供預設替身
    if (!isfun(withTabLocks) || !isfun(guardWrite)) {
        throw new Error('procCore needs withTabLocks and guardWrite from the WServOrm instance')
    }


    //pmKeyMutex: per-key in-memory mutex, 同 key 序列化、不同 key 並行.
    //用於 resendVerifyEmail / checkTokenAndChangePassword / adminResetUserPassword 等
    //critical 路徑, 防同 key 並行 race (lost update / 重複寄信).
    let kmx = pmKeyMutex()

    //cacheSt: in-process 多 key 原子占位 + auto-cleanup (TTL).
    //用於 createUser race (同 account 不同 email 之雙重 insert) — 原 kmx 之複合 key
    //`account:email` 不同組合走不同鎖完全不互斥, 改用 cst.setWithFree 兩段獨立 key 原子占位
    //(`createUser:account:<a>` 與 `createUser:email:<e>` 任一衝突即 reject), 避免繞鎖雙重 insert.
    let cst = cacheSt()

    //lockSave: 清單儲存類(updateUsersList / updateTokensList / updateIpsList)之雙擊防護(後端, 見 lockSave.mjs, ADR-074):
    //同一操作者之同一儲存處理中再送出即 reject 'saveInProgress'
    let lockSave = createLockSave(cst)

    //throttle 紀錄: key → timestamp(ms), 用於 resendVerifyEmail / adminResetUserPassword
    //之 30s 內第二次重複觸發判定. 與 mutex 配合: mutex 確保同 key 序列化,
    //throttle 確保序列化後第二次仍會被 reject (避免重複寄信).
    let lastResendTime = new Map()
    let lastResetTime = new Map()
    let throttleMs = 30 * 1000 //30 秒

    //email title 從 procLang 取
    let getEmailTitle = (key, lang) => {
        return get(kpLang, `${lang}.${key}`, '')
    }

    //email body 以內建語系鍵(kpLang 之 *EmContent)為字串模板做 placeholder 替換(值經 htmlEscape 防注入)
    let renderEmailText = (key, lang, kvMap = {}) => {
        if (lang !== 'eng' && lang !== 'cht') { lang = 'eng' }
        let content = get(kpLang, `${lang}.${key}`, '')
        for (let k in kvMap) {
            content = content.replaceAll(`{${k}}`, htmlEscape(kvMap[k]))
        }
        return content
    }


    //_getGenUserByKV
    let _getGenUserByKV = async (keyUser, valueUser, opt = {}) => {
        let errTemp = null

        //deletePassword
        let deletePassword = get(opt, 'deletePassword')
        if (!isbol(deletePassword)) {
            deletePassword = true
        }

        //us
        let us = await woItems.users.select({ [keyUser]: valueUser, isActive: 'y' })
            .catch((err) => {
                errTemp = err
            })
        //console.log(`...users.select`)

        //check
        if (errTemp) {
            console.log(errTemp)
            console.log('keyUser', keyUser)
            console.log('valueUser', maskKv(keyUser, valueUser)) //keyUser 可由對外查詢指定, 非識別欄之值可能即憑證 (ADR-068)
            console.log(`failed to find user`)
            return Promise.reject(`failed to find user`)
        }

        //delete password, 無錯誤取得後即先刪除, 避免調整程式時意外洩漏hash後密碼
        if (deletePassword) {
            us = map(us, (u) => {
                delete u.password
                return u
            })
        }

        //nus
        let nus = size(us)

        //check
        if (nus === 0) {
            if (srLog && isfun(srLog.debug)) {
                srLog.debug({ event: 'fun-getGenUserByKV', key: 'userNotFound', keyUser: capText(keyUser), valueUser: maskKv(keyUser, valueUser) }) //非識別欄之值可能即憑證, 與上方 console 同遮罩 (R-QKEY-01)
            }
            return Promise.reject(`can not find the user by ${keyUser}`)
        }

        //check
        if (nus >= 2) {
            if (srLog && isfun(srLog.debug)) {
                srLog.debug({ event: 'fun-getGenUserByKV', key: 'userDuplicate', keyUser: capText(keyUser), valueUser: maskKv(keyUser, valueUser) }) //同上 (R-QKEY-01)
            }
            return Promise.reject(`duplicate ${keyUser}`)
        }

        //u
        let u = us[0] //get(us, 0, null) 前面已檢測故一定有[0]
        // console.log('u', u)

        return u
    }


    //getGenUserByKV
    let getGenUserByKV = async (keyUser, valueUser) => {

        //u
        let u = await _getGenUserByKV(keyUser, valueUser)

        return u
    }


    //getGenUserByUserId
    let getGenUserByUserId = async (userId, opt = {}) => {

        //u
        let u = await getGenUserByKV('id', userId, opt)

        // //check, 不用檢測, 若resolve必定有u, 若reject則由外部處理
        // if (!iseobj(u)) {
        //     return null
        // }

        return u
    }


    //getGenUserByAccount
    let getGenUserByAccount = async (account, opt = {}) => {

        //u
        let u = await getGenUserByKV('account', account, opt)

        // //check, 不用檢測, 若resolve必定有u, 若reject則由外部處理
        // if (!iseobj(u)) {
        //     return null
        // }

        return u
    }


    //getTokenByKV
    let getTokenByKV = async (keyToken, valueToken) => {
        let errTemp = null

        //ts
        let ts = await woItems.tokens.select({ [keyToken]: valueToken })
            .catch((err) => {
                errTemp = err
            })
        //console.log(`...tokens.select`)

        //check
        if (errTemp) {
            console.log(errTemp)
            console.log(`failed to find token`)
            return Promise.reject(`failed to find token`)
        }

        //nts
        let nts = size(ts)

        //check
        if (nts === 0) {
            // console.log('keyToken', keyToken)
            // console.log('valueToken', valueToken)
            // console.log(`can not find the token by keyToken[${keyToken}]`)
            return Promise.reject(`can not find the token by keyToken[${keyToken}]`)
        }

        //check
        if (nts >= 2) {
            console.log(`duplicate token by keyToken[${keyToken}]`)
            return Promise.reject(`duplicate token by keyToken[${keyToken}]`)
        }

        //t
        let t = ts[0] //get(ts, 0, null) 前面已檢測故一定有[0]
        // console.log('t', t)

        return t
    }


    //getIpByKV
    let getIpByKV = async (keyIp, valueIp) => {
        let errTemp = null

        //oips
        let oips = await woItems.ips.select({ [keyIp]: valueIp })
            .catch((err) => {
                errTemp = err
            })
        //console.log(`...ips.select`)

        //check
        if (errTemp) {
            console.log(errTemp)
            console.log('keyIp', keyIp)
            console.log('valueIp', valueIp)
            console.log(`failed to find ip`)
            return Promise.reject(`failed to find ip`)
        }

        //noips
        let noips = size(oips)

        //check
        if (noips === 0) {
            // console.log('keyIp', keyIp)
            // console.log('valueIp', valueIp)
            // console.log(`can not find the ip by keyIp[${keyIp}]`)
            return Promise.reject(`can not find the ip by keyIp[${keyIp}]`)
        }

        //check
        if (noips >= 2) {
            console.log('keyIp', keyIp)
            console.log('valueIp', valueIp)
            console.log(`duplicate ip by keyIp[${keyIp}]`)
            return Promise.reject(`duplicate ip by keyIp[${keyIp}]`)
        }

        //oip
        let oip = oips[0] //get(oips, 0, null) 前面已檢測故一定有[0]
        // console.log('oip', oip)

        return oip
    }


    //loginByAccountAndPassword
    let loginByAccountAndPassword = async (account, password) => {

        //defense-in-depth NoSQL operator injection guard (對應 WWebSso.mjs _strictStr 外層; 詳 ADR-003 Consequences).
        //外層 kpfun 已 guard; 此 inner check 是「procCore 函式被 kpfun 外其他 caller 直接呼叫時」之保險.
        if (!isestr(account) || !isestr(password)) {
            return Promise.reject(`failedLoginForCatch`)
        }

        //getGenUserByAccount, 不限 isActive 查詢，以便逐一檢查各狀態
        //(NB: 主路徑 inactive user 在 procProtect.getBlockedByAccount 階段已被 _getGenUserByKV 過濾 isActive='y' 後 reject
        //'can not find the user by account', 不會走到此處, 故此處不再額外檢查 isActive — 對齊 ADR-003 Round-3 audit dead branch 清理.)
        let us = await woItems.users.select({ account })
        if (size(us) === 0) {
            return Promise.reject(`failedLoginForCatch`)
        }
        let u = us[0]

        //passwordTrue
        let passwordTrue = get(u, 'password', '')
        // console.log('passwordTrue', passwordTrue)

        //check (verifyPassword: 以明文密碼 + DB 自描述雜湊字串 + pepper(salt) 驗證)
        if (!verifyPassword(password, passwordTrue, salt)) {
            return Promise.reject(`failedLoginForCatch`)
        }

        //check timeVerified
        let timeVerified = get(u, 'timeVerified', '')
        if (!isestr(timeVerified)) {
            return Promise.reject('userRegistrationNotVerified')
        }

        //check timeExpired
        let timeExpired = get(u, 'timeExpired', '')
        if (isestr(timeExpired) && istimemsTZ(timeExpired)) {
            let tn = ot().format('YYYY-MM-DDTHH:mm:ss.SSSZ')
            if (tn > timeExpired) {
                return Promise.reject('loginAccountExpired')
            }
        }

        //userId
        let userId = get(u, 'id', '')
        // console.log('userId', userId)

        //createToken, recheckUser: 驗密碼(CPU 密集)於鎖外, 鑄 token 時於 tokens 鎖內重讀使用者狀態 (R-CONC-01 W2-2):
        //登入與停用 / 刪除 / 自動封鎖 / 重設密碼(皆於 [tokens, users] 鎖內撤銷 token)交錯時, 不致於撤銷之後才鑄出屬於已停用、已刪除、封鎖中或密碼已變更使用者之 token;
        //verifiedUser 為鎖外通過驗證所依據之使用者, 鎖內以新鮮資料再判密碼未變、已驗證、未到期; withUser 令回傳 { token, user } 取鎖內新鮮之使用者, 登入回傳值由同一次有效狀態產生
        let { token, user: uNow } = await createToken(userId, { recheckUser: true, verifiedUser: u, withUser: true })
        // console.log('token', token)

        //r
        let r = {
            id: uNow.id,
            account: uNow.account,
            name: uNow.name,
            email: uNow.email,
            description: uNow.description,
            from: uNow.from,
            redir: uNow.redir,
            isAdmin: uNow.isAdmin,
            isActive: uNow.isActive,
            isForceChangePw: uNow.isForceChangePw, //強制變更密碼旗標, 前端登入後判斷是否拉去 user view 強制變更
            token,
        }

        return r
    }


    //createToken
    //寫入於 tokens 表鎖內(S01); opt.recheckUser 為 true 時於鎖內重讀使用者, 已不存在、已停用或封鎖中即 reject 'failedLoginForCatch' (對外與密碼錯誤同回應, 不洩漏帳號狀態);
    //另給 opt.verifiedUser(鎖外通過驗證所依據之使用者)時, 鎖內以新鮮資料再判登入條件: 密碼已變更 → 'failedLoginForCatch'、已不是已驗證 → 'userRegistrationNotVerified'、已到期 → 'loginAccountExpired',
    //與鎖外同序同鍵; opt.withUser 為 true 時回傳 { token, user }(user 為鎖內新鮮之使用者, 僅 recheckUser 時有值), 否則回傳 token 字串
    //userIdUpdate 記 token 擁有者(procOrm 以 userId 參數戳記, R-CONC-04)
    let createToken = async (userId, opt = {}) => {
        let errTemp = null

        //check
        if (!ispnum(minExpired)) {
            console.log(`minExpired`, minExpired)
            console.log(`invalid minExpired`)
            return Promise.reject(`invalid minExpired`)
        }

        //t
        let t = ds.tokens.funNew({
            userId,
        })
        // console.log('funNew', t)

        //timeEnd, 依照minExpired(min)更新到期時間
        t.timeEnd = ot().add(minExpired, 'minute').format('YYYY-MM-DDTHH:mm:ss.SSSZ')
        // console.log('timeEnd', t.timeEnd)

        //token
        let token = get(t, 'token', '')

        //insert, tokens 表鎖內
        let rejectKey = null
        let uFresh = null
        await withTabLocks(['tokens'], async () => {

            //recheckUser
            if (get(opt, 'recheckUser') === true) {
                let us = await woItems.users.select({ id: userId })
                let u = get(us, 0, null)
                let blocked = false
                let timeBlocked = get(u, 'timeBlocked', '')
                if (istimemsTZ(timeBlocked) && ot().format('YYYY-MM-DDTHH:mm:ss.SSSZ') <= timeBlocked) {
                    blocked = true
                }
                if (size(us) !== 1 || get(u, 'isActive', '') === 'n' || blocked) {
                    rejectKey = 'failedLoginForCatch'
                    return
                }

                //verifiedUser: 鎖外通過驗證所依據之使用者; 登入條件以鎖內新鮮資料再判一次(與 loginByAccountAndPassword 同序同鍵)
                let vu = get(opt, 'verifiedUser', null)
                if (vu !== null) {
                    if (get(u, 'password', '') !== get(vu, 'password', '')) {
                        rejectKey = 'failedLoginForCatch' //等待期間密碼已被變更(如管理員重設): 先前以舊密碼通過之驗證不再有效
                        return
                    }
                    if (!isestr(get(u, 'timeVerified', ''))) {
                        rejectKey = 'userRegistrationNotVerified'
                        return
                    }
                    let timeExpired = get(u, 'timeExpired', '')
                    if (isestr(timeExpired) && istimemsTZ(timeExpired) && ot().format('YYYY-MM-DDTHH:mm:ss.SSSZ') > timeExpired) {
                        rejectKey = 'loginAccountExpired'
                        return
                    }
                }

                uFresh = u
            }

            await procOrm(userId, 'tokens', 'insert', [t])

        })
            .catch((err) => {
                errTemp = err
            })

        //check
        if (rejectKey !== null) {
            return Promise.reject(rejectKey)
        }
        if (errTemp) {
            console.log(errTemp)
            // console.log(`token`, token)
            console.log(`can not create a token from userId`)
            return Promise.reject(`can not create a token from userId`)
        }

        if (get(opt, 'withUser') === true) {
            return { token, user: uFresh }
        }
        return token
    }


    //_checkTokenByObj
    let _checkTokenByObj = async (tk, opt = {}) => {

        //timeEnd
        let timeEnd = get(tk, 'timeEnd', '')

        //check
        if (!istimemsTZ(timeEnd)) {
            // console.log(`tk`, tk)
            console.log(`timeEnd`, timeEnd)
            console.log(`invalid timeEnd`)
            return Promise.reject(`invalid timeEnd`)
        }

        //isApp
        let isApp = get(tk, 'isApp', '')
        // console.log('isApp', isApp)

        //fun
        let fun = get(opt, 'fun', null)

        //perm, 權限閘所需之 app token 權限(src/appPerms.mjs); 僅作用於 app token, 使用者 token 仍以 fun 判斷
        let perm = get(opt, 'perm', '')

        //tn
        let tn = ot().format('YYYY-MM-DDTHH:mm:ss.SSSZ')
        // console.log('tn     ', tn)
        // console.log('timeEnd', timeEnd)
        // console.log('tn < timeEnd', tn < timeEnd)

        let b1 = tn < timeEnd //現在時間<到期時間, 代表尚未到期
        let b2 = true
        //app token (isApp='y') 無使用者資訊故不執行 fun, 改依其 perms 判斷 (ADR-069, 取代 ADR-005 之一律視同 admin); 應僅由內部 token creation 路徑簽發, 不開放外部註冊.
        if (isApp !== 'y') {
            //token來自使用者

            if (isfun(fun)) {
                //有給定驗證fun才執行取得使用者資訊供驗證

                //userId
                let userId = get(tk, 'userId', '')

                //getGenUserByUserId
                let u = await getGenUserByUserId(userId)

                //fun
                b2 = fun(tk, u)
                if (ispm(b2)) {
                    b2 = await b2
                }

            }

        }
        else {
            //token來自應用系統

            if (isestr(perm)) {
                //權限閘有宣告所需權限: 依 perms 判斷(基本權限 readUsers 恆具備, 多元素為聯集)
                b2 = hasAppPerm(tk, perm)
            }
            else if (isfun(fun)) {
                //權限閘只給 fun 未宣告權限: app token 一律不通過(fail closed, 新增之權限閘漏宣告時不致對 app 全開)
                b2 = false
            }
            //未給 fun 亦未給 perm: 僅驗 token 本身(checkToken / getUserByToken 等自身權杖操作)

            //warn, 記錄缺權限之拒絕供稽核與介接排錯(對外仍統一回 tokenExpired, ADR-006)
            if (!b2) {
                srLog.warn({ event: 'fun-checkToken', key: 'appTokenPermDenied', token: maskToken(get(tk, 'token', '')), userId: get(tk, 'userId', ''), perm })
            }

        }

        let b = b1 && b2

        return b
    }


    //_checkToken
    let _checkToken = async (token, opt = {}) => {

        //tks
        // token = UUIDv7 (128-bit entropy) + LMDB in-memory, timing side-channel 無實務利用空間; password 已修 timing-safe 但 token 比對保留 === 為設計取捨.
        let tks = await woItems.tokens.select({ token })
        //console.log(`...tokens.select`)
        // console.log('tks', tks)

        //ntks
        let ntks = size(tks)

        //check
        if (ntks === 0) {
            // console.log(`token`, token)
            console.log(`invalid token`)
            return Promise.reject(`invalid token`)
        }

        //check
        if (ntks >= 2) {
            // console.log(`token`, token)
            console.log(`duplicate tokens`)
            return Promise.reject(`duplicate tokens`)
        }

        //tk
        let tk = get(tks, 0, '')
        // console.log('tk', tk)

        //userId
        let userId = get(tk, 'userId', '')

        //_checkTokenByObj
        let b = await _checkTokenByObj(tk, opt)

        //info
        srLog.info({ event: 'fun-checkToken', token: maskToken(token), userId, res: b })

        //logshow
        if (!b) {
            // console.log(`block token[${token}]`) //[tag:測試:顯示被封鎖token]
        }

        return b
    }


    //checkTokenByObj
    let checkTokenByObj = async (tk, opt = {}) => {
        let errTemp = null

        //_checkTokenByObj
        await _checkTokenByObj(tk, opt)
            .then((res) => {
                if (res === false) {
                    errTemp = 'tokenExpired'
                }
            })
            .catch((err) => {
                //對外統一 key 'tokenExpired' 防 information leakage (對齊 checkToken B-02); 內部 log 保留
                console.log('checkTokenByObj inner reject', err)
                errTemp = 'tokenExpired'
            })

        //check
        if (errTemp !== null) {
            return Promise.reject(errTemp)
        }

        return true //resolve只回傳true, reject代表無效tk.token與錯誤
    }


    //checkToken
    let checkToken = async (token, opt = {}) => {

        //defense-in-depth NoSQL operator injection guard. reject key 名 (對齊 ADR-006 統一防 information leakage);
        //由 kpfun _tErr 依 lang 翻譯 tokenExpired 訊息回前端 (E2E-011 中英混雜 fix).
        if (!isestr(token)) {
            return Promise.reject('tokenExpired')
        }

        let errTemp = null

        //_checkToken
        await _checkToken(token, opt)
            .then((res) => {
                if (res === false) {
                    // 對外統一 key 'tokenExpired' 為防 information leakage; 內部 log 保留布林細節供 audit (見 line ~467).
                    errTemp = 'tokenExpired'
                }
            })
            .catch((err) => {
                //對外統一 key 'tokenExpired' 為防 information leakage (ADR-006)
                //—— 原樣 bubble err 會洩漏 _checkToken 之 'invalid token' / 'duplicate tokens'
                //等具體 reject 字串 (Round-3 audit B-02 fix); 內部仍 console.log 保留 audit 細節.
                console.log('checkToken inner reject', err)
                errTemp = 'tokenExpired'
            })

        //check
        if (errTemp !== null) {
            return Promise.reject(errTemp)
        }

        return true //resolve只回傳true, reject代表無效token與錯誤
    }


    //refreshToken
    //讀取、驗證與續期寫入皆在 tokens 表鎖內(S02): 讀到之 token 於寫入前不會被登出 / 撤銷插隊刪除, 且寫入為只改不增, 不致把已刪之 token 以殘缺列新增回庫 (X5)
    let refreshToken = async (token) => {

        //defense-in-depth NoSQL operator injection guard (reject key 名, 對齊 token 鏈統一 tokenExpired)
        if (!isestr(token)) {
            return Promise.reject('tokenExpired')
        }

        return await withTabLocks(['tokens'], () => _refreshToken(token))
    }


    //_refreshToken, 須於 tokens 表鎖內呼叫
    let _refreshToken = async (token) => {

        let errTemp = null

        //tks
        let tks = await woItems.tokens.select({ token })
        //console.log(`...tokens.select`)

        //ntks
        let ntks = size(tks)

        //check
        if (ntks === 0) {
            // console.log(`token`, token)
            console.log(`invalid token`)
            return Promise.reject(`invalid token`)
        }

        //check
        if (ntks >= 2) {
            // console.log(`token`, token)
            console.log(`duplicate tokens`)
            return Promise.reject(`duplicate tokens`)
        }

        //tk
        let tk = get(tks, 0, '')
        // console.log('tk', tk)

        //timeEnd
        let timeEnd = get(tk, 'timeEnd', '')

        //check
        if (!istimemsTZ(timeEnd)) {
            // console.log(`token`, token)
            console.log(`timeEnd`, timeEnd)
            console.log(`invalid timeEnd`)
            return Promise.reject(`invalid timeEnd`)
        }

        //tn
        let tn = ot().format('YYYY-MM-DDTHH:mm:ss.SSSZ')

        //check
        if (tn >= timeEnd) { //現在時間>=到期時間, 代表已到期, 禁止更新token
            // console.log(`token`, token)
            console.log(`tn`, tn)
            console.log(`timeEnd`, timeEnd)
            console.log(`token expired`)
            return Promise.reject(`tokenExpired`)
        }

        //timeEndNew, 依照minExpired(min)更新到期時間
        let timeEndNew = ot().add(minExpired, 'minute').format('YYYY-MM-DDTHH:mm:ss.SSSZ')
        // console.log('timeEndNew', timeEndNew)

        //save, 經 procOrm 且 mustExist(只改不增, 列已不存在 → reject 'rowNotFound' 零寫入); procOrm 逐筆檢查(ADR-080)並戳記 timeUpdate / userIdUpdate(記 token 擁有者, R-CONC-04)
        await procOrm(get(tk, 'userId', ''), 'tokens', 'save', [{
            id: tk.id,
            timeEnd: timeEndNew,
        }], { mustExist: true })
            .catch((err) => {
                errTemp = err
            })

        //check
        if (errTemp) {
            console.log(errTemp)
            // console.log(`token`, token)
            console.log(`can not update timeEnd for token`)
            srLog.error({ event: 'fun-refreshToken-save', token: maskToken(token), err: getErrorMessage(errTemp) })
            return Promise.reject(`can not update timeEnd for token`)
        }

        return timeEndNew
    }


    //logoutByToken
    //讀取與刪除在 tokens 表鎖內(S03); 刪除未命中回報既有鍵 'can not delete the token'
    let logoutByToken = async (token) => {

        //defense-in-depth NoSQL operator injection guard (reject key 名, 對齊 token 鏈統一 tokenExpired)
        if (!isestr(token)) {
            return Promise.reject('tokenExpired')
        }

        return await withTabLocks(['tokens'], () => _logoutByToken(token))
    }


    //_logoutByToken, 須於 tokens 表鎖內呼叫
    let _logoutByToken = async (token) => {

        let errTemp = null

        //tks
        let tks = await woItems.tokens.select({ token })
        //console.log(`...tokens.select`)

        //ntks
        let ntks = size(tks)

        //check
        if (ntks === 0) {
            // console.log(`token`, token)
            console.log(`invalid token`)
            return Promise.reject(`invalid token`)
        }

        //check
        if (ntks >= 2) {
            // console.log(`token`, token)
            console.log(`duplicate tokens`)
            return Promise.reject(`duplicate tokens`)
        }

        //tk
        let tk = get(tks, 0, '')
        // console.log('tk', tk)

        //userId
        let userId = get(tk, 'userId', '')
        // console.log('userId', userId)

        //del
        let r = await woItems.tokens.del({ id: tk.id })
            .catch((err) => {
                errTemp = err
            })
        // console.log('r', r)

        //check
        if (errTemp) {
            console.log(errTemp)
            // console.log(`token`, token)
            console.log(`failed to delete token`)
            return Promise.reject(`failed to delete token`)
        }

        //check
        r = get(r, '0.nDeleted', 0)
        if (r !== 1) {
            // console.log(`token`, token)
            console.log(`can not delete the token`)
            return Promise.reject(`can not delete the token`)
        }

        //info
        srLog.info({ event: 'fun-logout', token: maskToken(token), userId })

        return true
    }


    //createUser
    //
    //【自助註冊專用】此函式僅由前端 PageLogin Register 表單透過 $fapi.createUser 觸發,
    //對應 WWebSso 的 kpfun.createUser handler (不驗 token, 允許未登入匿名呼叫)。
    //
    //後台 admin 新增使用者走另一條路徑 updateUsersList → updateTabItems, 不會進到本函式。
    //
    //自助註冊的特性:
    //- 須符合 settings.allowUserRegistration = true 才開放
    //- 須帶 password + confirmPassword (admin 後台路徑則由 admin 就地輸入單一密碼)
    //- 產生 tokenVerify 並寄驗證信; timeVerified 留空, 使用者完成驗證才能登入
    //- procOrm operatorId 傳 u.id 自我參照: 自己即創造者, userId / userIdUpdate 皆寫入自己 id;
    //  後台路徑則傳 admin id。可由 userId === id 判斷此 user 為自助註冊
    //
    let createUser = async (lang, data) => {

        //check
        if (!isestr(lang)) {
            lang = 'eng'
        }

        //check allowUserRegistration
        if (!allowUserRegistration) {
            return Promise.reject('userRegistrationNotAllowed')
        }

        //account
        let account = get(data, 'account', '')
        if (!isestr(account)) {
            return Promise.reject('userRegistrationAccountInvalid')
        }

        //email
        let email = get(data, 'email', '')
        if (!isestr(email) || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
            return Promise.reject('userRegistrationEmailFormatInvalid')
        }

        //password
        let password = get(data, 'password', '')

        //confirmPassword
        let confirmPassword = get(data, 'confirmPassword', '')
        if (password !== confirmPassword) {
            return Promise.reject('userChangePasswordNotSame')
        }

        //check password
        let r = checkUserPassword(lang, password, { account })
        if (r.state === 'error') {
            return Promise.reject(r.key)
        }

        //name
        let name = get(data, 'name', '')
        if (!isestr(name)) {
            return Promise.reject('userRegistrationNameInvalid')
        }

        //account / name / email 會被 clearXSS 改寫即拒絕 (ADR-081): procOrm 寫入時對各欄位 clearXSS, 儲存值將與送入值不同,
        //而唯一性檢查、登入與重寄驗證信皆以送入值查詢(實測: 帳號 john<doe 存成 john&lt;doe, 以原帳號登入失敗; 另可與 john&lt;doe 重複註冊)
        if ([account, name, email].some((v) => clearXSS(v) !== v)) {
            return Promise.reject('htmlMarkupNotAllowed')
        }

        //原子占位「account 鎖」與「email 鎖」兩段獨立 key, 任一衝突即 reject:
        //- 同 account 不同 email 並行 → 第 2 條撞 `createUser:account:<a>` 占位失敗, reject 'key in use'.
        //- 不同 account 同 email 並行 → 第 2 條撞 `createUser:email:<e>` 占位失敗, reject 'key in use'.
        //(原寫法 `kmx('createUser:${account}:${email}', ...)` 用複合 key, 不同 email 走不同
        // key 完全不互斥, 雙重 insert 漏網; 詳 R2L1-001 audit finding.)
        //範圍: select unique check → procOrm insert. 後續寄信放鎖外, SMTP 慢不阻塞後續同 key 排隊.
        //
        //setWithFree 之 'key in use' reject 訊息對使用者語意不友善, 須 remap 回原本之 i18n
        //「帳號已存在 / email 已存在」訊息 (對齊 api-doubleclick DC-02 之 assertion + 業務契約).
        let keyAccount = `createUser:account:${account}`
        let keyEmail = `createUser:email:${email}`
        let tokenVerify
        //唯一性檢查與 insert 於 users 表鎖內(S04, 修 X8): cst 之鍵空間與後台清單儲存(updateTabItems 取 users 表鎖)不同, 兩者原不互斥,
        //自助註冊與管理員新增同帳號可同時成功; 取同一把表鎖後, 後到者必能讀到先到者所寫之列而被唯一性檢查擋下
        await cst.setWithFree([keyAccount, keyEmail], () => withTabLocks(['users'], async () => {

            //check account unique (全域唯一，不限 isActive)
            let allUsers = await woItems.users.select()
            let existAccount = allUsers.some((u) => get(u, 'account', '') === account)
            if (existAccount) {
                return Promise.reject('userRegistrationAccountExists')
            }

            //check email unique (全域唯一，不限 isActive)
            let existEmail = allUsers.some((u) => get(u, 'email', '') === email)
            if (existEmail) {
                return Promise.reject('userRegistrationEmailExists')
            }

            //hashPassword
            let passwordHashed = hashPassword(password, salt)

            //tokenVerify
            tokenVerify = `${genIDSeq()}`

            //new user (timeVerified 為空，須完成 email 驗證才能登入)
            let u = ds.users.funNew({
                account,
                password: passwordHashed,
                name,
                email,
                tokenVerify,
                isAdmin: 'n',
                isActive: 'y',
            })

            //insert
            //operatorId 傳 u.id (自我參照): 自助註冊本人即創建者, userId / userIdUpdate 寫入自己的 id,
            //可由 userId === id 判斷此 user 為自助註冊（後台 admin 建立則 userId 為 admin id）
            //寫入失敗時 procOrm 之原文不回前端, 記 log 後改回語系鍵 (ADR-034, ADR-080)
            await procOrm(u.id, 'users', 'insert', [u])
                .catch((err) => {
                    srLog.error({ event: 'fun-createUser-insert', key: 'userRegistrationFailed', account, err: getErrorMessage(err) })
                    return Promise.reject('userRegistrationFailed')
                })
        }))
            .catch((err) => {
                //remap setWithFree 之 'key in use' reject → 業務語意之 i18n 訊息.
                //其他 reject (select unique check 之 'account/email already exists', insert 失敗之 userRegistrationFailed 等)
                //原樣 bubble.
                let errMsg = (err && typeof err === 'string') ? err : (err && err.message) || String(err)
                if (errMsg.includes(keyAccount)) {
                    return Promise.reject('userRegistrationAccountExists')
                }
                if (errMsg.includes(keyEmail)) {
                    return Promise.reject('userRegistrationEmailExists')
                }
                return Promise.reject(err)
            })

        //send verify email (若失敗，使用者可透過「重寄驗證信」補救)
        //信件標題與內容皆取 kpLang 語系鍵(settings 信件鍵與 kpLangExt 已於初始化覆寫入 kpLang)
        try {
            let sender = get(kpLang, `${lang}.webName`, '')
            let title = getEmailTitle('regVerifyEmTitle', lang)
            let verifyUrl = `${verifyBaseUrl}/api/verifyEmail?token=${tokenVerify}&lang=${lang}`
            let content = renderEmailText('regVerifyEmContent', lang, {
                sender, name, verifyUrl,
            })
            await srEmail.send(sender, title, content, email)
        }
        catch (err) {
            console.log('send verify email error', err)
        }

        return { state: 'success', msg: 'ok' }
    }


    //verifyEmail
    let verifyEmail = async (token) => {

        //check token
        if (!isestr(token)) {
            return Promise.reject('verifyEmailInvalidToken')
        }

        //查找、檢查與寫入於 users 表鎖內(S05): timeVerified 為雙方欄位(後台可改、驗證信連結亦寫), 系統直寫須取表鎖, 後台持舊畫面存檔才會被偵測而拒收 (V4)
        return await withTabLocks(['users'], async () => {

            //以 tokenVerify 查找使用者
            let us = await woItems.users.select({ tokenVerify: token })
            if (size(us) === 0) {
                return Promise.reject('verifyEmailInvalidToken')
            }
            let user = us[0]

            //check timeVerified (是否已驗證)
            let timeVerified = get(user, 'timeVerified', '')
            if (isestr(timeVerified)) {
                return Promise.reject('verifyEmailAlreadyVerified')
            }

            //update timeVerified: timemsTZ 格式(同其他時間欄與後台編輯之寫入). 原 now2str 為秒級, 共用判斷 getIsVerified(istimemsTZ)
            //判為未驗證 → 後台清單顯示「未驗證」, 且該帳號設為管理者後過不了管理權限閘 funCheckAdmin (2026-09-29 修正)
            //經 procOrm 且 mustExist(只改不增, 列已不存在則拒絕而不新增殘缺列, X5), 更新者記該使用者本人 (R-CONC-04)
            //逐筆檢查(ADR-080): 寫入失敗回 verifyEmailFailed, 不顯示驗證成功; tokenVerify 未清, 使用者可再點同一連結重試
            let errTemp = null
            await procOrm(user.id, 'users', 'save', [{
                id: user.id,
                timeVerified: nowms2str(),
                //F-053 fix (lazy clear): 不主動清 tokenVerify, 避免並發 resendVerifyEmail 寫的新 token
                //被此處 race window 覆蓋. token 重用風險由 line ~818 之 isestr(timeVerified) → reject
                //'verifyEmailAlreadyVerified' 擋住, 已驗證 user 點舊連結會得友善訊息.
            }], { mustExist: true })
                .catch((err) => {
                    errTemp = err
                })

            //check
            if (errTemp !== null) {
                srLog.error({ event: 'fun-verifyEmail-save', key: 'verifyEmailFailed', userId: user.id, err: getErrorMessage(errTemp) })
                return Promise.reject('verifyEmailFailed')
            }

            return { state: 'success', msg: 'ok' }
        })
    }


    //resendVerifyEmail
    let resendVerifyEmail = async (lang, account, email) => {

        //check
        if (!isestr(lang)) {
            lang = 'eng'
        }

        //check
        if (!isestr(account) || !isestr(email)) {
            return Promise.reject('userRegistrationResendInvalidEmail')
        }

        //序列化同 account 之並行請求, 並於鎖內 throttle 30s 內第二次 resend
        //(mutex 確保 throttle 紀錄寫入無 race; 30s 內第二次直接 reject 'resend throttled').
        return await kmx(`resendVerifyEmail:${account}`, async () => {

            //throttle 檢查 (30s 內第二次同 account 直接 reject)
            let now = Date.now()
            let last = lastResendTime.get(account)
            if (last && (now - last) < throttleMs) {
                return Promise.reject('userRegistrationResendThrottled')
            }

            //查找、檢查與寫入於 users 表鎖內(S06; kmx 在外層、表鎖在內層): tokenVerify 雖屬伺服器專有欄位(規格 §4 不要求表鎖), 本套件統一取鎖並只改不增 (決策 D2),
            //使讀到之列於寫入前不被刪除插隊而以殘缺列新增回庫 (X5)
            let { userId, name, tokenVerify, errTemp } = await withTabLocks(['users'], async () => {

                //getGenUserByAccount
                let u = null
                try {
                    u = await _getGenUserByKV('account', account)
                }
                catch (err) {}
                if (!u) {
                    return Promise.reject('userRegistrationResendInvalidEmail') //不洩露帳號是否存在
                }

                //check email match
                let uEmail = get(u, 'email', '')
                if (uEmail !== email) {
                    return Promise.reject('userRegistrationResendInvalidEmail')
                }

                //check timeVerified
                let timeVerified = get(u, 'timeVerified', '')
                if (isestr(timeVerified)) {
                    return Promise.reject('userRegistrationAlreadyVerified')
                }

                //userId
                let userId = get(u, 'id', '')
                let name = get(u, 'name', '')

                //產生新 tokenVerify 並更新至 users, 更新者記該使用者 (R-CONC-04)
                //逐筆檢查(ADR-080): 寫入失敗即 reject, 不記節流、不寄出連結無效之信
                let tokenVerify = `${genIDSeq()}`
                let errTemp = null
                await procOrm(userId, 'users', 'save', [{
                    id: userId,
                    tokenVerify,
                }], { mustExist: true })
                    .catch((err) => {
                        errTemp = err
                    })

                return { userId, name, tokenVerify, errTemp }
            })

            //check
            if (errTemp !== null) {
                srLog.error({ event: 'fun-resendVerifyEmail-save', key: 'userRegistrationResendFailed', userId, err: getErrorMessage(errTemp) })
                return Promise.reject('userRegistrationResendFailed')
            }

            //寫 throttle 時間戳 (放在 save 後, 確認此次 resend 已生效才記)
            lastResendTime.set(account, now)

            //send verify email
            //信件標題與內容皆取 kpLang 語系鍵(settings 信件鍵與 kpLangExt 已於初始化覆寫入 kpLang)
            try {
                let sender = get(kpLang, `${lang}.webName`, '')
                let title = getEmailTitle('regVerifyEmTitle', lang)
                let verifyUrl = `${verifyBaseUrl}/api/verifyEmail?token=${tokenVerify}&lang=${lang}`
                let content = renderEmailText('regVerifyEmContent', lang, {
                    sender, name, verifyUrl,
                })
                await srEmail.send(sender, title, content, email)
            }
            catch (err) {
                console.log('resend verify email error', err)
                return Promise.reject('userRegistrationResendFailed')
            }

            return { state: 'success', msg: 'ok' }
        })
    }


    //checkUserPassword
    let checkUserPassword = (lang, pw, opt = {}) => {

        //check
        if (!isestr(lang)) {
            lang = 'eng'
        }

        //account
        let account = get(opt, 'account', '')

        //check pw
        let keyErr = ''
        try {
            isUserPw(pw, {
                useKeyForError: true,
                useOnlyOneError: true,
                numLenMin: passwordPolicy.minLength,
                numLenMax: passwordPolicy.maxLength,
                requireLetter: passwordPolicy.requireLetter,
                requireUppercase: passwordPolicy.requireUppercase,
                requireLowercase: passwordPolicy.requireLowercase,
                requireDigit: passwordPolicy.requireDigit,
                requireSpecial: passwordPolicy.requireSpecial,
                noSpace: passwordPolicy.noSpace,
                onlyAscii: passwordPolicy.onlyAscii,
                forbiddenChars: passwordPolicy.forbiddenChars,
                commonPasswordBlacklist: passwordPolicy.commonPasswordBlacklist,
                account,
                noConsecutiveCharsFromAccount: passwordPolicy.noConsecutiveCharsFromAccount,
                consecutiveCharsMinMatch: passwordPolicy.consecutiveCharsMinMatch,
            })
        }
        catch (err) {
            keyErr = err.message
            // console.log('keyErr', keyErr)
        }

        let r = null
        if (!isestr(keyErr)) {
            r = {
                state: 'success',
                msg: 'ok',
            }
        }
        else {
            //key-only (msg-key 契約): 回完整 i18n key (userPassword_<keyErr>), 由前端 $tErr 翻譯 + 插值政策值
            //(minLength / maxLength / consecutiveCharsMinMatch 來自 webInfor.passwordPolicyInfo, 即時反映 settings).
            //後端不再翻譯/插值, 與其他錯誤 reject key 字串一致.
            r = {
                state: 'error',
                key: `userPassword_${keyErr}`,
            }
            return r
        }

        return r
    }


    //checkTokenAndChangePassword
    let checkTokenAndChangePassword = async (token, lang, oldPassword, newPassword) => {

        //checkToken
        await checkToken(token)

        //check
        if (!isestr(lang)) {
            lang = 'eng'
        }

        //check oldPassword
        if (!isestr(oldPassword)) {
            return Promise.reject('userChangePasswordFail')
        }

        //getUserByToken
        let uToken = await getUserByToken(token)
        let userId = get(uToken, 'id', '')

        //序列化同 userId 之並行 change-password 請求: 防 lost update + 重複寄信.
        //第二次同 userId 進入時 mutex 序列化, 第二次因 password 已被第一次改, 走既有
        //'incorrect old password' reject 路徑, 自然不會多寄信.
        return await kmx(`changeUserPassword:${userId}`, async () => {

            //讀取、驗舊密碼、撤銷其他 session 與寫入於 [tokens, users] 表鎖內(S07; kmx 在外層、表鎖在內層): password 為伺服器專有欄位、isForceChangePw 為雙方欄位(系統直寫須取表鎖),
            //驗證所依之 DB 雜湊與寫入間不被其他寫入者(重設密碼、後台存檔、登入建立 session)插隊; 只改不增, 列已被刪則拒絕而不新增殘缺列 (X5)
            //改密碼後之 session 處置 (R-SESS-01, ADR-093): 保留發出此請求之目前 session(token), 撤銷該使用者其他所有 session 權杖; app 權杖不是 session, 不撤銷
            let { u, email } = await withTabLocks(['tokens', 'users'], async () => {

                //鎖內再驗呼叫所用之權杖仍有效 (外審 sol#1): 鎖外之 checkToken 通過後、等鎖期間該 session 可能已被同使用者另一個改密碼請求或管理員重設撤銷,
                //被撤銷之權杖不得再改密碼(否則「保留發出請求之目前 session」不成立, 該請求還會撤銷對方保留之 session); checkToken 只讀不取鎖, 可在鎖內呼叫
                await checkToken(token)

                //getGenUserByUserId (with password)
                let u = await _getGenUserByKV('id', userId, { deletePassword: false })

                //account
                let account = get(u, 'account', '')

                //check newPassword
                let r = checkUserPassword(lang, newPassword, { account })
                if (r.state === 'error') {
                    return Promise.reject(r.key)
                }

                //passwordTrue
                let passwordTrue = get(u, 'password', '')

                //check (verifyPassword: 以明文舊密碼 + DB 自描述雜湊字串 + pepper(salt) 驗證)
                if (!verifyPassword(oldPassword, passwordTrue, salt)) {
                    return Promise.reject('userChangePasswordIncorrectOld')
                }

                //email
                let email = get(u, 'email', '')
                if (!isestr(email)) {
                    // console.log('token', token)
                    // console.log('u', u)
                    return Promise.reject('anUnexpectedErrorOccurred')
                }
                // console.log('email', email)

                //hash newPassword
                let passwordNew = hashPassword(newPassword, salt)

                //撤銷其他 session(先於密碼寫入, 驗證皆已通過): 撤銷失敗即 reject 且密碼不變, 不會出現「密碼已變更但舊 session 仍有效」(R-SESS-01)
                //(以布林旗標判失敗而非 errRevoke 是否為 null: reject 值可能為 null / undefined, 外審 sol#2)
                let revokeFailed = false
                let errRevoke = null
                let nRevoked = await revokeSessionTokensLocked(userId, token)
                    .catch((err) => {
                        revokeFailed = true
                        errRevoke = err
                    })
                if (revokeFailed) {
                    srLog.error({ event: 'fun-changePassword-revokeSessions', key: 'userChangePasswordFail', userId, err: getErrorMessage(errRevoke) })
                    return Promise.reject('userChangePasswordFail')
                }
                srLog.info({ event: 'fun-changePassword-revokeSessions', userId, nRevoked })

                //save (清 isForceChangePw='n', 變更密碼成功後即解除強制變更), 更新者記該使用者本人 (R-CONC-04)
                //逐筆檢查(ADR-080): 寫入失敗即 reject, 不寄「密碼已變更」信
                let errTemp = null
                await procOrm(userId, 'users', 'save', [{
                    id: userId,
                    password: passwordNew,
                    isForceChangePw: 'n',
                }], { mustExist: true })
                    .catch((err) => {
                        errTemp = err
                    })

                //check
                if (errTemp !== null) {
                    srLog.error({ event: 'fun-changePassword-save', key: 'userChangePasswordFail', userId, err: getErrorMessage(errTemp) })
                    return Promise.reject('userChangePasswordFail')
                }

                return { u, email }
            })

            //若已變更密碼, 但寄送email失敗時, 不能報錯中斷流程
            try {

                //sender
                let sender = get(kpLang, `${lang}.webName`, '')
                if (!isestr(sender)) {
                    console.log('get(kpLang, lang)', get(kpLang, lang))
                    console.log('lang', lang)
                    //須用 throw 讓下方 catch 接住對齊「寄送 email 失敗時, 不能報錯中斷流程」設計
                    //(async function 內 return Promise.reject 不被 try/catch 攔截 → 跳過外圍 catch
                    //→ 密碼已寫但 API reject 給前端, 使用者以為失敗實際舊密碼已失效).
                    throw new Error(`invalid sender`)
                }

                //name
                let name = get(u, 'name', 'unknow')

                //title, 取 kpLang 之 chpwEmTitle 鍵(settings 信件鍵與 kpLangExt 已於初始化覆寫入 kpLang)
                let title = getEmailTitle('chpwEmTitle', lang)
                if (!isestr(title)) {
                    console.log('chpwEmTitle 取不到, lang', lang)
                    throw new Error(`invalid title`)
                }

                //body, 取 kpLang 之 chpwEmContent 鍵做 {sender}/{name} 置換
                let content = renderEmailText('chpwEmContent', lang, {
                    sender, name,
                })

                //send
                await srEmail.send(sender, title, content, email)

            }
            catch (err) {
                console.log(err)

                //error (不記任何密碼明文; ADR-014 連 hash 都不該外洩)
                srLog.error({ event: 'fun-changePassword-sendEmail', token: maskToken(token), lang, err: getErrorMessage(err) })

            }

        })

    }


    //adminResetUserPassword: admin 對 targetUserId 重設密碼, 產生隨機新密碼塞 DB + 寄信附明文
    //
    //回傳: { state:'success' } (不含明文密碼, 避免操作者得知)
    //失敗 reject:
    //  - token 無效 / 過期
    //  - 操作者非 admin: 'forbidden'
    //  - userId 空: 'invalid userId'
    //  - 目標 user 不存在: 'user not found'
    //  - 對自己觸發: 'cannot reset self'
    //  - 隨機密碼產製失敗 (極少): 由 genRandomPassword 拋出
    //
    //寄信失敗 (SMTP 不通) 不視為錯誤, 密碼仍會寫入, 僅記 srLog.error
    let adminResetUserPassword = async (token, lang, targetUserId) => {

        //checkToken, app token 須具 writeUsers(其虛擬使用者 isAdmin='y', 故不可只靠下方 isAdmin 判斷; ADR-069); 使用者 token 不受 perm 影響
        await checkToken(token, { perm: 'writeUsers' })

        //check lang
        if (!isestr(lang)) {
            lang = 'eng'
        }

        //check targetUserId
        if (!isestr(targetUserId)) {
            return Promise.reject('anUnexpectedErrorOccurred')
        }

        //getUserByToken (操作者)
        let uOperator = await getUserByToken(token)
        let operatorId = get(uOperator, 'id', '')

        //operator 必須為 admin
        if (get(uOperator, 'isAdmin', '') !== 'y') {
            return Promise.reject('adminResetPasswordForbidden')
        }

        //不可對自己觸發
        if (operatorId === targetUserId) {
            return Promise.reject('adminResetPasswordCannotResetSelf')
        }

        //序列化同 targetUserId 之並行 reset 請求, 並於鎖內 throttle 30s 內第二次觸發.
        //(mutex 確保 throttle 紀錄寫入無 race; 30s 內第二次 reject
        // 'reset already triggered, please wait', 避免 lost update + 雙重亂數密碼 + 雙封信.)
        return await kmx(`adminResetUserPassword:${targetUserId}`, async () => {

            //throttle 檢查 (30s 內第二次同 targetUserId 直接 reject)
            let now = Date.now()
            let last = lastResetTime.get(targetUserId)
            if (last && (now - last) < throttleMs) {
                return Promise.reject('adminResetPasswordAlreadyTriggered')
            }

            //目標 user 查找、撤銷其全部 session 與寫入於 [tokens, users] 表鎖內(S08; kmx 在外層、表鎖在內層): password 為伺服器專有欄位、isForceChangePw 為雙方欄位(系統直寫須取表鎖);
            //只改不增, 目標已被刪則拒絕而不新增殘缺列 (X5); 更新者記操作管理員 (R-CONC-04)
            //改密碼後之 session 處置 (R-SESS-01, ADR-093): 撤銷對方全部 session 權杖(不含 app 權杖); 呼叫者(管理員 / app 權杖)自己之權杖不在撤銷範圍(目標不得為自己)
            let { targetAccount, targetName, targetEmail, newPassword } = await withTabLocks(['tokens', 'users'], async () => {

                //目標 user (含 password 拿到也不用, 只是確認存在)
                let uTarget = null
                try {
                    uTarget = await _getGenUserByKV('id', targetUserId, { deletePassword: true })
                }
                catch (err) {
                    return Promise.reject('adminResetPasswordUserNotFound')
                }
                if (!iseobj(uTarget)) {
                    return Promise.reject('adminResetPasswordUserNotFound')
                }

                let targetAccount = get(uTarget, 'account', '')
                let targetName = get(uTarget, 'name', 'unknow')
                let targetEmail = get(uTarget, 'email', '')

                //產生隨機新密碼 (符合 passwordPolicy + account 限制)
                let newPassword = genRandomPassword(passwordPolicy, targetAccount)

                //hash
                let hashed = hashPassword(newPassword, salt)

                //撤銷對方全部 session(先於密碼寫入): 撤銷失敗即 reject 且密碼不變, 不會出現「密碼已重設但舊 session 仍有效」(R-SESS-01)
                //(以布林旗標判失敗而非 errRevoke 是否為 null: reject 值可能為 null / undefined, 外審 sol#2)
                let revokeFailed = false
                let errRevoke = null
                let nRevoked = await revokeSessionTokensLocked(targetUserId)
                    .catch((err) => {
                        revokeFailed = true
                        errRevoke = err
                    })
                if (revokeFailed) {
                    srLog.error({ event: 'fun-adminResetUserPassword-revokeSessions', key: 'adminResetPasswordFailed', token: maskToken(token), targetUserId, err: getErrorMessage(errRevoke) })
                    return Promise.reject('adminResetPasswordFailed')
                }
                srLog.info({ event: 'fun-adminResetUserPassword-revokeSessions', targetUserId, nRevoked })

                //save (含 isForceChangePw='y')
                //逐筆檢查(ADR-080): 寫入失敗即 reject, 不記節流、不寄出未生效之新密碼
                let errTemp = null
                await procOrm(operatorId, 'users', 'save', [{
                    id: targetUserId,
                    password: hashed,
                    isForceChangePw: 'y',
                }], { mustExist: true })
                    .catch((err) => {
                        errTemp = err
                    })

                //check
                if (errTemp !== null) {
                    srLog.error({ event: 'fun-adminResetUserPassword-save', key: 'adminResetPasswordFailed', token: maskToken(token), targetUserId, err: getErrorMessage(errTemp) })
                    return Promise.reject('adminResetPasswordFailed')
                }

                return { targetAccount, targetName, targetEmail, newPassword }
            })

            //寫 throttle 時間戳 (放在 save 後, 確認此次 reset 已生效才記)
            lastResetTime.set(targetUserId, now)

            //寄信附明文新密碼 (SMTP 失敗不阻斷)
            try {

                if (!isestr(targetEmail)) {
                    //email 缺失就不寄, 但密碼已重設; admin 須由其他管道告知
                    srLog.error({ event: 'fun-adminResetUserPassword-noEmail', token: maskToken(token), targetUserId })
                }
                else {

                    //sender
                    let sender = get(kpLang, `${lang}.webName`, '')
                    if (!isestr(sender)) {
                        //須用 throw 讓下方 catch 接住對齊「SMTP 失敗不阻斷」設計 (詳 F4-001 註解).
                        throw new Error(`invalid sender`)
                    }

                    //title, 取 kpLang 之 resetPwEmTitle 鍵(settings 信件鍵與 kpLangExt 已於初始化覆寫入 kpLang)
                    let title = getEmailTitle('resetPwEmTitle', lang)
                    if (!isestr(title)) {
                        throw new Error(`invalid title`)
                    }

                    //body, 取 kpLang 之 resetPwEmContent 鍵做 {sender}/{name}/{account}/{newPassword} 置換
                    let content = renderEmailText('resetPwEmContent', lang, {
                        sender, name: targetName, account: targetAccount, newPassword,
                    })

                    //send
                    await srEmail.send(sender, title, content, targetEmail)

                }

            }
            catch (err) {
                console.log(err)
                //僅記 log, 不記明文密碼
                srLog.error({ event: 'fun-adminResetUserPassword-sendEmail', token: maskToken(token), targetUserId, err: getErrorMessage(err) })
            }

            return { state: 'success' }
        })
    }


    //revokeTokensByUserId: 撤銷(刪除)使用者名下全部 token, 供刪除 / 停用使用者(updateTabItems)與登入失敗封鎖(procProtect.blockAccount)共用.
    //一次刪除該使用者全部 token 並逐筆檢查(ormWrite), 單筆失敗不中斷其餘筆, 有失敗即 reject 錯誤訊息(含失敗筆主鍵)供呼叫端記錄.
    //冪等(已無 token 時刪 0 筆), resolve 回傳刪除之 token 數. 使用者設計上不持有 isApp='y' token, 故一併撤 (ADR-037).
    //S09: 對外之 revokeTokensByUserId 自取 tokens 表鎖; 上游已持 tokens 鎖者(updateTabItems users 路徑、procProtect 封鎖, 皆在 [tokens, users] 鎖內)
    //須呼叫 revokeTokensByUserIdLocked(持鎖版), 不可重入 (規格 §7)
    let revokeTokensByUserId = async (userId) => {
        return await withTabLocks(['tokens'], () => revokeTokensByUserIdLocked(userId))
    }


    //revokeTokensByUserIdLocked, 須於 tokens 表鎖內呼叫
    let revokeTokensByUserIdLocked = async (userId) => {

        //check
        if (!isestr(userId)) {
            return Promise.reject(`invalid userId`)
        }

        //ts
        let ts = await woItems.tokens.select({ userId })

        //check
        if (size(ts) === 0) {
            return 0
        }

        //del
        await ormWrite(woItems.tokens, 'del', map(ts, (t) => {
            return { id: t.id }
        }))

        return size(ts)
    }


    //revokeSessionTokensLocked: 改密碼後之 session 處置 (R-SESS-01, ADR-093), 須於 [tokens, users] 表鎖內呼叫(與密碼寫入同一組鎖, 不可重入).
    //只撤銷 userId 名下之 session 權杖(isApp !== 'y', 即使用者登入所發); app 權杖(isApp === 'y')不是 session, 其 userId 為擁有者, 不撤銷
    //(與 revokeTokensByUserIdLocked 之刪除 / 停用 / 封鎖情境不同: 該情境是使用者本身失效, 名下一切權杖皆撤).
    //exceptToken: 發出請求之目前 session 權杖字串, 該筆保留(使用者自行改密碼); 管理員重設不給, 全撤.
    //逐筆檢查(ormWrite), 單筆失敗不中斷其餘筆, 有失敗即 reject(含失敗筆主鍵), resolve 回傳撤銷筆數; 冪等(無可撤者回 0)
    let revokeSessionTokensLocked = async (userId, exceptToken = '') => {

        //check
        if (!isestr(userId)) {
            return Promise.reject(`invalid userId`)
        }

        //ts
        let ts = await woItems.tokens.select({ userId })

        //tsDel, session 權杖且非目前 session
        let tsDel = filter(ts, (t) => {
            return get(t, 'isApp', '') !== 'y' && !(isestr(exceptToken) && get(t, 'token', '') === exceptToken)
        })

        //check
        if (size(tsDel) === 0) {
            return 0
        }

        //del
        await ormWrite(woItems.tokens, 'del', map(tsDel, (t) => {
            return { id: t.id }
        }))

        return size(tsDel)
    }


    //updateTabItems
    //後台清單整表存檔(users / tokens / ips), 多人同時編輯之寫入契約 (原則 10; 規格 dspec/多人同時編輯之寫入契約.md; 規則帳本 rulebook_concurrency R-CONC-01~05):
    //- 讀取、比對、驗證依賴庫內之項、diff、寫入、撤銷 token、清快取全程在該表表鎖內(users 為 [tokens, users], 因寫入後同鎖撤銷 token); 讀取為鎖內新鮮讀取(無 ORM 快取).
    //- 帶基準(opt.optClient, 前端以 buildBaseline 對畫面所見之列自算): 與鎖內新鮮讀取比對, 不符整次拒收(零寫入, 先動先贏), 回語系鍵 saveStale / saveRowNotFound / saveBaselineFormat 提示重新載入.
    //  刪除集合 = 基準內(且在範圍內) − 送出, 不刪載入後他人新增者; 修改 = 送出列之摘要 ≠ 基準, 只寫契約 fields(+ order), 伺服器專有欄位取庫內值, 摘要相同之列不寫(不戳記更新者).
    //- 不帶基準(app 權杖直呼、已開啟之舊版頁面; 本 major 允許, 後者蓋前者, 下一 major 後台必帶): 仍取鎖、只改不增、伺服器專有欄位不採用客戶端值.
    //  users / ips 刪除集合 = 庫內全部 − 送出(以外部為主); tokens 只處理應用系統金鑰列(isApp === 'y'), session 列不刪、不覆蓋、不復活.
    //- tokens 採選項 P (R-CONC-03): app 列(契約 tokens)嚴格整表比對; session 列(契約 tokensSession)逐列寬鬆比對:
    //  只比對管理員有修改或刪除之列; 載入後新增者不刪; 已不在庫內者不復活; 系統續期而管理員未動者不寫; 管理員有動且庫內已變者拒收.
    //分驗證與寫入兩階段 (ADR-080):
    //- 驗證階段: 全部驗證於任何寫入之前完成, 任一失敗即 reject 該驗證之 key, 資料庫無任何變更 (ADR-021).
    //  凡可於寫入前判定、寫入時才會被拒或被靜默改寫之輸入一律於此拒絕 (ADR-081): rows 非陣列、主鍵非字串 / 重複 / 超過鍵長上限 → 'invalidRows';
    //  新增或修改列之欄位值會被 clearXSS 改寫 → 'htmlMarkupNotAllowed'. keyDetect 之三呼叫端皆為 'id', 與 procOrm 判準所用之主鍵欄相同.
    //- 寫入階段: 依刪除、新增、修改之順序寫入, 任一步 reject 即停止後續步驟並 reject 'saveWriteFail', 其前已寫入者不回滾 (ADR-044);
    //  procOrm 遇逐筆失敗亦 reject 且其餘筆已寫入 (w-serv-orm 1.1.7 起). 寫入階段一經進入, 不論成敗皆執行寫入後副作用:
    //  users 表撤銷本批欲刪除與欲停用者之 token, 並清除 opt.ocList 所給之清單快取 (失敗時資料庫可能已部分變更).
    let updateTabItems = async (woName, rows, keyDetect, opt = {}) => {
        // console.log('updateTabItems', woName, rows.length, keyDetect)

        //contract: 寫入契約(src/writeContracts, 前後端同一來源); tokens 另有 session 列契約
        let contract = contracts[woName]
        let contractSession = contracts.tokensSession
        if (!iseobj(contract) || keyDetect !== contract.pk) {
            throw new Error(`invalid woName[${woName}] or keyDetect[${keyDetect}] of updateTabItems`)
        }

        //resetOrder
        let resetOrder = get(opt, 'resetOrder')
        if (!isbol(resetOrder)) {
            resetOrder = false
        }

        //operatorId: 操作者 user id (寫入 audit fields userId / userIdUpdate; 預設 '' 維持舊行為)
        let operatorId = get(opt, 'operatorId', '')

        //lang: 用於 users 路徑下密碼策略檢查的錯誤訊息語系; 預設 'eng'
        let lang = get(opt, 'lang', 'eng')
        if (!isestr(lang)) {
            lang = 'eng'
        }

        //ocList: 該清單之讀取快取 (wsemi cache), 於寫入階段後清除 (ADR-008, ADR-080); 未給則不清
        let ocList = get(opt, 'ocList', null)

        //optClient: 前端經 RPC 送入之第 4 參數(未驗證), 於下方 parseSaveOpt 驗證後自組基準; 不展開給 procOrm (規格 §6)
        let optClient = get(opt, 'optClient')

        //check, rows 須為陣列 (ADR-081): 非陣列經 ltdtmapping 成空陣列, 比對時舊表全數歸為刪除
        if (!isarr(rows)) {
            return Promise.reject('invalidRows')
        }

        //idsNew: 前端標為新增(transient 欄位 _isNew === true)之列 id, 供下方比對既有列 (ADR-074);
        //_isNew 不在 schema keys 內, 下方 ltdtmapping 取欄時即剝除不入庫
        //permsRaw: tokens 之 perms 於 ltdtmapping 前取原值(缺欄為 undefined), 供鎖內驗證 (ADR-069; ltdtmapping 會把缺欄補成 '')
        let idsNew = []
        let permsRaw = new Map()
        each(rows, (r) => {
            if (get(r, '_isNew') === true) {
                idsNew.push(get(r, 'id', ''))
            }
            if (woName === 'tokens') {
                permsRaw.set(get(r, 'id', ''), get(r, 'perms'))
            }
        })

        //ltdtmapping
        rows = ltdtmapping(rows, ds[woName].keys)
        // console.log('ltdtmapping rows', rows)

        //重給order
        if (resetOrder) {
            rows = map(rows, (r, k) => {
                r.order = k + 1
                return r
            })
        }

        //ckKey: 偵測欄位未給予(非有效字串)或本批重複, 回傳 'empty'、'duplicate' 或 null
        let ckKey = (rows, key) => {
            let r = null
            let kp = Object.create(null) //主鍵 / email 為使用端字串, 容器無原型 (R-KEY-01)
            each(rows, (v) => {

                //value
                let value = get(v, key, '')

                //check
                if (!isestr(value)) {
                    r = 'empty'
                    return false //跳出
                }

                //check
                if (haskey(kp, value)) {
                    r = 'duplicate'
                    return false //跳出
                }

                //kp
                kp[value] = true

            })
            return r
        }

        //列格式(三清單共用, ADR-081): 主鍵須為非空字串、本批不重複, 且 UTF-8 位元組數不超過 LMDB 鍵長上限
        //(超過者寫入時才被 ORM 拒絕, 屆時同批之刪除已落地; 重複者於比對時後列覆蓋前列); 不符一律 reject 'invalidRows'
        if (ckKey(rows, 'id') !== null || rows.some((r) => Buffer.byteLength(r.id, 'utf8') > maxKeyBytes)) {
            return Promise.reject('invalidRows')
        }

        //users 之 email 須為非空字串且本批不重複(users 可重複 name), 回與前端同之語系鍵 (ADR-034, ADR-081; 原回含 email 值之原始字串)
        if (arrHas(woName, ['users'])) {
            let ck = ckKey(rows, 'email')
            if (ck === 'empty') {
                return Promise.reject('userEmailEmpty')
            }
            if (ck === 'duplicate') {
                return Promise.reject('userEmailDuplicate')
            }
        }

        //parseSaveOpt: 驗證前端送入之基準(格式或版本不識 → baselineFormat, 不得降級為不帶基準); 於取鎖、讀庫之前
        let po = parseSaveOpt(woName, optClient)
        if (po.err !== undefined) {
            return Promise.reject(kpSaveRejectKey[po.err])
        }
        let isBased = po.baseline !== undefined

        //subRaw / subNorm: 送出之列(依 id); subRaw 為前端所見形式(供與基準比對摘要), subNorm 為寫入形式(tokens 之 perms 去重並依全集排序, ADR-069, 於鎖內驗證合法後才正規化)
        let subRaw = new Map()
        each(rows, (row) => {
            subRaw.set(row.id, row)
        })
        let subNorm = subRaw
        if (woName === 'tokens') {
            subNorm = new Map()
            each(rows, (row) => {
                subNorm.set(row.id, { ...row, perms: normAppPerms(permsRaw.get(row.id)) })
            })
        }
        let ltdtNew = rows
        if (woName === 'tokens') {
            ltdtNew = map(rows, (row) => subNorm.get(row.id))
        }

        //表鎖: users 寫入後須同鎖撤銷其 token, 故為 [tokens, users] (withTabLocks 依表名碼元序取鎖, 不死結)
        let tables = woName === 'users' ? ['tokens', 'users'] : [woName]

        //讀取 → 比對基準 → 驗證 → diff → 寫入 → 撤銷 → 清快取, 全在表鎖內(guardWrite: 取鎖 → 新鮮讀取 → compareBaseline → write); tokens 之 app 列嚴格整表比對於此, session 列寬鬆比對於 write 內
        try {
            await guardWrite({
                tables,
                read: () => woItems[woName].select(),
                baseline: po.baseline, //undefined 為不帶基準(仍取鎖與讀取)
                contract,
                write: async (ltdtOld) => {
                    //console.log(`...woName[${woName}].select`)

                    //nowById: 鎖內新鮮讀取之列
                    let nowById = new Map()
                    each(ltdtOld, (r) => {
                        nowById.set(get(r, 'id', ''), r)
                    })

                    //新增列已存在即拒絕 (ADR-074): 同一包重送且第 2 次於第 1 次完成後才處理時, 第 1 次已建立之列會被當「修改」,
                    //以前端之空值 / 佔位字覆寫伺服器於新增時填入之欄位(實測: 新使用者 timeVerified 被清空、建立者 / 建立時間寫成佔位字而無法登入)
                    if (size(idsNew) > 0 && idsNew.some((id) => nowById.has(id))) {
                        return Promise.reject('saveNewRowExists')
                    }

                    //tokens 路徑: 清單存檔不得新增庫內不存在之 session 列(isApp 非 'y'; ADR-092), 不論帶不帶基準, 整次拒收(零寫入, 回固定語系鍵, 不回顯值):
                    //session 權杖只由登入產生, 後台清單本就無新增 session 列之入口 (ADR-042); 不帶基準時無從分辨「新增」與「載入後已被登出 / 自動封鎖撤銷之舊列」,
                    //送回舊列會使其復活而繞過撤銷. 例外: 帶基準而該列在 baselineSession 內者(載入時尚在, 其後被撤銷)不屬新增——管理員未動者下方略過、已動者拒收 saveStale.
                    //應用系統金鑰列(isApp === 'y')新增、既有 session 列之刪除與升級為應用系統金鑰照舊.
                    if (woName === 'tokens') {
                        let idsBase = new Set(isBased ? [...po.baseline, ...po.baselineSession].map(([id]) => id) : [])
                        let rowSessionNew = rows.find((r) => get(r, 'isApp', '') !== 'y' && !nowById.has(r.id) && !idsBase.has(r.id))
                        if (rowSessionNew !== undefined) {
                            srLog.warn({ event: 'fun-updateTabItems-reject', key: 'tokenSessionAddNotAllowed', woName })
                            return Promise.reject('tokenSessionAddNotAllowed')
                        }
                    }

                    //users 路徑: account 唯一性 + 非空驗證 (補 id/email 之外的 account; 防直打 API 寫入空/重複帳號).
                    //(a) 空值 → reject 'accountRequired'; (b) 本批內重複 或 與既有其他 user 之 account 衝突 → reject 'accountDuplicate'.
                    //帳號全域唯一, 與既有比對時排除「本批同 id 之自身既有列」(更新自己時 account 可維持不變).
                    if (woName === 'users') {
                        //既有 account → id 對照 (排除自身用)
                        let accountToIdOld = Object.create(null)
                        each(ltdtOld, (r) => {
                            let a = get(r, 'account', '')
                            if (isestr(a)) {
                                accountToIdOld[a] = get(r, 'id', '')
                            }
                        })
                        let kpAccount = Object.create(null)
                        let errAccount = null
                        each(rows, (row) => {
                            let account = get(row, 'account', '')
                            let id = get(row, 'id', '')
                            //空值
                            if (!isestr(account)) {
                                errAccount = 'accountRequired'
                                return false //跳出
                            }
                            //本批內重複
                            if (haskey(kpAccount, account)) {
                                errAccount = 'accountDuplicate'
                                return false //跳出
                            }
                            //與既有其他 user (非自身) 衝突
                            if (haskey(accountToIdOld, account) && accountToIdOld[account] !== id) {
                                errAccount = 'accountDuplicate'
                                return false //跳出
                            }
                            kpAccount[account] = true
                        })
                        if (errAccount !== null) {
                            return Promise.reject(errAccount)
                        }
                    }

                    //tokens 路徑: 本批有變動(或新增)之列須為未設定或已登錄權限字串之陣列, 任一列不合法則整批 reject 不寫入 (ADR-069).
                    //與 DB 相同之列不驗: DB 內既有之毀損值(非陣列等)若也擋, 後台整批存回將永遠失敗而無從修正; 其正規化後之有效權限與讀取端 fail closed 結果相同.
                    //帶基準時, 摘要同基準(管理員未動)之列亦不驗 (外審 sol#5): 該列不會被寫入——app 列已由嚴格整表比對確認庫內即基準, session 列未動不寫——
                    //如舊資料毀損值之 session 於載入後已被登出(庫內已無此列), 不得因此阻擋其他列之合法修改; 管理員有動或新增之列仍照驗
                    if (woName === 'tokens') {
                        let dgBase = new Map(isBased ? [...po.baseline, ...po.baselineSession] : [])
                        for (let row of rows) {
                            let perms = permsRaw.get(row.id)
                            let old = nowById.get(row.id)
                            if (old !== undefined && JSON.stringify(get(old, 'perms')) === JSON.stringify(perms)) {
                                continue
                            }
                            if (dgBase.has(row.id) && dgBase.get(row.id) === digestRow(subRaw.get(row.id), contract)) {
                                continue
                            }
                            if (!isAppPermsValue(perms)) {
                                return Promise.reject('tokenPermsInvalid')
                            }
                        }
                    }

                    //dels / adds / mods: 刪除(庫內之列)、新增(送出之列)、修改(送出之列)
                    let dels = []
                    let adds = []
                    let mods = []
                    let isApp = (r) => get(r, 'isApp', '') === 'y'

                    if (woName === 'tokens' && isBased) {

                        //app 列已由 guardWrite 嚴格整表比對相符(增、刪、改皆無差異); session 列(契約 tokensSession)逐列寬鬆比對,
                        //只取 compareBaseline 之 changed(庫內摘要與基準不同者, 如續期改 timeEnd); added(載入後新增者)忽略; removed(已不在庫內者)以 nowById 判斷
                        let baseA = new Map(po.baseline)
                        let baseS = new Map(po.baselineSession)
                        let cs = compareBaseline(ltdtOld, po.baselineSession, contractSession)
                        let changedS = new Set(cs.ok ? [] : cs.changed)

                        //app 列: 基準內未送出 → 刪除; 送出之摘要 ≠ 基準 → 修改
                        for (let [id, dg] of baseA) {
                            let sub = subRaw.get(id)
                            if (sub === undefined) {
                                dels.push(nowById.get(id))
                            }
                            else if (digestRow(sub, contract) !== dg) {
                                mods.push(subNorm.get(id))
                            }
                        }

                        //session 列
                        for (let [id, dg] of baseS) {
                            let sub = subRaw.get(id)
                            let now = nowById.get(id)
                            let live = now !== undefined && contractSession.scope(now)
                            if (sub === undefined) {
                                //管理員刪除: 已不在庫內(已被登出 / 撤銷)則冪等略過; 在庫內而庫內已變(如已續期)→ 管理員有動且庫內已變, 拒收
                                if (!live) {
                                    continue
                                }
                                if (changedS.has(id)) {
                                    return Promise.reject('saveStale')
                                }
                                dels.push(now)
                                continue
                            }
                            //管理員未動(摘要同基準): 不寫, 系統續期之 timeEnd 不被舊值蓋回, 已撤銷者不復活 (X1, X7)
                            if (digestRow(sub, contract) === dg) {
                                continue
                            }
                            //管理員有動: 已不在庫內或庫內已變 → 拒收; 否則修改(含升級為應用系統金鑰)
                            if (!live || changedS.has(id)) {
                                return Promise.reject('saveStale')
                            }
                            mods.push(subNorm.get(id))
                        }

                        //基準之外之列(管理員新增): 已存在於庫內(他人載入後新增而撞 id)→ 拒收; 否則新增
                        for (let [id] of subRaw) {
                            if (baseA.has(id) || baseS.has(id)) {
                                continue
                            }
                            if (nowById.has(id)) {
                                return Promise.reject('saveStale')
                            }
                            adds.push(subNorm.get(id))
                        }

                    }
                    else if (woName === 'tokens') {

                        //不帶基準(app 權杖直呼、已開啟之舊版頁面): 刪除與修改只處理應用系統金鑰列(庫內 isApp === 'y',
                        //修改另含送出 isApp === 'y' 者, 即升級為應用系統金鑰); session 列(登入新增、續期改 timeEnd、登出或封鎖刪除, 系統頻繁增刪)
                        //不刪、不以送入值覆蓋, 載入後才登入之 session 因而不被誤刪 (E1, D3). 新增列(送出而庫內無此 id)照常新增,
                        //含直打 API 鑄造使用者 token 與應用系統金鑰(ADR-042, ADR-084); 此路徑無基準可辨是否為已被撤銷之 session, 該風險由帶基準之後台頁(X1)承擔防護
                        each(ltdtOld, (r) => {
                            if (isApp(r) && !subRaw.has(r.id)) {
                                dels.push(r)
                            }
                        })
                        for (let [id, sub] of subNorm) {
                            let old = nowById.get(id)
                            if (old === undefined) {
                                adds.push(sub)
                                continue
                            }
                            if (!isApp(old) && !isApp(sub)) {
                                continue
                            }
                            //以正規化後之列(perms 去重排序,缺欄 / 毀損值變 [])比對庫內: DB 既有之毀損值與無 perms 欄之舊列於存回時正規化為空陣列(ADR-069, PERM-A-005),
                            //此為既有且有意之行為, 不以送入原值比對(外審 sol#8 之『原樣重送零寫入』與之衝突, 不採)
                            if (digestRow(sub, contract) !== digestRow(old, contract)) {
                                mods.push(sub)
                            }
                        }

                    }
                    else {

                        //users / ips: 帶基準時 guardWrite 已嚴格比對相符(庫內 = 基準), 刪除集合 = 基準內 − 送出; 不帶基準時 = 庫內全部 − 送出
                        if (isBased) {
                            for (let [id] of po.baseline) {
                                if (!subRaw.has(id) && nowById.has(id)) {
                                    dels.push(nowById.get(id))
                                }
                            }
                        }
                        else {
                            each(ltdtOld, (r) => {
                                if (!subRaw.has(r.id)) {
                                    dels.push(r)
                                }
                            })
                        }
                        //修改 = 送出列之摘要(契約 fields)≠ 庫內; 名次欄(users.order)值不同亦寫(存檔依列序重編)
                        each(rows, (sub) => {
                            let old = nowById.get(sub.id)
                            if (old === undefined) {
                                adds.push(sub)
                                return
                            }
                            let changed = digestRow(sub, contract) !== digestRow(old, contract)
                            if (!changed && contract.orderKey) {
                                changed = !isEqual(get(old, contract.orderKey), get(sub, contract.orderKey))
                            }
                            if (changed) {
                                mods.push(sub)
                            }
                        })

                    }

                    //rowsAdd: 新增列保留全欄形狀, 伺服器專有欄位(含稽核欄)不採用客戶端值, 由 procOrm 戳記或留空; users 之 password 為新增列例外(明文, 其後檢查策略並雜湊)
                    let rowsAdd = map(adds, (sub) => {
                        let row = { ...sub }
                        each(contract.serverOnly, (k) => {
                            row[k] = ''
                        })
                        if (woName === 'users') {
                            row.password = get(sub, 'password', '')
                        }
                        return row
                    })

                    //rowsMod: 修改列只寫契約 fields(+ 名次欄); 伺服器專有欄位(password、tokenVerify、稽核欄)取庫內值, 不入寫入列 (X2)
                    let rowsMod = map(mods, (sub) => {
                        let row = pickWriteRow(sub, contract)
                        if (contract.orderKey) {
                            row[contract.orderKey] = sub[contract.orderKey]
                        }
                        return row
                    })

                    //新增或修改列之任一欄位值(含主鍵; password 此時為明文、其後雜湊, 不檢查)會被 clearXSS 改寫即拒絕, 屬驗證階段 (ADR-021, ADR-081):
                    //procOrm 寫入時對各欄位 clearXSS(w-serv-orm getMapOrm 之 adjustData), 主鍵會被改寫者 1.1.8 起整批拒絕(屆時同批之刪除已落地),
                    //其餘欄位則被靜默改寫, 使儲存值與送入值不同(account / email 之唯一性與登入即以送入值比對).
                    //刪除不經 clearXSS、摘要相同之列不寫入, 皆不檢查; 惟 users 以 resetOrder 依位置重編 order, 既有列只要位置變動即屬修改而受檢
                    let rowsMarkup = filter([...rowsAdd, ...rowsMod], (row) => {
                        return keys(row).some((k) => k !== 'password' && !isEqual(clearXSS(row[k]), row[k]))
                    })
                    if (size(rowsMarkup) > 0) {
                        return Promise.reject('htmlMarkupNotAllowed')
                    }

                    //users 路徑: 對新使用者的明文密碼進行 policy 檢查與 hash, 屬驗證階段, 須於任何寫入之前 (ADR-021, ADR-080;
                    //原置於刪除寫入之後, 密碼不符策略時刪除與撤銷已落地卻回驗證錯誤)
                    if (woName === 'users' && size(rowsAdd) > 0) {
                        for (let row of rowsAdd) {
                            let pw = get(row, 'password', '')
                            let account = get(row, 'account', '')
                            let chk = checkUserPassword(lang, pw, { account })
                            if (chk.state === 'error') {
                                return Promise.reject(chk.key)
                            }
                            row.password = hashPassword(pw, salt)
                        }
                        //後台建帳自動填 timeVerified: timemsTZ 格式(見 verifyEmail 同處說明; 原 now2str 秒級使新建帳號顯示未驗證、設為管理者後過不了 funCheckAdmin, 2026-09-29 修正)
                        each(rowsAdd, (row) => {
                            let tv = get(row, 'timeVerified', '')
                            if (!isestr(tv)) {
                                row.timeVerified = nowms2str()
                            }
                        })
                    }

                    //rowsClear: 陣列欄變短之列先清空該欄: 儲存層 save 以 lodash merge 合併新舊列, 陣列逐索引合併, 新陣列較短時舊陣列尾端元素會殘留
                    //(如 tokens.perms 由 ['readTokens'] 撤銷為 [] 將無效, ADR-069). 先存 null 令該欄不再為陣列, 其後整列存入即為新陣列.
                    //兩次寫入之間該欄短暫為 null, tokens.perms 讀取端視同未設定(僅基本權限), 屬 fail closed 方向.
                    let rowsClear = []
                    each(rowsMod, (row) => {
                        let id = get(row, keyDetect, '')
                        let clear = null
                        each(row, (v, k) => {
                            let vOld = get(nowById.get(id), k)
                            if (isarr(v) && isarr(vOld) && v.length < vOld.length) {
                                if (clear === null) {
                                    clear = { [keyDetect]: id }
                                }
                                clear[k] = null
                            }
                        })
                        if (clear !== null) {
                            rowsClear.push(clear)
                        }
                    })

                    //寫入階段: 刪除 → 新增 → 修改, 任一步 reject 即停止後續步驟 (不回滾, ADR-044); 同一表鎖內, 刪除與修改皆 mustExist(只改不增, 列已不存在 → rowNotFound 而不新增殘缺列)
                    let errWrite = null
                    try {

                        //del, operatorId 用於 audit (userIdUpdate)
                        if (size(dels) > 0) {
                            await procOrm(operatorId, woName, 'del', map(dels, (row) => ({ id: row.id })), { mustExist: true })
                        }

                        //add
                        if (size(rowsAdd) > 0) {
                            if (woName === 'tokens') {
                                //tokens 之 userId 為令牌擁有者(非建立者): keepUserId 保留列上非空之擁有者, userIdUpdate 記操作者 (ADR-042, ADR-084; w-serv-orm 1.1.17);
                                //擁有者為空者以操作者補, 不再寫成無擁有者之金鑰
                                await procOrm(operatorId, woName, 'insert', rowsAdd, { keepUserId: true })
                            }
                            else {
                                await procOrm(operatorId, woName, 'insert', rowsAdd)
                            }
                        }

                        //mod
                        if (size(rowsClear) > 0) {
                            await procOrm(operatorId, woName, 'save', rowsClear, { mustExist: true })
                        }
                        if (size(rowsMod) > 0) {
                            await procOrm(operatorId, woName, 'save', rowsMod, { mustExist: true })
                        }

                    }
                    catch (err) {
                        errWrite = err
                    }

                    //users 路徑: 撤銷本批欲刪除與欲停用(isActive==='n')者名下全部 token, 避免 orphan token 仍可 checkToken/refreshToken 續命 (ADR-037).
                    //撤銷範圍依本批意圖, 不依寫入成敗(寫入失敗之列亦撤, fail closed); 先寫入再撤銷: 刪除 / 停用落地後已無法登入, 不會再產生新 token.
                    //停用者沿用整表掃描(本批表內 isActive==='n' 者皆撤, 冪等). 撤銷失敗僅 srLog.error 不阻斷主流程.
                    //與寫入同在 [tokens, users] 鎖內, 故用持鎖版 revokeTokensByUserIdLocked (不可重入, R-CONC-01)
                    if (woName === 'users') {
                        for (let row of dels) {
                            let userId = get(row, 'id', '')
                            await revokeTokensByUserIdLocked(userId)
                                .catch((err) => {
                                    srLog.error({ event: 'fun-updateTabItems-revokeTokenOnDelete', userId, err: getErrorMessage(err) })
                                })
                        }
                        for (let row of rows) {
                            if (get(row, 'isActive', '') !== 'n') {
                                continue
                            }
                            let userId = get(row, 'id', '')
                            await revokeTokensByUserIdLocked(userId)
                                .catch((err) => {
                                    srLog.error({ event: 'fun-updateTabItems-revokeTokenOnDisable', userId, err: getErrorMessage(err) })
                                })
                        }
                    }

                    //寫入後立即 invalidate 30s cache, 避免改完之統計頁顯示舊資料 (ADR-008, audit F-050); 寫入失敗時資料庫可能已部分變更, 一併清除 (ADR-080)
                    if (ocList !== null) {
                        ocList.clear('fun')
                    }

                    //check, 寫入階段失敗一律回 saveWriteFail, procOrm 原文(含失敗筆主鍵)僅記 log (ADR-034, ADR-080)
                    if (errWrite !== null) {
                        srLog.error({ event: 'fun-updateTabItems-write', key: 'saveWriteFail', woName, err: getErrorMessage(errWrite) })
                        return Promise.reject('saveWriteFail')
                    }

                },
            })
        }
        catch (err) {

            //契約拒收鍵(baselineMismatch / rowNotFound / baselineFormat)轉語系鍵, 提示重新載入; 取鍵一律用核心 getRejectKey
            let kSave = getSaveRejectKey(err)
            if (kSave !== null) {
                if (srLog && isfun(srLog.warn)) {
                    srLog.warn({ event: 'fun-updateTabItems-reject', key: kSave, woName }) //原則 3: 後端錯誤 log error key
                }
                return Promise.reject(kSave)
            }

            //rowsInvalid: 庫內讀出之列主鍵重複或缺漏, 屬伺服端資料錯誤(重新載入無法解決), 記 log 後回伺服端錯誤鍵
            if (getRejectKey(err) === 'rowsInvalid') {
                srLog.error({ event: 'fun-updateTabItems-rowsInvalid', key: 'anUnexpectedErrorOccurred', woName, err: getErrorMessage(err) })
                return Promise.reject('anUnexpectedErrorOccurred')
            }

            return Promise.reject(err)
        }

        //users 路徑: 回傳前剝除 password 與 tokenVerify 欄位, 避免明文/hash/驗證 token 經 API 洩漏
        if (woName === 'users') {
            ltdtNew = map(ltdtNew, (row) => {
                let copy = { ...row }
                delete copy.password
                delete copy.tokenVerify
                return copy
            })
        }

        return ltdtNew
    }


    //getUserByToken
    let getUserByToken = async (token) => {

        //tks
        let tks = await woItems.tokens.select({ token })
        //console.log(`...tokens.select`)

        //ntks
        let ntks = size(tks)

        //check
        if (ntks === 0) {
            // console.log(`token`, token)
            console.log(`invalid token`)
            return Promise.reject(`invalid token`)
        }

        //check
        if (ntks >= 2) {
            // console.log(`token`, token)
            console.log(`duplicate tokens`)
            return Promise.reject(`duplicate tokens`)
        }

        //tk
        let tk = get(tks, 0, null)
        // console.log('tk', tk)

        //isApp
        let isApp = get(tk, 'isApp', '')
        // console.log('isApp', isApp)

        //u
        let u = null
        if (isApp !== 'y') {
            //token來自使用者

            //userId
            let userId = get(tk, 'userId', '')
            // console.log('userId', userId)

            //getGenUserByUserId
            u = await getGenUserByUserId(userId)

        }
        else {
            //token來自應用系統, 另外提供虛擬使用者資訊

            //userId
            let userId = get(tk, 'userId', '')
            // console.log('userId', userId)

            //check
            if (!isestr(userId)) {
                // console.log(`tk`, tk)
                console.log(`invalid userId from token`)
                return Promise.reject(`invalid userId from token`)
            }

            // //timeEnd
            // let timeEnd = get(tk, 'timeEnd', '')
            // // console.log('timeEnd', timeEnd)

            // //check
            // if (!istimemsTZ(timeEnd)) {
            //     console.log(`timeEnd`, timeEnd)
            //     console.log(`invalid timeEnd`)
            //     return Promise.reject(`invalid timeEnd`)
            // }

            //u
            u = {
                id: userId,
                account: 'no account',
                name: 'no name',
                email: 'no email',
                description: 'no description',
                from: 'no from',
                redir: 'no redir',
                isAdmin: 'y', //應用系統代表為系統管理員
                timeVerified: '2000-01-01T00:00:00.000+08:00', //應用系統代表為已驗證
                timeExpired: '',
                timeBlocked: '',
                isActive: 'y',
            }

        }

        //uu
        let uu = {
            id: u.id,
            account: u.account,
            name: u.name,
            email: u.email,
            description: u.description,
            from: u.from,
            redir: u.redir,
            isApp: isApp === 'y' ? 'y' : 'n',
            isAdmin: u.isAdmin,
            timeVerified: u.timeVerified,
            timeExpired: u.timeExpired,
            timeBlocked: u.timeBlocked,
            isActive: u.isActive,
            isForceChangePw: u.isForceChangePw, //對齊 loginByAccountAndPassword 之 r shape; 前端 autoLogin (mUI.mjs:617) 同款判斷, 否則 admin 重設密碼後使用者 reload 即可繞過強制變更
        }

        return uu
    }


    //checkTokenAndGetUserByToken
    let checkTokenAndGetUserByToken = async (tokenSelf, tokenTarget, opt = {}) => {

        //checkToken
        await checkToken(tokenSelf, opt) //resolve僅回傳true, reject代表無效token或檢測token發生錯誤

        //getUserByToken
        let u = await getUserByToken(tokenTarget).catch(() => null)

        return u
    }


    //getUserInfor
    let getUserInfor = async (key, value, opt = {}) => {

        //key 為使用端給定之欄位名(對外 HTTP / kpfun), 須在白名單 id / account / email / name (R-QKEY-01, 單一擁有者):
        //白名單外 reject 固定 key, 不回顯 key 與 value, 不查資料庫; 本函式只經 checkTokenAndGetUserInfor 呼叫, 故檢查必在 checkToken 之後
        if (!(isestr(key) && keysUserQuery.includes(key))) {
            return Promise.reject('invalidUserQueryKey')
        }

        //u
        //對外 getUserInfor 邊界: 查無 target 時 _getGenUserByKV 會 reject 原始字串
        //('can not find the user by xxx' / 'duplicate xxx'), 此處統一 catch 轉為 null,
        //交由 WWebSso handler (iseobj 檢核失敗 → 'tokenNoPermission') 統一以「無權限」回應
        //(anti-enumeration: 不洩漏 target 是否存在). 內層 _getGenUserByKV 之原始 reject
        //維持不變, 供 procProtect 等內部 caller 既有判斷 (登入防列舉) 沿用.
        let u = await getGenUserByKV(key, value, opt)
            .catch(() => null)

        //check
        if (!iseobj(u)) {
            return null
        }

        //r
        let r = {
            id: u.id,
            account: u.account,
            name: u.name,
            email: u.email,
            description: u.description,
            from: u.from,
            redir: u.redir,
            isAdmin: u.isAdmin,
            timeVerified: u.timeVerified,
            timeExpired: u.timeExpired,
            timeBlocked: u.timeBlocked,
            isActive: u.isActive,
        }

        return r
    }


    //checkTokenAndGetUserInfor
    let checkTokenAndGetUserInfor = async (token, key, value, opt = {}) => {

        //checkToken
        await checkToken(token, opt) //resolve僅回傳true, reject代表無效token或檢測token發生錯誤

        //getUserInfor
        let r = await getUserInfor(key, value)

        return r
    }


    //getUsersList
    let getUsersList = async (opt = {}) => {

        //needActive
        let needActive = get(opt, 'needActive')
        if (!isbol(needActive)) {
            needActive = false
        }

        //deletePassword
        let deletePassword = get(opt, 'deletePassword')
        if (!isbol(deletePassword)) {
            deletePassword = true
        }

        //optSelect
        let optSelect = {}
        if (needActive) {
            optSelect = { isActive: 'y' }
        }

        //select
        let us = await woItems.users.select(optSelect)
        //console.log(`...users.select`)

        //delete password, 無錯誤取得後即先刪除, 避免調整程式時意外洩漏hash後密碼
        //tokenVerify (註冊驗證用 token, 憑證類) 同步收回 (T3, 原則 8): 契約生效後後台不再需要整列存回它 (伺服器專有欄位, 存檔不採用客戶端值, R-CONC-02)
        if (deletePassword) {
            us = map(us, (u) => {
                delete u.password
                delete u.tokenVerify
                return u
            })
        }

        return us
    }


    //getUsersListCache
    let ocGetUsersList = cache()
    let getUsersListCache = async () => {
        let r = await ocGetUsersList.getProxy('fun', { fun: getUsersList, inputs: null, timeExpired: 30 * 1000 }) //快取30秒
        return r
    }


    //checkTokenAndGetUsersList
    let checkTokenAndGetUsersList = async (token, opt = {}) => {

        //checkToken
        await checkToken(token, opt) //resolve僅回傳true, reject代表無效token或檢測token發生錯誤

        //getUsersList
        let us = await getUsersList(opt)

        return us
    }


    //omitUserCredential: 剝除使用者列之憑證欄, 回新物件不改原列 (供對外介接輸出用; 後台路徑不套用, 見 WWebSso getSsoUsersList)
    let omitUserCredential = (u) => {
        let r = { ...u }
        for (let k of keysUserCredential) {
            delete r[k]
        }
        return r
    }


    //checkTokenAndGetActiveUsersList
    let checkTokenAndGetActiveUsersList = async (token, opt = {}) => {

        //checkTokenAndGetUsersList
        let us = await checkTokenAndGetUsersList(token, { ...opt, needActive: true })

        return us
    }


    //updateUsersList
    let updateUsersList = async (rows, opt = {}) => {

        //updateTabItems, 撤銷刪除 / 停用者之 token 與清除使用者清單快取皆於其寫入階段後執行 (ADR-080)
        rows = await updateTabItems('users', rows, 'id', { resetOrder: true, ...opt, ocList: ocGetUsersList })

        return rows
    }


    //checkTokenAndUpdateUsersList
    //optClient: 前端經 RPC 送入之第 4 參數 { baseline }(未驗證, 由 updateTabItems 內 parseSaveOpt 驗證; 不展開給 procOrm); 未給即不帶基準
    let checkTokenAndUpdateUsersList = async (token, lang, rows, opt = {}, optClient = undefined) => {

        //checkToken
        await checkToken(token, opt) //resolve僅回傳true, reject代表無效token或檢測token發生錯誤

        //lang
        if (!isestr(lang)) {
            lang = 'eng'
        }

        //取操作者 id (用於 audit fields userId/userIdUpdate 與 self-lockout 檢查)
        let uOperator = await getUserByToken(token)
        let operatorId = get(uOperator, 'id', '')

        //rows 來自使用端, 須為陣列才可走訪: 帶數字 length 之物件經 lodash each 會改走索引 0..length-1 (length 極大時空轉阻塞事件迴圈, 且真實鍵被略過) (R-OBJ-ITER-01);
        //資料通道入口 (WWebSso updateUsersList) 已以 isearr 守門, 此為縱深, 並使本函數單獨呼叫時亦與 updateTabItems 同回 invalidRows
        if (!isarr(rows)) {
            return Promise.reject('invalidRows')
        }

        //自我保護僅適用於使用者操作者: app token 之操作者為虛擬使用者, users 表無其列, 無「自己」可刪除/降權/停用 (ADR-069)
        let isAppOperator = get(uOperator, 'isApp', '') === 'y'
        if (!isAppOperator) {

            //自我鎖死保護: 若 rows 內含操作者自己, 且操作者把自己 isAdmin/isActive 改成非 'y', reject
            let selfRow = null
            for (let rr of rows) {
                if (get(rr, 'id', '') === operatorId) {
                    selfRow = rr
                    break //跳出
                }
            }
            //自我刪除保護: rows 內找不到操作者 row, 代表 admin 嘗試把自己刪除, reject 防止直接打 API 繞過前端
            if (isestr(operatorId) && !iseobj(selfRow)) {
                return Promise.reject('cannotDeleteSelf')
            }
            if (iseobj(selfRow)) {
                if (get(selfRow, 'isAdmin', '') !== 'y') {
                    return Promise.reject('cannotDemoteSelf')
                }
                if (get(selfRow, 'isActive', '') !== 'y') {
                    return Promise.reject('cannotDisableSelf')
                }
            }

        }

        //雙擊防護(後端): 同一操作者之使用者清單儲存處理中再送出即拒絕 (見 lockSave, ADR-074)
        return await lockSave('updateUsersList', operatorId, async () => {

            //updateUsersList (帶 lang/operatorId 給下層用於 add 群組密碼策略檢查與 audit)
            //停用使用者即時撤銷其全部 token (ADR-037) 與清除使用者清單快取 (ADR-008), 皆於 updateTabItems 寫入階段後執行, 不論寫入成敗 (ADR-080)
            rows = await updateUsersList(rows, { lang, operatorId, optClient })

            return rows
        })
    }


    //cleanTokens timer 已 disable 因避免無法展延金鑰 (詳 line ~1774).


    //getTokensList
    let getTokensList = async () => {

        //select
        let ts = await woItems.tokens.select()
        //console.log(`...tokens.select`)

        //list 包含過期 token 供 admin 判斷.

        return ts
    }


    //getTokensListCache
    let ocGetTokensList = cache()
    let getTokensListCache = async () => {
        let r = await ocGetTokensList.getProxy('fun', { fun: getTokensList, inputs: null, timeExpired: 30 * 1000 }) //快取30秒
        return r
    }


    //checkTokenAndGetTokensList
    let checkTokenAndGetTokensList = async (token, opt = {}) => {

        //checkToken
        await checkToken(token, opt) //resolve僅回傳true, reject代表無效token或檢測token發生錯誤

        //getTokensList
        let us = await getTokensList()

        return us
    }


    //updateTokensList
    //opt: { operatorId, optClient }, operatorId 為操作者 id(稽核 userIdUpdate, R-CONC-04), optClient 見 checkTokenAndUpdateUsersList
    let updateTokensList = async (rows, opt = {}) => {

        //rows 來自使用端, 須為陣列才可走訪 (同 checkTokenAndUpdateUsersList; 非陣列〔如帶 length 之物件〕原於下方 for…of 拋 TypeError, R-OBJ-ITER-01)
        if (!isarr(rows)) {
            return Promise.reject('invalidRows')
        }

        //perms 之驗證(本批有變動或新增之列須為未設定或已登錄權限字串之陣列, 任一列不合法則整批 reject 不寫入, ADR-069)與合法者去重並依全集排序,
        //須對照鎖內新鮮讀取之庫內值, 故移入 updateTabItems 之表鎖內(原於鎖外讀庫比對, 與寫入之間可被插隊)
        //updateTabItems, 清除權杖清單快取於其寫入階段後執行 (ADR-080)
        rows = await updateTabItems('tokens', rows, 'id', {
            resetOrder: false,
            operatorId: get(opt, 'operatorId', ''),
            optClient: get(opt, 'optClient'),
            ocList: ocGetTokensList,
        })

        return rows
    }


    //checkTokenAndUpdateTokensList
    let checkTokenAndUpdateTokensList = async (token, rows, opt = {}, optClient = undefined) => {

        //checkToken
        await checkToken(token, opt) //resolve僅回傳true, reject代表無效token或檢測token發生錯誤

        //操作者 id (雙擊防護之占位 key)
        let uOperator = await getUserByToken(token)
        let operatorId = get(uOperator, 'id', '')

        //雙擊防護(後端): 同一操作者之權杖清單儲存處理中再送出即拒絕 (見 lockSave, ADR-074)
        return await lockSave('updateTokensList', operatorId, async () => {

            //updateTokensList, 清除權杖清單快取 (ADR-008) 於 updateTabItems 寫入階段後執行, 不論寫入成敗 (ADR-080)
            rows = await updateTokensList(rows, { operatorId, optClient })

            return rows
        })
    }


    //getIpsList
    let getIpsList = async () => {

        //select
        let oips = await woItems.ips.select()
        //console.log(`...ips.select`)

        return oips
    }


    //getIpsListCache
    let ocGetIpsList = cache()
    let getIpsListCache = async () => {
        let r = await ocGetIpsList.getProxy('fun', { fun: getIpsList, inputs: null, timeExpired: 30 * 1000 }) //快取30秒
        return r
    }


    //checkTokenAndGetIpsList
    let checkTokenAndGetIpsList = async (token, opt = {}) => {

        //checkToken
        await checkToken(token, opt) //resolve僅回傳true, reject代表無效token或檢測token發生錯誤

        //getIpsList
        let oips = await getIpsList()

        return oips
    }


    //updateIpsList
    //opt: { operatorId, optClient }, 同 updateTokensList
    let updateIpsList = async (rows, opt = {}) => {

        //updateTabItems, 清除 IP 清單快取於其寫入階段後執行 (ADR-080)
        rows = await updateTabItems('ips', rows, 'id', {
            resetOrder: false,
            operatorId: get(opt, 'operatorId', ''),
            optClient: get(opt, 'optClient'),
            ocList: ocGetIpsList,
        })

        return rows
    }


    //checkTokenAndUpdateIpsList
    let checkTokenAndUpdateIpsList = async (token, rows, opt = {}, optClient = undefined) => {

        //checkToken
        await checkToken(token, opt) //resolve僅回傳true, reject代表無效token或檢測token發生錯誤

        //操作者 id (雙擊防護之占位 key)
        let uOperator = await getUserByToken(token)
        let operatorId = get(uOperator, 'id', '')

        //雙擊防護(後端): 同一操作者之 IP 清單儲存處理中再送出即拒絕 (見 lockSave, ADR-074)
        return await lockSave('updateIpsList', operatorId, async () => {

            //updateIpsList, 清除 IP 清單快取 (ADR-008) 於 updateTabItems 寫入階段後執行, 不論寫入成敗 (ADR-080)
            rows = await updateIpsList(rows, { operatorId, optClient })

            return rows
        })
    }


    // //timer, 清除已過期(timeEnd)的token, 不使用避免無法展延金鑰
    // let lockingForCleanTokens = false
    // setInterval(async() => {

    //     //check
    //     if (lockingForCleanTokens) {
    //         return
    //     }
    //     lockingForCleanTokens = true

    //     //cleanTokens
    //     await cleanTokens()
    //         .finally(() => {
    //             lockingForCleanTokens = false
    //         })

    // }, 2000)


    //timeBlocked 到期解除採「隱性解除」(ADR-013): 不設 timer 主動清空, 一律由 getBlockedByUser / getBlockedByOip
    //以「當前時間 vs timeBlocked」比對判定; timeBlocked 保留歷史值兼任 audit 紀錄.
    //(2026-07-06 移除早於 ADR-013 之 cleanUsers/cleanIps 每 2 秒全表掃描 timer, 程式碼對齊 ADR-013)


    //p
    let p = {

        getTokenByKV,

        createUser,
        verifyEmail,
        resendVerifyEmail,
        checkUserPassword,
        checkTokenAndChangePassword,
        adminResetUserPassword,

        getIpByKV,

        revokeTokensByUserId,
        revokeTokensByUserIdLocked, //持鎖版: 呼叫端須已持有 tokens 表鎖(procProtect 封鎖於 [tokens, users] 鎖內使用), 不可重入

        getGenUserByKV,
        getGenUserByUserId,
        getGenUserByAccount,

        loginByAccountAndPassword,
        logoutByToken,

        checkToken,
        refreshToken,

        getUserByToken,
        checkTokenAndGetUserByToken,

        getUserInfor,
        checkTokenAndGetUserInfor,

        getUsersList,
        getUsersListCache,
        checkTokenAndGetUsersList,
        checkTokenAndGetActiveUsersList,
        omitUserCredential,
        updateUsersList,
        checkTokenAndUpdateUsersList,

        getTokensList,
        getTokensListCache,
        checkTokenAndGetTokensList,
        checkTokenAndUpdateTokensList,

        getIpsList,
        getIpsListCache,
        checkTokenAndGetIpsList,
        checkTokenAndUpdateIpsList,

    }


    return p
}


export default proc
