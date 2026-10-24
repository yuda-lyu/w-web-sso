//unit-writeContract.test.mjs — 寫入契約(前後端同一來源)之完整性與基準前端工具
//
// 依據:
//   - 規格 C:\opensrcOper\dspec\多人同時編輯之寫入契約.md §3(契約)、§4(欄位三分類)、§5(列摘要與基準 h1)、§9(盤點:每張表 × 每欄)、§13 V9、V10
//   - 規則帳本 sgud/rule/rulebook_concurrency.md R-CONC-02(每表每欄皆分類)、R-CONC-05(前端以 buildBaseline 對畫面所見之列自算基準)
// 守護: 新增 / 改名 schema 欄位時, 必須同步補分類(WC-01), 否則此檔失敗——避免新欄位未入契約而被整列回寫或靜默不受保護.

import assert from 'assert'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { buildBaseline, compareBaseline, digestRow, checkContract } from 'w-serv-orm/src/baseline.mjs'
import ds from '../src/schema/index.mjs'
import contracts from '../src/writeContracts/index.mjs'
import { baselineOfUsers, baselineOfIps, baselineOfTokens, isSameSnapshot } from '../src/baselineOf.mjs'


//專案根(本檔位於 test/); 場景 B: 讀套件自身之原始碼, 以本檔位置為準
let root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')


//以規格 / 帳本逐欄手寫之預期分類(與 src/writeContracts 獨立複本, 契約被誤改時才會失敗)
//fields: 客戶端欄位 ∪ 雙方欄位(後台可改, 系統亦會寫); serverOnly: 伺服器專有
let expected = {
    users: {
        fields: ['account', 'name', 'email', 'description', 'from', 'redir', 'isAdmin', 'timeVerified', 'timeExpired', 'timeBlocked', 'isForceChangePw', 'isActive'],
        dual: ['timeVerified', 'timeBlocked', 'isForceChangePw'], //雙方欄位: 必須入基準(系統改動後持舊畫面存檔即被拒), 不得列為伺服器專有
        serverOnly: ['password', 'tokenVerify', 'userId', 'timeCreate', 'userIdUpdate', 'timeUpdate'],
        orderKey: 'order',
    },
    tokens: {
        fields: ['token', 'userId', 'isApp', 'perms', 'timeCreate', 'timeEnd'],
        dual: ['timeEnd'],
        serverOnly: ['timeUpdate', 'userIdUpdate', 'appUsage', 'appName'], //appUsage / appName: 應用系統金鑰之用途與名稱, 只由 createAppToken 鑄造時寫入, 其後不可變更 (ADR-095)
        orderKey: undefined,
    },
    ips: {
        fields: ['ip', 'timeBlocked'],
        dual: ['timeBlocked'],
        serverOnly: ['userIdUpdate'],
        orderKey: undefined,
    },
}


describe('寫入契約之完整性 (R-CONC-02, 規格 §3 §4 §9)', function() {

    it('WC-01 每張表每欄皆已分類: pk ∪ orderKey ∪ fields ∪ serverOnly 恰等於 schema 全欄, 且 fields 與 serverOnly 無交集', function() {
        for (let name of ['users', 'tokens', 'ips']) {
            let c = contracts[name]
            checkContract(c)
            let all = [c.pk, ...(c.orderKey ? [c.orderKey] : []), ...c.fields, ...c.serverOnly]
            assert.strictEqual(new Set(all).size, all.length, `${name}: 欄位不得重複分類`)
            assert.deepStrictEqual([...all].sort(), [...ds[name].keys].sort(), `${name}: 與 schema 全欄一致(新增欄位須補分類)`)
            assert.deepStrictEqual(c.fields.filter((k) => c.serverOnly.includes(k)), [], `${name}: fields ∩ serverOnly = ∅`)
            assert.strictEqual(c.table, name)
            assert.strictEqual(c.pk, 'id')
        }
    })

    it('WC-02 [規格 §4] 逐欄分類符合手寫預期; 雙方欄位入 fields(不得改列伺服器專有或不入基準)', function() {
        for (let name of ['users', 'tokens', 'ips']) {
            let c = contracts[name]
            assert.deepStrictEqual(c.fields, expected[name].fields, `${name}.fields`)
            assert.deepStrictEqual([...c.serverOnly].sort(), [...expected[name].serverOnly].sort(), `${name}.serverOnly`)
            assert.strictEqual(c.orderKey, expected[name].orderKey, `${name}.orderKey`)
            for (let k of expected[name].dual) {
                assert.ok(c.fields.includes(k), `${name}.${k} 為雙方欄位, 須入 fields`)
                assert.ok(!c.serverOnly.includes(k), `${name}.${k} 不得列為伺服器專有`)
            }
        }
        //tokens.userId 為擁有者, 規格 §3 明列入 fields; users 之 password / tokenVerify 為伺服器專有
        assert.ok(contracts.tokens.fields.includes('userId'))
        assert.ok(contracts.users.serverOnly.includes('password') && contracts.users.serverOnly.includes('tokenVerify'))
    })

    it('WC-03 [R-CONC-03] tokens 兩份契約: 同 fields、scope 互補(isApp === \'y\' 為 app 列, 其餘為 session 列)', function() {
        let a = contracts.tokens
        let s = contracts.tokensSession
        checkContract(s)
        assert.deepStrictEqual(s.fields, a.fields)
        assert.deepStrictEqual(s.serverOnly, a.serverOnly)
        for (let v of ['y', 'n', '', undefined, null, 'Y', 'yes']) {
            let row = { id: 'x', isApp: v }
            assert.strictEqual(a.scope(row) !== s.scope(row), true, `isApp=${String(v)} 恰屬其一`)
            assert.strictEqual(a.scope(row), v === 'y', `isApp=${String(v)}`)
        }
    })

    it('WC-04 [§5 摘要穩定] 凍結向量: 固定樣本列之摘要(欄位政策或正規化規則被改即失敗, 須開 h2)', function() {
        let u = { id: 'u1', order: 1, account: 'a', name: 'n', email: 'e@x.com', description: '', from: '', redir: '', isAdmin: 'n', timeVerified: '2026-01-01T00:00:00.000+08:00', timeExpired: '', timeBlocked: '', isForceChangePw: 'n', isActive: 'y', password: 'P', tokenVerify: 'T' }
        let t = { id: 't1', token: 'tk', userId: 'o1', isApp: 'y', perms: ['readStats', 'readTokens'], timeCreate: '2026-01-01T00:00:00.000+08:00', timeEnd: '2030-01-01T00:00:00.000+08:00', timeUpdate: 'X', userIdUpdate: 'Y' }
        let i = { id: 'i1', ip: '10.0.0.1', timeBlocked: '' }
        let d = { users: digestRow(u, contracts.users), tokens: digestRow(t, contracts.tokens), ips: digestRow(i, contracts.ips) }
        for (let k of Object.keys(d)) {
            assert.match(d[k], /^h1:[0-9a-f]{14}$/, k)
        }
        //伺服器專有欄位與名次欄不入摘要
        assert.strictEqual(digestRow({ ...u, password: 'Q', tokenVerify: 'Z', userId: 'x', timeCreate: 'x', userIdUpdate: 'x', timeUpdate: 'x', order: 99 }, contracts.users), d.users)
        assert.strictEqual(digestRow({ ...t, timeUpdate: 'Z', userIdUpdate: 'Z' }, contracts.tokens), d.tokens)
        //客戶端 / 雙方欄位入摘要
        assert.notStrictEqual(digestRow({ ...u, timeBlocked: '2026-01-01T00:00:00.000+08:00' }, contracts.users), d.users)
        assert.notStrictEqual(digestRow({ ...u, isForceChangePw: 'y' }, contracts.users), d.users)
        assert.notStrictEqual(digestRow({ ...t, timeEnd: '2031-01-01T00:00:00.000+08:00' }, contracts.tokens), d.tokens)
        assert.notStrictEqual(digestRow({ ...t, userId: 'o2' }, contracts.tokens), d.tokens)
        //凍結值
        assert.deepStrictEqual(d, FROZEN, `凍結向量變動: ${JSON.stringify(d)}`)
    })

})


//凍結向量(2026-10-23, 契約 h1)
let FROZEN = {
    users: 'h1:0e038cab220914',
    tokens: 'h1:0a6c3af97ff22a',
    ips: 'h1:06aa0725d7505c',
}


describe('前端基準工具 (src/baselineOf.mjs, R-CONC-05)', function() {

    let usersRows = () => [
        { id: 'u2', order: 2, account: 'b', name: 'B', email: 'b@x.com', description: '', from: '', redir: '', isAdmin: 'n', timeVerified: '2026-01-01T00:00:00.000+08:00', timeExpired: '', timeBlocked: '', isForceChangePw: 'n', isActive: 'y' },
        { id: 'u1', order: 1, account: 'a', name: 'A', email: 'a@x.com', description: '', from: '', redir: '', isAdmin: 'y', timeVerified: '2026-01-01T00:00:00.000+08:00', timeExpired: '', timeBlocked: '', isForceChangePw: 'n', isActive: 'y' },
        { id: 'u3', order: '', account: 'c', name: 'C', email: 'c@x.com', isAdmin: 'n', timeVerified: null, isActive: 'y' }, //自助註冊: order 為空字串、缺欄、null
    ]

    it('WC-05 [V9、規格 §5] 基準之序即名次: 空字串 order 排最後; 與輸入列序無關; 他人重排被偵測、重編號(名次不變)不被偵測', function() {
        let b1 = baselineOfUsers(usersRows())
        assert.deepStrictEqual(b1.map((e) => e[0]), ['u1', 'u2', 'u3'])
        assert.deepStrictEqual(baselineOfUsers(usersRows().reverse()), b1, '與輸入列序無關')
        //重編號(名次不變)
        let renum = usersRows().map((r) => (r.order === '' ? r : { ...r, order: r.order * 10 }))
        assert.deepStrictEqual(compareBaseline(renum, b1, contracts.users), { ok: true })
        //重排(u2 排到 u1 前)
        let reorder = usersRows().map((r) => (r.id === 'u2' ? { ...r, order: 0 } : r))
        let c = compareBaseline(reorder, b1, contracts.users)
        assert.strictEqual(c.ok, false)
        assert.strictEqual(c.reordered, true)
    })

    it('WC-06 [V10] 前端算之基準 = 伺服端新鮮讀取所算(經 JSON 傳輸, 含缺欄 / null / 陣列 perms)', function() {
        let rows = usersRows()
        let viaJson = JSON.parse(JSON.stringify(rows))
        assert.deepStrictEqual(baselineOfUsers(viaJson), buildBaseline(rows, contracts.users))
        let ts = [
            { id: 't1', token: 'a', userId: 'o', isApp: 'y', perms: ['readStats'], timeCreate: 'c', timeEnd: 'e' },
            { id: 't2', token: 'b', userId: 'o', isApp: 'y', perms: null, timeCreate: 'c', timeEnd: 'e' },
            { id: 't3', token: 'c', userId: 'o', isApp: 'y', timeCreate: 'c', timeEnd: 'e' },
            { id: 't4', token: 'd', userId: 'o', isApp: 'n', perms: [], timeCreate: 'c', timeEnd: 'e' },
            { id: 't5', token: 'e', userId: 'o', isApp: '', perms: [], timeCreate: 'c', timeEnd: 'e' },
        ]
        let bt = baselineOfTokens(JSON.parse(JSON.stringify(ts)))
        assert.deepStrictEqual(bt.baseline, buildBaseline(ts, contracts.tokens))
        assert.deepStrictEqual(bt.baselineSession, buildBaseline(ts, contracts.tokensSession))
        assert.deepStrictEqual(bt.baseline.map((e) => e[0]), ['t1', 't2', 't3'], 'app 列')
        assert.deepStrictEqual(bt.baselineSession.map((e) => e[0]), ['t4', 't5'], 'session 列')
        //perms: null / 缺欄 摘要相同(頂層空值等價); 陣列 [] 與空值不同(巢狀值不套空值等價)
        let tb = { id: 'tx', token: 'z', userId: 'o', isApp: 'y', timeCreate: 'c', timeEnd: 'e' }
        assert.strictEqual(digestRow({ ...tb, perms: null }, contracts.tokens), digestRow(tb, contracts.tokens))
        assert.notStrictEqual(digestRow({ ...tb, perms: [] }, contracts.tokens), digestRow(tb, contracts.tokens))
        let ips = [{ id: 'i1', ip: '1.1.1.1' }, { id: 'i2', ip: '2.2.2.2', timeBlocked: '' }]
        assert.deepStrictEqual(baselineOfIps(JSON.parse(JSON.stringify(ips))), buildBaseline(ips, contracts.ips))
    })

    it('WC-07 算不出基準(列主鍵缺漏或重複)回 null, 不拋錯(送出時被後端以 saveBaselineFormat 拒收, 不降級為不帶基準)', function() {
        assert.strictEqual(baselineOfUsers([{ id: 'a' }, { id: 'a' }]), null)
        assert.strictEqual(baselineOfIps([{ ip: 'x' }]), null)
        assert.strictEqual(baselineOfTokens([{ id: '' }]), null)
        assert.strictEqual(baselineOfTokens([{ id: 'a', isApp: 'y' }, { id: 'a', isApp: 'y' }]), null)
    })

    it('WC-08 isSameSnapshot: 契約欄位摘要全相同才保留現畫面; 列數、主鍵或欄位值不同皆須以伺服端列取代', function() {
        let a = [{ id: '1', ip: 'x', timeBlocked: '' }, { id: '2', ip: 'y', timeBlocked: '' }]
        assert.strictEqual(isSameSnapshot(a, [a[1], a[0]], contracts.ips), true, '與列序無關')
        assert.strictEqual(isSameSnapshot(a, [...a, { id: '3', ip: 'z' }], contracts.ips), false, '列數不同')
        assert.strictEqual(isSameSnapshot(a, [a[0], { id: '9', ip: 'y' }], contracts.ips), false, '主鍵不同')
        assert.strictEqual(isSameSnapshot(a, [a[0], { ...a[1], timeBlocked: '2030' }], contracts.ips), false, '欄位值不同')
        assert.strictEqual(isSameSnapshot(a, [a[0], { ...a[1], userIdUpdate: 'u', timeUpdate: 't' }], contracts.ips), true, '伺服器專有欄位不入摘要')
        assert.strictEqual(isSameSnapshot(null, a, contracts.ips), false)
        assert.strictEqual(isSameSnapshot([{ id: '1', ip: 'x' }, { id: '1', ip: 'x' }], [{ id: '1', ip: 'x' }, { id: '1', ip: 'x' }], contracts.ips), false, '送出列主鍵重複')
    })

})


//以下兩案為「接線」之靜態守護(讀原始碼比對), 不是行為證明: 行為由 unit-saveBaseline / unit-tablock(共用同一鎖管理器)與 e2e-concurrency(三個頁面真送基準、舊畫面存檔被拒)證明;
//靜態守護的用途是接線被改壞時(外審 sol#13、#14 之假設情境)在最快的一層就紅, 不必等到 e2e 才發現
describe('接線之靜態守護 (外審 sol#13、#14)', function() {

    let read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8')

    it('WC-09 server/WWebSso.mjs: withTabLocks / guardWrite 只取自 WServOrm 實例一次, 且同一組同時注入 procCore 與 procProtect(系統直寫與後台存檔共用鎖管理器, 規格 §12)', function() {
        let src = read('server/WWebSso.mjs').replace(/\/\/.*$/gm, '') //去行尾註解(註解可提及名稱)
        let occ = src.match(/\bwithTabLocks\b/g) || []
        assert.strictEqual(occ.length, 3, '只出現三處: 自 wp 取出、注入 procCore、注入 procProtect')
        assert.ok(/let \{[^}]*\bwithTabLocks\b[^}]*\} = wp\b/.test(src), '自 WServOrm 實例(wp)取出')
        assert.ok(/procCore\([^)]*[{,]\s*withTabLocks,\s*guardWrite\s*\}\)/.test(src), 'procCore 以同名簡寫注入 withTabLocks 與 guardWrite')
        assert.ok(/procProtect\(\s*woItems,\s*p,\s*\{[^}]*\bwithTabLocks,/.test(src.replace(/\r?\n/g, ' ')), 'procProtect 以同名簡寫(withTabLocks,)注入, 非另組之鎖管理器')
        assert.ok(!/withTabLocks\s*[:=]\s*(?!wp)/.test(src), '無任何 withTabLocks: x / withTabLocks = x 之改接')
    })

    it('WC-10 三個清單頁: 存檔呼叫皆帶第 4 參數基準(舊畫面存檔才會被後端拒收), 且存檔成功後以伺服端重新讀取之列自算新基準', function() {
        let pages = [
            ['src/components/LayoutContentUsers.vue', /updateUsersList\([^)]*\{\s*baseline:\s*vo\.baseline\s*\}\s*\)/, /vo\.baseline\s*=\s*baselineOfUsers\(res\)/g],
            ['src/components/LayoutContentIps.vue', /updateIpsList\([^)]*\{\s*baseline:\s*vo\.baseline\s*\}\s*\)/, /vo\.baseline\s*=\s*baselineOfIps\(res\)/g],
            ['src/components/LayoutContentTokens.vue', /updateTokensList\([^)]*baselineSession:\s*vo\.baselines\.baselineSession\s*\}/, /vo\.baselines\s*=\s*baselineOfTokens\(res\)/g],
        ]
        for (let [rel, reSave, reLoad] of pages) {
            let src = read(rel)
            assert.ok(reSave.test(src), `${rel}: 存檔呼叫帶基準`)
            assert.ok((src.match(reLoad) || []).length >= 2, `${rel}: 載入與存檔成功後各自算基準(至少 2 處)`)
        }
    })

})
