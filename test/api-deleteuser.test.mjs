import assert from 'assert'
import ot from 'dayjs'
import ds from '../src/schema/index.mjs'
import hashPassword from '../server/hashPassword.mjs'
import { woItems } from '../g_mOrm.mjs'
import { startServersOnce, callFapi } from './tools/api-setup.mjs'


//
// 對應 spec/流程_後台刪除使用者.md
// 此檔僅含 "API 契約" cases (updateUsersList 非 admin reject、刪除後撤銷被刪者令牌),
// 另含 spec/流程_後台變更使用者資訊.md 之停用撤銷 (API-003; 與刪除撤銷同一機制 ADR-037 / ADR-080, 共用本檔 fixture),
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


describe('DeleteUser API — updateUsersList 拒絕情境與撤銷令牌', function() {
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

    //insertTokens: 為操作者(admin)與 target 各建令牌(target 2 個, 模擬多裝置), 回傳令牌字串
    async function insertTokens() {
        let timeEnd = ot().add(60, 'minute').format('YYYY-MM-DDTHH:mm:ss.SSSZ')
        let ta = ds.tokens.funNew({ userId: testUsers.admin.id })
        let tt1 = ds.tokens.funNew({ userId: testUsers.target.id })
        let tt2 = ds.tokens.funNew({ userId: testUsers.target.id })
        for (let t of [ta, tt1, tt2]) {
            t.timeEnd = timeEnd
        }
        await woItems.tokens.insert([ta, tt1, tt2])
        return { tokenAdmin: ta.token, tokenTarget1: tt1.token, tokenTarget2: tt2.token }
    }

    //rowsOfAll: 當下表中所有 user (移除 password 欄以模擬前端送出格式), fn 可過濾或改寫
    async function rowsOfAll(fn) {
        let allUsers = await woItems.users.select()
        let rows = allUsers.map((u) => {
            let c = { ...u }
            delete c.password
            return c
        })
        return fn(rows)
    }

    //assertTargetTokensRevoked: 被撤銷者 tokens 表無其列, 其令牌對外 checkToken 回 tokenExpired (ADR-006)
    async function assertTargetTokensRevoked(tks) {
        let rs = await woItems.tokens.select({ userId: testUsers.target.id })
        assert.strict.equal(rs.length, 0, `target 名下令牌應全數撤銷, 剩 ${rs.length}`)
        for (let token of [tks.tokenTarget1, tks.tokenTarget2]) {
            let r = await callFapi('checkToken', [token])
            assert.strict.equal(r.ok, false, `已撤銷之令牌不得通過 checkToken`)
            assert.strict.equal(r.err, 'tokenExpired')
        }
        //操作者令牌不受影響
        let self = await callFapi('checkToken', [tks.tokenAdmin])
        assert.strict.equal(self.ok, true, `操作者令牌應仍有效: ${self.err}`)
    }

    it('API-002-delete-revokes-tokens: admin 刪除使用者並儲存, 被刪者名下全部令牌即失效', async function() {
        //spec 流程_後台刪除使用者〈規則摘要〉級聯清理: 刪除寫入後撤銷被刪使用者名下全部令牌 (ADR-037 / ADR-080)
        let tks = await insertTokens()
        //前置: 被刪者之令牌原本有效 (避免以本就無效之令牌假通過)
        let before = await callFapi('checkToken', [tks.tokenTarget1])
        assert.strict.equal(before.ok, true, `前置: target 令牌應有效: ${before.err}`)

        let rows = await rowsOfAll((rs) => rs.filter((u) => u.id !== testUsers.target.id))
        let r = await callFapi('updateUsersList', [tks.tokenAdmin, 'eng', rows])
        assert.strict.equal(r.ok, true, `預期 resolve, 實際 reject: ${r.err}`)

        let us = await woItems.users.select({ id: testUsers.target.id })
        assert.strict.equal(us.length, 0, 'target 應已刪除')
        await assertTargetTokensRevoked(tks)
    })

    it('API-003-disable-revokes-tokens: admin 停用使用者並儲存, 被停用者名下全部令牌即失效 (spec 流程_後台變更使用者資訊)', async function() {
        //spec 流程_後台變更使用者資訊〈規則摘要〉: 停用(isActive 改為 'n')即撤銷其全部令牌 (ADR-037 / ADR-080)
        let tks = await insertTokens()
        let before = await callFapi('checkToken', [tks.tokenTarget1])
        assert.strict.equal(before.ok, true, `前置: target 令牌應有效: ${before.err}`)

        let rows = await rowsOfAll((rs) => rs.map((u) => (u.id === testUsers.target.id ? { ...u, isActive: 'n' } : u)))
        let r = await callFapi('updateUsersList', [tks.tokenAdmin, 'eng', rows])
        assert.strict.equal(r.ok, true, `預期 resolve, 實際 reject: ${r.err}`)

        let us = await woItems.users.select({ id: testUsers.target.id })
        assert.strict.equal(us.length, 1, 'target 停用不刪除')
        assert.strict.equal(us[0].isActive, 'n')
        await assertTargetTokensRevoked(tks)
    })

})
