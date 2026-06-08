/**
 * procMutex — in-memory per-key mutex helper
 *
 * 用於 backend critical 路徑序列化「同 key」之並行請求。
 * 同 key 序列化 (排隊執行), 不同 key 並行 (per-key parallelism)。
 *
 * 機制:
 *   - 每個 key 維護一條 Promise chain
 *   - 新 caller 串在 chain 尾, await 前一個結束 (resolve / reject 皆 OK) 才執行
 *   - fn 結束 (resolve / reject) 後即釋放鎖
 *   - 記憶體管理: 最後一個 caller 結束時刪 key entry, 避免 Map 無限增長
 *
 * 限制:
 *   - in-process only — cluster 多 process 下不互斥 (各 process 自己一份 Map)。
 *     對齊 ADR-030 Pending 部署拓樸 (單機假設)。多機 / 多 process 場景需另用
 *     外部鎖 (Redis / DB row lock / advisory lock 等)。
 *
 * API:
 *   let mu = procMutex()
 *   let result = await mu.withLock(key, async () => {
 *       //critical section: 同 key 同時間只會有一個 caller 在此執行
 *       return someValue
 *   })
 *
 * Example:
 *   let mu = procMutex()
 *
 *   //同 key 序列化: 後者必等前者完成
 *   await Promise.all([
 *       mu.withLock('user-123', async () => { ...stepA... }),
 *       mu.withLock('user-123', async () => { ...stepB... }), //在 stepA 之後跑
 *   ])
 *
 *   //不同 key 並行: 互不阻塞
 *   await Promise.all([
 *       mu.withLock('user-A', async () => { ...stepA... }),
 *       mu.withLock('user-B', async () => { ...stepB... }), //與 stepA 並行
 *   ])
 */
function procMutex() {

    //每個 key 對應一條 Promise chain 之尾端 (下一個 caller 須 await 它)
    let chains = new Map()

    //每個 key 當前排隊中 (含執行中) 的 caller 數, 用於最後一個釋放時清掉 entry
    let counts = new Map()

    let withLock = async (key, fn) => {

        //取得當前 chain 尾; 若無則以 resolved promise 起頭
        let prev = chains.get(key) || Promise.resolve()

        //新 caller 接在尾端: 不論 prev 成功或失敗, 都要輪到自己執行 fn
        //(prev 的成敗不該影響後續 caller 是否有機會跑)
        let next = prev.then(async () => {
            return await fn()
        }, async () => {
            return await fn()
        })

        //把 chain 尾推進到自己; 用 .catch(() => {}) 包一層防止 unhandled rejection
        //(後續 caller 仍從原 next 取結果, 此包裝只影響「鏈尾 reference」)
        chains.set(key, next.catch(() => {}))

        //increment 計數
        counts.set(key, (counts.get(key) || 0) + 1)

        try {
            return await next
        }
        finally {
            //caller 結束 (不論成敗) → decrement 計數
            let cnt = counts.get(key) - 1
            if (cnt <= 0) {
                //最後一個 caller 結束 → 清掉 entry 避免 Map 無限增長
                counts.delete(key)
                chains.delete(key)
            }
            else {
                counts.set(key, cnt)
            }
        }
    }

    return { withLock }
}


export default procMutex
