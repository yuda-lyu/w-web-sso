//unit-external-helpers.test.mjs — 對外查詢 helper 之失敗路徑與代入 (不起後端)
//
// 對象: src/getUserByToken.mjs / src/getUserByUserId.mjs / src/getUsersByToken.mjs
// 依據: spec/設計要點與取捨.md ADR-068 之 K 契約
//   - reject 一律為固定 key (沿用 perm helper 詞彙), 不含網址與權杖
//   - console 每次失敗一行 '[w-web-sso] <helper> <key>', 其內不含任何權杖字元 (不印錯誤原文與代入後網址)
//   - 代入以 split/join + encodeURIComponent, 不受 $ 樣式與保留字元影響
//   - funConvertUser 回非物件、同步拋錯或 reject 皆 → noUserDataAfterConvert
// SSO 回應以 data: 網址模擬 (Node 內建 fetch 支援, 走與 HTTP 相同之 text → JSON.parse 路徑);
// 佔位符置於 JSON 字串值內, 代入後仍為合法 JSON. data: 會做百分比解碼且 # 截斷, 故合成權杖避開 % # " \.
// 需真後端之案例 (連線失敗 / 非 2xx / SSO 真實 state) 見 api-external-helpers.test.mjs.

import assert from 'assert'
import util from 'util'
import getUserByToken from '../src/getUserByToken.mjs'
import getUserByUserId from '../src/getUserByUserId.mjs'
import getUsersByToken from '../src/getUsersByToken.mjs'


//合成權杖 (長度 >= 16); 斷言時以其前 8 字 (SYNTHSEL / SYNTHTAR / SYNTHUID) 為標記: helper 輸出不得含任何權杖字元
let SELF = 'SYNTHSELF-7Qk2Lm9Xw4'
let TAR = 'SYNTHTAR-3Vb8Np1Zr6'
let UID = 'SYNTHUID-5Hc1Tq8Js2'

let PH_TOKEN = 'token={sysToken}&key=token&value={token}'
let PH_ID = 'token={sysToken}&key=id&value={userId}'
let PH_LIST = 'token={sysToken}'


function dataJson(obj) {
    return `data:application/json,${JSON.stringify(obj)}`
}


//執行並攔下 console.log; 回 { ok, v, out }
async function run(fn) {
    let lines = []
    let log = console.log
    console.log = (...a) => {
        lines.push(a.map((v) => (typeof v === 'string' ? v : util.inspect(v, { depth: 5 }))).join(' '))
    }
    let r
    try {
        r = { ok: true, v: await fn() }
    }
    catch (err) {
        r = { ok: false, v: err }
    }
    finally {
        console.log = log
    }
    r.out = lines.join('\n')
    return r
}


//reject 值與 console 皆不得含權杖片段
function assertNoTokenMaterial(r, secrets) {
    let text = `${util.inspect(r.v, { depth: 5 })}\n${r.out}`
    for (let s of secrets) {
        let mark = s.slice(0, 8)
        assert.strict.equal(text.includes(mark), false, `輸出含權杖片段 ${mark}:\n${text}`)
    }
}


//失敗時 console 恰一行診斷
function assertOneDiagLine(r, helper, key) {
    let ls = r.out.split('\n').filter((l) => l.startsWith('[w-web-sso]'))
    assert.strict.equal(ls.length, 1, `預期恰一行診斷, 實得:\n${r.out}`)
    assert.ok(ls[0].startsWith(`[w-web-sso] ${helper} ${key}`), `診斷行開頭不符: ${ls[0]}`)
}


describe('對外查詢 helper — 失敗路徑與代入 (不起後端, ADR-068 K 契約)', function() {

    it('HLPU-001-F0-args: 參數無效 → invalidUrl / invalidTokenSelf / invalidTokenTar / invalidUserIdTar', async function() {
        let u1 = dataJson({ x: PH_TOKEN })
        let u2 = dataJson({ x: PH_ID })
        let u3 = dataJson({ x: PH_LIST })
        assert.strict.equal((await run(() => getUserByToken('', SELF, TAR))).v, 'invalidUrl')
        assert.strict.equal((await run(() => getUserByToken(u1, '', TAR))).v, 'invalidTokenSelf')
        assert.strict.equal((await run(() => getUserByToken(u1, SELF, ''))).v, 'invalidTokenTar')
        assert.strict.equal((await run(() => getUserByUserId('', SELF, UID))).v, 'invalidUrl')
        assert.strict.equal((await run(() => getUserByUserId(u2, '', UID))).v, 'invalidTokenSelf')
        assert.strict.equal((await run(() => getUserByUserId(u2, SELF, ''))).v, 'invalidUserIdTar')
        assert.strict.equal((await run(() => getUsersByToken('', SELF))).v, 'invalidUrl')
        assert.strict.equal((await run(() => getUsersByToken(u3, ''))).v, 'invalidTokenSelf')
    })

    it('HLPU-002-F1-placeholders: 網址缺佔位符 → noTokenKeyValueInUrl / noTokenKeyUserIdInUrl / noTokenInUrl', async function() {
        assert.strict.equal((await run(() => getUserByToken(dataJson({ x: 'token={sysToken}&key=token' }), SELF, TAR))).v, 'noTokenKeyValueInUrl')
        assert.strict.equal((await run(() => getUserByToken(dataJson({ x: 'key=token&value={token}' }), SELF, TAR))).v, 'noTokenKeyValueInUrl')
        assert.strict.equal((await run(() => getUserByToken(dataJson({ x: 'token={sysToken}&value={token}' }), SELF, TAR))).v, 'noTokenKeyValueInUrl')
        assert.strict.equal((await run(() => getUserByUserId(dataJson({ x: 'token={sysToken}&key=id' }), SELF, UID))).v, 'noTokenKeyUserIdInUrl')
        assert.strict.equal((await run(() => getUsersByToken(dataJson({ x: 'nothing' }), SELF))).v, 'noTokenInUrl')
    })

    it('HLPU-003-F2c-unparseable-url: 網址無法解析 → cannotGetUserByUrl / cannotGetUsersByUrl, 輸出不含權杖 (fetch 錯誤原文夾帶完整網址)', async function() {
        let r1 = await run(() => getUserByToken(`http://ho st/api/getSsoUserInfor?${PH_TOKEN}`, SELF, TAR))
        assert.strict.equal(r1.v, 'cannotGetUserByUrl')
        assertNoTokenMaterial(r1, [SELF, TAR])
        assertOneDiagLine(r1, 'getUserByToken', 'cannotGetUserByUrl')
        let r2 = await run(() => getUserByUserId(`http://ho st/api/getSsoUserInfor?${PH_ID}`, SELF, UID))
        assert.strict.equal(r2.v, 'cannotGetUserByUrl')
        assertNoTokenMaterial(r2, [SELF])
        assertOneDiagLine(r2, 'getUserByUserId', 'cannotGetUserByUrl')
        let r3 = await run(() => getUsersByToken(`http://ho st/api/getSsoUsersList?${PH_LIST}`, SELF))
        assert.strict.equal(r3.v, 'cannotGetUsersByUrl')
        assertNoTokenMaterial(r3, [SELF])
        assertOneDiagLine(r3, 'getUsersByToken', 'cannotGetUsersByUrl')
    })

    it('HLPU-004-F3c-non-json: 2xx 但本體非 JSON (本體回顯代入後網址) → cannotGetUserDataByUrl / cannotGetUsersDataByUrl, 輸出不含權杖', async function() {
        let r1 = await run(() => getUserByToken(`data:text/plain,echo ${PH_TOKEN}`, SELF, TAR))
        assert.strict.equal(r1.v, 'cannotGetUserDataByUrl')
        assertNoTokenMaterial(r1, [SELF, TAR])
        assertOneDiagLine(r1, 'getUserByToken', 'cannotGetUserDataByUrl')
        let r3 = await run(() => getUsersByToken(`data:text/plain,echo ${PH_LIST}`, SELF))
        assert.strict.equal(r3.v, 'cannotGetUsersDataByUrl')
        assertNoTokenMaterial(r3, [SELF])
    })

    it('HLPU-005-F3-state-error: SSO 回 state=error → cannotGetUserDataByUrl; msg 為 key 形狀才印, 非 key 之 msg (可能回顯權杖) 不印', async function() {
        let rKey = await run(() => getUserByToken(dataJson({ state: 'error', msg: 'tokenExpired', x: PH_TOKEN }), SELF, TAR))
        assert.strict.equal(rKey.v, 'cannotGetUserDataByUrl')
        assertNoTokenMaterial(rKey, [SELF, TAR])
        assert.ok(rKey.out.includes('tokenExpired'), `key 形狀之 SSO msg 應保留供診斷:\n${rKey.out}`)
        let rFree = await run(() => getUserByToken(dataJson({ state: 'error', msg: `free text ${PH_TOKEN}` }), SELF, TAR))
        assert.strict.equal(rFree.v, 'cannotGetUserDataByUrl')
        assertNoTokenMaterial(rFree, [SELF, TAR])
        let rId = await run(() => getUserByUserId(dataJson({ state: 'error', msg: 'tokenNoPermission', x: PH_ID }), SELF, UID))
        assert.strict.equal(rId.v, 'cannotGetUserDataByUrl')
        assertNoTokenMaterial(rId, [SELF])
    })

    it('HLPU-006-F4-no-data: success 但無資料 → noUserDataByUrl / noUsersDataByUrl (H3 非陣列亦拒)', async function() {
        let r1 = await run(() => getUserByToken(dataJson({ state: 'success', msg: null, x: PH_TOKEN }), SELF, TAR))
        assert.strict.equal(r1.v, 'noUserDataByUrl')
        assertNoTokenMaterial(r1, [SELF, TAR])
        assertOneDiagLine(r1, 'getUserByToken', 'noUserDataByUrl')
        let r2 = await run(() => getUserByUserId(dataJson({ state: 'success', msg: 'not-an-object', x: PH_ID }), SELF, UID))
        assert.strict.equal(r2.v, 'noUserDataByUrl')
        assertNoTokenMaterial(r2, [SELF])
        let r3 = await run(() => getUsersByToken(dataJson({ state: 'success', msg: [], x: PH_LIST }), SELF))
        assert.strict.equal(r3.v, 'noUsersDataByUrl')
        assertNoTokenMaterial(r3, [SELF])
        let r4 = await run(() => getUsersByToken(dataJson({ state: 'success', msg: 'abc', x: PH_LIST }), SELF))
        assert.strict.equal(r4.ok, false, `非陣列之 msg 不得當成清單回傳: ${util.inspect(r4.v)}`)
        assert.strict.equal(r4.v, 'noUsersDataByUrl')
    })

    it('HLPU-007-F5-convert: funConvertUser 回非物件 / 同步拋錯 / reject → noUserDataAfterConvert, 輸出不含部署端錯誤原文', async function() {
        let okUser = dataJson({ state: 'success', msg: { id: 'id-x', account: 'ac-x' }, x: PH_TOKEN })
        let okList = dataJson({ state: 'success', msg: [{ id: 'id-a' }, { id: 'id-b' }], x: PH_LIST })
        let rNull = await run(() => getUserByToken(okUser, SELF, TAR, { funConvertUser: () => null }))
        assert.strict.equal(rNull.v, 'noUserDataAfterConvert')
        let rThrow = await run(() => getUserByToken(okUser, SELF, TAR, { funConvertUser: () => { throw new Error('SYNTHCONV-throw-secret') } }))
        assert.strict.equal(rThrow.v, 'noUserDataAfterConvert')
        assertNoTokenMaterial(rThrow, ['SYNTHCONV-throw-secret'])
        let rRej = await run(() => getUserByUserId(dataJson({ state: 'success', msg: { id: 'id-x' }, x: PH_ID }), SELF, UID, { funConvertUser: async () => Promise.reject('SYNTHCONV-reject-secret') }))
        assert.strict.equal(rRej.v, 'noUserDataAfterConvert')
        assertNoTokenMaterial(rRej, ['SYNTHCONV-reject-secret'])
        let rList = await run(() => getUsersByToken(okList, SELF, { funConvertUser: async (u) => (u.id === 'id-b' ? Promise.reject('SYNTHCONV-list-secret') : u) }))
        assert.strict.equal(rList.v, 'noUserDataAfterConvert')
        assertNoTokenMaterial(rList, ['SYNTHCONV-list-secret'])
    })

    it('HLPU-008-substitution-encoding: 代入值含 $ 樣式與保留字元時, 送出之值與原值逐字相同', async function() {
        let tarOdd = 'a%41b$`c$&d+e&f=g'
        let selfOdd = 'self+x$\'y%2F'
        let r1 = await run(() => getUserByToken(dataJson({ state: 'success', msg: { v: '{token}', s: '{sysToken}' }, x: PH_TOKEN }), selfOdd, tarOdd))
        assert.strict.equal(r1.ok, true, `預期成功, 實得: ${util.inspect(r1.v)}\n${r1.out}`)
        assert.strict.equal(r1.v.v, tarOdd)
        assert.strict.equal(r1.v.s, selfOdd)
        let r2 = await run(() => getUserByUserId(dataJson({ state: 'success', msg: { v: '{userId}' }, x: PH_ID }), SELF, tarOdd))
        assert.strict.equal(r2.ok, true, `預期成功, 實得: ${util.inspect(r2.v)}\n${r2.out}`)
        assert.strict.equal(r2.v.v, tarOdd)
    })

})
