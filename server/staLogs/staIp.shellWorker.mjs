import { parentPort } from 'worker_threads'
import staIp from './staIp.mjs'

parentPort.on('message', async (param) => {
    try {
        let r = await staIp(param.timeLength, param.timeInterval, param.opt)
        parentPort.postMessage({
            mode: 'done',
            payload: r,
        })
    }
    catch (err) {
        parentPort.postMessage({
            mode: 'error',
            payload: err,
        })
    }
})
