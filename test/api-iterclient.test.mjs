//api-iterclient.test.mjs — 使用端字串鍵經真實 HTTP / 資料通道之統計與防護 (R-OBJ-ITER-01、R-KEY-01)
//
// 依據: CLAUDE_rulebook.md「R-OBJ-ITER-01」「R-KEY-01」; 單元層 unit-iterClientObj
//   - 來源: 請求標頭 X-Forwarded-For 第一段即 verifyConn 之 ip(未驗證格式、未登入者可植入); token 為查詢參數 / 資料通道參數
//   - IT-A-001 標頭 IP 為 length: 統計頁(getStaIp)之該桶明細不被略過、不產生索引假鍵
//   - IT-A-002 權杖之 userId 為 length: 統計(getStaToken)同上
//   - IT-A-003 標頭 IP / token 為原型鍵名(constructor、__proto__): 後端不結束、仍可回應, 統計照記
// 作法: 每案以臨時 settings(logFd 指向 test/_tmp/api-iterclient/logs)重啟全新後端——
//   ①統計只讀本檔造成之 log, 不汙染 ./logs(e2e-stainfor 之統計頁讀同一資料夾); ②統計 30 秒快取為新行程之空快取; ③修改前會結束後端之案不影響他檔.
//   檔尾以預設 settings 重啟、刪臨時資料夾並還原 base seed(IP 偵測計時器會把標頭 IP 登錄進 ips 表).

import assert from 'assert'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import ot from 'dayjs'
import ds from '../src/schema/index.mjs'
import { woItems } from '../g_mOrm.mjs'
import { callFapi, apiUrl } from './tools/api-setup.mjs'
import { resetToBaseSeed, deleteNonBaseSeed, restartBackend, genTempSettings } from './tools/e2e-setup.mjs'


let fdTmp = path.join(path.dirname(fileURLToPath(import.meta.url)), '_tmp', 'api-iterclient')
let logFd = './test/_tmp/api-iterclient/logs' //相對後端之 cwd(專案根)
let ADMIN = 'token-for-admin' //base seed


//w-syslog 落檔等待(同 api-srlog-noleak)
let sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
let TIME_LOG_FLUSH = 3000


//own: 取自有屬性之值
let own = (o, k) => {
    let d = Object.getOwnPropertyDescriptor(o, k)
    return d === undefined ? undefined : d.value
}


//sumKey: 全部時間桶中某鍵之自有值加總
let sumKey = (rs, k) => rs.reduce((a, r) => a + (own(r.data, k) || 0), 0)


//fakeKeys: 全部時間桶中純數字之鍵(索引假鍵)
let fakeKeys = (rs) => {
    let r = new Set()
    for (let b of rs) {
        for (let k of Object.keys(b.data)) {
            if (/^\d+$/.test(k)) {
                r.add(k)
            }
        }
    }
    return [...r]
}


//postMain: 資料通道端點(verifyConn 先記 log 再解析本體, 本體無效不影響記錄), 同 api-srlog-noleak
async function postMain(headers = {}) {
    return await fetch(`${apiUrl}/api/main`, { method: 'POST', headers, body: 'x' }).then((r) => r.status).catch((err) => `ERR ${err.message}`)
}


//fresh: 以臨時 settings 重啟全新後端
async function fresh() {
    fs.mkdirSync(path.join(fdTmp, 'logs'), { recursive: true })
    await restartBackend(genTempSettings({ logFd }))
}


describe('使用端字串鍵經真後端 (R-OBJ-ITER-01 / R-KEY-01)', function() {
    this.timeout(180000)

    //不呼叫 startServersOnce: 本檔只需後端, 由 beforeEach 之 restartBackend 起(不依賴前端 8080 之編譯)

    after(async function() {
        await restartBackend('./settings.json') //還原預設 settings
        fs.rmSync(fdTmp, { recursive: true, force: true })
        await resetToBaseSeed() //標頭 IP 已被偵測計時器登錄進 ips 表
        await deleteNonBaseSeed()
    })

    beforeEach(async function() {
        this.timeout(120000)
        fs.rmSync(fdTmp, { recursive: true, force: true })
        await resetToBaseSeed()
        await fresh()
    })


    it('IT-A-001 X-Forwarded-For 為 length: getStaIp 之真實 IP 計數不失、length 為一般鍵、無索引假鍵', async function() {
        //spec(R-OBJ-ITER-01): 標頭第一段 "length" 即 verifyConn 之 ip, 該小時桶 data 為 { count, length: 3, '203.0.113.9': 2, ... }
        for (let i = 0; i < 3; i++) {
            await postMain({ 'X-Forwarded-For': 'length' })
        }
        for (let i = 0; i < 2; i++) {
            await postMain({ 'X-Forwarded-For': '203.0.113.9' })
        }
        await sleep(TIME_LOG_FLUSH)
        let r = await callFapi('getStaIp', [ADMIN])
        assert.strictEqual(r.ok, true, `getStaIp 應成功: ${r.err}`)
        let rs = r.val
        //原實作: data 被當陣列樣迭代, 真實鍵被略過(203.0.113.9 之 2 筆與 length 皆消失)且所有桶多出 0、1、2 假鍵
        assert.strictEqual(sumKey(rs, 'length'), 3)
        assert.strictEqual(sumKey(rs, '203.0.113.9'), 2)
        assert.deepStrictEqual(fakeKeys(rs), [])
        //端到端不變式: count 為各桶 verifyConn 總數, 至少含本案送出之 5 筆
        assert.ok(rs.reduce((a, b) => a + (own(b.data, 'count') || 0), 0) >= 5)
    })

    it('IT-A-002 權杖之 userId 為 length: getStaToken 以使用者名稱為鍵之計數不失、無索引假鍵', async function() {
        //spec(R-OBJ-ITER-01): users.id / tokens.userId 由管理端寫入, 可為 "length"; 每次 checkToken 通過即寫 fun-checkToken(userId)
        let u = ds.users.funNew({ order: 800, account: 'it-a-len', password: 'x', name: 'IT Len User', email: 'it-a-len@test.com', from: 'test', isAdmin: 'n', timeVerified: '2025-01-01T00:00:00.000+08:00', timeExpired: '2030-01-01T00:00:00.000+08:00' })
        u.id = 'length'
        u.isActive = 'y'
        await woItems.users.insert([u])
        let t = ds.tokens.funNew({ userId: 'length' })
        t.id = 'it-a-tok-len'
        t.token = 'it-a-tok-len'
        t.timeEnd = ot().add(60, 'minute').format('YYYY-MM-DDTHH:mm:ss.SSSZ')
        await woItems.tokens.insert([t])
        for (let i = 0; i < 3; i++) {
            let c = await callFapi('checkToken', ['it-a-tok-len'])
            assert.strictEqual(c.ok, true, `checkToken 應成功: ${c.err}`)
        }
        await sleep(TIME_LOG_FLUSH)
        let r = await callFapi('getStaToken', [ADMIN])
        assert.strictEqual(r.ok, true, `getStaToken 應成功: ${r.err}`)
        assert.strictEqual(sumKey(r.val, 'IT Len User'), 3)
        assert.deepStrictEqual(fakeKeys(r.val), [])
    })

    let cases = [
        ['IT-A-003a', 'X-Forwarded-For 為 constructor', 'xff', 'constructor'],
        ['IT-A-003b', 'X-Forwarded-For 為 __proto__', 'xff', '__proto__'],
        ['IT-A-003c', 'checkToken 之 token 參數為 constructor', 'token', 'constructor'],
        ['IT-A-003d', 'checkToken 之 token 參數為 __proto__', 'token', '__proto__'],
    ]
    for (let [id, label, kind, val] of cases) {
        it(`${id} ${label}: 後端不結束, 續可回應(原實作 callApiBy* 之 .push 拋 TypeError, 未接住而結束行程)`, async function() {
            let st = kind === 'xff'
                ? await postMain({ 'X-Forwarded-For': val })
                : await fetch(`${apiUrl}/api/checkToken?token=${encodeURIComponent(val)}`).then((r) => r.status).catch((err) => `ERR ${err.message}`)
            assert.ok(typeof st === 'number', `請求應得回應(實得 ${st})`)
            await sleep(TIME_LOG_FLUSH)
            //spec: 無效權杖一律 tokenExpired(ADR-006), 後端仍存活
            let r = await fetch(`${apiUrl}/api/checkToken?token=it-a-no-such-token`)
            assert.strictEqual(r.status, 200)
            assert.deepStrictEqual(await r.json(), { state: 'error', msg: 'tokenExpired' })
            //統計照記: 標頭 IP 計為一般鍵(token 案之 verifyConn 之 ip 為本機位址, 不查)
            if (kind === 'xff') {
                let s = await callFapi('getStaIp', [ADMIN])
                assert.strictEqual(s.ok, true, `getStaIp 應成功: ${s.err}`)
                assert.strictEqual(sumKey(s.val, val), 1)
            }
        })
    }

})
