import { fileURLToPath } from 'url'
import path from 'path'
import { Worker } from 'worker_threads'
import genPm from 'wsemi/src/genPm.mjs'


let __filename = fileURLToPath(import.meta.url)
let __dirname = path.dirname(__filename)

async function staIp(timeLength = 7, timeInterval = 'hr', opt = {}) {
    let pm = genPm()

    //fpWk
    let fpWk = path.resolve(__dirname, 'staIp.shellWorker.mjs')
    // console.log('fpWk', fpWk)

    //wk
    let wk = new Worker(fpWk)

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

export default staIp
