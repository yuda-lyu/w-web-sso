import ot from 'dayjs'
import get from 'lodash-es/get.js'
import size from 'lodash-es/size.js'
import groupBy from 'lodash-es/groupBy.js'
import each from 'lodash-es/each.js'
import mapValues from 'lodash-es/mapValues.js'
import merge from 'lodash-es/merge.js'
import genPm from 'wsemi/src/genPm.mjs'
import isestr from 'wsemi/src/isestr.mjs'
// import randomIntRange from 'wsemi/src/randomIntRange.mjs'
import fsTreeFolder from 'wsemi/src/fsTreeFolder.mjs'
import fsBuildReadStreamText from 'wsemi/src/fsBuildReadStreamText.mjs'


async function staToken(timeLength = 7, timeInterval = 'hr', opt = {}) {

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
        kpTime[tCurr.format(fmt)] = { data: { count: 0 } }
        tCurr = tCurr.add(1, unit)
    }

    //vpfs
    let vpfs = fsTreeFolder(fdLog)

    //logs
    let logs = []
    for (let vpf of vpfs) {

        //fp
        let fp = vpf.path

        //ev
        let ev = fsBuildReadStreamText(fp)

        //line
        ev.on('line', (line) => {
            let v = null
            try {
                v = JSON.parse(line)
                let t = ot(v.time)
                let timeFmt = t.format(fmt)
                let b1 = t.isAfter(tStart)
                let b2 = v.event === 'fun-checkToken'
                let b = b1 && b2
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
            pm.resolve()
        })
        await pm

    }

    //gs
    let gs = groupBy(logs, 'timeFmt')

    //gsLog
    let gsLog = mapValues(gs, vs => {
        let count = size(vs)
        let guid = groupBy(vs, 'userId')
        let kp = {}
        each(guid, (vvs, userId) => {
            kp[userId] = size(vvs)
        })
        // for (let i = 1; i <= randomIntRange(10, 100); i++) {
        //     let userId = `user${i}`
        //     kp[userId] = randomIntRange(0, 1000)
        // }
        return {
            data: {
                count,
                ...kp,
            }
        }
    })

    //merge
    let mr = merge({}, kpTime, gsLog)

    //rs
    let rs = Object.keys(mr)
        .sort()
        .map(time => ({
            time,
            ...mr[time]
        }))

    return rs
}

export default staToken
