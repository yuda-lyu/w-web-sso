import ot from 'dayjs'
import get from 'lodash-es/get.js'
import each from 'lodash-es/each.js'
import map from 'lodash-es/map.js'
import size from 'lodash-es/size.js'
import filter from 'lodash-es/filter.js'
import sumBy from 'lodash-es/sumBy.js'
import mapKeys from 'lodash-es/mapKeys.js'
import cache from 'wsemi/src/cache.mjs'
import isestr from 'wsemi/src/isestr.mjs'
import * as s from '../src/plugins/mShare.mjs'
import { getAppUsage, getAppId, keyAppUsageRetired } from '../src/appUsage.mjs'
import staUserAccountLogin from './staLogs/staUserAccountLogin.callWorker.mjs'
import staToken from './staLogs/staToken.callWorker.mjs'
import staIp from './staLogs/staIp.callWorker.mjs'


function proc(woItems, p, opt = {}) {

    //params
    let {
        srLog,
        logFd, //D43: 承接設定之 logFd, 傳給 staLogs worker 之 fdLog(取代其硬寫預設 './logs')
    } = opt


    // 30s cache: admin 寫入後由 procCore.mjs updateUsersList/updateTokensList/updateIpsList 之 ocGetXxxList.clear() 即時 invalidate (audit F-050); 對 admin 操作 dashboard 立刻同步, 對外部讀取仍享 cache 加速.
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


    //checkTokenAndGetStaUserSummary
    let checkTokenAndGetStaUserSummary = async (token, opt = {}) => {

        //checkToken
        await p.checkToken(token, opt) //resolve僅回傳true, reject代表無效token或檢測token發生錯誤

        //getStaUserSummary
        let rs = await getStaUserSummary()

        return rs
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
                if (t.isApp === 'y') {
                    return false //應用系統金鑰不給期限(ADR-095), 不計入即將到期
                }
                return (t.timeEnd >= tn) && (t.timeEnd <= tnAft24h)
            })
            ending24h = size(tsEnding24h)
        }

        //ended
        let ended = 0
        if (true) {
            let tsEnded = filter(ts, (t) => {
                if (t.isApp === 'y') {
                    //應用系統金鑰不給期限(ADR-095), 不計入已到期(既有列之 timeEnd 已不生效); 惟升級前即不可用之舊列(retired)已失效, 計入已到期而不計入有效 (ADR-095 補記)
                    return getAppUsage(t) === keyAppUsageRetired
                }
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


    //checkTokenAndGetStaTokenSummary
    let checkTokenAndGetStaTokenSummary = async (token, opt = {}) => {

        //checkToken
        await p.checkToken(token, opt) //resolve僅回傳true, reject代表無效token或檢測token發生錯誤

        //getStaTokenSummary
        let rs = await getStaTokenSummary()

        return rs
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


    // caller 端透過 opt.fun = funCheckAdmin 強制 admin 驗證, app token 則依 opt.perm = 'readStats'(ADR-069); 詳 WWebSso.mjs 之 kpfun getSta* 六支
    //checkTokenAndGetStaIpSummary
    let checkTokenAndGetStaIpSummary = async (token, opt = {}) => {

        //checkToken
        await p.checkToken(token, opt) //resolve僅回傳true, reject代表無效token或檢測token發生錯誤

        //getStaIpSummary
        let rs = await getStaIpSummary()

        return rs
    }


    //getStaUserAccountLogin
    let _getStaUserAccountLogin = async() => {

        //staUserAccountLogin
        let rs = await staUserAccountLogin(7, 'hr', { fdLog: logFd, srLog })

        return rs
    }
    //wsemi ≥1.8.81 cache: 執行中共用 in-flight promise (併發不再輪詢等待); timeFrom:'end' 使 30 秒自掃描完成起算;
    //useCacheWhenError:false 失敗不快取且拋錯 (取代原「偵測 undefined」ADR-045 與呼叫端 single-flight ADR-051)
    let ocGetStaUserAccountLogin = cache()
    let getStaUserAccountLogin = async () => {
        let r = await ocGetStaUserAccountLogin.getProxy('fun', { fun: _getStaUserAccountLogin, inputs: null, timeExpired: 30 * 1000, timeFrom: 'end', useCacheWhenError: false }) //快取30秒
            .catch((err) => {
                if (srLog) {
                    srLog.error({ event: 'fun-getStaUserAccountLogin', key: 'getStaDataFailed', err: String(get(err, 'message', err)) })
                }
                return Promise.reject('getStaDataFailed')
            })
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
        let rs = await staToken(7, 'hr', { fdLog: logFd, srLog })

        //kpCount, 鍵為 log 之 userId (R-KEY-01: 無原型; R-OBJ-ITER-01: v.data 依自有鍵走訪, userId 為 length 時不致被當陣列樣迭代)
        let kpCount = Object.create(null)
        each(rs, (v) => {
            for (let userId of Object.keys(v.data)) {
                if (userId === 'count') {
                    continue //保留字(該桶總筆數), 換下一個
                }
                kpCount[userId] = 0
            }
        })

        //getUsersListCache
        let us = await p.getUsersListCache() //使用快取加速

        //kpUsername
        let kpUsername = Object.create(null)
        kpUsername.count = 0 //預先給予count為0
        each(us, (u) => {
            kpUsername[u.id] = u.name
        })

        //系統服務用途之應用系統金鑰: log 之 userId 為其應用系統身分 app:<金鑰主鍵> (ADR-095, 外審 sol#11), 顯示金鑰名稱; 無名稱(升級前既有列)沿用身分字串
        let ts = await p.getTokensListCache() //使用快取加速
        each(ts, (t) => {
            if (get(t, 'isApp', '') === 'y' && getAppUsage(t) === 'system') {
                let name = get(t, 'appName', '')
                kpUsername[getAppId(t)] = isestr(name) ? name : getAppId(t)
            }
        })

        //add username
        rs = map(rs, (v) => {

            //複製(補零之全桶鍵集合)
            let _kpCount = Object.assign(Object.create(null), kpCount)

            //填入對應userId的count
            for (let userId of Object.keys(v.data)) {
                if (userId === 'count') {
                    continue
                }
                _kpCount[userId] = v.data[userId]
            }

            //userId換成username
            _kpCount = mapKeys(_kpCount, (count, userId) => {
                let username = kpUsername[userId] //自有鍵查值, 不把 userId 當 lodash 路徑 (R-KEY-01)
                if (username === undefined) {
                    username = userId //若找不到, 改用userId顯示
                }
                return username
            })

            //vt, count 為該桶總筆數(保留字), 使用者名稱恰為 count 者不覆寫之
            let vt = {
                time: v.time,
                data: {
                    count: v.data.count,
                    ..._kpCount,
                },
            }
            vt.data.count = v.data.count

            return vt
        })

        return rs
    }
    let ocGetStaToken = cache()
    let getStaToken = async () => {
        //cache 選項同 getStaUserAccountLogin
        let r = await ocGetStaToken.getProxy('fun', { fun: _getStaToken, inputs: null, timeExpired: 30 * 1000, timeFrom: 'end', useCacheWhenError: false }) //快取30秒
            .catch((err) => {
                if (srLog) {
                    srLog.error({ event: 'fun-getStaToken', key: 'getStaDataFailed', err: String(get(err, 'message', err)) })
                }
                return Promise.reject('getStaDataFailed')
            })
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
        let rs = await staIp(7, 'hr', { fdLog: logFd, srLog })

        //kpCount, 鍵為 log 之 ip (取自 X-Forwarded-For 標頭, 使用端可植入任意字串; R-KEY-01: 無原型; R-OBJ-ITER-01: v.data 依自有鍵走訪, ip 為 length 時不致被當陣列樣迭代)
        let kpCount = Object.create(null)
        each(rs, (v) => {
            for (let ip of Object.keys(v.data)) {
                if (ip === 'count') {
                    continue //保留字(該桶總筆數), 換下一個
                }
                kpCount[ip] = 0
            }
        })

        //擴充ip
        rs = map(rs, (v) => {

            //複製(補零之全桶鍵集合)
            let _kpCount = Object.assign(Object.create(null), kpCount)

            //填入對應ip的count
            for (let ip of Object.keys(v.data)) {
                if (ip === 'count') {
                    continue
                }
                _kpCount[ip] = v.data[ip]
            }

            //vt, count 為該桶總筆數(保留字)
            let vt = {
                time: v.time,
                data: {
                    count: v.data.count,
                    ..._kpCount,
                },
            }
            vt.data.count = v.data.count

            return vt
        })

        return rs
    }
    let ocGetStaIp = cache()
    let getStaIp = async () => {
        //cache 選項同 getStaUserAccountLogin; getStaIpSummary 內部亦呼叫 getStaIp, 與前端直呼者共用 wsemi 之 in-flight promise
        let r = await ocGetStaIp.getProxy('fun', { fun: _getStaIp, inputs: null, timeExpired: 30 * 1000, timeFrom: 'end', useCacheWhenError: false }) //快取30秒
            .catch((err) => {
                if (srLog) {
                    srLog.error({ event: 'fun-getStaIp', key: 'getStaDataFailed', err: String(get(err, 'message', err)) })
                }
                return Promise.reject('getStaDataFailed')
            })
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
        checkTokenAndGetStaUserSummary,

        getStaTokenSummary,
        checkTokenAndGetStaTokenSummary,

        getStaIpSummary,
        checkTokenAndGetStaIpSummary,

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
