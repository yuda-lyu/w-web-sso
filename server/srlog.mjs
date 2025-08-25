import WSyslog from 'w-syslog/src/WSyslog.mjs'

let srlog = WSyslog({
    fdLog: './_logs',
    interval: 'hr',
})
// srlog.info({ event: 'runner', msg: 'start' })
// srlog.warn({ event: 'monitor-memory', msg: 'usage-high', ratio: 85.4 })
// srlog.error({ event: 'crash', msg: 'db connection', code: 500 })

export default srlog
