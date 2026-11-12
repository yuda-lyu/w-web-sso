//api-saverows.test.mjs — 清單儲存 RPC 之 rows 元素層級檢查(ADR-081 擴及元素層級): 真後端(11007) + 真資料庫 + 真傳輸(WServHapiClient, JSON), 不經 UI
//
// 依據:
//   - 規格 spec/設計要點與取捨.md ADR-081(寫入前驗證完備; 元素層級補記)、sgud/rule/rulebook_orm.md R-VAL-01
//   - 姊妹系統先例: 同型後台於存檔入口拒收「非陣列, 或含非物件 / 空物件之列」, 零寫入
// 對三個存檔 RPC(updateUsersList / updateTokensList / updateIpsList)送 rows 含 null / {} / '' / 非空字串 / [] / 0 之元素
// (單一元素、合法列之後、合法列之前三種擺位): 皆回 invalidRows, 三表快照(依主鍵排序之全部列)不變.
// 防線分兩層: ①WWebSso 三個 RPC 入口(isearr + 每列 id 須為非空字串); ②procCore.updateTabItems 之元素檢查(unit-ormWriteFail A21b 直呼驗證, 不經入口);
// 本檔驗證兩層合起來對真傳輸之結果(單層失效時本檔未必轉紅, 屬縱深; 層別之變異見修正報告).
// 另有對照案: 合法整表存檔(前端同路徑, 帶載入時之基準)仍成功, 避免「一律拒收」之空轉.
// 每案例前重置 base seed + 本檔 fixture, 案例後只刪非 base seed(對齊其他 api 檔).

import assert from 'assert'
import { woItems } from '../g_mOrm.mjs'
import ds from '../src/schema/index.mjs'
import { baselineOfUsers, baselineOfTokens, baselineOfIps } from '../src/baselineOf.mjs'
import hashPassword from '../server/hashPassword.mjs'
import { startServersOnce, callFapi } from './tools/api-setup.mjs'
import { resetToBaseSeed, deleteNonBaseSeed } from './tools/e2e-setup.mjs'
import { awaitClientIpRegistered } from './tools/api-clientIp.mjs'


let SALT = '{salt}' //同 settings.json 之 salt 與 g_initialData
let ADMIN = 'token-for-admin' //base seed 之系統管理者 session 權杖
let TIME_END = '2030-01-01T00:00:00.000+08:00'
let TIME_OK = '2025-01-01T00:00:00.000+08:00'
let LEAK = 'leak-marker-7f3a91' //輸入值: 回應不得出現


//snapshot: 三表全部列(依主鍵排序)
//取快照前先等後端 ipDetectNew 計時器把本測試行程之來源 IP 登錄進 ips 表, 避免其系統寫入落在兩次快照之間而誤判「三表零變更」(見 tools/api-clientIp.mjs; 比對仍是完整三表)
async function snapshot() {
    await awaitClientIpRegistered()
    let one = async (t) => (await woItems[t].select()).sort((a, b) => (a.id < b.id ? -1 : 1))
    return { users: await one('users'), tokens: await one('tokens'), ips: await one('ips') }
}


async function insertFixtures() {
    let account = 'ac-sr-a'
    let u = ds.users.funNew({
        order: 900,
        account,
        password: hashPassword('Pw@SaveRows1', SALT),
        name: 'sr a',
        email: `${account}@test.com`,
        description: '',
        from: 'test',
        redir: '',
        isAdmin: 'n',
        timeVerified: TIME_OK,
        timeExpired: TIME_END,
        timeBlocked: '',
        isActive: 'y',
    })
    u.id = 'id-sr-a'
    u.timeVerified = TIME_OK
    await woItems.users.insert([u])
    let t = ds.tokens.funNew({ userId: 'id-sr-owner' })
    t.id = 'id-sr-app-1'
    t.token = 'sr-app-1'
    t.timeEnd = TIME_END
    t.isApp = 'y'
    t.perms = ['readTokens']
    await woItems.tokens.insert([t])
    await woItems.ips.insert([
        { ...ds.ips.funNew({ ip: '192.0.2.41', timeBlocked: '' }), id: 'id-sr-ip-1' },
        { ...ds.ips.funNew({ ip: '192.0.2.42', timeBlocked: '' }), id: 'id-sr-ip-2' },
    ])
}


//load: 系統管理者載入(RPC), 回傳列與自算基準(與前端同一工具 src/baselineOf.mjs)
async function load(fn) {
    let r = await callFapi(fn, [ADMIN])
    assert.strict.equal(r.ok, true, JSON.stringify(r))
    return r.val
}


//每個存檔 RPC 之呼叫與載入
let tables = {
    users: {
        get: 'getUsersList',
        save: 'updateUsersList',
        baseline: async () => {
            let rows = (await load('getUsersList')).sort((a, b) => (a.order || 0) - (b.order || 0))
            return { rows, opt: { baseline: baselineOfUsers(rows) } }
        },
    },
    tokens: {
        get: 'getTokensList',
        save: 'updateTokensList',
        baseline: async () => {
            let rows = await load('getTokensList')
            let b = baselineOfTokens(rows)
            return { rows, opt: { baseline: b.baseline, baselineSession: b.baselineSession } }
        },
    },
    ips: {
        get: 'getIpsList',
        save: 'updateIpsList',
        baseline: async () => {
            await awaitClientIpRegistered() //載入前先等來源 IP 登錄, 使持此基準之存檔不被計時器之系統寫入拒為 saveStale (同 snapshot)
            let rows = await load('getIpsList')
            return { rows, opt: { baseline: baselineOfIps(rows) } }
        },
    },
}


//無效元素: 非物件或空物件(JSON 傳輸後 undefined 即 null, 故不另列)
let kinds = [
    ['null', null],
    ['{}', {}],
    ['空字串', ''],
    ['非空字串', LEAK],
    ['[]', []],
    ['數字 0', 0],
]


describe('清單儲存 RPC — rows 元素層級檢查 (api, 真後端 / 真傳輸)', function() {
    this.timeout(180000)

    before(async function() {
        await startServersOnce()
    })

    after(async function() {
        await deleteNonBaseSeed()
    })

    beforeEach(async function() {
        await resetToBaseSeed()
        await insertFixtures()
    })

    afterEach(async function() {
        await deleteNonBaseSeed()
    })

    //spec(ADR-081 元素層級補記): rows 之每個元素須為非空物件; 不符整次拒收 invalidRows, 資料表零變更, 訊息不帶輸入值
    for (let woName of ['users', 'tokens', 'ips']) {
        it(`SAVEROWS-A-00${woName === 'users' ? 1 : woName === 'tokens' ? 2 : 3} ${woName} 存檔 RPC: rows 含非物件或空物件之元素(6 種 × 3 種擺位) → invalidRows, 三表快照不變`, async function() {
            let tb = tables[woName]
            let { rows: valid } = await tb.baseline()
            assert.ok(valid.length > 0, `${woName}: fixture 應有列`)
            let before = await snapshot()
            let n = 0
            for (let [kindName, e] of kinds) {
                let shapes = [
                    ['單一元素', [e]],
                    ['合法列之後', [...valid, e]],
                    ['合法列之前', [e, ...valid]],
                ]
                for (let [shapeName, rows] of shapes) {
                    let ctx = `${woName} / ${kindName} / ${shapeName}`
                    let r = await callFapi(tb.save, [ADMIN, 'eng', rows])
                    assert.strict.equal(r.ok, false, ctx)
                    assert.strict.equal(r.err, 'invalidRows', ctx)
                    assert.strict.equal(String(r.err).includes(LEAK), false, `${ctx}: 回應不得含輸入值`)
                    assert.deepStrictEqual(await snapshot(), before, `${ctx}: 三表應零變更`)
                    n++
                }
            }
            assert.strict.equal(n, 18)
        })
    }

    //對照: 合法整表存檔(前端同路徑, 帶載入時之基準)仍成功, 且有變更者確實落地
    it('SAVEROWS-A-004 對照: 合法整表存檔(三清單, 帶基準)成功, 修改與刪除落地', async function() {
        //users: 修改 id-sr-a 之 description
        let u = await tables.users.baseline()
        let ru = await callFapi('updateUsersList', [ADMIN, 'eng', u.rows.map((r) => (r.id === 'id-sr-a' ? { ...r, description: 'edited-by-saverows' } : r)), u.opt])
        assert.strict.equal(ru.ok, true, JSON.stringify(ru))
        let us = await load('getUsersList')
        assert.strict.equal(us.find((r) => r.id === 'id-sr-a').description, 'edited-by-saverows')
        //ips: 刪除 id-sr-ip-2
        let i = await tables.ips.baseline()
        let ri = await callFapi('updateIpsList', [ADMIN, 'eng', i.rows.filter((r) => r.id !== 'id-sr-ip-2'), i.opt])
        assert.strict.equal(ri.ok, true, JSON.stringify(ri))
        let ips = await load('getIpsList')
        assert.strict.equal(ips.some((r) => r.id === 'id-sr-ip-2'), false)
        assert.strict.equal(ips.some((r) => r.id === 'id-sr-ip-1'), true)
        //tokens: 無變更重送(只改不增, 清單存檔無新增入口)
        let t = await tables.tokens.baseline()
        let before = await snapshot()
        let rt = await callFapi('updateTokensList', [ADMIN, 'eng', t.rows, t.opt])
        assert.strict.equal(rt.ok, true, JSON.stringify(rt))
        assert.deepStrictEqual((await snapshot()).tokens, before.tokens)
    })

})
