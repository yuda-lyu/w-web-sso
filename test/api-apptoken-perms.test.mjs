//api-apptoken-perms.test.mjs — 應用系統金鑰(app token, isApp='y')之權限閘 (ADR-069)
//
// 依據: spec/設計要點與取捨.md ADR-069 (取代 ADR-005 之「app token 一律視同 admin」)
//   - tokens.perms 為權限字串陣列, 多元素即聯集; 基本權限 readUsers 恆具備(預設只提供查使用者)
//   - 權限閘(17 個): 對外 HTTP getSsoUsersList / getSsoUserInfor(key=token、key=id)與後台 kpfun getUserInfor / getUsersList → readUsers;
//     updateUsersList / adminResetUserPassword → writeUsers; getTokensList → readTokens; updateTokensList → writeTokens;
//     getIpsList → readIps; updateIpsList → writeIps; getSta* 六支 → readStats
//   - app token 缺權限 → 與非 admin 使用者同一對外 key 'tokenExpired'(ADR-006), 且不得有任何寫入副作用; srLog 記 appTokenPermDenied(含 perm)
//   - 使用者 token 不受 perms 影響: admin 全通過, 非 admin 全拒(adminResetUserPassword 維持 adminResetPasswordForbidden)
//   - 寫入 tokens.perms 須為未設定或已登錄權限字串之陣列(否則 reject 'tokenPermsInvalid'), 儲存時去重並依全集排序
// 作法: 真後端(11007)。以 envOverride 令 SMTP 連 127.0.0.1:1(連線拒絕), adminResetUserPassword 寄信必敗而不外寄(寄信失敗不阻斷, 既有契約).
//   每案例前重置 base seed + 本檔 fixture, 案例後只刪非 base seed(對齊其他 api 檔).

import assert from 'assert'
import fs from 'fs'
import path from 'path'
import { woItems } from '../g_mOrm.mjs'
import ds from '../src/schema/index.mjs'
import { startServersOnce, apiUrl, callFapi } from './tools/api-setup.mjs'
import { resetToBaseSeed, deleteNonBaseSeed, restartBackend, genTempSettings } from './tools/e2e-setup.mjs'


let PERMS = ['readUsers', 'writeUsers', 'readTokens', 'writeTokens', 'readIps', 'writeIps', 'readStats'] //ADR-069 權限全集(與 unit-appPerms PERM-U-001 同一份)
let TIME_END = '2030-01-01T00:00:00.000+08:00'
let logFd = './logs' //與 settings.json 之 logFd 一致


//呼叫者: 使用者 token 兩種 + app token 11 種(perms 之各種寫法); expect 為該呼叫者應具備之有效權限(明列, 不以受測模組推導)
let callers = [
    { key: 'admin', token: 'token-for-admin', kind: 'admin' },
    { key: 'viewer', token: 'token-for-viewer', kind: 'viewer' },
    { key: 'app-base', token: 'perm-app-base', kind: 'app', perms: [], expect: ['readUsers'] },
    { key: 'app-legacy', token: 'perm-app-legacy', kind: 'app', noPermsKey: true, expect: ['readUsers'] }, //升級前既有之列(無 perms 欄)
    { key: 'app-corrupt', token: 'perm-app-corrupt', kind: 'app', perms: 'writeUsers', expect: ['readUsers'] }, //非陣列 → fail closed
    ...PERMS.map((P) => ({ key: `app-${P}`, token: `perm-app-${P}`, kind: 'app', perms: [P], expect: ['readUsers', P] })),
    { key: 'app-all', token: 'perm-app-all', kind: 'app', perms: [...PERMS], expect: [...PERMS] },
]


function appUserId(c) {
    return `id-${c.token}`
}

function targetUserId(c) {
    return `id-perm-target-${c.key}`
}


//fixture: app tokens / 各呼叫者專屬之重設密碼目標使用者(避開 30s throttle) / 一筆 ip / 一筆供寫入 perms 之探針 app token
async function insertFixtures() {
    let tks = []
    for (let c of callers) {
        if (c.kind !== 'app') {
            continue
        }
        let t = ds.tokens.funNew({ userId: appUserId(c), isApp: 'y' })
        t.id = `id-${c.token}`
        t.token = c.token
        t.isApp = 'y'
        t.timeEnd = TIME_END
        if (c.noPermsKey) {
            delete t.perms
        }
        else {
            t.perms = c.perms
        }
        tks.push(t)
    }
    let probe = ds.tokens.funNew({ userId: 'id-perm-probe', isApp: 'y' })
    probe.id = 'id-perm-probe'
    probe.token = 'perm-probe'
    probe.isApp = 'y'
    probe.perms = []
    probe.timeEnd = TIME_END
    tks.push(probe)
    await woItems.tokens.insert(tks)

    let us = callers.map((c, k) => {
        let u = ds.users.funNew({
            order: 700 + k,
            account: `perm-target-${c.key}`,
            password: 'not-used',
            name: `perm-target-${c.key}`,
            email: `perm-target-${c.key}@example.com`,
            description: 'desc-orig',
            from: 'test',
            redir: '',
            isAdmin: 'n',
        })
        u.id = targetUserId(c)
        u.timeVerified = '2025-01-01T00:00:00.000+08:00'
        return u
    })
    await woItems.users.insert(us)

    let ip = ds.ips.funNew({ ip: '192.0.2.10', timeBlocked: '' })
    ip.id = 'id-perm-ip'
    await woItems.ips.insert([ip])
}


//HTTP GET → 對齊 callFapi 之 { ok, val, err }
async function httpApi(route, params) {
    let q = new URLSearchParams(params).toString()
    let res = await fetch(`${apiUrl}/api/${route}?${q}`)
    let body = await res.json()
    if (body.state === 'success') {
        return { ok: true, val: body.msg }
    }
    return { ok: false, err: typeof body.msg === 'string' ? body.msg : JSON.stringify(body.msg) }
}


async function getRowsForSave(tableName) {
    let rs = await woItems[tableName].select()
    return rs.map((r) => {
        let v = { ...r }
        delete v.password //比照後台前端: 清單不含 password, 後端存回時自 DB 補回
        return v
    })
}


//17 個權限閘; after(c, ok) 驗寫入副作用: 應通過者須已寫入, 應拒者不得有任何寫入
let ops = [
    {
        key: 'HTTP getSsoUsersList',
        perm: 'readUsers',
        run: (c) => httpApi('getSsoUsersList', { token: c.token }),
        checkOk: (r) => assert.ok(Array.isArray(r.val) && r.val.some((u) => u.id === 'id-for-viewer'), 'msg 應為含 id-for-viewer 之清單'),
    },
    {
        key: 'HTTP getSsoUserInfor(key=token)',
        perm: 'readUsers',
        run: (c) => httpApi('getSsoUserInfor', { token: c.token, key: 'token', value: 'token-for-viewer' }),
        checkOk: (r) => assert.strict.equal(r.val.id, 'id-for-viewer'),
    },
    {
        key: 'HTTP getSsoUserInfor(key=id)',
        perm: 'readUsers',
        run: (c) => httpApi('getSsoUserInfor', { token: c.token, key: 'id', value: 'id-for-viewer' }),
        checkOk: (r) => assert.strict.equal(r.val.account, 'ac-viewer'),
    },
    {
        key: 'kpfun getUserInfor',
        perm: 'readUsers',
        run: (c) => callFapi('getUserInfor', [c.token, 'id', 'id-for-viewer']),
        checkOk: (r) => assert.strict.equal(r.val.account, 'ac-viewer'),
    },
    {
        key: 'kpfun getUsersList',
        perm: 'readUsers',
        run: (c) => callFapi('getUsersList', [c.token]),
        checkOk: (r) => assert.ok(Array.isArray(r.val) && r.val.some((u) => u.id === 'id-for-viewer')),
    },
    {
        key: 'kpfun updateUsersList',
        perm: 'writeUsers',
        run: async (c) => {
            let rows = await getRowsForSave('users')
            let row = rows.find((u) => u.id === targetUserId(c))
            row.description = `desc-by-${c.key}`
            return callFapi('updateUsersList', [c.token, 'eng', rows])
        },
        after: async (c, ok) => {
            let us = await woItems.users.select({ id: targetUserId(c) })
            assert.strict.equal(us[0].description, ok ? `desc-by-${c.key}` : 'desc-orig', '目標使用者之 description')
            let n = size(await woItems.users.select())
            assert.strict.equal(n, 3 + callers.length, '使用者筆數不變(整批存回不得誤刪)')
        },
    },
    {
        key: 'kpfun adminResetUserPassword',
        perm: 'writeUsers',
        run: (c) => callFapi('adminResetUserPassword', [c.token, 'eng', targetUserId(c)]),
        checkOk: (r) => assert.strict.equal(r.val.state, 'success'),
        after: async (c, ok) => {
            let us = await woItems.users.select({ id: targetUserId(c) })
            assert.strict.equal(us[0].isForceChangePw, ok ? 'y' : 'n', '重設成功才標記強制變更密碼')
            assert.strict.equal(us[0].password !== 'not-used', ok, '重設成功才改寫密碼')
        },
    },
    {
        key: 'kpfun getTokensList',
        perm: 'readTokens',
        run: (c) => callFapi('getTokensList', [c.token]),
        checkOk: (r) => assert.ok(Array.isArray(r.val) && r.val.some((t) => t.token === 'perm-probe')),
    },
    {
        key: 'kpfun updateTokensList',
        perm: 'writeTokens',
        run: async (c) => {
            let rows = await getRowsForSave('tokens')
            let row = rows.find((t) => t.id === 'id-perm-probe')
            row.perms = ['readStats']
            return callFapi('updateTokensList', [c.token, 'eng', rows])
        },
        after: async (c, ok) => {
            let ts = await woItems.tokens.select({ id: 'id-perm-probe' })
            assert.deepStrictEqual(ts[0].perms, ok ? ['readStats'] : [], '探針 app token 之 perms')
        },
    },
    {
        key: 'kpfun getIpsList',
        perm: 'readIps',
        run: (c) => callFapi('getIpsList', [c.token]),
        checkOk: (r) => assert.ok(Array.isArray(r.val) && r.val.some((v) => v.id === 'id-perm-ip')),
    },
    {
        key: 'kpfun updateIpsList',
        perm: 'writeIps',
        run: async (c) => {
            let rows = await getRowsForSave('ips')
            rows.find((v) => v.id === 'id-perm-ip').ip = '192.0.2.11'
            return callFapi('updateIpsList', [c.token, 'eng', rows])
        },
        after: async (c, ok) => {
            let vs = await woItems.ips.select({ id: 'id-perm-ip' })
            assert.strict.equal(vs[0].ip, ok ? '192.0.2.11' : '192.0.2.10', 'ip 列')
        },
    },
    ...['getStaUserSummary', 'getStaTokenSummary', 'getStaIpSummary', 'getStaUserAccountLogin', 'getStaToken', 'getStaIp'].map((fn) => ({
        key: `kpfun ${fn}`,
        perm: 'readStats',
        run: (c) => callFapi(fn, [c.token]),
    })),
]


function size(v) {
    return Array.isArray(v) ? v.length : 0
}


//期望: admin 全通過; viewer 全拒(重設密碼為其專屬 key); app 依有效權限
function expectOf(c, op) {
    if (c.kind === 'admin') {
        return { ok: true }
    }
    if (c.kind === 'viewer') {
        return { ok: false, err: op.key === 'kpfun adminResetUserPassword' ? 'adminResetPasswordForbidden' : 'tokenExpired' }
    }
    if (c.expect.includes(op.perm)) {
        return { ok: true }
    }
    return { ok: false, err: 'tokenExpired' }
}


//讀取 t0 之後有寫入之 log 檔全文
function readLogsSince(t0) {
    let text = ''
    for (let f of fs.readdirSync(logFd)) {
        let p = path.join(logFd, f)
        if (fs.statSync(p).mtimeMs >= t0 - 1000) {
            text += fs.readFileSync(p, 'utf8')
        }
    }
    return text
}


describe('應用系統金鑰權限閘 — 17 個權限閘 × 13 種呼叫者 (ADR-069)', function() {
    this.timeout(180000)

    before(async function() {
        await startServersOnce()
        //SMTP 導向必敗之 127.0.0.1:1: 重設密碼路徑寄信失敗不阻斷(既有契約), 避免測試對外寄信
        await restartBackend(genTempSettings({}), {
            EM_SRC_HOST: '127.0.0.1',
            EM_SRC_PORT: '1',
            EM_SRC_PW: 'x',
            EM_SRC_EMAIL: 'example@gmail.com',
        })
    })

    after(async function() {
        await deleteNonBaseSeed()
        await restartBackend('./settings.json') //還原預設 settings 與環境
    })

    beforeEach(async function() {
        await resetToBaseSeed()
        await insertFixtures()
    })

    afterEach(async function() {
        await deleteNonBaseSeed()
    })


    for (let c of callers) {
        it(`PERM-A-001-matrix[${c.key}]: 各權限閘之通過 / 拒絕與寫入副作用符合有效權限`, async function() {
            let miss = []
            for (let op of ops) {
                let exp = expectOf(c, op)
                let r = await op.run(c)
                if (r.ok !== exp.ok) {
                    miss.push(`${op.key}: 預期 ${exp.ok ? '通過' : `拒絕(${exp.err})`}, 實際 ${r.ok ? '通過' : `拒絕(${r.err})`}`)
                    continue
                }
                try {
                    if (r.ok && op.checkOk) {
                        op.checkOk(r)
                    }
                    if (!r.ok) {
                        assert.strict.equal(r.err, exp.err, '拒絕之對外 key')
                    }
                    if (op.after) {
                        await op.after(c, r.ok)
                    }
                }
                catch (err) {
                    miss.push(`${op.key}: ${err.message}`)
                }
            }
            assert.strict.equal(miss.length, 0, `[${c.key}] 不符 ${miss.length} 項:\n  ${miss.join('\n  ')}`)
        })
    }


    it('PERM-A-002-self-ops-not-gated: 自身權杖操作不需權限 — 僅基本權限之 app token 可 checkToken(HTTP 與 kpfun)並取得自身虛擬使用者', async function() {
        let r1 = await httpApi('checkToken', { token: 'perm-app-base' })
        assert.strict.equal(r1.ok, true, `HTTP checkToken: ${JSON.stringify(r1)}`)
        assert.strict.equal(r1.val, true)
        let r2 = await callFapi('checkToken', ['perm-app-base'])
        assert.strict.equal(r2.ok, true, `kpfun checkToken: ${JSON.stringify(r2)}`)
        let r3 = await callFapi('getUserByToken', ['perm-app-base'])
        assert.strict.equal(r3.ok, true, `kpfun getUserByToken: ${JSON.stringify(r3)}`)
        assert.strict.equal(r3.val.id, 'id-perm-app-base')
        assert.strict.equal(r3.val.isApp, 'y')
    })


    it('PERM-A-003-grant-revoke-immediate: admin 於金鑰清單授予 readTokens 後 app 立即可讀金鑰清單, 撤銷後立即恢復拒絕', async function() {
        let before = await callFapi('getTokensList', ['perm-app-base'])
        assert.strict.equal(before.ok, false, '授予前應拒絕')

        let rows = await getRowsForSave('tokens')
        rows.find((t) => t.id === 'id-perm-app-base').perms = ['readTokens']
        let g = await callFapi('updateTokensList', ['token-for-admin', 'eng', rows])
        assert.strict.equal(g.ok, true, `授予: ${JSON.stringify(g)}`)
        let granted = await callFapi('getTokensList', ['perm-app-base'])
        assert.strict.equal(granted.ok, true, `授予後應通過: ${JSON.stringify(granted.err)}`)
        let row = granted.val.find((t) => t.id === 'id-perm-app-base')
        assert.deepStrictEqual(row.perms, ['readTokens'], '金鑰清單應回傳 perms 陣列(後台顯示所需)')

        rows = await getRowsForSave('tokens')
        rows.find((t) => t.id === 'id-perm-app-base').perms = []
        let v = await callFapi('updateTokensList', ['token-for-admin', 'eng', rows])
        assert.strict.equal(v.ok, true, `撤銷: ${JSON.stringify(v)}`)
        let revoked = await callFapi('getTokensList', ['perm-app-base'])
        assert.strict.equal(revoked.ok, false, '撤銷後應拒絕')
        assert.strict.equal(revoked.err, 'tokenExpired')
    })


    it('PERM-A-004-write-validate: perms 須為已登錄權限字串之陣列, 否則整批 reject tokenPermsInvalid 且不寫入', async function() {
        for (let bad of ['readTokens', ['readToken'], ['readTokens', 1], { readTokens: true }]) {
            let rows = await getRowsForSave('tokens')
            rows.find((t) => t.id === 'id-perm-probe').perms = bad
            rows.find((t) => t.id === 'id-perm-app-base').perms = ['readIps'] //同批之合法變更亦不得寫入
            let r = await callFapi('updateTokensList', ['token-for-admin', 'eng', rows])
            assert.strict.equal(r.ok, false, `perms=${JSON.stringify(bad)} 應 reject`)
            assert.strict.equal(r.err, 'tokenPermsInvalid', `perms=${JSON.stringify(bad)} 之 key`)
            let ts = await woItems.tokens.select({ id: 'id-perm-app-base' })
            assert.deepStrictEqual(ts[0].perms, [], `perms=${JSON.stringify(bad)}: 同批合法變更不得寫入`)
        }
    })


    it('PERM-A-005-write-normalize: 未帶 perms 之列存為空陣列; 重複與亂序存為去重並依全集排序; DB 既有之毀損值與無 perms 欄之舊列未被修改時可整批存回並正規化為空陣列', async function() {
        let rows = await getRowsForSave('tokens')
        delete rows.find((t) => t.id === 'id-perm-probe').perms //舊版前端送回之列無 perms 鍵
        rows.find((t) => t.id === 'id-perm-app-base').perms = ['readStats', 'readTokens', 'readStats']
        //id-perm-app-corrupt (DB 為字串 'writeUsers') 與 id-perm-app-legacy (DB 無 perms 欄) 原樣送回
        let r = await callFapi('updateTokensList', ['token-for-admin', 'eng', rows])
        assert.strict.equal(r.ok, true, JSON.stringify(r))
        let probe = await woItems.tokens.select({ id: 'id-perm-probe' })
        assert.deepStrictEqual(probe[0].perms, [])
        let base = await woItems.tokens.select({ id: 'id-perm-app-base' })
        assert.deepStrictEqual(base[0].perms, ['readTokens', 'readStats'])
        let corrupt = await woItems.tokens.select({ id: 'id-perm-app-corrupt' })
        assert.deepStrictEqual(corrupt[0].perms, [], '毀損值正規化為空陣列(有效權限與讀取端 fail closed 相同, 僅基本權限)')
        let legacy = await woItems.tokens.select({ id: 'id-perm-app-legacy' })
        assert.deepStrictEqual(legacy[0].perms, [])
    })


    it('PERM-A-007-shrink-exact: 權限由多項改為較少項(含不同元素)時精確儲存, 不殘留舊陣列尾端元素; 撤銷後之權限立即失效', async function() {
        let rows = await getRowsForSave('tokens')
        rows.find((t) => t.id === 'id-perm-app-base').perms = ['readTokens', 'writeIps', 'readStats']
        let r1 = await callFapi('updateTokensList', ['token-for-admin', 'eng', rows])
        assert.strict.equal(r1.ok, true, JSON.stringify(r1))

        rows = await getRowsForSave('tokens')
        rows.find((t) => t.id === 'id-perm-app-base').perms = ['readIps']
        let r2 = await callFapi('updateTokensList', ['token-for-admin', 'eng', rows])
        assert.strict.equal(r2.ok, true, JSON.stringify(r2))
        let ts = await woItems.tokens.select({ id: 'id-perm-app-base' })
        assert.deepStrictEqual(ts[0].perms, ['readIps'], '儲存值應恰為新陣列')

        let ips = await callFapi('getIpsList', ['perm-app-base'])
        assert.strict.equal(ips.ok, true, '新授予之 readIps 應生效')
        for (let fn of ['getTokensList', 'getStaIp']) {
            let x = await callFapi(fn, ['perm-app-base'])
            assert.strict.equal(x.ok, false, `已撤銷之權限不得殘留 (${fn})`)
        }
    })


    it('PERM-A-006-audit-log: app token 缺權限被拒時, srLog 記 appTokenPermDenied(含 perm 與 userId), 權杖遮罩', async function() {
        let t0 = Date.now()
        let r = await callFapi('getIpsList', ['perm-app-base'])
        assert.strict.equal(r.ok, false)
        await new Promise((resolve) => setTimeout(resolve, 2500)) //等 w-syslog 落檔
        let lines = readLogsSince(t0).split(/\r?\n/).filter((l) => l.includes('"appTokenPermDenied"'))
        let hit = lines.find((l) => l.includes('"perm":"readIps"') && l.includes('"userId":"id-perm-app-base"'))
        assert.ok(hit, `應有 appTokenPermDenied 紀錄(perm=readIps), 實際: ${lines.slice(-3).join(' | ')}`)
        assert.strict.equal(hit.includes('"perm-app-base"'), false, '紀錄不得含權杖全文')
    })

})
