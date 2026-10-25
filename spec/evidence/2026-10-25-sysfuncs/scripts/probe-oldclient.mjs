//probe-oldclient.mjs — 真舊版框架用戶端(w-serv-hapi 1.1.7 / webdata 1.1.15 / broadcast 1.1.10, 輪詢不帶 token 鍵)對新版後端(sysFuncsPublic 收窄)之相容性(sso-run01; 暫存)
import { startServersOnce, cleanup, apiUrl, restartBackend, resetToBaseSeed, deleteNonBaseSeed } from '../../test/tools/e2e-setup.mjs'
import WServHapiClientOld from './oldclient/node_modules/w-serv-hapi/src/WServHapiClient.mjs'

async function boot(label, token) {
    let errs = []
    let r = await new Promise((resolve, reject) => {
        let timer = setTimeout(() => reject(new Error(`${label}: 開機逾時 15s errs=${JSON.stringify(errs).slice(0, 200)}`)), 15000)
        let inst = WServHapiClientOld({
            useShowLog: false,
            url: apiUrl,
            apiName: 'api',
            useWaitToken: false,
            getToken: () => token,
            tokenType: 'Bearer',
            getServerMethods: (f) => { clearTimeout(timer); resolve({ f, inst }) },
            recvData: () => {},
        })
        inst.on('error', (e) => errs.push(e))
    })
    let wi = await r.f.getWebInfor()
    let us = token ? await r.f.getUsersList(token) : null
    //等 [sys:getTableTags] 之回應(在 getServerMethods 之後)
    let t0 = Date.now()
    while (errs.length === 0 && Date.now() - t0 < 6000) await new Promise((x) => setTimeout(x, 100))
    r.inst.clearBroadcast()
    r.inst.clearSync()
    console.log(`[old-client] ${label}: getServerMethods OK; getWebInfor keys=${Object.keys(wi || {}).length}; getUsersList=${us ? us.length + ' rows' : '(未登入不呼叫)'}; errorEvents=${JSON.stringify(errs).slice(0, 200)}`)
    return { ok: true, errs }
}

let code = 0
try {
    await startServersOnce()
    await restartBackend('./settings.json')
    await resetToBaseSeed()
    let a = await boot('unauth(token 空)', '')
    let b = await boot('admin(token-for-admin)', 'token-for-admin')
    for (let x of [a, b]) {
        let all = x.errs.every((e) => (typeof e === 'string' ? e : JSON.stringify(e)).includes('permission denied'))
        if (!all || x.errs.length < 1) { code = 1; console.log('[old-client] FAIL: error 事件應僅為 [sys:getTableTags] permission denied') }
    }
}
catch (err) {
    code = 1
    console.log('[old-client] FAIL', err && err.message || err)
}
finally {
    await deleteNonBaseSeed().catch(() => {})
    cleanup()
    process.exit(code)
}
