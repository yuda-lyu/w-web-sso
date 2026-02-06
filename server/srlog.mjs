import get from 'lodash-es/get.js'
import isestr from 'wsemi/src/isestr.mjs'
import WSyslog from 'w-syslog/src/WSyslog.mjs'


let init = (opt = {}) => {

    let fdLog = get(opt, 'logFd', '')
    if (!isestr(fdLog)) {
        fdLog = './_logs'
    }

    let interval = get(opt, 'logInterval', '')
    if (!isestr(interval)) {
        interval = 'hr'
    }

    let srLog = WSyslog({
        fdLog,
        interval,
    })
    // srLog.info({ event: 'runner', msg: 'start' })
    // srLog.warn({ event: 'monitor-memory', msg: 'usage-high', ratio: 85.4 })
    // srLog.error({ event: 'crash', msg: 'db connection', code: 500 })

    return srLog
}


export default init
