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

import WServHapiClient from 'w-serv-hapi/src/WServHapiClient.mjs'
import { startServersOnce, cleanup, apiUrl } from './e2e-setup.mjs'


let fapiPm = null
let instClient = null //WServHapiClient 實例, 供 root after 停止(ADR-085)


//取得 fapi client (lazy init + cached). 須在 startServersOnce 之後呼叫.
function getFapi() {
    if (fapiPm) return fapiPm
    fapiPm = new Promise((resolve, reject) => {
        let timer = setTimeout(() => reject(new Error('getFapi timeout after 30s — backend not ready')), 30000)
        instClient = WServHapiClient({
            useShowLog: false,
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
        })
        instClient.on('error', (err) => {
            //連線錯誤不直接 reject, 因 init 過程可能短暫 ws 重連
            //getServerMethods 還是會在連上後觸發
            //開機流程於 getServerMethods 之後呼叫 [sys:getTableTags], 本套件不列入 sysFuncsPublic 故必回 permission denied (預期, ADR-096; api-sysfuncs SF-03 / SF-05 守護)
            if (err === 'permission denied') {
                console.log('[api-setup] WServHapiClient: [sys:getTableTags] permission denied (expected, ADR-096)')
                return
            }
            console.log('[api-setup] WServHapiClient error (init phase, will retry):', err && err.message || err)
        })
    })
    return fapiPm
}


//stopFapi: 停止 client 之輪詢、取得函數清單與同步表之請求與計時器; w-serv-hapi 1.1.6 起 clearBroadcast 與 clearSync 兩者皆須呼叫(只呼叫其一時輪詢或同步照常)
function stopFapi() {
    if (instClient !== null) {
        instClient.clearBroadcast()
        instClient.clearSync()
    }
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
// 結束: root after 先停止 client(stopFapi), 再強制 process.exit().
// w-serv-hapi 1.1.6 起 client 可停止: clearBroadcast 清除 w-serv-broadcast 之輪詢計時器並中止在途輪詢, clearSync 中止 w-serv-webdata 自身之在途請求
// (原註解「沒對外暴露 close/destroy, 唯一可靠的中止方式是 process.exit()」已不成立; 撐住行程者為輪詢計時器而非 w-sync-webdata, ADR-085).
// exit 保留為保險: 停止前已送出之 callFapi 仍依重試撐住行程, 單一 mocha 行程內另有 g_mOrm 之資料庫連線等資源.
// 註冊在最末的 root after: e2e-setup 先被 import, 其 root after(cleanup, 殺 backend)先跑, 之後才停止 client 並退出.
//
let exitHookRegistered = false
function registerForceExitOnce() {
    if (exitHookRegistered) return
    exitHookRegistered = true
    if (typeof globalThis.after === 'function') {
        globalThis.after(function() {
            this.timeout(5000)
            //停止失敗不得阻止其後之退出(否則 mocha 不退), 只印出
            try {
                stopFapi()
            }
            catch (err) {
                console.log('[api-setup] stopFapi failed:', err && err.message ? err.message : err)
            }
            //讓 stdout flush + 給 mocha reporter 印完
            setImmediate(() => process.exit(process.exitCode || 0))
        })
    }
}
registerForceExitOnce()


export { startServersOnce, cleanup, apiUrl, getFapi, callFapi }
