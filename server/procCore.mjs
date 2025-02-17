import path from 'path'
import fs from 'fs'
import ot from 'dayjs'
import get from 'lodash-es/get.js'
import each from 'lodash-es/each.js'
import map from 'lodash-es/map.js'
import size from 'lodash-es/size.js'
import keys from 'lodash-es/keys.js'
import iseobj from 'wsemi/src/iseobj.mjs'
import isestr from 'wsemi/src/isestr.mjs'
import ispint from 'wsemi/src/ispint.mjs'
import isearr from 'wsemi/src/isearr.mjs'
import ispnum from 'wsemi/src/ispnum.mjs'
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
import ds from '../src/schema/index.mjs'
import hashPassword from './hashPassword.mjs'


function proc(woItems, procOrm, { salt, timeExpired }) {


    //getGenUserByKV
    let getGenUserByKV = async(keyUser, valueUser) => {

        //us
        let us = await woItems.users.select({ [keyUser]: valueUser, isActive: 'y' })

        //u
        let u = get(us, 0, null)

        //check
        if (!iseobj(u)) {
            return null
        }

        return u
    }


    //getGenUserByUserId
    let getGenUserByUserId = async(userId) => {

        //u
        let u = await getGenUserByKV('id', userId)

        //check
        if (!iseobj(u)) {
            return null
        }

        return u
    }


    //getGenUserByAccount
    let getGenUserByAccount = async(account) => {

        //u
        let u = await getGenUserByKV('account', account)

        //check
        if (!iseobj(u)) {
            return null
        }

        return u
    }


    //loginByAccountAndPassword
    let loginByAccountAndPassword = async(account, password) => {

        //hashPassword
        let passwordTest = hashPassword(password, salt)
        // console.log('password', password, 'salt', salt)
        // console.log('passwordTest', passwordTest)

        //getGenUserByAccount
        let u = await getGenUserByAccount(account)
        // console.log('u', u)

        //check
        if (!iseobj(u)) {
            console.log(`account`, account)
            console.log(`can not find the user from account`)
            return Promise.reject(`can not find the user from account`)
        }

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

        //bbb 待加入創建usersRecs儲存使用者登入資訊與紀錄

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

        //t
        let t = ds.tokens.funNew({
            userId,
        })
        // console.log('funNew', t)

        //timeEnd, 依照timeExpired(min)更新到期時間
        t.timeEnd = ot().add(timeExpired, 'minute').format('YYYY-MM-DDTHH:mm:ss.SSSZ')
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
            console.log(`Can not create a token from userId`)
            return Promise.reject(`Can not create a token from userId`)
        }

        return token
    }


    //checkTokenCore
    let checkTokenCore = async (tk) => {

        //timeEnd
        let timeEnd = get(tk, 'timeEnd', '')

        //tt
        let tt = ot(timeEnd, 'YYYY-MM-DDTHH:mm:ss.SSSZ')
        // console.log('tt', tt)

        //tn
        let tn = ot()

        //dmin
        let dmin = tt.diff(tn, 'minutes')
        // console.log('dmin', dmin)

        //check
        if (dmin > timeExpired) {
            console.log(`tk`, tk)
            console.log(`dmin`, dmin, `timeExpired`, timeExpired)
            console.log(`token expired`)
            return Promise.reject(`token expired`)
        }

        return true
    }


    //checkToken
    let checkToken = async (token) => {

        //tks
        let tks = await woItems.tokens.select({ token })

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

        //checkTokenCore
        await checkTokenCore(tk)

        return true
    }


    //refreshToken
    let refreshToken = async (token) => {
        let errTemp = null

        //tks
        let tks = await woItems.tokens.select({ token })

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

        //tt
        let tt = ot(timeEnd, 'YYYY-MM-DDTHH:mm:ss.SSSZ')
        // console.log('tt', tt)

        //tn
        let tn = ot()

        //dmin
        let dmin = tt.diff(tn, 'minutes')
        // console.log('dmin', dmin)

        //check
        if (dmin > timeExpired) {
            console.log(`token`, token)
            console.log(`dmin`, dmin, `timeExpired`, timeExpired)
            console.log(`token expired`)
            return Promise.reject(`token expired`)
        }

        //timeEndNew
        let timeEndNew = tn.format('YYYY-MM-DDTHH:mm:ss.SSSZ')
        // console.log('timeEndNew', timeEndNew)

        //save
        await woItems.tokens.save({
            id: tk.id,
            timeEnd: timeEndNew,
        })
            .catch((err) => {
                errTemp = err
            })

        //check
        if (errTemp) {
            console.log(errTemp)
            console.log(`token`, token)
            console.log(`Can not update time for token`)
            return Promise.reject(`Can not update time for token`)
        }

        return true
    }


    //getUserByToken
    let getUserByToken = async(token) => {
        let errTemp = null

        //tks
        let tks = await woItems.tokens.select({ token })

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

        //us
        let us = await woItems.users.select({ id: userId, isActive: 'y' })
            .catch((err) => {
                errTemp = err
            })

        //check
        if (errTemp) {
            console.log(errTemp)
            console.log(`userId`, userId)
            console.log(`Failed to find user`)
            return Promise.reject(`Failed to find user`)
        }

        //nus
        let nus = size(us)

        //check
        if (nus === 0) {
            console.log(`userId`, userId)
            console.log(`can not find the user by userId`)
            return Promise.reject(`can not find the user by userId`)
        }

        //check
        if (nus >= 2) {
            console.log(`userId`, userId)
            console.log(`duplicate userId`)
            return Promise.reject(`duplicate userId`)
        }

        //u
        let u = get(us, 0, '')
        // console.log('u', u)

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
            token,
        }

        return r
    }


    //logOutByToken
    let logOutByToken = async(token) => {
        let errTemp = null

        //tks
        let tks = await woItems.tokens.select({ token })

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
        let userId = get(tk, 'userId', '') //bbb 先保留userId供後續功能使用
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
            console.log(`Failed to delete token`)
            return Promise.reject(`Failed to delete token`)
        }

        //check
        r = get(r, '0.nDeleted', 0)
        if (r !== 1) {
            console.log(`token`, token)
            console.log(`Can not delete the token`)
            return Promise.reject(`Can not delete the token`)
        }

        //bbb 待加入創建usersRecs儲存使用者登出紀錄

        //bbb 待加入通知程序(訂閱者,監聽器)之使用者登出訊息

        return true
    }


    //cleanTokens
    let cleanTokens = async () => {

        //tks
        let tks = await woItems.tokens.select()
        // console.log('tks', tks)

        //tksDels
        let tksDels = []
        await pmSeries(tks, async (tk) => {

            //checkTokenCore
            let errTemp = null
            await checkTokenCore(tk)
                .catch((err) => {
                    errTemp = err
                })

            //check
            if (errTemp) {
                tksDels.push(tk)
            }

        })

        //check
        if (size(tksDels) > 0) {

            await pmSeries(tks, async (tk) => {

                //del
                await woItems.tokens.del({ id: tk.id })
                    .catch(() => { })

                //bbb 待加入創建usersRecs儲存使用者登出紀錄

                //bbb 待加入通知程序(訂閱者,監聽器)之使用者登出訊息

            })

        }

    }


    //createUser
    let createUser = async () => {
    //bbb 待開發createUser
    }


    //ModifyUser
    let ModifyUser = async () => {
    //bbb 待開發ModifyUser
    }


    //DeleteUser
    let DeleteUser = async () => {
    //bbb 待開發DeleteUser
    }


    //AuthUser
    let AuthUser = async () => {
    //bbb 待開發AuthUser
    }


    //EmailUser
    let EmailUser = async () => {
    //bbb 待開發 EmailUser
    }


    //updateTabItems
    let updateTabItems = async (woName, rows, keyDetect) => {
        // console.log('updateTabItems', woName, rows.length, keyDetect)

        //ltdtmapping
        rows = ltdtmapping(rows, ds[woName].keys)
        // console.log('ltdtmapping rows', rows)

        //重給order
        rows = map(rows, (r, k) => {
            r.order = k + 1
            return r
        })

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


    //getUsersList
    let getUsersList = async (token, needActive = false) => {

        //checkToken
        await checkToken(token)

        //opt
        let opt = {}
        if (needActive) {
            opt = { isActive: 'y' }
        }

        //select
        let us = await woItems.users.select(opt)

        //us
        us = map(us, (v, k) => {
            delete v.password
            return v
        })

        return us
    }


    //getActiveUsersList
    let getActiveUsersList = async (token) => {
        let us = await getUsersList(token, true)
        return us
    }


    //updateUsersList
    let updateUsersList = async (token, rows) => {

        //checkToken
        await checkToken(token)

        //updateTabItems
        rows = await updateTabItems('users', rows, 'id')

        return rows
    }


    //getUserInfor
    let getUserInfor = async (token, key, value) => {

        //checkToken
        await checkToken(token)

        //select
        let us = await woItems.users.select({ [key]: value, isActive: 'y' }) //僅提供isActive為y

        //u
        let u = get(us, 0, {})

        //check
        if (!iseobj(u)) {
            console.log(`token`, token)
            console.log(`key`, key, `value`, value)
            console.log(`Can not find user`)
            return Promise.reject(`Can not find user`)
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
            token,
        }

        return r
    }


    //p
    let p = {
        loginByAccountAndPassword,
        checkToken,
        refreshToken,
        getUserByToken,
        logOutByToken,
        cleanTokens,
        createUser,
        ModifyUser,
        DeleteUser,
        AuthUser,
        EmailUser,
        getUserInfor,
        getUsersList,
        getActiveUsersList,
        updateUsersList,
    }


    return p
}


export default proc
