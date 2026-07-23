import path from 'path'
import fs from 'fs'
import crypto from 'crypto'
import ot from 'dayjs'
import get from 'lodash-es/get.js'
import each from 'lodash-es/each.js'
import map from 'lodash-es/map.js'
import size from 'lodash-es/size.js'
import keys from 'lodash-es/keys.js'
import filter from 'lodash-es/filter.js'
import genIDSeq from 'wsemi/src/genIDSeq.mjs'
import iseobj from 'wsemi/src/iseobj.mjs'
import isestr from 'wsemi/src/isestr.mjs'
import ispint from 'wsemi/src/ispint.mjs'
import isearr from 'wsemi/src/isearr.mjs'
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
import ltdtDiffByKey from 'wsemi/src/ltdtDiffByKey.mjs'
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
import now2str from 'wsemi/src/now2str.mjs'
import getErrorMessage from 'wsemi/src/getErrorMessage.mjs'
import ds from '../src/schema/index.mjs'
import * as s from '../src/plugins/mShare.mjs'
import hashPassword, { verifyPassword } from './hashPassword.mjs'
import genRandomPassword from './genRandomPassword.mjs'
import { maskToken } from './srLog.mjs'


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


function proc(woItems, procOrm, { srLog, srEmail, salt, minExpired, kpLang, pathTemplate, passwordPolicy, allowUserRegistration, siteUrl, verifyBaseUrl }) {


    //pmKeyMutex: per-key in-memory mutex, 同 key 序列化、不同 key 並行.
    //用於 resendVerifyEmail / checkTokenAndChangePassword / adminResetUserPassword 等
    //critical 路徑, 防同 key 並行 race (lost update / 重複寄信).
    let kmx = pmKeyMutex()

    //cacheSt: in-process 多 key 原子占位 + auto-cleanup (TTL).
    //用於 createUser race (同 account 不同 email 之雙重 insert) — 原 kmx 之複合 key
    //`account:email` 不同組合走不同鎖完全不互斥, 改用 cst.setWithFree 兩段獨立 key 原子占位
    //(`createUser:account:<a>` 與 `createUser:email:<e>` 任一衝突即 reject), 避免繞鎖雙重 insert.
    let cst = cacheSt()

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

    //email body 從 server/template/{templateName}-{lang}.html 讀檔並做 placeholder 替換
    let renderEmailBody = (templateName, lang, kvMap = {}) => {
        if (lang !== 'eng' && lang !== 'cht') { lang = 'eng' }
        let fpTpl = path.resolve(pathTemplate, `${templateName}-${lang}.html`)
        let content = fs.readFileSync(fpTpl, 'utf8')
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
            console.log('valueUser', valueUser)
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
            console.log('keyUser', keyUser)
            console.log('valueUser', valueUser)
            return Promise.reject(`can not find the user by ${keyUser}`)
        }

        //check
        if (nus >= 2) {
            console.log('keyUser', keyUser)
            console.log('valueUser', valueUser)
            console.log(`duplicate ${keyUser}`)
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

        //createToken
        let token = await createToken(userId)
        // console.log('token', token)

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
            isActive: u.isActive,
            isForceChangePw: u.isForceChangePw, //強制變更密碼旗標, 前端登入後判斷是否拉去 user view 強制變更
            token,
        }

        return r
    }


    //createToken
    let createToken = async (userId) => {
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

        //insert
        await woItems.tokens.insert(t)
            .catch((err) => {
                errTemp = err
            })

        //check
        if (errTemp) {
            console.log(errTemp)
            // console.log(`token`, token)
            console.log(`can not create a token from userId`)
            return Promise.reject(`can not create a token from userId`)
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

        //tn
        let tn = ot().format('YYYY-MM-DDTHH:mm:ss.SSSZ')
        // console.log('tn     ', tn)
        // console.log('timeEnd', timeEnd)
        // console.log('tn < timeEnd', tn < timeEnd)

        let b1 = tn < timeEnd //現在時間<到期時間, 代表尚未到期
        let b2 = true
        // app token (isApp='y') 預設視同 admin, 跳過 fun 驗證; 應僅由內部 token creation 路徑簽發, 不開放外部註冊.
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
            //token來自應用系統, 因無使用者資訊即便有給fun也略過
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
    let refreshToken = async (token) => {

        //defense-in-depth NoSQL operator injection guard (reject key 名, 對齊 token 鏈統一 tokenExpired)
        if (!isestr(token)) {
            return Promise.reject('tokenExpired')
        }

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

        //timeUpdate
        let timeUpdate = ot().format('YYYY-MM-DDTHH:mm:ss.SSSZ')

        //save
        await woItems.tokens.save({
            id: tk.id,
            timeEnd: timeEndNew,
            timeUpdate,
        })
            .catch((err) => {
                errTemp = err
            })

        //check
        if (errTemp) {
            console.log(errTemp)
            // console.log(`token`, token)
            console.log(`can not update timeEnd for token`)
            return Promise.reject(`can not update timeEnd for token`)
        }

        return timeEndNew
    }


    //logoutByToken
    let logoutByToken = async (token) => {

        //defense-in-depth NoSQL operator injection guard (reject key 名, 對齊 token 鏈統一 tokenExpired)
        if (!isestr(token)) {
            return Promise.reject('tokenExpired')
        }

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
        await cst.setWithFree([keyAccount, keyEmail], async () => {

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
            await procOrm(u.id, 'users', 'insert', [u])
        })
            .catch((err) => {
                //remap setWithFree 之 'key in use' reject → 業務語意之 i18n 訊息.
                //其他 reject (select unique check 之 'account/email already exists', insert 失敗等)
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
        try {
            let sender = get(kpLang, `${lang}.webName`, '')
            let title = getEmailTitle('regVerifyEmTitle', lang)
            let verifyUrl = `${verifyBaseUrl}/api/verifyEmail?token=${tokenVerify}&lang=${lang}`
            let content = renderEmailBody('regVerifyEmail', lang, {
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

        //update timeVerified
        await woItems.users.save({
            id: user.id,
            timeVerified: now2str(),
            //F-053 fix (lazy clear): 不主動清 tokenVerify, 避免並發 resendVerifyEmail 寫的新 token
            //被此處 race window 覆蓋. token 重用風險由 line ~818 之 isestr(timeVerified) → reject
            //'verifyEmailAlreadyVerified' 擋住, 已驗證 user 點舊連結會得友善訊息.
        })

        return { state: 'success', msg: 'ok' }
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

            //產生新 tokenVerify 並更新至 users
            let tokenVerify = `${genIDSeq()}`
            await woItems.users.save({
                id: userId,
                tokenVerify,
            })

            //寫 throttle 時間戳 (放在 save 後, 確認此次 resend 已生效才記)
            lastResendTime.set(account, now)

            //send verify email
            try {
                let sender = get(kpLang, `${lang}.webName`, '')
                let title = getEmailTitle('regVerifyEmTitle', lang)
                let verifyUrl = `${verifyBaseUrl}/api/verifyEmail?token=${tokenVerify}&lang=${lang}`
                let content = renderEmailBody('regVerifyEmail', lang, {
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

            //save (清 isForceChangePw='n', 變更密碼成功後即解除強制變更)
            await woItems.users.save({
                id: userId,
                password: passwordNew,
                isForceChangePw: 'n',
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

                //title from procLang
                let title = getEmailTitle('chpwEmTitle', lang)
                if (!isestr(title)) {
                    console.log('chpwEmTitle 取不到, lang', lang)
                    throw new Error(`invalid title`)
                }

                //body from server/template/changePasswordEmail-{lang}.html
                let content = renderEmailBody('changePasswordEmail', lang, {
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

        //checkToken
        await checkToken(token)

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

            //hash + save (含 isForceChangePw='y')
            let hashed = hashPassword(newPassword, salt)
            await woItems.users.save({
                id: targetUserId,
                password: hashed,
                isForceChangePw: 'y',
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

                    //title from procLang
                    let title = getEmailTitle('resetPwEmTitle', lang)
                    if (!isestr(title)) {
                        throw new Error(`invalid title`)
                    }

                    //body from server/template/resetPasswordEmail-{lang}.html
                    let content = renderEmailBody('resetPasswordEmail', lang, {
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


    //updateTabItems
    let updateTabItems = async (woName, rows, keyDetect, opt = {}) => {
        // console.log('updateTabItems', woName, rows.length, keyDetect)

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

        //ckKey
        let ckKey = (rows, key) => {
            let err = null

            //check
            let kp = {}
            each(rows, (v, k) => {

                //value
                let value = get(v, key, '')

                //check
                if (!isestr(value)) {
                    err = `rows[${k}].${key} is not an effective string`
                    return false //跳出
                }

                //check
                if (haskey(kp, value)) {
                    err = `rows[${k}].${key}[${value}] is duplicate`
                    return false //跳出
                }

                //kp
                kp[value] = true

            })

            return err
        }

        //偵測未給予或重複
        let err = null
        if (true) {
            if (arrHas(woName, ['users'])) { //users可重複name
                err = ckKey(rows, 'id')
                if (err !== null) {
                    return Promise.reject(err)
                }
                err = ckKey(rows, 'email')
                if (err !== null) {
                    return Promise.reject(err)
                }
            }
        }

        //ltdtDiffByKey
        let ltdtOld = await woItems[woName].select()
        //console.log(`...woName[${woName}].select`)

        //users 路徑: account 唯一性 + 非空驗證 (補 id/email 之外的 account; 防直打 API 寫入空/重複帳號).
        //(a) 空值 → reject 'accountRequired'; (b) 本批內重複 或 與既有其他 user 之 account 衝突 → reject 'accountDuplicate'.
        //帳號全域唯一, 與既有比對時排除「本批同 id 之自身既有列」(更新自己時 account 可維持不變).
        if (woName === 'users') {
            //既有 account → id 對照 (排除自身用)
            let accountToIdOld = {}
            each(ltdtOld, (r) => {
                let a = get(r, 'account', '')
                if (isestr(a)) {
                    accountToIdOld[a] = get(r, 'id', '')
                }
            })
            let kpAccount = {}
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

        //users 路徑: 既有 row 的 password 保留 DB hash, 避免前端送來的 '' (getUsersList 已 strip)
        //在儲存階段把 DB 既有 password 覆蓋成空字串, 等同把所有既有使用者密碼洗掉
        if (woName === 'users') {
            let oldById = {}
            each(ltdtOld, (r) => {
                oldById[r.id] = r
            })
            each(rows, (row) => {
                let oldRow = oldById[row.id]
                if (oldRow) {
                    row.password = oldRow.password
                }
            })
        }

        let ltdtNew = rows
        let r = ltdtDiffByKey(ltdtOld, ltdtNew, keyDetect)
        // console.log('ltdtDiffByKey r', r)

        //del
        if (size(r.del) > 0) {
            await procOrm(operatorId, woName, 'del', r.del) //operatorId 用於 audit (userIdUpdate)

            //users 路徑: 刪除使用者須一併撤銷其名下所有 token, 避免 orphan token 仍可 checkToken/refreshToken 續命
            //(對稱於下方 isActive='n' 撤 token 迴圈與 procProtect.blockAccount). 逐筆撤銷失敗僅 srLog.error 不阻斷主流程.
            if (woName === 'users') {
                for (let row of r.del) {
                    let userId = get(row, 'id', '')
                    if (!isestr(userId)) {
                        continue
                    }
                    try {
                        let ts = await woItems.tokens.select({ userId })
                        for (let t of ts) {
                            await woItems.tokens.del({ id: t.id })
                        }
                    }
                    catch (err) {
                        srLog.error({ event: 'fun-updateTabItems-revokeTokenOnDelete', userId, err: getErrorMessage(err) })
                    }
                }
            }
        }

        //add
        if (size(r.add) > 0) {
            //users 路徑: 對新使用者的明文密碼進行 policy 檢查與 hash
            if (woName === 'users') {
                for (let row of r.add) {
                    let pw = get(row, 'password', '')
                    let account = get(row, 'account', '')
                    let chk = checkUserPassword(lang, pw, { account })
                    if (chk.state === 'error') {
                        return Promise.reject(chk.key)
                    }
                    row.password = hashPassword(pw, salt)
                }
                //後台建帳自動填 timeVerified
                each(r.add, (row) => {
                    let tv = get(row, 'timeVerified', '')
                    if (!isestr(tv)) {
                        row.timeVerified = now2str()
                    }
                })
            }
            await procOrm(operatorId, woName, 'insert', r.add)
        }

        //diff
        if (size(r.diff) > 0) {
            await procOrm(operatorId, woName, 'save', r.diff)
        }

        //users 路徑: 回傳前剝除 password 欄位, 避免明文/hash 經 API 洩漏
        if (woName === 'users') {
            ltdtNew = map(ltdtNew, (row) => {
                let copy = { ...row }
                delete copy.password
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
        if (deletePassword) {
            us = map(us, (u) => {
                delete u.password
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


    //checkTokenAndGetActiveUsersList
    let checkTokenAndGetActiveUsersList = async (token, opt = {}) => {

        //checkTokenAndGetUsersList
        let us = await checkTokenAndGetUsersList(token, { ...opt, needActive: true })

        return us
    }


    //updateUsersList
    let updateUsersList = async (rows, opt = {}) => {

        //updateTabItems
        rows = await updateTabItems('users', rows, 'id', { resetOrder: true, ...opt })

        return rows
    }


    //checkTokenAndUpdateUsersList
    let checkTokenAndUpdateUsersList = async (token, lang, rows, opt = {}) => {

        //checkToken
        await checkToken(token, opt) //resolve僅回傳true, reject代表無效token或檢測token發生錯誤

        //lang
        if (!isestr(lang)) {
            lang = 'eng'
        }

        //取操作者 id (用於 audit fields userId/userIdUpdate 與 self-lockout 檢查)
        let uOperator = await getUserByToken(token)
        let operatorId = get(uOperator, 'id', '')

        //自我鎖死保護: 若 rows 內含操作者自己, 且操作者把自己 isAdmin/isActive 改成非 'y', reject
        let selfRow = null
        each(rows, (rr) => {
            if (get(rr, 'id', '') === operatorId) {
                selfRow = rr
                return false //跳出
            }
        })
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

        //updateUsersList (帶 lang/operatorId 給下層用於 add 群組密碼策略檢查與 audit)
        rows = await updateUsersList(rows, { lang, operatorId })

        //停用使用者即時撤銷其全部 token: 本批中 isActive==='n' 之 user, 於儲存成功後刪除其名下所有 token
        //(使用者設計上不持有 isApp='y' token, 故一併撤). 作法比照 procProtect.blockAccount:
        //woItems.tokens.select({ userId }) 取陣列後逐筆 del. 冪等 (該 user 已無 token 時刪 0 筆無害).
        //撤 token 為附帶副作用, 失敗僅記 srLog.error 不阻斷主流程.
        for (let row of rows) {
            if (get(row, 'isActive', '') !== 'n') {
                continue
            }
            let userId = get(row, 'id', '')
            if (!isestr(userId)) {
                continue
            }
            try {
                let ts = await woItems.tokens.select({ userId })
                for (let t of ts) {
                    await woItems.tokens.del({ id: t.id })
                }
            }
            catch (err) {
                srLog.error({ event: 'fun-updateUsersList-revokeToken', userId, err: getErrorMessage(err) })
            }
        }

        //寫入後立即 invalidate 30s cache, 避免 admin 改完之 dashboard 顯示舊資料 (audit F-050)
        ocGetUsersList.clear('fun')

        return rows
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
    let updateTokensList = async (rows) => {

        //updateTabItems
        rows = await updateTabItems('tokens', rows, 'id', { resetOrder: false })

        return rows
    }


    //checkTokenAndUpdateTokensList
    let checkTokenAndUpdateTokensList = async (token, rows, opt = {}) => {

        //checkToken
        await checkToken(token, opt) //resolve僅回傳true, reject代表無效token或檢測token發生錯誤

        //updateTokensList
        rows = await updateTokensList(rows)

        //寫入後立即 invalidate 30s cache, 避免 admin 改完之 dashboard 顯示舊資料 (audit F-050)
        ocGetTokensList.clear('fun')

        return rows
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
    let updateIpsList = async (rows) => {

        //updateTabItems
        rows = await updateTabItems('ips', rows, 'id', { resetOrder: false })

        return rows
    }


    //checkTokenAndUpdateIpsList
    let checkTokenAndUpdateIpsList = async (token, rows, opt = {}) => {

        //checkToken
        await checkToken(token, opt) //resolve僅回傳true, reject代表無效token或檢測token發生錯誤

        //updateIpsList
        rows = await updateIpsList(rows)

        //寫入後立即 invalidate 30s cache, 避免 admin 改完之 dashboard 顯示舊資料 (audit F-050)
        ocGetIpsList.clear('fun')

        return rows
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
