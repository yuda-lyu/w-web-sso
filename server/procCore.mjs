import path from 'path'
import fs from 'fs'
import ot from 'dayjs'
import get from 'lodash-es/get.js'
import each from 'lodash-es/each.js'
import map from 'lodash-es/map.js'
import size from 'lodash-es/size.js'
import keys from 'lodash-es/keys.js'
import filter from 'lodash-es/filter.js'
import iseobj from 'wsemi/src/iseobj.mjs'
import isestr from 'wsemi/src/isestr.mjs'
import ispint from 'wsemi/src/ispint.mjs'
import isearr from 'wsemi/src/isearr.mjs'
import ispnum from 'wsemi/src/ispnum.mjs'
import isbol from 'wsemi/src/isbol.mjs'
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
import waitFun from 'wsemi/src/waitFun.mjs'
import delay from 'wsemi/src/delay.mjs'
import cache from 'wsemi/src/cache.mjs'
import ds from '../src/schema/index.mjs'
import * as s from '../src/plugins/mShare.mjs'
import hashPassword from './hashPassword.mjs'


function proc(woItems, procOrm, { srLog, salt, minExpired }) {


    //_getGenUserByKV
    let _getGenUserByKV = async(keyUser, valueUser, opt = {}) => {
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
            console.log(`can not find the user by ${keyUser}`)
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
    let getGenUserByKV = async(keyUser, valueUser) => {

        //u
        let u = await _getGenUserByKV(keyUser, valueUser)

        return u
    }


    //getGenUserByUserId
    let getGenUserByUserId = async(userId, opt = {}) => {

        //u
        let u = await getGenUserByKV('id', userId, opt)

        // //check, 不用檢測, 若resolve必定有u, 若reject則由外部處理
        // if (!iseobj(u)) {
        //     return null
        // }

        return u
    }


    //getGenUserByAccount
    let getGenUserByAccount = async(account, opt = {}) => {

        //u
        let u = await getGenUserByKV('account', account, opt)

        // //check, 不用檢測, 若resolve必定有u, 若reject則由外部處理
        // if (!iseobj(u)) {
        //     return null
        // }

        return u
    }


    //getTokenByKV
    let getTokenByKV = async(keyToken, valueToken) => {
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
            console.log('keyToken', keyToken)
            console.log('valueToken', valueToken)
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
            console.log('keyToken', keyToken)
            console.log('valueToken', valueToken)
            console.log(`duplicate token by keyToken[${keyToken}]`)
            return Promise.reject(`duplicate token by keyToken[${keyToken}]`)
        }

        //t
        let t = ts[0] //get(ts, 0, null) 前面已檢測故一定有[0]
        // console.log('t', t)

        return t
    }


    //getIpByKV
    let getIpByKV = async(keyIp, valueIp) => {
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
    let loginByAccountAndPassword = async(account, password) => {

        //hashPassword
        let passwordTest = hashPassword(password, salt)
        // console.log('password', password, 'salt', salt)
        // console.log('passwordTest', passwordTest)

        //getGenUserByAccount
        let u = await _getGenUserByKV('account', account, { deletePassword: false }) //不能使用getGenUserByAccount, 會刪除密碼無法比對
        // console.log('u', u)

        // //check, 不用檢測, 若resolve必定有u, 若reject則由外部處理
        // if (!iseobj(u)) {
        //     console.log(`account`, account)
        //     console.log(`can not find the user from account`)
        //     return Promise.reject(`can not find the user from account`)
        // }

        //passwordTrue
        let passwordTrue = get(u, 'password', '')
        // console.log('passwordTrue', passwordTrue)

        //check
        if (passwordTest !== passwordTrue) {
            return Promise.reject(`incorrect user account or password`)
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
            console.log(`token`, token)
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
            console.log(`tk`, tk)
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
        let tks = await woItems.tokens.select({ token })
        //console.log(`...tokens.select`)
        // console.log('tks', tks)

        //ntks
        let ntks = size(tks)

        //check
        if (ntks === 0) {
            console.log(`token`, token)
            console.log(`invalid token`)
            return Promise.reject(`invalid token`)
        }

        //check
        if (ntks >= 2) {
            console.log(`token`, token)
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
        srLog.info({ event: 'fun-checkToken', token, userId, res: b })

        //logshow
        if (!b) {
            console.log(`block token[${token}]`) //[tag:測試:顯示被封鎖token]
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
                    errTemp = 'token expired'
                }
            })
            .catch((err) => {
                errTemp = err
            })

        //check
        if (errTemp !== null) {
            return Promise.reject(errTemp)
        }

        return true //resolve只回傳true, reject代表無效tk.token與錯誤
    }


    //checkToken
    let checkToken = async (token, opt = {}) => {
        let errTemp = null

        //_checkToken
        await _checkToken(token, opt)
            .then((res) => {
                if (res === false) {
                    errTemp = 'token expired'
                }
            })
            .catch((err) => {
                errTemp = err
            })

        //check
        if (errTemp !== null) {
            return Promise.reject(errTemp)
        }

        return true //resolve只回傳true, reject代表無效token與錯誤
    }


    //refreshToken
    let refreshToken = async (token) => {
        let errTemp = null

        //tks
        let tks = await woItems.tokens.select({ token })
        //console.log(`...tokens.select`)

        //ntks
        let ntks = size(tks)

        //check
        if (ntks === 0) {
            console.log(`token`, token)
            console.log(`invalid token`)
            return Promise.reject(`invalid token`)
        }

        //check
        if (ntks >= 2) {
            console.log(`token`, token)
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
            console.log(`token`, token)
            console.log(`timeEnd`, timeEnd)
            console.log(`invalid timeEnd`)
            return Promise.reject(`invalid timeEnd`)
        }

        //tn
        let tn = ot().format('YYYY-MM-DDTHH:mm:ss.SSSZ')

        //check
        if (tn >= timeEnd) { //現在時間>=到期時間, 代表已到期, 禁止更新token
            console.log(`token`, token)
            console.log(`tn`, tn)
            console.log(`timeEnd`, timeEnd)
            console.log(`token expired`)
            return Promise.reject(`token expired`)
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
            console.log(`token`, token)
            console.log(`can not update timeEnd for token`)
            return Promise.reject(`can not update timeEnd for token`)
        }

        return timeEndNew
    }


    //logoutByToken
    let logoutByToken = async(token) => {
        let errTemp = null

        //tks
        let tks = await woItems.tokens.select({ token })
        //console.log(`...tokens.select`)

        //ntks
        let ntks = size(tks)

        //check
        if (ntks === 0) {
            console.log(`token`, token)
            console.log(`invalid token`)
            return Promise.reject(`invalid token`)
        }

        //check
        if (ntks >= 2) {
            console.log(`token`, token)
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
            console.log(`token`, token)
            console.log(`failed to delete token`)
            return Promise.reject(`failed to delete token`)
        }

        //check
        r = get(r, '0.nDeleted', 0)
        if (r !== 1) {
            console.log(`token`, token)
            console.log(`can not delete the token`)
            return Promise.reject(`can not delete the token`)
        }

        //info
        srLog.info({ event: 'fun-logout', token, userId })

        return true
    }


    //createUser
    let createUser = async () => {
    //bbb 待開發createUser
    }


    //modifyUser
    let modifyUser = async () => {
    //bbb 待開發 modifyUser
    }


    //deleteUser
    let deleteUser = async () => {
    //bbb 待開發 deleteUser
    }


    //emailUser
    let emailUser = async () => {
    //bbb 待開發 emailUser
    }


    //updateTabItems
    let updateTabItems = async (woName, rows, keyDetect, opt = {}) => {
        // console.log('updateTabItems', woName, rows.length, keyDetect)

        //resetOrder
        let resetOrder = get(opt, 'resetOrder')
        if (!isbol(resetOrder)) {
            resetOrder = false
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
        let ltdtNew = rows
        let r = ltdtDiffByKey(ltdtOld, ltdtNew, keyDetect)
        // console.log('ltdtDiffByKey r', r)

        //del
        if (size(r.del) > 0) {
            await procOrm('', woName, 'del', r.del) //須使用procOrm才有辦法自動給予相關欄位, 且不使用外部給予userId
            // .catch((err) => {
            //     console.log('woItems[woName].del err', err)
            // })
        }

        //add
        if (size(r.add) > 0) {
            await procOrm('', woName, 'insert', r.add) //須使用procOrm才有辦法自動給予相關欄位, 且不使用外部給予userId
            // .catch((err) => {
            //     console.log('woItems[woName].insert err', err)
            // })
        }

        //diff
        if (size(r.diff) > 0) {
            await procOrm('', woName, 'save', r.diff) //須使用procOrm才有辦法自動給予相關欄位, 且不使用外部給予userId
            // .catch((err) => {
            //     console.log('woItems[woName].save err', err)
            // })
        }

        return ltdtNew
    }


    //getUserByToken
    let getUserByToken = async(token) => {

        //tks
        let tks = await woItems.tokens.select({ token })
        //console.log(`...tokens.select`)

        //ntks
        let ntks = size(tks)

        //check
        if (ntks === 0) {
            console.log(`token`, token)
            console.log(`invalid token`)
            return Promise.reject(`invalid token`)
        }

        //check
        if (ntks >= 2) {
            console.log(`token`, token)
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
                console.log(`tk`, tk)
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
        }

        return uu
    }


    //checkTokenAndGetUserByToken
    let checkTokenAndGetUserByToken = async(tokenSelf, tokenTarget, opt = {}) => {

        //checkToken
        await checkToken(tokenSelf, opt) //resolve僅回傳true, reject代表無效token或檢測token發生錯誤

        //getUserByToken
        let u = await getUserByToken(tokenTarget)

        return u
    }


    //getUserInfor
    let getUserInfor = async (key, value, opt = {}) => {

        //u
        let u = await getGenUserByKV(key, value, opt)

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
    let updateUsersList = async (rows) => {

        //updateTabItems
        rows = await updateTabItems('users', rows, 'id', { resetOrder: true })

        return rows
    }


    //checkTokenAndUpdateUsersList
    let checkTokenAndUpdateUsersList = async (token, rows, opt = {}) => {

        //checkToken
        await checkToken(token, opt) //resolve僅回傳true, reject代表無效token或檢測token發生錯誤

        //updateUsersList
        rows = await updateUsersList(rows)

        return rows
    }


    // //cleanTokens
    // let cleanTokens = async (opt = {}) => {

    //     //tks
    //     let tks = await woItems.tokens.select()
    //     //console.log(`...tokens.select`)
    //     // console.log('tks', tks)

    //     //tksDels
    //     let tksDels = []
    //     await pmSeries(tks, async (tk) => {

    //         //checkTokenByObj
    //         let errTemp = null
    //         await checkTokenByObj(tk, opt)
    //             .catch((err) => {
    //                 // console.log('checkTokenByObj catch', err)
    //                 errTemp = err
    //             })

    //         //check
    //         if (errTemp) {
    //             tksDels.push(tk)
    //         }

    //     })

    //     //check
    //     if (size(tksDels) > 0) {
    //         // console.log('tksDels', tksDels)

    //         await pmSeries(tksDels, async (tk) => {

    //             //del
    //             await woItems.tokens.del({ id: tk.id })
    //                 .catch((err) => {
    //                     console.log('tokens.del catch', err)
    //                 })

    //         })

    //     }

    // }


    //getTokensList
    let getTokensList = async () => {

        //select
        let ts = await woItems.tokens.select()
        //console.log(`...tokens.select`)

        // //needNoEnd
        // if (needNoEnd) {

        //     //tn
        //     let tn = ot().format('YYYY-MM-DDTHH:mm:ss.SSSZ')
        //     // console.log('tn', tn)

        //     //filter
        //     ts = filter(ts, (v) => {
        //         return v.timeEnd >= tn //tn<=到期時間, 代表有效
        //     })

        // }

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


    //cleanUsers
    let cleanUsers = async() => {

        //getUsersList
        let us = await getUsersList({})

        //clean
        await pmSeries(us, async(u) => {

            //b
            let b1 = !s.getIsBlocked(u) //未封鎖
            let b2 = isestr(u.timeBlocked) //有值
            let b = b1 && b2

            //check
            if (!b) {
                return
            }

            //清除timeBlocked
            await woItems.users.save({
                id: u.id,
                timeBlocked: '',
            })

        })

    }


    //timer, 清理user的timeBlocked
    let lockingForCleanUsers = false
    setInterval(async() => {

        //check
        if (lockingForCleanUsers) {
            return
        }
        lockingForCleanUsers = true

        //cleanUsers
        await cleanUsers()
            .finally(() => {
                lockingForCleanUsers = false
            })

    }, 2000)


    //cleanIps
    let cleanIps = async() => {

        //getIpsList
        let oips = await getIpsList({})

        //clean
        await pmSeries(oips, async(oip) => {

            //b
            let b1 = !s.getIsBlocked(oip) //未封鎖
            let b2 = isestr(oip.timeBlocked) //有值
            let b = b1 && b2

            //check
            if (!b) {
                return
            }

            //清除timeBlocked
            await woItems.ips.save({
                id: oip.id,
                timeBlocked: '',
            })

        })

    }


    //timer, 清理ip的timeBlocked
    let lockingForCleanIps = false
    setInterval(async() => {

        //check
        if (lockingForCleanIps) {
            return
        }
        lockingForCleanIps = true

        //cleanIps
        await cleanIps()
            .finally(() => {
                lockingForCleanIps = false
            })

    }, 2000)


    //p
    let p = {

        getTokenByKV,

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
