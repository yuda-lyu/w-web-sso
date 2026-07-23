import assert from 'assert'
import ds from '../src/schema/index.mjs'
import hashPassword from '../server/hashPassword.mjs'
import { woItems } from '../g.mOrm.mjs'
import { startServersOnce, cleanup, apiUrl, getFapi, callFapi } from './api-setup.mjs'


//
// D40: 帳號登入失敗「即時封鎖」(D24)並發 race 取證測試.
// 對應 z審計報告v3.md D-γ / critic: D24 把封鎖判定從序列化 2s timer 移到每筆登入失敗的
// async catch handler 內(procProtect.mjs loginByAccountAndPassword), 對同一 account 之
// kpAccountLoginFailed[account] 做 push/filter/剪枝/blockAccount 全程無鎖. 此測試以
// Promise.allSettled 對同一帳號同時送出 numForAccountLoginFailed+1 次錯誤密碼登入,
// 多輪重跑(REPEAT_ROUNDS), 驗證不論交錯順序封鎖判定皆可靠觸發(無漏封).
// 依業主拍板(D40=a): 先取得證據, 再決定是否需為此路徑加鎖.
//

let salt = '{salt}'
let numForAccountLoginFailed = 3 //對齊 settings.json numForAccountLoginFailed
let REPEAT_ROUNDS = 5 //多輪取證, 提高偵測到偶發 race 的機率
let cleanKpAccountLoginFailedForToken = '{cleanKpAccountLoginFailedForToken}'


function buildUser(idx) {
    let account = `ac-conc-${idx}`
    let v = ds.users.funNew({
        order: 920,
        account,
        password: hashPassword('Pw@Concurrency1', salt),
        name: `Concurrency Test User ${idx}`,
        email: `${account}@test.com`,
        description: '',
        from: 'test',
        redir: 'http://127.0.0.1:8080/?view=user&token={token}',
        isAdmin: 'n',
        timeVerified: '2025-01-01T00:00:00.000+08:00',
        timeExpired: '2030-01-01T00:00:00.000+08:00',
        timeBlocked: '',
        isActive: 'y',
    })
    v.id = `id-ac-conc-${idx}`
    v.timeVerified = '2025-01-01T00:00:00.000+08:00'
    v.timeExpired = '2030-01-01T00:00:00.000+08:00'
    return v
}

async function insertUser(u) {
    await woItems.users.del({ id: u.id }).catch(() => {})
    await woItems.users.insert([u])
}

async function deleteUser(u) {
    await woItems.users.del({ id: u.id }).catch(() => {})
}

//清空 server in-memory 的 kpAccountLoginFailed(所有帳號的登入失敗計數), 避免跨輪/跨檔殘留污染.
async function cleanKpAccountLoginFailed() {
    try {
        let r = await fetch(`${apiUrl}/api/cleanKpAccountLoginFailed?token=${encodeURIComponent(cleanKpAccountLoginFailedForToken)}`)
        let j = await r.json()
        if (j.state !== 'success') {
            console.warn(`[cleanKpAccountLoginFailed] server 回應非 success: ${JSON.stringify(j)}`)
        }
    }
    catch (err) {
        console.warn(`[cleanKpAccountLoginFailed] 呼叫失敗: ${err.message}`)
    }
}


describe('AutoBlock Concurrency API — 帳號即時封鎖並發取證 (D40)', function() {
    this.timeout(120000)

    before(async function() {
        await startServersOnce()
        await getFapi()
    })

    after(async function() {
        this.timeout(20000)
        cleanup()
    })

    it(`D40-001: ${REPEAT_ROUNDS} 輪, 每輪對同一帳號同時送出 ${numForAccountLoginFailed + 1} 次錯誤密碼登入 → 每輪皆須成功封鎖(DB timeBlocked 有值), 不論交錯順序`, async function() {

        let blockedRounds = 0
        let unblockedRounds = []

        for (let round = 0; round < REPEAT_ROUNDS; round++) {

            let u = buildUser(round)
            await insertUser(u)
            await cleanKpAccountLoginFailed()

            //同一帳號同時送出 N+1 次錯誤密碼登入(真並發, 從 Node test runner 直打後端 WS RPC,
            //此為測後端內部狀態並發正確性, 非使用者操作流程, 對齊本專案 api-*.test.mjs 慣例)
            let n = numForAccountLoginFailed + 1
            let promises = []
            for (let i = 0; i < n; i++) {
                promises.push(callFapi('loginByAccountAndPassword', ['eng', u.account, 'WrongPassword@123']))
            }
            let results = await Promise.allSettled(promises)

            //語意斷言: 每次錯誤密碼登入皆應失敗(不論最終是否觸發封鎖, 錯誤密碼本就不該登入成功)
            for (let r of results) {
                let val = r.value || {}
                assert.strict.equal(val.ok, false, `round ${round}: 錯誤密碼登入應失敗, 實際: ${JSON.stringify(val)}`)
            }

            //給 blockAccount 內部 DB save 一點緩衝時間(理論上每個 callFapi promise resolve 前
            //即時封鎖判定與 await blockAccount 已完成, 此為保守 buffer 防 DB 寫入延遲的 flaky)
            await new Promise((resolve) => setTimeout(resolve, 500))

            //查 DB 之 ground truth: 該帳號是否已被封鎖(不依賴前端訊息, 直接驗證後端狀態)
            let rows = await woItems.users.select({ id: u.id })
            let timeBlocked = (rows[0] || {}).timeBlocked || ''

            if (timeBlocked) {
                blockedRounds++
            }
            else {
                unblockedRounds.push(round)
            }

            await deleteUser(u)
        }

        await cleanKpAccountLoginFailed()

        assert.strict.equal(
            blockedRounds,
            REPEAT_ROUNDS,
            `${REPEAT_ROUNDS} 輪並發封鎖測試應全數觸發封鎖, 實際 ${blockedRounds}/${REPEAT_ROUNDS} 輪封鎖成功; ` +
            `未封鎖輪次: ${JSON.stringify(unblockedRounds)}(若此斷言失敗, 代表 D24 即時封鎖之 read-modify-write 在並發下確實存在漏封 race, ` +
            `應依 z審計報告v3.md D-γ 建議評估是否需為 kpAccountLoginFailed 加鎖)`
        )
    })

})
