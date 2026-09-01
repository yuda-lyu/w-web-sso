//ADR-052: 應用系統 token (isApp='y') 明確豁免 token 調用次數封鎖 (spec/流程_自動封鎖機制.md B09a)
//對應規格 (read-only, 逐行讀過):
//  server/procProtect.mjs:293-309   blockAccountByToken: 取 token 物件 → isApp='y' 記 debug 後 return (不封鎖)
//  server/procProtect.mjs:374-419   timer 每 2 秒掃 kpTokenCallApi, 次數 > numForTokenCallApi 即呼叫 blockAccountByToken
//  g_initialData.mjs:78-80          base seed token-for-app (isApp='y', 無對應 user); token-for-basic (使用者 id-for-basic)
//作法: 以 numForTokenCallApi=5 之臨時 settings 重啟後端 (restartBackend), 對 /api/checkToken 連打 8 次 (> 5),
//      等 timer 跑過 (3 s) 後再驗: app token 仍有效 (豁免); 對照組使用者 token 失效 (機制確有觸發).
import assert from 'assert'
import { startServersOnce, apiUrl } from './api-setup.mjs'
import { restartBackend, genTempSettings, resetToBaseSeed } from './e2e-setup.mjs'
import { woItems } from '../g_mOrm.mjs'


let NUM = 5

//回應格式 { state:'success', msg:true } (有效) / { state:'error', msg:'tokenExpired' } (失效或不存在)
async function checkToken(token) {
    let r = await fetch(`${apiUrl}/api/checkToken?token=${token}&key=token`)
    let j = await r.json().catch(() => null)
    return (j && j.state === 'success') ? j.msg : null
}

//連打 n 次 (並行), 只求觸發 kpTokenCallApi 計數
async function hammer(token, n) {
    let ps = []
    for (let i = 0; i < n; i++) {
        ps.push(fetch(`${apiUrl}/api/checkToken?token=${token}&key=token`).catch(() => {}))
    }
    await Promise.allSettled(ps)
}

function delay(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms))
}


describe('api-autoblock-apptoken — app token 豁免 token 調用次數封鎖 (ADR-052)', function() {
    this.timeout(300000)

    before(async function() {
        await startServersOnce()
        await resetToBaseSeed()
        //numForTokenCallApi 壓低到 5, 使測試能在秒級觸發 timer 封鎖判定
        await restartBackend(genTempSettings({ numForTokenCallApi: NUM, minForTokenCallApi: 10 }))
    })

    after(async function() {
        await restartBackend('./settings.json') //還原預設 settings
        await resetToBaseSeed() //對照組已被封鎖並刪 token, 還原 base seed 供後續測試檔
    })


    //APP-001 (ADR-052): app token 超過上限後仍有效, tokens 表紀錄仍在
    it('APP-001-app-token-exceeds-limit-not-blocked', async function() {
        let before = await checkToken('token-for-app')
        assert.strict.equal(before, true, '前置: token-for-app 應有效')

        await hammer('token-for-app', NUM + 3)
        await delay(3000) //timer 每 2 秒掃一次, 給兩輪餘裕

        let after = await checkToken('token-for-app')
        assert.strict.equal(after, true, 'app token 超過 numForTokenCallApi 後仍應有效 (豁免)')

        let tks = await woItems.tokens.select({ token: 'token-for-app' })
        assert.strict.equal(tks.length, 1, 'tokens 表之 token-for-app 不應被刪除')
        assert.strict.equal(tks[0].isApp, 'y')
    })


    //APP-002 (對照組): 使用者 token 同法超過上限 → 封鎖使用者並刪 token → checkToken 不再為 true
    it('APP-002-user-token-exceeds-limit-blocked (control)', async function() {
        let before = await checkToken('token-for-basic')
        assert.strict.equal(before, true, '前置: token-for-basic 應有效')

        await hammer('token-for-basic', NUM + 3)
        await delay(3000)

        let after = await checkToken('token-for-basic')
        assert.strict.notEqual(after, true, '使用者 token 超過 numForTokenCallApi 後應失效 (封鎖機制確有觸發)')

        let tks = await woItems.tokens.select({ token: 'token-for-basic' })
        assert.strict.equal(tks.length, 0, 'tokens 表之 token-for-basic 應被刪除 (流程_自動封鎖機制 B14)')

        let us = await woItems.users.select({ id: 'id-for-basic' })
        assert.strict.equal(us.length, 1)
        assert.strict.ok(us[0].timeBlocked, 'users.timeBlocked 應被設定 (B13)')
    })

})
