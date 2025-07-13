import path from 'path'
import fs from 'fs'
import ot from 'dayjs'
import get from 'lodash-es/get.js'
import each from 'lodash-es/each.js'
import map from 'lodash-es/map.js'
import size from 'lodash-es/size.js'
import keys from 'lodash-es/keys.js'
import trim from 'lodash-es/trim.js'
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
import ds from '../src/schema/index.mjs'


function proc(woItems, p, opt = {}) {

    //params
    let {
        minForAccountLoginFailed,
        numForAccountLoginFailed,
        minBlockForAccountLoginFailed,
        minForTokenCallApi,
        numForTokenCallApi,
        minBlockForTokenCallApi,
        minForIpCallApi,
        numForIpCallApi,
        minBlockForIpCallApi,
    } = opt


    //kpAccountLoginFailed
    let kpAccountLoginFailed = {}


    //getBlockedByUser
    let getBlockedByUser = async(u) => {

        //check
        if (!iseobj(u)) {
            return Promise.reject(`invalid u`)
        }

        //timeBlocked
        let timeBlocked = get(u, 'timeBlocked', '')
        // console.log('timeBlocked', timeBlocked)

        //check
        if (istimemsTZ(timeBlocked)) {

            //tn
            let tn = ot().format('YYYY-MM-DDTHH:mm:ss.SSSZ')
            // console.log('tn', tn)
            // console.log('timeBlocked', timeBlocked)
            // console.log('tn < timeBlocked', tn < timeBlocked)

            //check
            if (tn <= timeBlocked) {
                // console.log(u.account, 'block', `tn[${tn}] <= timeBlocked[${timeBlocked}]`)
                return true //當前時間早於封鎖時間, 代表封鎖中
            }
            else {
                // console.log(u.account, 'unblock', `tn[${tn}] > timeBlocked[${timeBlocked}]`)
                return false //當前時間已超過封鎖時間, 代表未封鎖
            }

        }
        else if (timeBlocked === '') {
            return false //未有封鎖時間, 代表未封鎖
        }

        return Promise.reject(`invalid timeBlocked[${timeBlocked}]`)
    }


    //getBlockedByAccount
    let getBlockedByAccount = async(account) => {

        //getGenUserByAccount
        let u = await p.getGenUserByAccount(account)

        // //check, 不用檢測, 若resolve必定有, 若reject則由外部處理
        // if (!iseobj(u)) {
        // }

        //getBlockedByUser
        let b = await getBlockedByUser(u)

        return b
    }


    //blockAccount
    let blockAccount = async (account) => {

        //getGenUserByAccount
        let u = await p.getGenUserByAccount(account)

        // //check, 不用檢測, 若resolve必定有, 若reject則由外部處理
        // if (!iseobj(u)) {
        // }

        //getBlockedByUser
        let b = await getBlockedByUser(u)

        //check
        if (b) {
            return //已封鎖, 禁止重複封鎖
        }

        //timeBlocked, 依照minBlockForAccountLoginFailed(min)更新封鎖時間
        let timeBlocked = ot().add(minBlockForAccountLoginFailed, 'minute').format('YYYY-MM-DDTHH:mm:ss.SSSZ')
        // console.log('timeBlocked', timeBlocked)

        //封鎖使用者, 須更新使用者timeBlocked
        await woItems.users.save({
            id: u.id,
            timeBlocked,
        })

        //getTokenByKV
        let t = await p.getTokenByKV('userId', u.id)

        //封鎖使用者, 須刪除所用token
        await woItems.tokens.del({
            id: t.id,
        })

    }


    //loginByAccountAndPassword
    let loginByAccountAndPassword = async(account, password) => {

        //blocked
        let blocked = await getBlockedByAccount(account)
        // console.log(account, 'blocked', blocked)

        //check
        if (blocked) {
            return Promise.reject(`account blocked`)
        }

        //loginByAccountAndPassword
        let r = null
        await p.loginByAccountAndPassword(account, password)
            .then((u) => {
                // console.log('p.loginByAccountAndPassword then', u)

                //r
                r = {
                    state: 'success',
                    msg: u,
                }

                //清除帳號的登入失敗紀錄
                kpAccountLoginFailed[account] = []

            })
            .catch((err) => {
                // console.log('p.loginByAccountAndPassword catch', err)

                //default
                if (!kpAccountLoginFailed[account]) {
                    kpAccountLoginFailed[account] = []
                }

                //儲存帳號的登入失敗紀錄
                kpAccountLoginFailed[account].push(ot().format('YYYY-MM-DDTHH:mm:ss.SSSZ'))
                // console.log(account, `kpAccountLoginFailed[account]`, kpAccountLoginFailed[account])

                //r
                r = {
                    state: 'error',
                    msg: err,
                }

            })
        // console.log('r', r)

        if (r.state === 'success') {
            return r.msg
        }
        return Promise.reject(r.msg)
    }


    //timer, 限制帳號最大登入失敗(密碼錯誤)次數
    let lockingForAccountLoginFailed = false
    setInterval(async() => {

        //check
        if (lockingForAccountLoginFailed) {
            return
        }
        lockingForAccountLoginFailed = true

        //timeStart
        let timeStart = ot().add(-minForAccountLoginFailed, 'minute').format('YYYY-MM-DDTHH:mm:ss.SSSZ')
        // console.log('timeStart', timeStart)

        //偵測登入失敗紀錄
        await pmSeries(kpAccountLoginFailed, async (times, account) => {

            //recs, 提取指定時間範圍內的紀錄
            let recs = times.filter((timeRec) => {
                return timeRec >= timeStart //ot(t).isAfter(timeStart)
            })
            // console.log(account, 'recs', recs)

            //更新, 僅保留指定時間範圍內的紀錄
            kpAccountLoginFailed[account] = recs

            //nrecs
            let nrecs = size(recs)
            // console.log(account, 'nrecs', nrecs)

            //check
            if (nrecs > numForAccountLoginFailed) {
                // console.log(`account[${account}]: nrecs[${nrecs}] > numForAccountLoginFailed[${numForAccountLoginFailed}]`)

                //blockAccount, 封鎖使用者, 亦會直接刪除使用userId之token
                await blockAccount(account)
                    .catch((err) => {
                        console.log(err)
                    })

            }

        })
            .finally(() => {
                lockingForAccountLoginFailed = false
            })

    }, 2000)


    //kpTokenCallApi
    let kpTokenCallApi = {}


    //blockAccountByToken
    let blockAccountByToken = async (token) => {

        //getTokenByKV
        let t = await p.getTokenByKV('token', token)

        // //check, 不用檢測, 若resolve必定有, 若reject則由外部處理
        // if (!iseobj(t)) {
        // }

        //userId
        let userId = get(t, 'userId', '')

        //check
        if (!isestr(userId)) {
            console.log('token', token)
            console.log('t', t)
            return Promise.reject(`invalid userId`)
        }

        //getGenUserByUserId
        let u = await p.getGenUserByUserId(userId)

        // //check, 不用檢測, 若resolve必定有, 若reject則由外部處理
        // if (!iseobj(u)) {
        // }

        //getBlockedByUser
        let b = await getBlockedByUser(u)

        //check
        if (b) {
            return //已封鎖, 禁止重複封鎖
        }

        //timeBlocked, 依照minBlockForTokenCallApi(min)更新封鎖時間
        let timeBlocked = ot().add(minBlockForTokenCallApi, 'minute').format('YYYY-MM-DDTHH:mm:ss.SSSZ')
        // console.log('timeBlocked', timeBlocked)

        //封鎖使用者, 須更新使用者timeBlocked
        await woItems.users.save({
            id: u.id,
            timeBlocked,
        })

        //封鎖使用者, 須刪除所用token
        await woItems.tokens.del({
            id: t.id,
        })

    }


    //callApiByToken
    let callApiByToken = async(token) => {

        //default
        if (!kpTokenCallApi[token]) {
            kpTokenCallApi[token] = []
        }

        //儲存token的調用API紀錄
        kpTokenCallApi[token].push(ot().format('YYYY-MM-DDTHH:mm:ss.SSSZ'))
        // console.log(token, `kpTokenCallApi[token]`, kpTokenCallApi[token])

    }


    //getInforsByTokenCallApi
    let getInforsByTokenCallApi = async(token) => {
        let rs = get(kpTokenCallApi, token, [])
        return rs
    }


    //getCountsByTokenCallApi
    let getCountsByTokenCallApi = async(token) => {
        let rs = await getInforsByTokenCallApi(token)
        let nrs = size(rs)
        return nrs
    }


    //timer, 限制token最大調用API次數
    let lockingForTokenCallApi = false
    setInterval(async() => {

        //check
        if (lockingForTokenCallApi) {
            return
        }
        lockingForTokenCallApi = true

        //timeStart
        let timeStart = ot().add(-minForTokenCallApi, 'minute').format('YYYY-MM-DDTHH:mm:ss.SSSZ')
        // console.log('timeStart', timeStart)

        //偵測token調用API次數
        await pmSeries(kpTokenCallApi, async (times, token) => {

            //recs, 提取指定時間範圍內的紀錄
            let recs = times.filter((timeRec) => {
                return timeRec >= timeStart //ot(t).isAfter(timeStart)
            })
            // console.log(token, 'recs', recs)

            //更新, 僅保留指定時間範圍內的紀錄
            kpTokenCallApi[token] = recs

            //nrecs
            let nrecs = size(recs)
            // console.log(token, 'nrecs', nrecs)

            //check
            if (nrecs > numForTokenCallApi) {
                // console.log(`token[${token}]: nrecs[${nrecs}] > numForTokenCallApi[${numForTokenCallApi}]`)

                //blockAccountByToken, 沒封鎖token, 是通過封鎖使用者且直接刪除使用userId之token
                await blockAccountByToken(token)
                    .catch((err) => {
                        console.log(err)
                    })

            }

        })
            .finally(() => {
                lockingForTokenCallApi = false
            })

    }, 2000)


    //kpIpCallApi
    let kpIpCallApi = {}


    //getIpByHeaders
    let getIpByHeaders = (req) => {

        //本機local開發階段
        // 請求直接從瀏覽器送到server, 沒有Proxy會沒有x-forwarded-for
        // 須靠 req.socket.remoteAddress 或 req.info.remoteAddress 來取得真實IP, 通常是 127.0.0.1 或 ::1

        //外網直接連入(無Proxy)
        // 例如用ngrok, 公網IP, 或直接暴露port, 請求會直接到達server不會有x-forwarded-for
        // 須靠 req.socket.remoteAddress 取得用戶真實IP, 例如 123.45.xxx.xxx

        //外網經Proxy(如Nginx, Cloudflare, 或其他反向代理)
        // 通常為生產環境, 真實IP會寫入x-forwarded-for
        // 須優先讀x-forwarded-for, 再fallback到remoteAddress

        //headers
        let headers = get(req, 'headers')

        //ip
        let ip = ''

        //x-forwarded-for, 內容為client, proxy1, proxy2,...要取第1個
        if (!isestr(ip)) {
            let c = get(headers, 'x-forwarded-for', '')
            let s = sep(c, ',')
            ip = get(s, 0, '')
            ip = trim(ip)
        }

        //info.remoteAddress
        if (!isestr(ip)) {
            if (req && req.info && req.info.remoteAddress) {
                ip = req.info.remoteAddress
                ip = trim(ip)
            }
        }

        //socket.remoteAddress
        if (!isestr(ip)) {
            if (req && req.socket && req.socket.remoteAddress) {
                ip = req.socket.remoteAddress
                ip = trim(ip)
            }
        }

        //connection.remoteAddress
        if (!isestr(ip)) {
            if (req && req.connection && req.connection.remoteAddress) {
                ip = req.connection.remoteAddress
                ip = trim(ip)
            }
        }

        //logshow
        if (!isestr(ip)) {
            console.log('headers', headers)
            console.log('can not get ip of user')
        }

        return ip
    }


    //getBlockedByOip
    let getBlockedByOip = async(oip) => {

        //check
        if (!iseobj(oip)) {
            return Promise.reject(`invalid oip`)
        }

        //timeBlocked
        let timeBlocked = get(oip, 'timeBlocked', '')
        // console.log('timeBlocked', timeBlocked)

        //check
        if (istimemsTZ(timeBlocked)) {

            //tn
            let tn = ot().format('YYYY-MM-DDTHH:mm:ss.SSSZ')
            // console.log('tn', tn)
            // console.log('timeBlocked', timeBlocked)
            // console.log('tn < timeBlocked', tn < timeBlocked)

            //check
            if (tn <= timeBlocked) {
                // console.log(ip, 'block', `tn[${tn}] <= timeBlocked[${timeBlocked}]`)
                return true //當前時間早於封鎖時間, 代表封鎖中
            }
            else {
                // console.log(ip, 'unblock', `tn[${tn}] > timeBlocked[${timeBlocked}]`)
                return false //當前時間已超過封鎖時間, 代表未封鎖
            }

        }
        else if (timeBlocked === '') {
            return false //未有封鎖時間, 代表未封鎖
        }

        return Promise.reject(`invalid timeBlocked[${timeBlocked}]`)
    }


    //getBlockedByIp
    let getBlockedByIp = async(ip) => {
        let errTemp = null

        //check
        if (!isestr(ip)) {
            return Promise.reject(`invalid ip`)
        }

        //getIpByKV
        let oip = null
        await p.getIpByKV('ip', ip)
            .then((res) => {
                oip = res
            })
            .catch((err) => {
                // console.log(err)
                let m = 'can not find the ip by keyIp[ip]'
                if (err === m) {
                    oip = null
                }
                else {
                    errTemp = m
                }
            })

        //check
        if (errTemp !== null) {
            return Promise.reject(errTemp)
        }

        //check
        if (oip === null) {
            return false //無此ip代表未封鎖, 直接回傳未封鎖狀態
        }

        //getBlockedByOip
        let b = await getBlockedByOip(oip)

        return b
    }


    //blockIpByIp
    let blockIpByIp = async (ip) => {
        let errTemp = null

        //genTimeBlocked
        let genTimeBlocked = () => {
            let timeBlocked = ot().add(minBlockForIpCallApi, 'minute').format('YYYY-MM-DDTHH:mm:ss.SSSZ')
            return timeBlocked
        }

        //getIpByKV
        let oip = null
        await p.getIpByKV('ip', ip)
            .then((res) => {
                oip = res
            })
            .catch((err) => {
                // console.log(err)
                let m = 'can not find the ip by keyIp[ip]'
                if (err === m) {
                    oip = null
                }
                else {
                    errTemp = m
                }
            })

        //check
        if (errTemp !== null) {
            return Promise.reject(errTemp)
        }

        //check
        if (oip === null) {
            //無此ip, 須插入封鎖狀態之oip

            //timeBlocked, 依照minBlockForIpCallApi(min)更新封鎖時間
            let timeBlocked = genTimeBlocked()
            // console.log('timeBlocked', timeBlocked)

            //使用funNew產生oip
            oip = ds.ips.funNew({
                ip,
                timeBlocked,
            })
            // console.log('funNew', oip)

            //insert
            await woItems.ips.insert(oip)
                .catch((err) => {
                    errTemp = err
                })

            //check
            if (errTemp !== null) {
                return Promise.reject(errTemp)
            }

            return //跳出
        }

        //getBlockedByOip
        let b = await getBlockedByOip(oip)

        //check
        if (b) {
            return //已封鎖, 禁止重複封鎖
        }

        //timeBlocked, 依照minBlockForIpCallApi(min)更新封鎖時間
        let timeBlocked = genTimeBlocked()
        // console.log('timeBlocked', timeBlocked)

        //封鎖ip, 須更新ip的timeBlocked
        await woItems.ips.save({
            id: oip.id,
            timeBlocked,
        })

    }


    //callApiByIp
    let callApiByIp = async(ip) => {

        //default
        if (!kpIpCallApi[ip]) {
            kpIpCallApi[ip] = []
        }

        //儲存ip的調用API紀錄
        kpIpCallApi[ip].push(ot().format('YYYY-MM-DDTHH:mm:ss.SSSZ'))
        // console.log(ip, `kpIpCallApi[ip]`, kpIpCallApi[ip])

    }


    //getInforsByIpCallApi
    let getInforsByIpCallApi = async(ip) => {
        let rs = get(kpIpCallApi, ip, [])
        return rs
    }


    //getCountsByIpCallApi
    let getCountsByIpCallApi = async(ip) => {
        let rs = await getInforsByIpCallApi(ip)
        let nrs = size(rs)
        return nrs
    }


    //timer, 偵測新ip出現儲存至ips
    let lockingForIpDetectNew = false
    setInterval(async() => {

        //check
        if (lockingForIpDetectNew) {
            return
        }
        lockingForIpDetectNew = true

        //ips
        let ips = keys(kpIpCallApi)
        // console.log('ips', ips)

        //getIpsList
        let oips = await p.getIpsList()
        // console.log('oips', oips)

        //kpIpOld
        let kpIpOld = {}
        each(oips, (oip) => {
            let ip = oip.ip
            kpIpOld[ip] = true
        })

        //kpIpNew
        let kpIpNew = {}
        each(ips, (ip) => {
            kpIpNew[ip] = true
        })

        //ipsNew
        let ipsNew = []
        each(kpIpNew, (v, ip) => {
            if (!haskey(kpIpOld, ip)) {
                ipsNew.push(ip)
            }
        })
        // console.log('ipsNew', ipsNew)

        //oipsNew
        let oipsNew = map(ipsNew, (ip) => {

            //使用funNew產生oip
            let oip = ds.ips.funNew({
                ip,
            })
            // console.log('funNew', oip)

            return oip
        })
        // console.log('oipsNew', oipsNew)

        //insert
        await woItems.ips.insert(oipsNew)
            .catch((err) => {
                console.log(err) //顯示其他錯誤
            })
            .finally(() => {
                lockingForIpDetectNew = false
            })

    }, 2000)


    //timer, 限制ip最大調用API次數
    let lockingForIpCallApi = false
    setInterval(async() => {

        //check
        if (lockingForIpCallApi) {
            return
        }
        lockingForIpCallApi = true

        //timeStart
        let timeStart = ot().add(-minForIpCallApi, 'minute').format('YYYY-MM-DDTHH:mm:ss.SSSZ')
        // console.log('timeStart', timeStart)

        //偵測ip調用API次數
        await pmSeries(kpIpCallApi, async (times, ip) => {

            //recs, 提取指定時間範圍內的紀錄
            let recs = times.filter((timeRec) => {
                return timeRec >= timeStart //ot(t).isAfter(timeStart)
            })
            // console.log(ip, 'recs', recs)

            //更新, 僅保留指定時間範圍內的紀錄
            kpIpCallApi[ip] = recs

            //nrecs
            let nrecs = size(recs)
            // console.log(ip, 'nrecs', nrecs)

            //check
            if (nrecs > numForIpCallApi) {
                // console.log(`ip[${ip}]: nrecs[${nrecs}] > numForIpCallApi[${numForIpCallApi}]`)

                //blockIpByIp
                await blockIpByIp(ip)
                    .catch((err) => {
                        console.log(err)
                    })

            }

        })
            .catch((err) => {
                console.log(err) //顯示其他錯誤
            })
            .finally(() => {
                lockingForIpCallApi = false
            })

    }, 2000)


    //pp
    let pp = {

        loginByAccountAndPassword,

        // getEndByToken, //等同於p._checkToken(此未提供外部使用), 類似p.checkToken(resolve只回傳true, reject代表無效token與錯誤)
        getBlockedByAccount,
        getBlockedByIp,

        callApiByToken,
        getInforsByTokenCallApi,
        getCountsByTokenCallApi,

        getIpByHeaders,

        callApiByIp,
        getInforsByIpCallApi,
        getCountsByIpCallApi,

    }


    return pp
}


export default proc
