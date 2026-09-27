import get from 'lodash-es/get.js'
import isestr from 'wsemi/src/isestr.mjs'
import iseobj from 'wsemi/src/iseobj.mjs'
import ispm from 'wsemi/src/ispm.mjs'
import httpGetJson from './httpGetJson.mjs'
import maskUrl from './maskUrl.mjs'


//fetchSsoMsg: 三支對外查詢 helper(getUserByToken / getUserByUserId / getUsersByToken)共用之核心, 內部模組, 非對外 API
//K 契約(spec/設計要點與取捨.md ADR-068):
//- 失敗一律 reject 固定 key, 不含網址與權杖(原實作 reject 與 console 皆帶已代入權杖之完整網址, 經呼叫端原樣轉給瀏覽器)
//- 診斷每次失敗印一行 '[w-web-sso] <helper> <key> {...}', 其內不含任何權杖字元:
//  網址印範本(未代入)之 origin + pathname; 錯誤只印 name / code / HTTP status(fetch 錯誤原文可能夾帶完整網址,
//  如 'Failed to parse URL from <url>'); SSO 回之 state / msg 只在 key 形狀時印(非 key 之 msg 可能回顯請求內容)


let reName = /^[A-Za-z]{1,40}$/
let reCode = /^[A-Z][A-Z0-9_]{1,40}$/
let reKey = /^[A-Za-z][A-Za-z0-9]{0,63}$/


//pick: 值符合形狀才保留, 否則為 undefined(JSON.stringify 時略去)
function pick(v, re) {
    return (isestr(v) && re.test(v)) ? v : undefined
}


function logFail(name, key, detail) {
    console.log(`[w-web-sso] ${name} ${key} ${JSON.stringify(detail)}`)
}


//fill: 以 split / join 代入, 值經 encodeURIComponent
//不用 replaceAll: 其取代字串會解讀 $& $` $' 等樣式(請求端可控之權杖含 $` 時會把含介接權杖之網址前綴複製進查詢值);
//不編碼時 + 被解成空白、& 與 = 形成額外參數. encodeURIComponent 對 UUID、英數與 -_.~ 為恆等轉換
function fill(url, kvs) {
    let u = url
    for (let [ph, v] of kvs) {
        u = u.split(ph).join(encodeURIComponent(v))
    }
    return u
}


/**
 * 代入 → 以 GET 打 SSO → 判 state → 驗資料型別, 成功回 SSO 之 msg
 *
 * @param {String} name 輸入 helper 名稱, 供診斷行識別
 * @param {String} url 輸入網址範本(含佔位符)
 * @param {Array} kvs 輸入代入對照陣列, 每元素為 [佔位符, 值]
 * @param {Object} opt 輸入設定物件
 * @param {String} opt.keyRequest 輸入連線失敗或非 2xx 之 reject key
 * @param {String} opt.keyData 輸入 SSO 回 state 非 success(含本體非 JSON)之 reject key
 * @param {String} opt.keyNoData 輸入 SSO 回 success 但資料不符之 reject key
 * @param {Function} opt.isValid 輸入資料型別檢查函數
 * @returns {Promise} 回傳 Promise, resolve 為 SSO 之 msg, reject 為固定 key
 */
async function fetchSsoMsg(name, url, kvs, opt) {
    let { keyRequest, keyData, keyNoData, isValid } = opt

    //urlLog, 範本未代入, 只留 origin + pathname
    let urlLog = maskUrl(url)

    //get
    let res = null
    let errTemp = null
    try {
        res = await httpGetJson(fill(url, kvs))
    }
    catch (err) {
        errTemp = err
    }

    //check, 連線失敗 / 網址無法解析 / 非 2xx
    if (errTemp !== null) {
        logFail(name, keyRequest, {
            url: urlLog,
            errName: pick(get(errTemp, 'name'), reName),
            errCode: pick(get(errTemp, 'cause.code'), reCode) || pick(get(errTemp, 'code'), reCode),
            status: get(errTemp, 'status'),
        })
        return Promise.reject(keyRequest)
    }

    //data
    let data = get(res, 'data')
    let state = get(data, 'state', '')
    let msg = get(data, 'msg')

    //check, SSO 回錯誤(本體非 JSON 時 data 為字串, state 為空)
    if (state !== 'success') {
        logFail(name, keyData, {
            url: urlLog,
            ssoState: pick(state, reKey),
            ssoMsg: pick(msg, reKey),
            bodyType: typeof data,
        })
        return Promise.reject(keyData)
    }

    //check, 資料型別
    if (!isValid(msg)) {
        logFail(name, keyNoData, {
            url: urlLog,
        })
        return Promise.reject(keyNoData)
    }

    return msg
}


/**
 * 以部署端提供之 funConvertUser 轉換單一使用者; 回非物件、同步拋錯或 reject 一律 reject 'noUserDataAfterConvert'
 * (部署端之錯誤原文不外傳, 其診斷屬部署端自身)
 *
 * @param {Function} funConvertUser 輸入轉換函數, 可為 sync 或 async
 * @param {Object} u 輸入使用者物件
 * @returns {Promise} 回傳 Promise, resolve 為轉換後物件, reject 為 'noUserDataAfterConvert'
 */
async function convertUser(funConvertUser, u) {
    let r = null
    try {
        r = funConvertUser(u)
        if (ispm(r)) {
            r = await r
        }
    }
    catch (err) {
        return Promise.reject('noUserDataAfterConvert')
    }
    if (!iseobj(r)) {
        return Promise.reject('noUserDataAfterConvert')
    }
    return r
}


export { fetchSsoMsg, convertUser }
