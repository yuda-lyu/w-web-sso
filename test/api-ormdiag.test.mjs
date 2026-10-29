import assert from 'assert'
import fs from 'fs'
import net from 'net'
import path from 'path'
import { spawn } from 'child_process'
import obj2u8arr from 'wsemi/src/obj2u8arr.mjs'
import u8arr2obj from 'wsemi/src/u8arr2obj.mjs'


//
// w-serv-orm 診斷輸出導入 srLog 與外來值入口遮罩之端到端 (R-ORM-04 / R-DIAG-01; spec: spec/設計要點與取捨.md ADR-098、ADR-099; 跨套件規格 dspec〈診斷輸出與遮罩〉)
//
// 依據: w-serv-orm 1.1.20 起診斷輸出預設只在 console 列標籤與不含個資之摘要, 完整細節(主鍵、ORM 錯誤原文)只交 opt.funLog;
//   WWebSso 以 wsemi 之 genDiagFunLog 接管(dspec Q1): srLog.warn { event: 'orm-diag', label, safe }(只有安全摘要, 無 detail), 不再 console 雙寫.
//   本套件直接呼叫之資料表(woItems)與寄信之 reject 為後端/驅動之外來值, 於進入本套件時經 diag.err 遮罩憑證(guardOrm / srEmail), 本套件以固定詞彙組成之 reject 原樣.
// 作法: 獨立後端(test/tools/srvOrmDiag.mjs: 私有埠 11307、私有 lmdb 與 log 資料夾於 test/_tmp/api-ormdiag/, 不碰 11007 與 ./db),
//   正式 WWebSso 搭配包裝 w-orm-lmdb 之 WOrm: 開關檔存在時 users.insert 回傳 ok 為 0 之聚合物件(夾帶個資字串);
//   另一開關檔存在時 users / tokens 之 select 以回顯寄信密碼之 Error reject(模擬驅動錯誤夾帶憑證).
//   經公開入口 createUser(自助註冊)、loginByAccountAndPassword(RPC)與 GET /api/logoutByToken(HTTP)觸發, 讀後端 srLog 檔、回應與 stdout 驗證.
//   該入口之 srLog(fun-createUser-insert)本就記帳號(既有稽核政策, 不在本檔斷言範圍); 本檔斷言 orm-diag 事件、回應、srLog 與 stdout 不含個資或憑證.
//

let PORT = 11307
let TMP = path.resolve('./test/_tmp/api-ormdiag')
let DB_URL = path.join(TMP, 'db')
let LOG_FD = path.join(TMP, 'logs')
let ARM_FILE = path.join(TMP, 'arm.flag')
let REJECT_FILE = path.join(TMP, 'reject.flag')
let ERR_SECRET = 'SECRET-ORM-ERR-7f3a91'
//SMTP_PW: 寄信密碼(診斷遮罩之秘密, 亦為模擬驅動 reject 回顯之憑證); 刻意取為固定 key failedLoginForCatch 之子字串(語料 R07: 固定詞彙之 reject 不得被切碎)
let SMTP_PW = 'ginForCa'
//ECHO: 模擬驅動 reject 的回顯形式(srvOrmDiag.mjs: `driver auth failed for password <憑證> at <表>`); SMTP_PW 本身為固定 key 之子字串, 故洩漏判定一律用 ECHO 而非 SMTP_PW
let ECHO = `password ${SMTP_PW}`
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


//callRpc: 同 api-doubleclick 之直打 POST /api/main; 回傳 { ok, msg(字串化), raw(回應之 output) }
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
            return { ok: true, msg: out.msg, raw: out }
        }
        let msg = out ? out.msg : null
        return { ok: false, msg: typeof msg === 'string' ? msg : (msg?.key ?? msg?.message ?? JSON.stringify(msg)), raw: out }
    }
    return { ok: false, msg: `unparseable response: ${JSON.stringify(respObj)}`, raw: respObj }
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


describe('api-ormdiag w-serv-orm 診斷輸出導入 srLog 與外來值入口遮罩 (R-ORM-04 / R-DIAG-01)', function() {

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
                ORMDIAG_REJECT_FILE: REJECT_FILE,
                ORMDIAG_SMTP_PW: SMTP_PW,
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

    it('ORMDIAG-002 users.insert 寫入失敗: srLog.warn 有 orm-diag(只有 label 與安全摘要, 無 detail); stdout 無診斷行(不再 console 雙寫); 回應仍為固定語系鍵', async function() {
        //spec(dspec Q1): sso 之 orm-diag 只寫安全摘要; 等級 error → warn; 不再 console 雙寫; id / email / 錯誤原文中之資料值不得出現
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
        //srLog: orm-diag 恰一筆, warn 層級(pino 40)
        let hits = await waitLogs((o) => o.event === 'orm-diag', 1)
        await sleep(1000)
        hits = readLogs().filter((o) => o.event === 'orm-diag')
        assert.strictEqual(hits.length, 1, `orm-diag 筆數: ${JSON.stringify(hits)}`)
        let o = hits[0]
        assert.strictEqual(o.level, 40)
        assert.strictEqual(o.label, 'users.insert fail')
        assert.deepStrictEqual(o.safe, { ok: 0 })
        assert.ok(!('detail' in o), `不得有 detail: ${JSON.stringify(o)}`)
        let s = JSON.stringify(o)
        for (let x of [account, email, 'ormdiag.fail', 'ormdiag-fail', ERR_SECRET]) {
            assert.ok(!s.includes(x), `orm-diag 不得含 ${x}: ${s}`)
        }
        //既有紀錄不受影響: 呼叫端之 fun-createUser-insert 仍記語系鍵(本檔不斷言其帳號欄, 屬既有稽核政策)
        let own = await waitLogs((x) => x.event === 'fun-createUser-insert', 1)
        assert.strictEqual(own.length, 1)
        assert.strictEqual(own[0].key, 'userRegistrationFailed')
        //整個 log 資料夾不含信箱與 ORM 錯誤原文中的標記
        let all = JSON.stringify(readLogs())
        assert.ok(!all.includes(email), 'srLog 全部紀錄不含信箱')
        assert.ok(!all.includes(ERR_SECRET), 'srLog 全部紀錄不含 ORM 錯誤原文中的標記')
        //stdout: 不再有診斷行(傳 funLog 後 w-serv-orm 不寫 console, 本套件亦不補寫), 且 stdout 全文不含個資
        let outNew = stdout.slice(linesBefore)
        let diagLines = outNew.split(/\r?\n/).filter((l) => l.startsWith('users.'))
        assert.deepStrictEqual(diagLines, [])
        for (let x of [account, email, ERR_SECRET, 'ormdiag.fail']) {
            assert.ok(!stdout.includes(x), `stdout 不得含 ${x}`)
        }
    })

    it('ORMDIAG-003 資料表 select 以回顯寄信密碼之 Error reject: RPC 回應、srLog(kpfun-error)與 stdout 皆不含該憑證之回顯, 診斷文字保留', async function() {
        //spec(dspec D3): 本套件直接呼叫之資料表 reject(外來值)含憑證者, 進入本套件時遮罩; 回給遠端之回應與日誌不含憑證
        //路徑: createUser 於 users 表鎖內 woItems.users.select() 未 catch → reject(err) 經 cst.setWithFree、kpfun 集中出口回遠端
        this.timeout(60000)
        let linesBefore = stdout.length
        let nBefore = readLogs().filter((o) => o.event === 'kpfun-error' && o.fun === 'createUser').length
        fs.writeFileSync(REJECT_FILE, 'on')
        let r = null
        try {
            r = await callRpc('createUser', ['eng', 'ormdiag-rej-user', PW, PW, 'ormdiag rej', 'ormdiag.rej@example.com'])
        }
        finally {
            fs.rmSync(REJECT_FILE, { force: true })
        }
        assert.strictEqual(r.ok, false)
        let resp = JSON.stringify(r.raw)
        assert.ok(!resp.includes(ECHO), `回應不得含憑證回顯: ${resp}`)
        //srLog: kpfun 集中出口恰多一筆, key(Error.message)保留診斷文字、不含憑證回顯
        let errs = await waitLogs((o) => o.event === 'kpfun-error' && o.fun === 'createUser', nBefore + 1)
        assert.strictEqual(errs.length, nBefore + 1, JSON.stringify(errs))
        let key = errs[errs.length - 1].key
        assert.ok(key.includes('driver auth failed'), `保留診斷文字: ${key}`)
        assert.ok(!key.includes(ECHO), `key 不得含憑證回顯: ${key}`)
        await sleep(500)
        assert.ok(!JSON.stringify(readLogs()).includes(ECHO), 'srLog 全部紀錄不含憑證回顯')
        assert.ok(!stdout.slice(linesBefore).includes(ECHO), 'stdout 不含憑證回顯')
    })

    it('ORMDIAG-004 HTTP 端點(GET /api/logoutByToken)之資料表 reject 含憑證: 回遠端之 msg 與 srLog 皆已遮罩', async function() {
        this.timeout(60000)
        fs.writeFileSync(REJECT_FILE, 'on')
        let body = null
        try {
            let resp = await fetch(`${apiUrl}/api/logoutByToken?token=ormdiag-token-0000000000`)
            body = await resp.json()
        }
        finally {
            fs.rmSync(REJECT_FILE, { force: true })
        }
        assert.strictEqual(body.state, 'error')
        let s = JSON.stringify(body)
        assert.ok(s.includes('driver auth failed'), `保留診斷文字: ${s}`)
        assert.ok(!s.includes(ECHO), `回應不得含憑證回顯: ${s}`)
        let errs = await waitLogs((o) => o.event === 'api-error' && typeof o.key === 'string' && o.key.includes('driver auth failed'), 1)
        assert.strictEqual(errs.length, 1)
        assert.ok(!errs[0].key.includes(ECHO), `api-error 不得含憑證回顯: ${errs[0].key}`)
        await sleep(500)
        assert.ok(!JSON.stringify(readLogs()).includes(ECHO), 'srLog 全部紀錄不含憑證回顯')
    })

    it('ORMDIAG-005 固定詞彙之 reject 原樣(R07): 登入密碼錯誤回 failedLoginForCatch, 即使寄信密碼為其子字串; srLog 之 kpfun-error 亦原樣', async function() {
        //spec(dspec R07): 本套件以固定詞彙組成之 reject 不經遮罩; SMTP_PW(ginForCa)為 failedLoginForCatch 之子字串, 若被誤包 diag.err 則回應會變 failedLo***tch
        this.timeout(60000)
        let isMine = (o) => o.event === 'kpfun-error' && o.fun === 'loginByAccountAndPassword' && o.key === 'failedLoginForCatch'
        let nBefore = readLogs().filter(isMine).length
        let r = await callRpc('loginByAccountAndPassword', ['eng', 'ormdiag-ok', 'Wrong@12345x'])
        assert.strictEqual(r.ok, false)
        assert.strictEqual(r.msg, 'failedLoginForCatch')
        let errs = await waitLogs(isMine, nBefore + 1)
        assert.strictEqual(errs.length, nBefore + 1, `kpfun-error: ${JSON.stringify(readLogs().filter((o) => o.event === 'kpfun-error'))}`)
    })

})
