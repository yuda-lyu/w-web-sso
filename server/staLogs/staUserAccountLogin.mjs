import ot from 'dayjs'
import get from 'lodash/get.js'
import size from 'lodash/size.js'
import groupBy from 'lodash/groupBy.js'
import mapValues from 'lodash/mapValues.js'
import filter from 'lodash/filter.js'
import merge from 'lodash/merge.js'
import isestr from 'wsemi/src/isestr.mjs'
import genPm from 'wsemi/src/genPm.mjs'
import fsTreeFolder from 'wsemi/src/fsTreeFolder.mjs'
import fsBuildReadStreamText from 'wsemi/src/fsBuildReadStreamText.mjs'


async function staUserAccountLogin(timeLength = 7, timeInterval = 'hr', opt = {}) {

    //fdLog
    let fdLog = get(opt, 'fdLog')
    if (!isestr(fdLog)) {
        fdLog = './_logs'
    }

    //fmt
    let fmt = timeInterval === 'day' ? 'YYYY-MM-DD' : 'YYYY-MM-DDTHH'

    //unit
    let unit = timeInterval === 'hr' ? 'hour' : 'day'

    //kpTime, 產生完整的時間區間
    let now = ot()
    let tStart = now.subtract(timeLength, 'day')
    let tCurr = tStart.startOf(unit)
    let tEnd = now.startOf(unit)
    let kpTime = {}
    while (!tCurr.isAfter(tEnd)) {
        kpTime[tCurr.format(fmt)] = { data: { attempt: 0, success: 0, error: 0 } }
        tCurr = tCurr.add(1, unit)
    }
    // console.log('kpTime', kpTime)

    //vpfs
    let vpfs = fsTreeFolder(fdLog)
    // console.log('vpfs', vpfs)

    //logs
    let logs = []
    for (let vpf of vpfs) {

        //fp
        let fp = vpf.path

        //ev
        let ev = fsBuildReadStreamText(fp)

        //line
        ev.on('line', (line) => {
            // console.log('line', line)
            let v = null
            try {

                //v
                v = JSON.parse(line)

                //t
                let t = ot(v.time)

                //timeFmt
                let timeFmt = t.format(fmt)

                //b
                let b1 = t.isAfter(tStart)
                let b2 = (
                    v.event === 'kpfun-loginByAccountAndPassword-before' ||
                    v.event === 'kpfun-loginByAccountAndPassword-success' ||
                    v.event === 'kpfun-loginByAccountAndPassword-error'
                )
                let b = b1 && b2

                //push
                if (b) {
                    logs.push({
                        timeFmt,
                        ...v,
                    })
                }

            }
            catch (err) {}
        })

        //await close
        let pm = genPm()
        ev.on('close', () => {
            // console.log('close')
            pm.resolve()
        })
        await pm

    }
    // console.log('logs', logs)

    //gs
    let gs = groupBy(logs, 'timeFmt')
    // console.log('gs', gs)

    //gsLog
    let gsLog = mapValues(gs, vs => {
        let vbefore = filter(vs, { event: 'kpfun-loginByAccountAndPassword-before' })
        let vsuccess = filter(vs, { event: 'kpfun-loginByAccountAndPassword-success' })
        let verror = filter(vs, { event: 'kpfun-loginByAccountAndPassword-error' })
        return {
            data: {
                attempt: size(vbefore),
                success: size(vsuccess),
                error: size(verror),
            }
        }
    })
    // console.log('gsLog', gsLog)

    //merge
    let mr = merge({}, kpTime, gsLog)
    // console.log('mr', mr)

    //rs
    let rs = Object.keys(mr)
        .sort()
        .map(time => ({
            time,
            ...mr[time]
        }))
    // console.log('rs', rs)

    return rs
}

export default staUserAccountLogin
