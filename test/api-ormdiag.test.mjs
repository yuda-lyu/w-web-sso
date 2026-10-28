import assert from 'assert'
import fs from 'fs'
import net from 'net'
import path from 'path'
import { spawn } from 'child_process'
import obj2u8arr from 'wsemi/src/obj2u8arr.mjs'
import u8arr2obj from 'wsemi/src/u8arr2obj.mjs'
import { maskToken } from '../server/srLog.mjs'


//
// w-serv-orm 診斷輸出導入 srLog 之端到端 (R-ORM-04; spec: spec/設計要點與取捨.md ADR-098)
//
// 依據: w-serv-orm 1.1.20 起診斷輸出預設只在 console 列標籤與不含個資之摘要, 完整細節(主鍵、ORM 錯誤原文)只交 opt.funLog;
//   WWebSso 以 server/ormDiagLog.mjs 之 funLog 接管: srLog.error { event: 'orm-diag', label, safe, detail(遮罩後) }, console 照舊只列標籤與摘要.
// 作法: 獨立後端(test/tools/srvOrmDiag.mjs: 私有埠 11307、私有 lmdb 與 log 資料夾於 test/_tmp/api-ormdiag/, 不碰 11007 與 ./db),
//   正式 WWebSso 搭配包裝 w-orm-lmdb 之 WOrm: 開關檔存在時 users.insert 回傳 ok 為 0 之聚合物件(夾帶個資字串).
//   經公開入口 createUser(自助註冊)觸發 procOrm 寫入失敗, 讀後端 srLog 檔與 stdout 驗證.
//   該入口之 srLog(fun-createUser-insert)本就記帳號(既有稽核政策, 不在本檔斷言範圍); 本檔斷言 orm-diag 事件與 stdout 不含個資.
//

let PORT = 11307
let TMP = path.resolve('./test/_tmp/api-ormdiag')
let DB_URL = path.join(TMP, 'db')
let LOG_FD = path.join(TMP, 'logs')
let ARM_FILE = path.join(TMP, 'arm.flag')
let ERR_SECRET = 'SECRET-ORM-ERR-7f3a91'
let PW = 'Zq#8765Wm'
let apiUrl = `http://127.0.0.1:${PORT}`

let child = null
let stdout = ''
let exited = false


function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms))
}


//canConnect: 埠是否有人監聽
function canConnect() {
    return new Promise((resolve) => {
        let s = net.connect({ port: PORT, host: '127.0.0.1' })
        s.once('connect', () => {
            s.destroy()
            resolve(true)
        })
        s.once('error', () => {
            resolve(false)
        })
    })
}


//rmTmp: 刪 test/_tmp/api-ormdiag(lmdb 檔案於行程結束後才釋放, 重試)
async function rmTmp() {
    for (let k = 0; k < 20; k++) {
        try {
            fs.rmSync(TMP, { recursive: true, force: true })
            if (!fs.existsSync(TMP)) {
                return
            }
        }
        catch (err) {
            //重試
        }
        await sleep(250)
    }
}


//callRpc: 同 api-doubleclick 之直打 POST /api/main
async function callRpc(funcName, args, token = 'dummy') {
    let payload = { func: funcName, input: { __sysInputArgs__: args, __sysToken__: token } }
    let r = await fetch(`${apiUrl}/api/main`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/octet-stream' },
        body: Buffer.from(obj2u8arr(payload)),
    })
    let respObj = u8arr2obj(new Uint8Array(await r.arrayBuffer()))
    if (respObj && typeof respObj === 'object' && 'success' in respObj) {
        let out = respObj.success?.output
        if (out && out.state === 'success') {
            return { ok: true, msg: out.msg }
        }
        let msg = out ? out.msg : null
        return { ok: false, msg: typeof msg === 'string' ? msg : (msg?.key ?? msg?.message ?? JSON.stringify(msg)) }
    }
    return { ok: false, msg: `unparseable response: ${JSON.stringify(respObj)}` }
}


//readLogs: 讀 srLog 資料夾內全部紀錄(JSON lines)
function readLogs() {
    let out = []
    if (!fs.existsSync(LOG_FD)) {
        return out
    }
    for (let f of fs.readdirSync(LOG_FD)) {
        for (let line of fs.readFileSync(path.join(LOG_FD, f), 'utf8').split('\n')) {
            try {
                out.push(JSON.parse(line))
            }
            catch (err) {
                //非 JSON 行略過
            }
        }
    }
    return out
}


//waitLogs: 輪詢至符合條件之紀錄數達 n(srLog 為背景寫檔), 逾時回目前所有符合者
async function waitLogs(pred, n, ms = 15000) {
    let t0 = Date.now()
    let hits = []
    while (Date.now() - t0 < ms) {
        hits = readLogs().filter(pred)
        if (hits.length >= n) {
            break
        }
        await sleep(200)
    }
    return hits
}


describe('api-ormdiag w-serv-orm 診斷輸出導入 srLog (R-ORM-04)', function() {

    before(async function() {
        this.timeout(120000)
        if (await canConnect()) {
            throw new Error(`port ${PORT} 已被佔用, api-ormdiag 需要專屬埠(請先確認並釋放)`)
        }
        console.log('[api-ormdiag] tmp =', TMP)
        await rmTmp()
        fs.mkdirSync(LOG_FD, { recursive: true })
        child = spawn(process.execPath, ['test/tools/srvOrmDiag.mjs'], {
            stdio: ['ignore', 'pipe', 'pipe'],
            windowsHide: true,
            env: {
                ...process.env,
                ORMDIAG_PORT: String(PORT),
                ORMDIAG_DB_URL: DB_URL,
                ORMDIAG_LOG_FD: LOG_FD,
                ORMDIAG_ARM_FILE: ARM_FILE,
                ORMDIAG_ERR_SECRET: ERR_SECRET,
            },
        })
        child.stdout.on('data', (d) => {
            stdout += d.toString()
        })
        child.stderr.on('data', (d) => {
            stdout += d.toString()
        })
        child.on('exit', () => {
            exited = true
        })
        let t0 = Date.now()
        while (!(await canConnect())) {
            if (exited) {
                throw new Error(`srvOrmDiag 提前結束: ${stdout.slice(-1000)}`)
            }
            if (Date.now() - t0 > 90000) {
                throw new Error(`srvOrmDiag 啟動逾時: ${stdout.slice(-1000)}`)
            }
            await sleep(300)
        }
    })

    after(async function() {
        this.timeout(30000)
        if (child !== null && !exited) {
            child.kill()
            let t0 = Date.now()
            while (!exited && Date.now() - t0 < 15000) {
                await sleep(100)
            }
        }
        //回驗: 行程已結束且埠已釋放
        assert.ok(exited, '後端行程已結束')
        assert.strictEqual(await canConnect(), false, `port ${PORT} 已釋放`)
        await rmTmp()
        assert.ok(!fs.existsSync(TMP), 'test/_tmp/api-ormdiag 已清除')
    })

    it('ORMDIAG-001 對照: 未注入故障時自助註冊成功, srLog 無 orm-diag 事件(成功路徑不產生診斷)', async function() {
        this.timeout(60000)
        let r = await callRpc('createUser', ['eng', 'ormdiag-ok', PW, PW, 'ormdiag ok', 'ormdiag-ok@example.com'])
        assert.strictEqual(r.ok, true, `createUser: ${JSON.stringify(r)}`)
        await sleep(1500)
        assert.deepStrictEqual(readLogs().filter((o) => o.event === 'orm-diag'), [])
    })

    it('ORMDIAG-002 users.insert 寫入失敗: srLog.error 有 orm-diag(label 與摘要), 細節遮罩; stdout 只有標籤與摘要; 回應仍為固定語系鍵', async function() {
        //spec: 把 w-serv-orm 診斷輸出導入 srLog; id / email / 錯誤原文中之資料值不得出現; console 不多出輸出
        this.timeout(60000)
        let account = 'ormdiag-fail-user'
        let email = 'ormdiag.fail@example.com'
        let linesBefore = stdout.length
        fs.writeFileSync(ARM_FILE, 'on')
        let r = await callRpc('createUser', ['eng', account, PW, PW, 'ormdiag fail', email])
        fs.rmSync(ARM_FILE, { force: true })
        //回應: 既有契約(固定語系鍵, 不含 ORM 原文)
        assert.strictEqual(r.ok, false)
        assert.strictEqual(r.msg, 'userRegistrationFailed')
        //srLog: orm-diag 恰一筆, error 層級(pino 50)
        let hits = await waitLogs((o) => o.event === 'orm-diag', 1)
        await sleep(1000)
        hits = readLogs().filter((o) => o.event === 'orm-diag')
        assert.strictEqual(hits.length, 1, `orm-diag 筆數: ${JSON.stringify(hits)}`)
        let o = hits[0]
        assert.strictEqual(o.level, 50)
        assert.strictEqual(o.label, 'users.insert fail')
        assert.deepStrictEqual(o.safe, { ok: 0 })
        //細節遮罩: 帳號 / 信箱 / 主鍵 / 錯誤原文中之資料值皆不外露, 錯誤原文其餘文字保留供診斷
        assert.strictEqual(o.detail.ok, 0)
        assert.strictEqual(o.detail.n, 1)
        //帳號與信箱為該次呼叫輸入內之值: 換成 maskToken 之形式; 後端自產之主鍵(uuid)亦為遮罩形式(輸入內之主鍵遮罩, 或 uuid 樣式標記)
        assert.ok(o.detail.err.startsWith(`${ERR_SECRET} account[${maskToken(account)}] email[${maskToken(email)}] id[`), `err: ${o.detail.err}`)
        assert.ok(/ id\[(\(uuid\)|([^\]]{1,4}\.\.\.[^\]]{1,4})?\(len=\d+\))\]$/.test(o.detail.err), `主鍵為遮罩形式: ${o.detail.err}`)
        let s = JSON.stringify(o)
        for (let x of [account, email, 'ormdiag.fail', 'ormdiag-fail']) {
            assert.ok(!s.includes(x), `orm-diag 不得含 ${x}: ${s}`)
        }
        //既有紀錄不受影響: 呼叫端之 fun-createUser-insert 仍記語系鍵(本檔不斷言其帳號欄, 屬既有稽核政策)
        let own = await waitLogs((x) => x.event === 'fun-createUser-insert', 1)
        assert.strictEqual(own.length, 1)
        assert.strictEqual(own[0].key, 'userRegistrationFailed')
        //整個 log 資料夾不含信箱(orm-diag 之錯誤原文其餘文字依設計保留, 故 ERR_SECRET 標記會在 orm-diag.detail.err 內, 只在 stdout 斷言不出現)
        let all = JSON.stringify(readLogs())
        assert.ok(!all.includes(email), 'srLog 全部紀錄不含信箱')
        //stdout: 診斷行恰為「標籤 摘要」, 且 stdout 全文不含個資
        let outNew = stdout.slice(linesBefore)
        let diagLines = outNew.split(/\r?\n/).filter((l) => l.startsWith('users.'))
        assert.deepStrictEqual(diagLines, ['users.insert fail { ok: 0 }'])
        for (let x of [account, email, ERR_SECRET, 'ormdiag.fail']) {
            assert.ok(!stdout.includes(x), `stdout 不得含 ${x}`)
        }
    })

})
