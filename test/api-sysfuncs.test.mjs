//api-sysfuncs.test.mjs — 框架系統函數之身分關卡: `[sys:getFuncList]` / `[sys:polling]` / `[sys:getTableTags]` × 呼叫者 (ADR-096; 跨套件原則 使用者身分驗證原則.md 二.7、二.8)
//
// 依據:
//   - ADR-096(spec/設計要點與取捨.md): sso 之 `sysFuncsPublic` 只列未登入之登入頁確實需要且無敏感內容者——`[sys:getFuncList]`(只回函數名稱)與 `[sys:polling]`(前端元件開機必經、
//     本套件無同步表且不使用廣播故恆回空陣列); `[sys:getTableTags]` 登入頁不需要, 且 `getUserIdByToken` 恆回空字串, 故對任何呼叫者(含帶有效 token 者)恆被拒絕(permission denied)
//   - w-serv-webdata 1.1.16: 框架預設三者皆公開(相容), 使用方須顯式設定; 未列者須 getUserIdByToken 得非空字串
//   - 驗證依據(真瀏覽器擷取)見報告與 sgud/exp/experience.md: 登入頁冷載入 = [sys:polling] → [sys:getFuncList] → getServerMethods → getWebInfor 與 [sys:getTableTags] 並行送出
// 作法: 真後端(11007), 以前端元件同款編碼(obj2u8arr)直打 POST /api/main; 另以真 WServHapiClient 帶有效系統管理者 token 走一次前端開機流程。
//   每格前重置 base seed 並建 fixture(7 類呼叫者 + 未知 token + 已逾期 session token, 同 api-accessmatrix 之 callers)。
// 「公開」= 不需有效身分, 不表示可省略框架封裝鍵: 缺 `__sysToken__` 鍵 → `invalid token`、缺 / 非陣列 `__sysInputArgs__` → `invalid input`(皆先於身分關卡, 對公開函數亦然; SF-04)。
// 修改 `sysFuncsPublic` 時本檔須同步。變異(ADR-096 〈Consequences〉變異表; 每項各被下列案例抓到):
//   M1 改回預設 / M4 明列三者 → SF-03、SF-04、SF-05、SF-06 紅; M2 只列 getFuncList → SF-02、SF-05、SF-06 紅; M3 只列 polling → SF-01、SF-05、SF-06 紅; M5 空陣列 → SF-01、SF-02、SF-05、SF-06 紅。
//   (`sysFuncsPublic` 為 null / undefined / 鍵名打錯時框架退回全公開 = M1; 非陣列 / 未知名稱時建構即拋錯, 後端起不來 = before hook 失敗。)

import assert from 'assert'
import obj2u8arr from 'wsemi/src/obj2u8arr.mjs'
import u8arr2obj from 'wsemi/src/u8arr2obj.mjs'
import WServHapiClient from 'w-serv-hapi/src/WServHapiClient.mjs'
import { woItems } from '../g_mOrm.mjs'
import ds from '../src/schema/index.mjs'
import { startServersOnce, apiUrl } from './tools/api-setup.mjs'
import { resetToBaseSeed, deleteNonBaseSeed, restartBackend } from './tools/e2e-setup.mjs'
import { callers, insertFixtures } from './tools/apiAccess.mjs'


//額外呼叫者: 未知 token 字串、已逾期之登入 token(後端無從反查, 與 getUserIdByToken 恆回空同一等價類; 逐格實測)
let EXP_TOKEN = 'sf-expired-session'
let extraCallers = [
    { key: 'UNK', token: 'no-such-token-xyz' },
    { key: 'EXP', token: EXP_TOKEN },
]
let allCallers = [...callers, ...extraCallers]


//rawRpc: 對齊前端元件(w-converhp client)之請求編碼, 回傳解碼後之回應 { success: { func, output } } 或 { error }
async function rawRpc(func, input, token) {
    let headers = { 'Content-Type': 'application/octet-stream' }
    if (token) {
        headers['Authorization'] = `Bearer ${token}`
    }
    let res = await fetch(`${apiUrl}/api/main`, { method: 'POST', headers, body: Buffer.from(obj2u8arr({ func, input })) })
    assert.strictEqual(res.status, 200, `${func}: HTTP ${res.status}`)
    return u8arr2obj(new Uint8Array(await res.arrayBuffer()))
}

//callSys: 系統函數(輸入為 { __sysInputArgs__: [], __sysToken__ }; 輪詢另見 poll)
async function callSys(func, token) {
    let r = await rawRpc(func, { __sysInputArgs__: [], __sysToken__: token }, token)
    assert.ok(r && r.success && r.success.func === func, `${func}: 回應形狀 ${JSON.stringify(r).slice(0, 200)}`)
    return r.success.output
}

//poll: [sys:polling] 之輸入為 { clientId, __sysToken__ }(本版前端元件); 已發布之舊前端元件為 { clientId }(不帶 token 鍵)
async function poll(clientId, token, withTokenKey) {
    let input = withTokenKey ? { clientId, __sysToken__: token } : { clientId }
    let r = await rawRpc('[sys:polling]', input, token)
    assert.ok(r && r.success && r.success.func === '[sys:polling]', `[sys:polling](clientId=${clientId}, withTokenKey=${withTokenKey}, token=${token ? '有' : '空'}): 回應形狀 ${JSON.stringify(r).slice(0, 200)}`)
    return r.success.output
}

//bootClient: 真前端用戶端(與 src/main.js 同款選項); 實例於建構當下即記在 st.inst, 逾時 / 失敗路徑亦可由呼叫端 finally 停止(clearBroadcast + clearSync 兩者皆須)
function bootClient(getToken) {
    let st = { inst: null, errs: [], f: null, ready: null }
    st.ready = new Promise((resolve, reject) => {
        let timer = setTimeout(() => reject(new Error('client 開機逾時 15s(輪詢或函數清單被拒?) errs=' + JSON.stringify(st.errs).slice(0, 300))), 15000)
        st.inst = WServHapiClient({
            useShowLog: false,
            url: apiUrl,
            apiName: 'api',
            useWaitToken: false,
            getToken,
            tokenType: 'Bearer',
            getServerMethods: (f) => {
                clearTimeout(timer)
                st.f = f
                resolve(f)
            },
            recvData: () => {},
        })
        st.inst.on('error', (err) => {
            st.errs.push(err)
        })
    })
    st.stop = () => {
        try {
            st.inst.clearBroadcast()
            st.inst.clearSync()
        }
        catch (err) { /* 停止失敗不得遮蔽測試結果 */ }
    }
    return st
}

let sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))


describe('框架系統函數之身分關卡 (ADR-096): sysFuncsPublic = [getFuncList, polling], getTableTags 恆拒絕', function() {
    this.timeout(300000)

    before(async function() {
        await startServersOnce()
        await restartBackend('./settings.json') //確保為本次程式碼之新行程(沿用舊行程會以舊設定判定)
    })

    beforeEach(async function() {
        await resetToBaseSeed()
        await insertFixtures('id-sf-target')
        //已逾期之登入 token(session 列, isApp 非 'y')
        let t = ds.tokens.funNew({ userId: 'id-for-viewer', isApp: 'n' })
        t.id = 'id-sf-expired'
        t.token = EXP_TOKEN
        t.timeEnd = '2020-01-01T00:00:00.000+08:00'
        await woItems.tokens.insert([t])
    })

    after(async function() {
        await deleteNonBaseSeed()
        await restartBackend('./settings.json')
    })

    it('SF-01 [sys:getFuncList]: 7 類呼叫者 + 未知 / 已逾期 token(含無 token)皆成功, 只回函數名稱字串清單(無資料), 清單相同', async function() {
        let base = null
        for (let c of allCallers) {
            let o = await callSys('[sys:getFuncList]', c.token)
            assert.strictEqual(o.state, 'success', c.key)
            assert.ok(Array.isArray(o.msg) && o.msg.length > 0, `${c.key}: 清單非空`)
            assert.ok(o.msg.every((v) => typeof v === 'string'), `${c.key}: 清單元素皆為字串(只有名稱)`)
            for (let must of ['getWebInfor', 'loginByAccountAndPassword', 'checkToken', 'getUsersList']) {
                assert.ok(o.msg.includes(must), `${c.key}: 清單含 ${must}`)
            }
            //不含內部同步用系統函數(框架去除 [sys:getTableTags])
            assert.ok(!o.msg.includes('[sys:getTableTags]'), `${c.key}: 清單不含 [sys:getTableTags]`)
            if (base === null) {
                base = JSON.stringify(o.msg)
            }
            assert.strictEqual(JSON.stringify(o.msg), base, `${c.key}: 清單與呼叫者無關`)
        }
        //清單不含任何 token / 金鑰字串
        assert.ok(!/token-for|m-au|m-as|pw-|sf-expired/.test(base), '清單不含 token / 密碼樣式字串')
    })

    it('SF-02 [sys:polling]: 呼叫者 × 新 / 舊協定皆放行且恆回空陣列; 同一 clientId 於空 / 有效 / 無效 token 間切換仍放行; 非法 clientId 被拒', async function() {
        //(a) 呼叫者 × 協定: 各連續兩輪(首輪綁定 clientId, 次輪驗證同一 clientId 仍放行; 公開時匿名身分一致)
        for (let c of allCallers) {
            for (let withKey of [true, false]) {
                let cid = `sf-client-${c.key}-${withKey ? 'k' : 'n'}`
                for (let round = 0; round < 2; round++) {
                    let out = await poll(cid, c.token, withKey)
                    assert.ok(Array.isArray(out), `${c.key} withKey=${withKey} round=${round}: 輪詢放行(回陣列), 實得 ${JSON.stringify(out).slice(0, 120)}`)
                    assert.strictEqual(out.length, 0, `${c.key} withKey=${withKey} round=${round}: 無廣播內容`)
                }
            }
        }
        //(b) 同一 clientId 之 token 序列(貼近真前端: 登入前空 → 登入後有效 token → 登出 / 失效後回空): 本套件身分恆為匿名, 綁定恆一致, 皆放行
        for (let tok of ['', 'token-for-admin', '', 'token-for-viewer', 'no-such-token-xyz', EXP_TOKEN, '']) {
            let out = await poll('sf-seq', tok, true)
            assert.deepStrictEqual(out, [], `序列 token=${tok || '(空)'}: 仍放行且回空陣列`)
        }
        assert.deepStrictEqual(await poll('sf-seq', '', false), [], '序列之後以舊協定(不帶鍵)仍放行')
        //(c) clientId 非非空字串 → 廣播層固定拒絕(先於身分關卡), 不放行
        for (let cid of [undefined, '', 123, null]) {
            let input = { __sysToken__: '' }
            if (cid !== undefined) {
                input.clientId = cid
            }
            let r = await rawRpc('[sys:polling]', input, '')
            assert.ok(r && typeof r.error === 'string' && r.error.includes('invalid clientId'), `clientId=${JSON.stringify(cid)}: 須被拒(invalid clientId), 實得 ${JSON.stringify(r).slice(0, 160)}`)
        }
    })

    it('SF-03 [sys:getTableTags]: 7 類呼叫者 + 未知 / 已逾期 token(含帶有效系統管理者 token)皆被拒絕 permission denied, 不回資料, 不回顯 token', async function() {
        for (let c of allCallers) {
            let o = await callSys('[sys:getTableTags]', c.token)
            assert.strictEqual(o.state, 'error', `${c.key}: 須被拒絕, 實得 ${JSON.stringify(o).slice(0, 160)}`)
            assert.strictEqual(o.msg, 'permission denied', c.key)
            assert.ok(!('data' in o), `${c.key}: 不回資料`)
            if (c.token) {
                assert.ok(!JSON.stringify(o).includes(c.token), `${c.key}: 回應不回顯 token`)
            }
        }
    })

    it('SF-04 框架封裝鍵之形態: 公開與否皆先檢封裝(缺 token 鍵 → invalid token、缺 / 非陣列參數 → invalid input); token 值為空 / null / 非字串 / 有效時 getTableTags 仍不放行', async function() {
        //(a) token 值之形態(鍵存在): 對 getTableTags 一律 permission denied
        for (let tokenVal of ['', null, 12345, 'token-for-admin']) {
            let r = await rawRpc('[sys:getTableTags]', { __sysInputArgs__: [], __sysToken__: tokenVal }, '')
            assert.ok(r && r.success && r.success.func === '[sys:getTableTags]', JSON.stringify(r).slice(0, 160))
            assert.strictEqual(r.success.output.state, 'error', `token=${JSON.stringify(tokenVal)}`)
            assert.strictEqual(r.success.output.msg, 'permission denied', `token=${JSON.stringify(tokenVal)}`)
        }
        //(b) 封裝鍵缺漏 / 形態不合: 公開函數(getFuncList)與非公開函數(getTableTags)同樣被框架先行拒絕(公開 ≠ 可省略封裝鍵)
        for (let func of ['[sys:getFuncList]', '[sys:getTableTags]']) {
            for (let { input, msg, tag } of [
                { input: { __sysInputArgs__: [] }, msg: 'invalid token', tag: '缺 __sysToken__ 鍵' },
                { input: { __sysToken__: '' }, msg: 'invalid input', tag: '缺 __sysInputArgs__ 鍵' },
                { input: { __sysToken__: '', __sysInputArgs__: 'x' }, msg: 'invalid input', tag: '__sysInputArgs__ 為字串' },
                { input: { __sysToken__: '', __sysInputArgs__: null }, msg: 'invalid input', tag: '__sysInputArgs__ 為 null' },
                { input: { __sysToken__: '', __sysInputArgs__: {} }, msg: 'invalid input', tag: '__sysInputArgs__ 為物件' },
            ]) {
                let r = await rawRpc(func, input, '')
                assert.ok(r && r.success && r.success.func === func, `${func} ${tag}: ${JSON.stringify(r).slice(0, 160)}`)
                assert.strictEqual(r.success.output.state, 'error', `${func} ${tag}`)
                assert.strictEqual(r.success.output.msg, msg, `${func} ${tag}`)
            }
        }
    })

    it('SF-05 真前端用戶端(WServHapiClient, 一開始即帶有效系統管理者 token)開機: 輪詢與函數清單通過、getServerMethods 觸發、後端函數可用; 唯一之 error 事件為單一 [sys:getTableTags] 拒絕', async function() {
        let st = bootClient(() => 'token-for-admin')
        try {
            await st.ready
            //登入後之呼叫仍由各函數以明確 token 參數授權(getUserIdByToken 恆回空, 不影響)
            let wi = await st.f.getWebInfor()
            assert.ok(wi && typeof wi === 'object', 'getWebInfor 可用')
            let us = await st.f.getUsersList('token-for-admin')
            assert.ok(Array.isArray(us) && us.length >= 3, 'getUsersList(明確 token 參數)可用')
            //等開機流程之 [sys:getTableTags] 回應(在 getServerMethods 之後)
            let t0 = Date.now()
            while (st.errs.length === 0 && Date.now() - t0 < 8000) {
                await sleep(100)
            }
            //再等 ≥ 2 輪輪詢(預設每 2 秒一輪): 輪詢若被拒會另發 { msg: '[sys:polling] error' } 之 error 事件
            await sleep(4500)
            assert.deepStrictEqual(st.errs, ['permission denied'], `error 事件須恰為單一 [sys:getTableTags] 之 'permission denied'(字串), 實得 ${JSON.stringify(st.errs).slice(0, 300)}`)
        }
        finally {
            st.stop()
        }
    })

    it('SF-06 真前端用戶端貼近 src/main.js: 開機時 token 為空, getServerMethods 後才取得系統管理者 token(登入): 輪詢跨空 → 有效 token 之切換仍通過, 無額外 error 事件', async function() {
        let tok = ''
        let st = bootClient(() => tok)
        try {
            await st.ready
            tok = 'token-for-admin' //登入完成(同一用戶端、同一 clientId 繼續輪詢, 其後之輪詢改帶 token)
            let t0 = Date.now()
            while (st.errs.length === 0 && Date.now() - t0 < 8000) {
                await sleep(100)
            }
            await sleep(4500) //≥ 2 輪帶 token 之輪詢
            let us = await st.f.getUsersList(tok)
            assert.ok(Array.isArray(us) && us.length >= 3, '切換後 getUsersList(明確 token 參數)可用')
            assert.deepStrictEqual(st.errs, ['permission denied'], `切換前後 error 事件須恆為單一 [sys:getTableTags] 之 'permission denied', 實得 ${JSON.stringify(st.errs).slice(0, 300)}`)
        }
        finally {
            st.stop()
        }
    })

})
