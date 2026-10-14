import isfun from 'wsemi/src/isfun.mjs'


//kTimerName, 經本包裝之回呼以此鍵記其計時器名稱, 供測試核對各計時器皆經包裝(R-ERR-01)
let kTimerName = Symbol('wrapTimer')


/**
 * 包裝週期計時器(setInterval / setTimeout)之回呼(R-ERR-01, ADR-085)
 *
 * 前一次未結束時再觸發即略過; 回呼之同步拋錯與 reject 一律攔下交 onError, 結束(不論成敗)即釋放, 下一輪照常執行;
 * 回傳之函數恆 resolve, onError 自身拋錯亦攔下.
 * why: 計時器之 async 回呼 reject 時無人接手, Node 預設即結束行程(w-serv-hapi 1.1.6 起不再代為註冊 process 層監聽, 本套件亦不註冊);
 * 原各計時器手寫之重入鎖只在成功路徑釋放, 失敗一次即永久停擺.
 *
 * @param {String} name 輸入計時器名稱字串, 記錄錯誤用
 * @param {Function} fn 輸入回呼函數, 可為 sync 或 async 函數
 * @param {Function} [onError=null] 輸入錯誤處理函數, 傳入 { timer, err }, 可為 sync 或 async 函數, 預設null
 * @returns {Function} 回傳 async 函數, 供計時器呼叫
 */
function wrapTimer(name, fn, onError = null) {

    //check
    if (!isfun(fn)) {
        throw new Error(`invalid fn of timer[${name}]`)
    }

    //running, 前一次未結束時為 true
    let running = false

    let run = async () => {
        if (running) {
            return
        }
        running = true
        try {
            await fn()
        }
        catch (err) {
            if (isfun(onError)) {
                try {
                    await onError({ timer: name, err }) //onError 為 async 而 reject 時亦攔下
                }
                catch (e) {}
            }
        }
        finally {
            running = false
        }
    }
    run[kTimerName] = name

    return run
}


export { kTimerName }
export default wrapTimer
