//
// api-*.test.mjs 共用: 等後端把「本測試行程之來源 IP」登錄進 ips 表
//
// 為什麼需要:
//   後端 server/procProtect.mjs 的 ipDetectNew 計時器 (setInterval 2000ms, 約 929 行起) 會把「記憶體計數 kpIpCallApi 內有、ips 表尚無」之 IP
//   以 procOrm('system', 'ips', 'insert') 補登記進 ips 表 (userIdUpdate 為 'system'); 每個 API 請求 (WWebSso verifyConn → callApiByIp) 都會使來源 IP 進入計數.
//   測試的 resetToBaseSeed / deleteNonBaseSeed 會清空 ips 表, 其後只要再打任一請求, 本機 IP (127.0.0.1) 便在下一次計時器觸發 (0~2 秒內, 相位隨機) 被補回.
//   「取整份資料快照 → 執行操作 → 再取快照比對零寫入」的斷言若剛好跨過該次觸發, 快照間會多出一筆與被測操作無關的系統寫入, 在負載下 (操作較慢, 視窗較寬) 現形為偶發紅.
//
// 作法: 取快照前先等該 IP 的 ips 列出現 (可觀察條件, 非固定延時); 列出現後計時器對此 IP 不再寫入, 之後的快照彼此一致.
// 不放寬斷言: 仍比對完整的 users / tokens / ips 快照, 被測操作若寫入任何列 (含 ips) 仍會使其轉紅.
//
// 前提: 本測試行程已對後端發出過請求使後端計數含此 IP; 本函數於 ips 表無此列時會再發一次公開唯讀 RPC (getWebInfor) 確保之.
// 等不到 (逾時) 即拋錯, 不吞掉, 不重試掩蓋.
//

import { woItems } from '../../g_mOrm.mjs'
import { callFapi } from './api-setup.mjs'


//測試行程連後端之來源 IP: apiUrl 為本機後端, 請求不帶 X-Forwarded-For, 後端取連線位址 127.0.0.1
let CLIENT_IP = '127.0.0.1'


//awaitClientIpRegistered: 等 ips 表出現來源 IP 的列; 回傳該 IP 的列數
async function awaitClientIpRegistered(opt = {}) {
    let ip = opt.ip || CLIENT_IP
    let timeoutMs = opt.timeoutMs || 20000
    let intervalMs = opt.intervalMs || 20
    let has = async () => (await woItems.ips.select({ ip })).length
    let n = await has()
    if (n > 0) {
        return n
    }
    //後端計數可能已被清除或剪枝: 發一次公開唯讀 RPC 使其重新進入計數
    await callFapi('getWebInfor', [''])
    let t0 = Date.now()
    while (Date.now() - t0 < timeoutMs) {
        n = await has()
        if (n > 0) {
            return n
        }
        await new Promise((resolve) => setTimeout(resolve, intervalMs))
    }
    throw new Error(`awaitClientIpRegistered: ips 表在 ${timeoutMs} ms 內未出現 ip[${ip}] (ipDetectNew 計時器未登錄來源 IP; 請確認測試已對後端發出請求)`)
}


export { CLIENT_IP, awaitClientIpRegistered }
