import assert from 'assert'
import ot from 'dayjs'
import ds from '../src/schema/index.mjs'
import hashPassword from '../server/hashPassword.mjs'
import { woItems } from '../g.mOrm.mjs'
import { startServersOnce, callFapi } from './api-setup.mjs'


//
// 對應 spec/流程_後台刪除使用者.md
// 此檔僅含 "API 契約" cases (updateUsersList 非 admin reject),
// UI flow 走 test/e2e-deleteuser.test.mjs (Playwright + baseline).
//

let salt = '{salt}'


let testUsers = {
    admin: {
        id: 'id-ap-du-admin',
        account: 'ap-du-admin',
        rawPassword: 'Pw@apduadm1',
        name: 'API DU Admin',
        email: 'ap-du-admin@test.com',
        isAdmin: 'y',
        redir: 'http://127.0.0.1:8080/?view=backstage&token={token}',
    },
    target: {
        id: 'id-ap-du-target',
        account: 'ap-du-target',
        rawPassword: 'Pw@apdutar1',
        name: 'API DU Target',
        email: 'ap-du-target@test.com',
        isAdmin: 'n',
        redir: 'http://127.0.0.1:8080/?view=user&token={token}',
    },
}


async function insertTestUsersAndTokens() {
    let arr = Object.values(testUsers)
    let rs = arr.map((u, k) => {
        let v = ds.users.funNew({
            order: 880 + k,
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
}


async function _delTokensByUserId(userId) {
    let tks = await woItems.tokens.select({ userId }).catch(() => [])
    for (let tk of tks) await woItems.tokens.del({ id: tk.id }).catch(() => {})
}


async function deleteTestUsersAndTokens() {
    for (let u of Object.values(testUsers)) {
        await woItems.users.del({ id: u.id }).catch(() => {})
        await _delTokensByUserId(u.id)
    }
}


describe('DeleteUser API — updateUsersList 拒絕情境', function() {
    this.timeout(60000)

    beforeEach(async function() {
        this.timeout(180000)
        await startServersOnce()
        await deleteTestUsersAndTokens()
        await insertTestUsersAndTokens()
    })

    afterEach(async function() {
        await deleteTestUsersAndTokens()
    })

    it('API-001-non-admin-token-reject: 普通 user token 直接打 updateUsersList API, reject (DB 不變)', async function() {
        //對應 spec bullet 5「非 admin token, funCheckAdmin 判否, 與真過期共用同一 reject 訊息」
        let tt = ds.tokens.funNew({ userId: testUsers.target.id })
        tt.timeEnd = ot().add(60, 'minute').format('YYYY-MM-DDTHH:mm:ss.SSSZ')
        await woItems.tokens.insert([tt])
        let targetToken = tt.token

        let allUsers = await woItems.users.select()
        let rows = allUsers.map((u) => {
            let c = { ...u }
            delete c.password
            return c
        })

        let dbBefore = await woItems.users.select()

        let r = await callFapi('updateUsersList', [targetToken, 'eng', rows])
        assert.strict.equal(r.ok, false,
            `非 admin token 應被 reject, 實際 ok=${r.ok} val=${JSON.stringify(r.val)}`)

        let dbAfter = await woItems.users.select()
        assert.strict.equal(dbAfter.length, dbBefore.length,
            `DB users 數量應不變, before=${dbBefore.length} after=${dbAfter.length}`)

        await _delTokensByUserId(testUsers.target.id)
    })

})
