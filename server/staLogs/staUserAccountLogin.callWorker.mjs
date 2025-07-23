import { Worker } from 'worker_threads'
import genPm from 'wsemi/src/genPm.mjs'


async function staUserAccountLogin(timeLength = 7, timeInterval = 'hr', opt = {}) {
    let pm = genPm()

    let wk = new Worker('./server/staLogs/staUserAccountLogin.shellWorker.mjs')

    wk.on('message', (msg) => {

        if (msg.mode === 'done') {
            pm.resolve(msg.payload)
        }
        else if (msg.mode === 'error') {
            pm.reject(msg.payload)
        }

        wk.terminate()

    })

    wk.on('error', (err) => {
        pm.reject(err)
    })

    wk.postMessage({
        timeLength,
        timeInterval,
        opt,
    })

    return pm
}

export default staUserAccountLogin
