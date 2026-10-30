import get from 'lodash-es/get.js'
import isestr from 'wsemi/src/isestr.mjs'
import isarr from 'wsemi/src/isarr.mjs'
import ispint from 'wsemi/src/ispint.mjs'
import cint from 'wsemi/src/cint.mjs'
import WSyslog from 'w-syslog/src/WSyslog.mjs'
import maskUrl from '../src/maskUrl.mjs'


let init = (opt = {}) => {

    let fdLog = get(opt, 'logFd', '')
    if (!isestr(fdLog)) {
        fdLog = './logs'
    }

    let interval = get(opt, 'logInterval', '')
    if (!isestr(interval)) {
        interval = 'hr'
    }

    //numKeep, settings 之 logNumKeep (opt-in): 未給採 w-syslog 預設 (hr: 365*24, day: 365), 有給但非正整數視為設定錯誤
    let numKeep = get(opt, 'logNumKeep', null)
    let o = { fdLog, interval }
    if (numKeep !== null && numKeep !== undefined && numKeep !== '') {
        if (!ispint(numKeep)) {
            throw new Error(`invalid logNumKeep[${numKeep}], must be positive integer`)
        }
        o.numKeep = cint(numKeep)
    }

    let srLog = WSyslog(o)
    // srLog.info({ event: 'runner', msg: 'start' })
    // srLog.warn({ event: 'monitor-memory', msg: 'usage-high', ratio: 85.4 })
    // srLog.error({ event: 'crash', msg: 'db connection', code: 500 })

    return srLog
}


//safeText: 字串中之控制字元(< 32、127)換成 '?', 避免請求端以 CR/LF 等自填 log 行 (maskToken 與其他寫入使用端字串之 log 共用)
export function safeText(s) {
    return Array.from(s, (c) => {
        let x = c.charCodeAt(0)
        return (x < 32 || x === 127) ? '?' : c
    }).join('')
}


//maskToken: 權杖寫入 log 前之遮罩(M 契約, spec/設計要點與取捨.md ADR-068; perm / api / task 之 maskTok 以同一組測資守護)
//- 陣列逐元素遮罩: Hapi 對重複之 query 參數(?token=a&token=b)給陣列, 原實作對非字串原樣回傳致權杖全文入 log
//- 露出字數 k=min(4, floor(n/8)): 原固定前 4 後 4 對 ≤8 字元之權杖等於全文, 36 字元 session token 仍為前 4 後 4
//- 露出字元之控制字元換成 '?', 避免請求端以 CR/LF 偽造 log 行; 其他型別只給型別, 絕不輸出原值
export function maskToken(token) {
    if (isarr(token)) {
        return token.map(maskToken)
    }
    if (token === undefined || token === null || token === '') {
        return ''
    }
    if (!isestr(token)) {
        return `(${typeof token})`
    }
    let n = token.length
    let k = Math.min(4, Math.floor(n / 8))
    if (k === 0) {
        return `(len=${n})`
    }
    return `${safeText(token.slice(0, k))}...${safeText(token.slice(-k))}(len=${n})`
}


//keysUserQuery: 以使用端給定之欄位名查使用者時允許之欄位名(識別欄白名單, R-QKEY-01), 單一定義; maskKv 以同一組判定識別欄
export let keysUserQuery = ['id', 'account', 'email', 'name']


//capText: 使用端可自填之字串(欄位名 key、識別欄之查詢值)寫入 log 前處理(R-QKEY-01 規則 6, 與 maskToken 同一紀律):
//  控制字元(< 32、127)置換為 ?; 長度超過 LOG_TEXT_MAX 者截斷並附 ...(len=原長), 否則原樣; 非字串原樣回傳
export let LOG_TEXT_MAX = 256
export function capText(s) {
    if (!isestr(s)) {
        return s
    }
    let t = safeText(s)
    if (t.length > LOG_TEXT_MAX) {
        return `${t.slice(0, LOG_TEXT_MAX)}...(len=${t.length})`
    }
    return t
}


//maskKv: 以指定欄位查使用者時之查詢值寫入 log 前處理; 識別欄照記供追查, 其餘欄位(token / tokenVerify 等)之值即憑證故遮罩
export function maskKv(key, value) {
    if (isestr(key) && keysUserQuery.includes(key)) {
        return capText(value)
    }
    return maskToken(value)
}


//logType: 值寫入 console 前之處置(ADR-101, 取代 ADR-068 M 契約中 console 之 maskKv 規則; 依 dspec〈診斷輸出與遮罩〉D2 預設不輸出資料值):
//使用者物件、請求本體、傳入參數值、資料表與後端之回傳值一律不輸出其值, 只給型別 '(typeof x)'(null 與陣列另標), 不論字串長短、是否為識別欄
export function logType(v) {
    let t = v === null ? 'null' : (Array.isArray(v) ? 'array' : typeof v)
    return `(typeof ${t})`
}


//logKey: 欄位名寫入 console 前之處置(ADR-101): 只在 allowed(本套件資料表欄位名單)內才照印, 使用端可自填之欄位名不在名單內者只給型別, 與 logType 同形
export function logKey(key, allowed) {
    if (isestr(key) && isarr(allowed) && allowed.includes(key)) {
        return key
    }
    return logType(key)
}


//maskUrl: 網址只留 origin + pathname(定義於 src/maskUrl.mjs, 與對外查詢 helper 共用)
export { maskUrl }


export default init
