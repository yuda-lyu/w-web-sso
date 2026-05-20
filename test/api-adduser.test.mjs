import assert from 'assert'
import ot from 'dayjs'
import ds from '../src/schema/index.mjs'
import hashPassword from '../server/hashPassword.mjs'
import { woItems } from '../g.mOrm.mjs'
import { startServersOnce, callFapi } from './api-setup.mjs'


//
// 對應 spec/流程_後台新增使用者.md
// 此檔僅含 "API 契約" cases (updateUsersList reject / DB side effect),
// UI flow (add row + 各 inline 錯誤 + happy save) 走 test/e2e-adduser.test.mjs (Playwright + baseline).
//
// 涵蓋 cases: password-* (策略 reject) / self-lockout-* / happy-path / existing-row-password-preserved
//

let salt = '{salt}'


let testUsers = {
    admin: {
        id: 'id-ap-au-admin',
        account: 'ap-au-admin',
        rawPassword: 'Pw@apauadm1',
        name: 'API AU Admin',
        email: 'ap-au-admin@test.com',
        isAdmin: 'y',
        redir: 'http://127.0.0.1:8080/?view=backstage&token={token}',
    },
    existing: {
        id: 'id-ap-au-existing',
        account: 'ap-au-existing',
        rawPassword: 'Pw@apauexi1',
        name: 'API AU Existing',
        email: 'ap-au-existing@test.com',
        isAdmin: 'n',
        redir: 'http://127.0.0.1:8080/?view=user&token={token}',
    },
}

let userTokens = {}


async function insertTestUsersAndTokens() {
    let arr = Object.values(testUsers)
    let rs = arr.map((u, k) => {
        let v = ds.users.funNew({
            order: 850 + k,
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

    let t = ds.tokens.funNew({ userId: testUsers.admin.id })
    t.timeEnd = ot().add(60, 'minute').format('YYYY-MM-DDTHH:mm:ss.SSSZ')
    userTokens[testUsers.admin.id] = t.token
    await woItems.tokens.insert([t])
}


async function deleteTestUsersAndTokens() {
    async function _delTokensByUserId(userId) {
        let tks = await woItems.tokens.select({ userId }).catch(() => [])
        for (let tk of tks) await woItems.tokens.del({ id: tk.id }).catch(() => {})
    }
    for (let u of Object.values(testUsers)) {
        await woItems.users.del({ id: u.id }).catch(() => {})
        await _delTokensByUserId(u.id)
    }
}


function buildNewRowPlain(account, password, opt = {}) {
    return ds.users.funNew({
        order: opt.order || 999,
        account,
        password,
        name: opt.name || `New ${account}`,
        email: opt.email || `${account}@test.com`,
        description: '',
        from: 'test',
        redir: 'http://127.0.0.1:8080/?view=user&token={token}',
        isAdmin: opt.isAdmin || 'n',
        timeVerified: '',
        timeExpired: '2030-01-01T00:00:00.000+08:00',
        timeBlocked: '',
        isActive: 'y',
    })
}


//把指定 newRow 加到當下表中所有 user (移除 password 欄以模擬前端送出格式)
async function buildAllRowsWithNew(newRow) {
    let allUsers = await woItems.users.select()
    allUsers = allUsers.map((u) => { let c = { ...u }; delete c.password; return c })
    return [...allUsers, newRow]
}


describe('AddUser API — updateUsersList 拒絕情境與副作用', function() {
    this.timeout(60000)

    //per-case 獨立 setup (db reset), 避免 case 之間互相污染
    beforeEach(async function() {
        this.timeout(180000)
        await startServersOnce()
        await deleteTestUsersAndTokens()
        await insertTestUsersAndTokens()
    })

    afterEach(async function() {
        await deleteTestUsersAndTokens()
    })

    it('API-001-password-empty: 新 row password 空, reject', async function() {
        let rows = await buildAllRowsWithNew(buildNewRowPlain('ap-au-bad-empty', '', { email: 'ap-au-bad-empty@test.com' }))
        let r = await callFapi('updateUsersList', [userTokens[testUsers.admin.id], 'eng', rows])
        assert.strict.equal(r.ok, false)
    })

    it('API-002-password-too-short: reject', async function() {
        let rows = await buildAllRowsWithNew(buildNewRowPlain('ap-au-bad-short', 'Ab@1', { email: 'ap-au-bad-short@test.com' }))
        let r = await callFapi('updateUsersList', [userTokens[testUsers.admin.id], 'eng', rows])
        assert.strict.equal(r.ok, false)
    })

    it('API-003-password-no-letter: reject', async function() {
        let rows = await buildAllRowsWithNew(buildNewRowPlain('ap-au-bad-noletter', '12345678@', { email: 'ap-au-bad-noletter@test.com' }))
        let r = await callFapi('updateUsersList', [userTokens[testUsers.admin.id], 'eng', rows])
        assert.strict.equal(r.ok, false)
    })

    it('API-004-password-no-digit: reject', async function() {
        let rows = await buildAllRowsWithNew(buildNewRowPlain('ap-au-bad-nodigit', 'Abcdefg@', { email: 'ap-au-bad-nodigit@test.com' }))
        let r = await callFapi('updateUsersList', [userTokens[testUsers.admin.id], 'eng', rows])
        assert.strict.equal(r.ok, false)
    })

    it('API-005-password-blacklist: reject', async function() {
        let rows = await buildAllRowsWithNew(buildNewRowPlain('ap-au-bad-bl', '1qaz@WSX', { email: 'ap-au-bad-bl@test.com' }))
        let r = await callFapi('updateUsersList', [userTokens[testUsers.admin.id], 'eng', rows])
        assert.strict.equal(r.ok, false)
    })

    it('API-006-self-lockout-isAdmin: reject "cannotDemoteSelf"', async function() {
        let allUsers = await woItems.users.select()
        allUsers = allUsers.map((u) => {
            let copy = { ...u }
            delete copy.password
            if (copy.id === testUsers.admin.id) copy.isAdmin = 'n'
            return copy
        })
        let r = await callFapi('updateUsersList', [userTokens[testUsers.admin.id], 'eng', allUsers])
        assert.strict.equal(r.ok, false)
        assert.strict.match(r.err, /[Cc]annot demote yourself|不可解除自己的管理員權限/)
    })

    it('API-007-self-lockout-isActive: reject "cannotDisableSelf"', async function() {
        let allUsers = await woItems.users.select()
        allUsers = allUsers.map((u) => {
            let copy = { ...u }
            delete copy.password
            if (copy.id === testUsers.admin.id) copy.isActive = 'n'
            return copy
        })
        let r = await callFapi('updateUsersList', [userTokens[testUsers.admin.id], 'eng', allUsers])
        assert.strict.equal(r.ok, false)
        assert.strict.match(r.err, /[Cc]annot disable yourself|不可停用自己的帳號/)
    })

    it('API-008-happy-path: admin 加 user, DB 驗證 hash/audit/timeVerified', async function() {
        let newAccount = 'ap-au-newuser-happy'
        await woItems.users.select({ account: newAccount }).catch(() => []).then(async (us) => {
            for (let u of us) await woItems.users.del({ id: u.id }).catch(() => {})
        })

        let rawPw = 'Pw@KLMN5678'
        let rows = await buildAllRowsWithNew(buildNewRowPlain(newAccount, rawPw, { email: 'ap-au-newuser-happy@test.com' }))
        let r = await callFapi('updateUsersList', [userTokens[testUsers.admin.id], 'eng', rows])
        assert.strict.equal(r.ok, true, `預期 resolve, 實際 reject: ${r.err}`)

        let us = await woItems.users.select({ account: newAccount })
        assert.strict.equal(us.length, 1)
        let u = us[0]
        assert.strict.notEqual(u.password, rawPw)
        assert.strict.notEqual(u.password, '')
        assert.strict.equal(u.password, hashPassword(rawPw, salt))
        assert.strict.equal(u.isForceChangePw, 'n')
        assert.strict.equal(u.userId, testUsers.admin.id, `userId 應為 admin id`)
        assert.strict.equal(u.userIdUpdate, testUsers.admin.id)
        assert.strict.equal(typeof u.timeVerified === 'string' && u.timeVerified.length > 0, true)

        await woItems.users.del({ id: u.id }).catch(() => {})
    })

    it('API-009-existing-row-password-preserved: 既有 user password hash 不被洗掉', async function() {
        let before = await woItems.users.select({ id: testUsers.existing.id })
        let originalHash = before[0].password
        assert.strict.equal(originalHash, hashPassword(testUsers.existing.rawPassword, salt))

        let allUsers = await woItems.users.select()
        allUsers = allUsers.map((u) => {
            let copy = { ...u }
            delete copy.password
            if (copy.id === testUsers.existing.id) copy.description = 'updated desc'
            return copy
        })
        let r = await callFapi('updateUsersList', [userTokens[testUsers.admin.id], 'eng', allUsers])
        assert.strict.equal(r.ok, true, `預期 resolve, 實際 reject: ${r.err}`)

        let after = await woItems.users.select({ id: testUsers.existing.id })
        assert.strict.equal(after[0].password, originalHash)
        assert.strict.equal(after[0].description, 'updated desc')
    })

})
