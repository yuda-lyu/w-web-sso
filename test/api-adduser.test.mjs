import assert from 'assert'
import ot from 'dayjs'
import istimemsTZ from 'wsemi/src/istimemsTZ.mjs'
import ds from '../src/schema/index.mjs'
import hashPassword, { verifyPassword } from '../server/hashPassword.mjs'
import { woItems } from '../g_mOrm.mjs'
import { startServersOnce, callFapi } from './tools/api-setup.mjs'


//
// 對應 spec/流程_後台新增使用者.md
// 此檔僅含 "API 契約" cases (updateUsersList reject / DB side effect),
// UI flow (add row + 各 inline 錯誤 + happy save) 走 test/e2e-adduser.test.mjs (Playwright + baseline).
//
// 涵蓋 cases: password-* (策略 reject) / self-lockout-* / happy-path / existing-row-password-preserved /
//   寫入前驗證 (ADR-081: 主鍵或欄位含會被 clearXSS 改寫之標記、主鍵超過鍵長上限; 同批之刪除不得落地)
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
        //對應 CLAUDE.md「錯誤時回傳前端資訊須回傳 key」: 後端一律 reject 純 err-key, 由前端依 lang 翻譯
        assert.strict.equal(r.err, 'cannotDemoteSelf')
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
        //對應 CLAUDE.md「錯誤時回傳前端資訊須回傳 key」: 後端一律 reject 純 err-key, 由前端依 lang 翻譯
        assert.strict.equal(r.err, 'cannotDisableSelf')
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
        assert.strict.equal(verifyPassword(rawPw, u.password, salt), true, `password hash 應可由 rawPw 驗證通過`)
        assert.strict.equal(u.isForceChangePw, 'n')
        assert.strict.equal(u.userId, testUsers.admin.id, `userId 應為 admin id`)
        assert.strict.equal(u.userIdUpdate, testUsers.admin.id)
        //spec「後台建帳自動填 timeVerified」: 須為 timemsTZ 格式(共用判斷 getIsVerified 以 istimemsTZ 認定已驗證);
        //原只驗非空, 秒級格式(now2str)亦通過, 致新建帳號顯示未驗證之缺陷未被抓到 (2026-09-29)
        assert.strict.equal(istimemsTZ(u.timeVerified), true, `timeVerified 應為 timemsTZ 格式, 實際「${u.timeVerified}」`)

        await woItems.users.del({ id: u.id }).catch(() => {})
    })

    it('API-010-new-admin-passes-admin-gate: admin 新建之系統管理者帳號可通過管理權限閘(funCheckAdmin)', async function() {
        //對應 spec 規則: 後台建帳即視為已驗證; 設為系統管理者者應可使用後台管理 API.
        //修正前 timeVerified 為秒級格式, s.checkUserAdmin → getIsVerified(istimemsTZ) 為 false → 管理 API 一律拒絕
        let newAccount = 'ap-au-newadmin'
        let rawPw = 'Pw@KLMN5678'
        let newRow = buildNewRowPlain(newAccount, rawPw, { email: 'ap-au-newadmin@test.com', isAdmin: 'y' })
        let rows = await buildAllRowsWithNew(newRow)
        let r = await callFapi('updateUsersList', [userTokens[testUsers.admin.id], 'eng', rows])
        assert.strict.equal(r.ok, true, `預期 resolve, 實際 reject: ${r.err}`)

        let u = (await woItems.users.select({ account: newAccount }))[0]
        assert.strict.equal(!!u, true, '新系統管理者應已建立')

        //為新系統管理者建權杖, 以其權杖呼叫需系統管理者之 getUsersList
        let t = ds.tokens.funNew({ userId: u.id })
        t.timeEnd = ot().add(60, 'minute').format('YYYY-MM-DDTHH:mm:ss.SSSZ')
        await woItems.tokens.insert([t])
        let r2 = await callFapi('getUsersList', [t.token])
        assert.strict.equal(r2.ok, true, `新系統管理者應可呼叫管理 API, 實際 reject: ${r2.err}`)

        await woItems.tokens.del({ id: t.id }).catch(() => {})
        await woItems.users.del({ id: u.id }).catch(() => {})
    })

    it('API-009-existing-row-password-preserved: 既有 user password hash 不被洗掉', async function() {
        let before = await woItems.users.select({ id: testUsers.existing.id })
        let originalHash = before[0].password
        assert.strict.equal(verifyPassword(testUsers.existing.rawPassword, originalHash, salt), true, `既有 user password hash 應可由原 rawPassword 驗證通過`)

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

    //usersViaBackend: 由後端讀取使用者清單. 測試行程直讀 LMDB 時, 若於後端寫入後立即讀取可能讀到舊快照(lmdb-js 之讀交易延至計時器重設, 見 ADR-081),
    //「資料庫無變更」之斷言改由後端讀: 後端若曾寫入, 其讀交易已於自身 commit 時重設
    async function usersViaBackend() {
        let r = await callFapi('getUsersList', [userTokens[testUsers.admin.id]])
        assert.strict.equal(r.ok, true, `getUsersList: ${r.err}`)
        return r.val
    }

    it('API-011-markup-id-rejected-before-write: 刪除與主鍵含 HTML 標記之新增列同批 → htmlMarkupNotAllowed, 欲刪除者仍在且其令牌仍有效 (ADR-081)', async function() {
        //ADR-081 / ADR-021: 主鍵會被 clearXSS 改寫者屬驗證失敗, 於任何寫入之前拒絕(修改前: 刪除落地後新增才被 w-serv-orm 1.1.8 整批拒絕, 回 saveWriteFail 且已撤銷令牌)
        let tExisting = ds.tokens.funNew({ userId: testUsers.existing.id })
        tExisting.timeEnd = ot().add(60, 'minute').format('YYYY-MM-DDTHH:mm:ss.SSSZ')
        await woItems.tokens.insert([tExisting])
        let newRow = { ...buildNewRowPlain('ap-au-markup-id', 'Pw@KLMN5678', { email: 'ap-au-markup-id@test.com' }), id: '<x>ap-au-markup-id' }
        let rows = (await buildAllRowsWithNew(newRow)).filter((u) => u.id !== testUsers.existing.id)
        let r = await callFapi('updateUsersList', [userTokens[testUsers.admin.id], 'eng', rows])
        assert.strict.equal(r.ok, false)
        assert.strict.equal(r.err, 'htmlMarkupNotAllowed')
        let us = await usersViaBackend()
        assert.strict.equal(us.some((u) => u.id === testUsers.existing.id), true, '欲刪除者應仍在')
        assert.strict.equal(us.some((u) => u.email === 'ap-au-markup-id@test.com'), false, '新增列不得寫入')
        //ADR-080 決策 1: 未進入寫入階段不撤銷 → 欲刪除者之令牌仍有效
        let ck = await callFapi('checkToken', [tExisting.token])
        assert.strict.equal(ck.ok, true, `欲刪除者之令牌應仍有效: ${ck.err}`)
    })

    it('API-012-markup-account-rejected: 新增列帳號含 HTML 標記(會被 clearXSS 改寫) → htmlMarkupNotAllowed, 未新增 (ADR-081)', async function() {
        //ADR-081: 帳號被改寫後儲存值與輸入不同, 以所輸入之帳號登入失敗且唯一性可被繞過 → 驗證階段拒絕
        let email = 'ap-au-markup-acc@test.com'
        try {
            let rows = await buildAllRowsWithNew(buildNewRowPlain('ap<au>markup', 'Pw@KLMN5678', { email }))
            let r = await callFapi('updateUsersList', [userTokens[testUsers.admin.id], 'eng', rows])
            assert.strict.equal(r.ok, false)
            assert.strict.equal(r.err, 'htmlMarkupNotAllowed')
            let us = await usersViaBackend()
            assert.strict.equal(us.some((u) => u.email === email), false, '新增列不得寫入')
        }
        finally {
            //修改前會寫入(帳號存成 ap&lt;au>markup), 清掉以免殘留
            for (let u of await woItems.users.select({ email }).catch(() => [])) {
                await woItems.users.del({ id: u.id }).catch(() => {})
            }
        }
    })

    it('API-013-overlong-id-rejected-before-write: 刪除與主鍵超過 LMDB 鍵長上限之新增列同批 → invalidRows, 欲刪除者仍在 (ADR-081)', async function() {
        //ADR-081 / ADR-021: 主鍵 UTF-8 超過 1978 位元組者寫入時才被 LMDB 拒絕(修改前: 刪除已落地, 回 saveWriteFail)
        let newRow = { ...buildNewRowPlain('ap-au-longid', 'Pw@KLMN5678', { email: 'ap-au-longid@test.com' }), id: 'k'.repeat(1979) }
        let rows = (await buildAllRowsWithNew(newRow)).filter((u) => u.id !== testUsers.existing.id)
        let r = await callFapi('updateUsersList', [userTokens[testUsers.admin.id], 'eng', rows])
        assert.strict.equal(r.ok, false)
        assert.strict.equal(r.err, 'invalidRows')
        let us = await usersViaBackend()
        assert.strict.equal(us.some((u) => u.id === testUsers.existing.id), true, '欲刪除者應仍在')
        assert.strict.equal(us.some((u) => u.email === 'ap-au-longid@test.com'), false, '新增列不得寫入')
    })

})
