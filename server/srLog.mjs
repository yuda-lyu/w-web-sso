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
    let safe = (s) => Array.from(s, (c) => {
        let x = c.charCodeAt(0)
        return (x < 32 || x === 127) ? '?' : c
    }).join('')
    return `${safe(token.slice(0, k))}...${safe(token.slice(-k))}(len=${n})`
}


//maskKv: 以指定欄位查使用者時之查詢值寫入 log 前處理; 識別欄照記供追查, 其餘欄位(token / tokenVerify 等)之值即憑證故遮罩
let keysKvPlain = ['id', 'account', 'email', 'name']
export function maskKv(key, value) {
    if (isestr(key) && keysKvPlain.includes(key)) {
        return value
    }
    return maskToken(value)
}


//maskUrl: 網址只留 origin + pathname(定義於 src/maskUrl.mjs, 與對外查詢 helper 共用)
export { maskUrl }


export default init
