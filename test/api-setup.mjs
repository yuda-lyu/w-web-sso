//
// api-*.test.mjs 共用 setup
//
// 對應 spec § "API 契約測試" - 不需 browser, 從 Node 直接打後端 API.
// 共用 e2e-setup.mjs 的 server 啟動 / cleanup, 故跟 e2e mocha 跑同一個 backend (port 11007).
//
// 用法:
//   import { startServersOnce, cleanup, apiUrl, getFapi, callFapi } from './api-setup.mjs'
//
//   before(async () => {
//       await startServersOnce()
//       await getFapi() // 第一次取會初始化 client
//   })
//
//   it('xxx', async () => {
//       let r = await callFapi('adminResetUserPassword', [token, 'eng', userId])
//       assert(r.ok === false && r.err === 'cannot reset self')
//   })
//

import FormData from 'form-data'
import WServHapiClient from 'w-serv-hapi/src/WServHapiClient.mjs'
import { startServersOnce, cleanup, apiUrl } from './e2e-setup.mjs'


let fapiPm = null


//取得 fapi client (lazy init + cached). 須在 startServersOnce 之後呼叫.
function getFapi() {
    if (fapiPm) return fapiPm
    fapiPm = new Promise((resolve, reject) => {
        let timer = setTimeout(() => reject(new Error('getFapi timeout after 30s — backend not ready')), 30000)
        WServHapiClient({
            showLog: false,
            FormData,
            url: apiUrl,
            apiName: 'api',
            useWaitToken: false,
            getToken: () => '',
            tokenType: 'Bearer',
            getServerMethods: (fapi) => {
                clearTimeout(timer)
                resolve(fapi)
            },
            recvData: () => {},
            getRefreshState: () => {},
            getRefreshTable: () => {},
            getBeforeUpdateTableTags: () => {},
            getAfterUpdateTableTags: () => {},
        }).on('error', (err) => {
            //連線錯誤不直接 reject, 因 init 過程可能短暫 ws 重連
            //getServerMethods 還是會在連上後觸發
            console.log('[api-setup] WServHapiClient error (init phase, will retry):', err && err.message || err)
        })
    })
    return fapiPm
}


//包裝 fapi[funcName](...args) 為 { ok, val? , err? } 格式 (對齊 e2e callFapi 慣例)
async function callFapi(funcName, args) {
    let fapi = await getFapi()
    if (typeof fapi[funcName] !== 'function') {
        return { ok: false, err: `fapi.${funcName} not found` }
    }
    try {
        let val = await fapi[funcName](...args)
        return { ok: true, val }
    }
    catch (err) {
        let m = (err && typeof err === 'string') ? err : (err && err.message) || String(err)
        return { ok: false, err: m }
    }
}


//
// WServHapiClient 內含 w-sync-webdata 子系統會啟 setInterval 持續輪詢 table tags,
// 沒對外暴露 close/destroy. 即使 cleanup 殺掉 backend, polling loop 仍 hold event loop
// 並噴 ECONNREFUSED retry log, 導致 mocha 跑完不退. 唯一可靠的中止方式是 process.exit().
// 註冊在最末的 root after, 確保 e2e cleanup 已經先跑完才強制退出.
//
let exitHookRegistered = false
function registerForceExitOnce() {
    if (exitHookRegistered) return
    exitHookRegistered = true
    if (typeof globalThis.after === 'function') {
        globalThis.after(function() {
            this.timeout(5000)
            //讓 stdout flush + 給 mocha reporter 印完
            setImmediate(() => process.exit(process.exitCode || 0))
        })
    }
}
registerForceExitOnce()


export { startServersOnce, cleanup, apiUrl, getFapi, callFapi }
