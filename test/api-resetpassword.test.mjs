import assert from 'assert'
import fs from 'fs'
import path from 'path'
import ot from 'dayjs'
import ds from '../src/schema/index.mjs'
import hashPassword from '../server/hashPassword.mjs'
import { woItems } from '../g.mOrm.mjs'
import { startServersOnce, callFapi } from './api-setup.mjs'


//
// 對應 spec/流程_後台重設使用者密碼.md
// 此檔僅含 "API 契約" cases (4xx/5xx 拒絕 / DB side effect / template 內容驗證),
// UI flow 走 test/e2e-resetpassword.test.mjs (Playwright + baseline).
//
// 涵蓋 API-001 ~ API-009
//

let salt = '{salt}'


//testUsers 與 e2e-resetpassword.test.mjs 相同 (id 不同避免互撞),
//但因 mocha 跑序兩檔可能交錯, 本檔用獨立前綴 ap- (api) 避免 collision
let testUsers = {
    admin: {
        id: 'id-ap-rp-admin',
        account: 'ap-rp-admin',
        rawPassword: 'Pw@aprpadmin1',
        name: 'API RP Admin',
        email: 'ap-rp-admin@test.com',
        isAdmin: 'y',
        redir: 'http://127.0.0.1:8080/?view=backstage&token={token}',
    },
    targetEng: {
        id: 'id-ap-rp-target-eng',
        account: 'ap-rp-target-eng',
        rawPassword: 'Pw@aprpEng9',
        name: 'API RP Target Eng',
        email: 'ap-rp-target-eng@test.com',
        isAdmin: 'n',
        redir: 'http://127.0.0.1:8080/?view=user&token={token}',
    },
    attacker: {
        id: 'id-ap-rp-attacker',
        account: 'ap-rp-attacker',
        rawPassword: 'Pw@aprpatk001',
        name: 'API RP Attacker',
        email: 'ap-rp-attacker@test.com',
        isAdmin: 'n',
        redir: 'http://127.0.0.1:8080/?view=user&token={token}',
    },
}

let userTokens = {}


async function insertTestUsersAndTokens() {
    let arr = Object.values(testUsers)
    let rs = arr.map((u, k) => {
        let v = ds.users.funNew({
            order: 800 + k,
            account: u.account,
            password: hashPassword(u.rawPassword, salt),
            name: u.name,
            email: u.email,
            description: '',
            from: 'test',
            redir: u.redir,
            isAdmin: u.isAdmin,
            timeVerified: '2025-01-01T00:00:00.000+08:00',
            timeExpired: '2030-01-01T00:00:00.000+08:00',
            timeBlocked: '',
            isActive: 'y',
        })
        v.id = u.id
        v.isAdmin = u.isAdmin
        v.timeVerified = '2025-01-01T00:00:00.000+08:00'
        v.timeExpired = '2030-01-01T00:00:00.000+08:00'
        v.timeBlocked = ''
        return v
    })
    await woItems.users.insert(rs)

    let tks = []
    userTokens = {}
    for (let key of ['admin', 'attacker']) {
        let u = testUsers[key]
        let t = ds.tokens.funNew({ userId: u.id })
        t.timeEnd = ot().add(60, 'minute').format('YYYY-MM-DDTHH:mm:ss.SSSZ')
        userTokens[u.id] = t.token
        tks.push(t)
    }
    await woItems.tokens.insert(tks)
}


async function deleteTestUsersAndTokens() {
    for (let u of Object.values(testUsers)) {
        await woItems.users.del({ id: u.id }).catch(() => {})
        let _tks = await woItems.tokens.select({ userId: u.id }).catch(() => [])
        for (let _tk of _tks) await woItems.tokens.del({ id: _tk.id }).catch(() => {})
    }
}


describe('ResetPassword API — adminResetUserPassword 拒絕情境 (API-001/003/004/005/006)', function() {
    this.timeout(60000)

    before(async function() {
        this.timeout(180000)
        await startServersOnce()
        await deleteTestUsersAndTokens()
        await insertTestUsersAndTokens()
    })

    after(async function() {
        await deleteTestUsersAndTokens()
    })

    it('API-003-cannot-reset-self: admin 對自己觸發, reject "cannot reset self"', async function() {
        let adminToken = userTokens[testUsers.admin.id]
        let r = await callFapi('adminResetUserPassword', [adminToken, 'eng', testUsers.admin.id])
        assert.strict.equal(r.ok, false, `預期 reject, 實際 resolve: ${JSON.stringify(r)}`)
        assert.strict.equal(r.err, 'cannot reset self', `錯誤訊息應為 'cannot reset self', 實際: ${r.err}`)
    })

    it('API-004-forbidden-non-admin: 非 admin 呼叫, reject "forbidden"', async function() {
        let attackerToken = userTokens[testUsers.attacker.id]
        let r = await callFapi('adminResetUserPassword', [attackerToken, 'eng', testUsers.targetEng.id])
        assert.strict.equal(r.ok, false, `預期 reject, 實際 resolve: ${JSON.stringify(r)}`)
        assert.strict.equal(r.err, 'forbidden', `錯誤訊息應為 'forbidden', 實際: ${r.err}`)
    })

    it('API-005-user-not-found: admin 對不存在 userId 觸發, reject "user not found"', async function() {
        let adminToken = userTokens[testUsers.admin.id]
        let r = await callFapi('adminResetUserPassword', [adminToken, 'eng', 'id-not-exist-xyz'])
        assert.strict.equal(r.ok, false, `預期 reject, 實際 resolve: ${JSON.stringify(r)}`)
        assert.strict.equal(r.err, 'user not found', `錯誤訊息應為 'user not found', 實際: ${r.err}`)
    })

    it('API-006-invalid-userId-empty: admin 帶空字串 userId, reject "invalid userId"', async function() {
        let adminToken = userTokens[testUsers.admin.id]
        let r = await callFapi('adminResetUserPassword', [adminToken, 'eng', ''])
        assert.strict.equal(r.ok, false, `預期 reject, 實際 resolve: ${JSON.stringify(r)}`)
        assert.strict.equal(r.err, 'invalid userId', `錯誤訊息應為 'invalid userId', 實際: ${r.err}`)
    })

    it('API-001-happy-path-side-effect: admin 對 targetEng 觸發成功, DB password 變更 + isForceChangePw=y + 回應無明文', async function() {
        //起點: target isForceChangePw=n + 已知 password hash
        await woItems.users.save({
            id: testUsers.targetEng.id,
            password: hashPassword(testUsers.targetEng.rawPassword, salt),
            isForceChangePw: 'n',
        })
        let beforeUs = await woItems.users.select({ id: testUsers.targetEng.id })
        let originalPwHash = beforeUs[0].password
        assert.strict.equal(beforeUs[0].isForceChangePw, 'n', `起點 isForceChangePw 應為 'n'`)

        let adminToken = userTokens[testUsers.admin.id]
        let r = await callFapi('adminResetUserPassword', [adminToken, 'eng', testUsers.targetEng.id])
        assert.strict.equal(r.ok, true, `預期 resolve, 實際 reject: ${r.err}`)
        assert.strict.equal(r.val.state, 'success', `回應 state 應為 success`)
        assert.strict.equal(r.val.password, undefined, `回應不應含明文密碼`)
        assert.strict.equal(r.val.newPassword, undefined, `回應不應含明文密碼`)

        let afterUs = await woItems.users.select({ id: testUsers.targetEng.id })
        assert.strict.equal(afterUs.length, 1, `target user 仍應存在`)
        assert.strict.equal(afterUs[0].isForceChangePw, 'y', `reset 後 isForceChangePw 應為 'y'`)
        assert.strict.notEqual(afterUs[0].password, originalPwHash, `reset 後 password hash 應改變`)
        assert.strict.notEqual(afterUs[0].password, '', `reset 後 password 不應為空`)
    })

})


describe('ResetPassword API — 後端契約 (API-002/007/008/009)', function() {
    this.timeout(60000)

    before(async function() {
        this.timeout(180000)
        await startServersOnce()
        await deleteTestUsersAndTokens()
        await insertTestUsersAndTokens()
    })

    after(async function() {
        await deleteTestUsersAndTokens()
    })

    it('API-002-smtp-fail-still-success: 測試環境 SMTP 為假, 觸發 reset 仍須 resolve success + DB 更新', async function() {
        await woItems.users.save({
            id: testUsers.targetEng.id,
            password: hashPassword(testUsers.targetEng.rawPassword, salt),
            isForceChangePw: 'n',
        })
        let beforeUs = await woItems.users.select({ id: testUsers.targetEng.id })
        let originalPwHash = beforeUs[0].password

        //settings.json.emSrcPW='{pw}' (placeholder), SMTP auth 必失敗.
        //預期: procCore catch SMTP error, 仍回 {state:'success'} + DB 已更新
        let adminToken = userTokens[testUsers.admin.id]
        let r = await callFapi('adminResetUserPassword', [adminToken, 'eng', testUsers.targetEng.id])
        assert.strict.equal(r.ok, true, `SMTP fail 仍須 resolve, 實際 reject: ${r.err}`)
        assert.strict.equal(r.val.state, 'success', `回應 state 應為 success`)

        let afterUs = await woItems.users.select({ id: testUsers.targetEng.id })
        assert.strict.equal(afterUs[0].isForceChangePw, 'y', `SMTP fail 仍須 isForceChangePw='y', 實際 ${afterUs[0].isForceChangePw}`)
        assert.strict.notEqual(afterUs[0].password, originalPwHash, `SMTP fail 仍須 password hash 更新`)
    })

    it('API-007-email-content-template: resetPasswordEmail-{eng,cht}.html 含 {account}/{newPassword} 且不含 http:// / <a href', function() {
        for (let lang of ['eng', 'cht']) {
            let fp = path.resolve('./server/template', `resetPasswordEmail-${lang}.html`)
            assert.strict.equal(fs.existsSync(fp), true, `template 不存在: ${fp}`)
            let html = fs.readFileSync(fp, 'utf8')
            //spec 二.1: 信件含 account + 明文新密碼
            assert.strict.equal(html.includes('{account}'), true, `[${lang}] template 缺 {account} placeholder`)
            assert.strict.equal(html.includes('{newPassword}'), true, `[${lang}] template 缺 {newPassword} placeholder`)
            assert.strict.equal(html.includes('{sender}'), true, `[${lang}] template 缺 {sender} placeholder`)
            assert.strict.equal(html.includes('{name}'), true, `[${lang}] template 缺 {name} placeholder`)
            //spec 二.1 + 安全性: 信件不含任何連結 (避免 phishing 與 reset 連結攻擊面)
            assert.strict.equal(html.includes('http://'), false, `[${lang}] template 不應含 http:// (spec 規定不含連結)`)
            assert.strict.equal(html.includes('https://'), false, `[${lang}] template 不應含 https:// (spec 規定不含連結)`)
            assert.strict.equal(/<a\s/i.test(html), false, `[${lang}] template 不應含 <a> tag (spec 規定不含連結)`)
        }
    })

    it('API-008-multi-device-tokens-preserved: target 有 2 個既有 token, admin reset 後兩 token 仍存在', async function() {
        let targetId = testUsers.targetEng.id
        let oldTks = await woItems.tokens.select({ userId: targetId }).catch(() => [])
        for (let t of oldTks) await woItems.tokens.del({ id: t.id }).catch(() => {})
        let t1 = ds.tokens.funNew({ userId: targetId })
        let t2 = ds.tokens.funNew({ userId: targetId })
        t1.timeEnd = ot().add(60, 'minute').format('YYYY-MM-DDTHH:mm:ss.SSSZ')
        t2.timeEnd = ot().add(60, 'minute').format('YYYY-MM-DDTHH:mm:ss.SSSZ')
        await woItems.tokens.insert([t1, t2])
        let beforeTks = await woItems.tokens.select({ userId: targetId })
        assert.strict.equal(beforeTks.length, 2, `起點應有 2 個 token, 實際 ${beforeTks.length}`)
        let beforeIds = new Set(beforeTks.map(t => t.id))

        let adminToken = userTokens[testUsers.admin.id]
        let r = await callFapi('adminResetUserPassword', [adminToken, 'eng', targetId])
        assert.strict.equal(r.ok, true, `預期 resolve, 實際 reject: ${r.err}`)

        //spec 二.5: 兩 token 仍存在 (admin reset 不主動清 user token)
        let afterTks = await woItems.tokens.select({ userId: targetId })
        assert.strict.equal(afterTks.length, 2, `reset 後仍應有 2 個 token, 實際 ${afterTks.length}`)
        for (let t of afterTks) {
            assert.strict.equal(beforeIds.has(t.id), true, `reset 後 token id "${t.id}" 不在原 2 個之列 (應為原 token 保留)`)
        }
    })

    it('API-009-notification-email-template: changePasswordEmail-{eng,cht}.html 含 {sender}/{name} placeholder', function() {
        //三.1: 變更成功 → 寄變更通知信 (沿用既有 changePasswordEmail template)
        for (let lang of ['eng', 'cht']) {
            let fp = path.resolve('./server/template', `changePasswordEmail-${lang}.html`)
            assert.strict.equal(fs.existsSync(fp), true, `template 不存在: ${fp}`)
            let html = fs.readFileSync(fp, 'utf8')
            assert.strict.equal(html.includes('{sender}'), true, `[${lang}] template 缺 {sender} placeholder`)
            assert.strict.equal(html.includes('{name}'), true, `[${lang}] template 缺 {name} placeholder`)
            //通知信不應含明文密碼 (使用者已自己設定, 不需也不該再夾帶)
            assert.strict.equal(html.includes('{newPassword}'), false, `[${lang}] 通知信不應含 {newPassword} placeholder`)
            assert.strict.equal(html.includes('{password}'), false, `[${lang}] 通知信不應含 {password} placeholder`)
        }
    })

})
