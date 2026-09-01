import get from 'lodash-es/get.js'
import isestr from 'wsemi/src/isestr.mjs'
import ispint from 'wsemi/src/ispint.mjs'
import cint from 'wsemi/src/cint.mjs'
import WSyslog from 'w-syslog/src/WSyslog.mjs'


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


export function maskToken(token) {
    if (!isestr(token)) {
        return token !== undefined ? token : ''
    }
    return `${token.slice(0, 4)}...${token.slice(-4)}(len=${token.length})`
}


export default init
