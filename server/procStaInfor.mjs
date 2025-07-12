import path from 'path'
import fs from 'fs'
import ot from 'dayjs'
import get from 'lodash-es/get.js'
import each from 'lodash-es/each.js'
import map from 'lodash-es/map.js'
import size from 'lodash-es/size.js'
import filter from 'lodash-es/filter.js'
import keys from 'lodash-es/keys.js'
import trim from 'lodash-es/trim.js'
import sumBy from 'lodash-es/sumBy.js'
import mapKeys from 'lodash-es/mapKeys.js'
import cloneDeep from 'lodash-es/cloneDeep.js'
import iseobj from 'wsemi/src/iseobj.mjs'
import isestr from 'wsemi/src/isestr.mjs'
import ispint from 'wsemi/src/ispint.mjs'
import isearr from 'wsemi/src/isearr.mjs'
import ispnum from 'wsemi/src/ispnum.mjs'
import istimemsTZ from 'wsemi/src/istimemsTZ.mjs'
import isfun from 'wsemi/src/isfun.mjs'
import ispm from 'wsemi/src/ispm.mjs'
import cint from 'wsemi/src/cint.mjs'
import sep from 'wsemi/src/sep.mjs'
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
import cache from 'wsemi/src/cache.mjs'
import ds from '../src/schema/index.mjs'
import * as s from '../src/plugins/mShare.mjs'
import staUserAccountLogin from './staLogs/staUserAccountLogin.callWorker.mjs'
import staToken from './staLogs/staToken.callWorker.mjs'
import staIp from './staLogs/staIp.callWorker.mjs'


function proc(woItems, p, opt = {}) {


    //getStaUserSummary
    let getStaUserSummary = async() => {

        //getUsersListCache
        let us = await p.getUsersListCache() //使用快取加速

        //total
        let total = size(us)

        //active
        let active = 0
        if (true) {
            let usActive = filter(us, (u) => {
                return s.getIsActive(u)
            })
            active = size(usActive)
        }

        //blocked
        let blocked = 0
        if (true) {
            let usBlocked = filter(us, (u) => {
                return s.getIsBlocked(u)
            })
            blocked = size(usBlocked)
        }

        //expired
        let expired = 0
        if (true) {
            let usExpired = filter(us, (u) => {
                return s.getIsExpired(u)
            })
            expired = size(usExpired)
        }

        //r
        let r = {
            total, //全部使用者數
            active, //有效使用者數
            blocked, //被封鎖使用者數
            expired, //已過期使用者數
        }

        return r
    }


    //getStaTokenSummary
    let getStaTokenSummary = async() => {

        //tnPre24h, tnAft24h
        let tnPre24h = ot().add(-24, 'hour').format('YYYY-MM-DDTHH:mm:ss.SSSZ')
        let tn = ot().format('YYYY-MM-DDTHH:mm:ss.SSSZ')
        let tnAft24h = ot().add(+24, 'hour').format('YYYY-MM-DDTHH:mm:ss.SSSZ')

        //getTokensListCache
        let ts = await p.getTokensListCache() //使用快取加速

        //total
        let total = size(ts)

        //created24h
        let created24h = 0
        if (true) {
            let tsCreated24h = filter(ts, (t) => {
                return t.timeCreate >= tnPre24h
            })
            created24h = size(tsCreated24h)
        }

        //ending24h
        let ending24h = 0
        if (true) {
            let tsEnding24h = filter(ts, (t) => {
                return (t.timeEnd >= tn) && (t.timeEnd <= tnAft24h)
            })
            ending24h = size(tsEnding24h)
        }

        //ended
        let ended = 0
        if (true) {
            let tsEnded = filter(ts, (t) => {
                return s.getIsEnded(t)
            })
            ended = size(tsEnded)
        }

        //active, 總token數-已過期token數
        let active = total - ended

        //r
        let r = {
            active, //有效 Token 總數
            created24h, //24 小時內最近創建的 Token 數量
            ending24h, //24 小時內即將過期的 Token 數量
            ended, //已過期的 Token 數量
        }

        return r
    }


    //getStaIpSummary
    let getStaIpSummary = async() => {

        //tnPre24h, tnAft24h
        let tnPre24h = ot().add(-24, 'hour').format('YYYY-MM-DDTHH:mm:ss.SSSZ')
        // let tn = ot().format('YYYY-MM-DDTHH:mm:ss.SSSZ')
        // let tnAft24h = ot().add(+24, 'hour').format('YYYY-MM-DDTHH:mm:ss.SSSZ')

        //getIpsListCache
        let oips = await p.getIpsListCache() //使用快取加速

        // //total
        // let total = size(oips)

        //getStaIp
        let sis = await getStaIp()
        // console.log('sis', sis)

        //conn24h
        let conn24h = 0
        if (true) {
            let rsFilterConn24h = filter(sis, (si) => {
                let t = ot(si.time, 'YYYY-MM-DDTHH').format('YYYY-MM-DDTHH:mm:ss.SSSZ')
                return t >= tnPre24h
            })
            // conn24h = size(rsFilterConn24h)
            conn24h = sumBy(rsFilterConn24h, 'data.count')
        }

        //blocked
        let blocked = 0
        if (true) {
            let usBlocked = filter(oips, (oip) => {
                return s.getIsBlocked(oip)
            })
            blocked = size(usBlocked)
        }

        //r
        let r = {
            conn24h, //24 小時內 IP 連線數
            blocked, //目前被封鎖 IP 數
        }

        return r
    }


    //getStaUserAccountLogin
    let _getStaUserAccountLogin = async() => {

        //staUserAccountLogin
        let rs = await staUserAccountLogin()

        return rs
    }
    let ocGetStaUserAccountLogin = cache()
    let getStaUserAccountLogin = async () => {
        let r = await ocGetStaUserAccountLogin.getProxy('fun', { fun: _getStaUserAccountLogin, inputs: null, timeExpired: 30 * 1000 }) //快取30秒
        return r
    }


    //checkTokenAndGetStaUserAccountLogin
    let checkTokenAndGetStaUserAccountLogin = async (token, opt = {}) => {

        //checkToken
        await p.checkToken(token, opt) //resolve僅回傳true, reject代表無效token或檢測token發生錯誤

        //getStaUserAccountLogin
        let rs = await getStaUserAccountLogin()

        return rs
    }


    //getStaToken
    let _getStaToken = async() => {

        //staToken
        let rs = await staToken()

        //kpCount
        let kpCount = {}
        each(rs, (v) => {
            each(v.data, (count, userId) => {
                if (userId === 'count') {
                    return true //跳出換下一個
                }
                kpCount[userId] = 0
            })
        })

        //getUsersListCache
        let us = await p.getUsersListCache() //使用快取加速

        //kpUsername
        let kpUsername = {
            count: 0, //預先給予count為0
        }
        each(us, (u) => {
            kpUsername[u.id] = u.name
        })

        //add username
        rs = map(rs, (v) => {

            //cloneDeep
            let _kpCount = cloneDeep(kpCount)

            //填入對應userId的count
            each(v.data, (count, userId) => {
                _kpCount[userId] = count
            })

            //userId換成username
            _kpCount = mapKeys(_kpCount, (count, userId) => {
                if (userId === 'count') {
                    return userId //若為count直接回傳
                }
                let username = get(kpUsername, userId, userId) //若找不到, 改用userId顯示
                return username
            })

            //vt
            let vt = {
                time: v.time,
                data: {
                    count: v.count,
                    ..._kpCount,
                },
            }

            return vt
        })

        return rs
    }
    let ocGetStaToken = cache()
    let getStaToken = async () => {
        let r = await ocGetStaToken.getProxy('fun', { fun: _getStaToken, inputs: null, timeExpired: 30 * 1000 }) //快取30秒
        return r
    }


    //checkTokenAndGetStaToken
    let checkTokenAndGetStaToken = async (token, opt = {}) => {

        //checkToken
        await p.checkToken(token, opt) //resolve僅回傳true, reject代表無效token或檢測token發生錯誤

        //getStaToken
        let rs = await getStaToken()

        return rs
    }


    //getStaIp
    let _getStaIp = async() => {

        //staIp
        let rs = await staIp()

        //kpCount
        let kpCount = {}
        each(rs, (v) => {
            each(v.data, (count, ip) => {
                if (ip === 'count') {
                    return true //跳出換下一個
                }
                kpCount[ip] = 0
            })
        })

        //擴充ip
        rs = map(rs, (v) => {

            //cloneDeep
            let _kpCount = cloneDeep(kpCount)

            //填入對應ip的count
            each(v.data, (count, ip) => {
                _kpCount[ip] = count
            })

            //vt
            let vt = {
                time: v.time,
                data: {
                    count: v.count,
                    ..._kpCount,
                },
            }

            return vt
        })

        return rs
    }
    let ocGetStaIp = cache()
    let getStaIp = async () => {
        let r = await ocGetStaIp.getProxy('fun', { fun: _getStaIp, inputs: null, timeExpired: 30 * 1000 }) //快取30秒
        return r
    }


    //checkTokenAndGetStaIp
    let checkTokenAndGetStaIp = async (token, opt = {}) => {

        //checkToken
        await p.checkToken(token, opt) //resolve僅回傳true, reject代表無效token或檢測token發生錯誤

        //getStaIp
        let rs = await getStaIp()

        return rs
    }


    //pl
    let pl = {

        getStaUserSummary,
        getStaTokenSummary,
        getStaIpSummary,

        getStaUserAccountLogin,
        checkTokenAndGetStaUserAccountLogin,

        getStaToken,
        checkTokenAndGetStaToken,

        getStaIp,
        checkTokenAndGetStaIp,

    }


    return pl
}


export default proc
