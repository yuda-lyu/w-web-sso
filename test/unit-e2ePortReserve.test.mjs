//測試 e2e 單開之自動換埠與只動本實例之下殺(規則帳本 R-E2E-PORT-01; 排程第 309 項, 2026-11-05 ws309; 規格 C:/opensrcOper/dspec/e2e埠與多套件同跑.md E1～E8)
//
//受測: test/tools/e2ePorts.mjs(基準埠單一定義＋reserveE2ePorts)、test/tools/e2e-setup.mjs(baseUrl／apiUrl／genTempSettings 之 serverPort／服務管理器之 reservation／前端 dev server 實際埠核對)、
//      test/tools/run-e2e-isolated.mjs(逐檔 runner 之下殺)、test/ 與 spec/evidence 下寫死之埠、網址與下殺呼叫、15 個 e2e 檔之 compareBuf 接線。
//契約(R-E2E-PORT-01):
//  1. [E1][E2] 沒有占用時即基準埠(E2E_PORT_OFFSET 維持未設); 後端或前端任一基準埠被真實監聽者占用時整組位移, 位移後之 baseUrl／apiUrl／臨時設定之 serverPort／verifyBaseUrl／siteUrl 皆為位移後之實際埠。
//  2. [E4] 占用者絕不被動到: 位移之過程中占用者仍在監聽、沒有收到任何 HTTP 請求(保留與偵測只做綁定檢查)。
//  3. [E3] 兩個同時開跑之行程(同一登錄目錄)不會選到同一組埠(預約, 偵測與綁定之間有時間差)。
//  4. [E4] test/、test/tools/、spec/evidence/ 之可執行碼無依埠下殺(killPortListeners)之呼叫; 逐檔 runner 只殺本實例已確認身分之監聽者並於遇他人占用或查不到監聽者時中止; 服務管理器明確帶入 reservation。
//  5. 測試碼(e2e-／api-／tools)無寫死之連線網址(host:埠); 例外只有 redir 資料字串(http://127.0.0.1:8080/?view=…&token={token}, 資料不是連線, 不隨位移改)。
//     api-／unit- 測試寫死之監聽埠與 e2ePorts.OTHER_TEST_PORTS 一致(新增忘了列即紅); 15 個 e2e 檔之 runBaselineCase 皆帶 compareBuf: portCompareBuf(畫面含埠之 E7 覆蓋)。
//  6. [E5] 自建 dev server 就緒後核對其輸出之 Local 網址埠: 與預期埠不同(vue-cli 之 portfinder 於埠被搶走時靜默改埠)即拋錯。
//與環境無關(任務要求): 占用者一律占「作業系統配發之動態埠」(經 E2E_PORTS_FOR_UNIT_TEST 令子行程以之當基準埠), 絕不在真實之 11007／8080 起占用者
//  (8080 多套件共用, Windows 允許並存綁定而搶走對方之連線); 期望位移由「當下環境之首個空閒位移」動態算出; 不使用 skip。
//跑法: node C:/opensrcOper/tools/quiet-run.mjs --name e2ePortReserve --lock -- npx mocha test/unit-e2ePortReserve.test.mjs --timeout 120000
import fs from 'fs'
import net from 'net'
import http from 'http'
import path from 'path'
import assert from 'assert'
import JSON5 from 'json5'
import { spawn, spawnSync } from 'child_process'
import { fileURLToPath, pathToFileURL } from 'url'

const A = assert.strict
const fdTest = path.dirname(fileURLToPath(import.meta.url))
const projRoot = path.join(fdTest, '..')
const fdTmp = path.join(fdTest, '_tmp', 'e2ePortReserve') //測試中介資料(測完即刪)
const fdReg = path.join(fdTmp, 'reg') //私有之埠預約登錄目錄(不干擾真實預約)
const SETUP_URL = pathToFileURL(path.join(fdTest, 'tools', 'e2e-setup.mjs')).href
const PORTS_URL = pathToFileURL(path.join(fdTest, 'tools', 'e2ePorts.mjs')).href

//e2ePorts.mjs 之 OTHER_TEST_PORTS(自原始碼文字取, 不 import: import 會在本 mocha 行程內實際呼叫 reserveE2ePorts, 使本檔依賴環境)
let otherPorts = () => {
    let m = /OTHER_TEST_PORTS\s*=\s*\[([^\]]*)\]/.exec(codeOf(path.join(fdTest, 'tools', 'e2ePorts.mjs')))
    A.ok(m, 'e2ePorts.mjs 須有 OTHER_TEST_PORTS 陣列')
    return m[1].split(',').map((s) => Number(s.trim())).filter((n) => n > 0)
}

//settings.json 之 serverPort(未位移時 genTempSettings 不注入任何鍵, 臨時設定之 serverPort 即此值)
let settingsPort = () => JSON5.parse(fs.readFileSync(path.join(projRoot, 'settings.json'), 'utf8')).serverPort

//子行程: 匯入 e2e-setup(其匯入之 e2ePorts 於模組頂層即保留埠)後回報實際埠與衍生值; WS309_HOLD_OPEN=1 時續留至父行程寫入一行(保留不釋放)
const CHILD_CODE = `
import fs from 'fs'
const m = await import(${JSON.stringify(SETUP_URL)})
const p = await import(${JSON.stringify(PORTS_URL)})
const t = JSON.parse(fs.readFileSync(m.genTempSettings({}), 'utf8'))
console.log('RESULT ' + JSON.stringify({ source: p.reservation.source, offset: p.reservation.offset, ports: p.reservation.ports, bases: [p.BACKEND_PORT, p.FRONTEND_PORT], env: process.env.E2E_PORT_OFFSET === undefined ? null : process.env.E2E_PORT_OFFSET, base: m.baseUrl, api: m.apiUrl, shifted: m.PORTS_SHIFTED, cmp: m.portCompareBuf === null ? null : typeof m.portCompareBuf, serverPort: t.serverPort, verifyBaseUrl: t.verifyBaseUrl, siteUrl: t.siteUrl }))
if (process.env.WS309_HOLD_OPEN === '1') {
    await new Promise((resolve) => process.stdin.once('data', resolve))
}
m.cleanup()
`

let bases = [0, 0] //本檔使用之動態基準埠[後端, 前端](before 取得)

let baseEnv = () => {
    let env = { ...process.env, E2E_PORT_REG_DIR: fdReg, E2E_PORTS_FOR_UNIT_TEST: bases.join(',') }
    //外層 shell 若為等價驗證設了 E2E_BASELINE_OUT_DIR／E2E_PORT_REGIONS_OUT 等, 不得影響本檔(與環境無關)
    for (let k of ['E2E_PORT_OFFSET', 'E2E_PORT_HOLD', 'E2E_REGEN', 'E2E_BARE', 'E2E_DIAG', 'E2E_COLLECT', 'E2E_BASELINE_OUT_DIR', 'E2E_PORT_REGIONS_OUT', 'E2E_STRICT_CAPTURE', 'WS309_HOLD_OPEN']) {
        delete env[k]
    }
    return env
}

let runChild = (env, code = CHILD_CODE) => {
    let r = spawnSync(process.execPath, ['--input-type=module', '-e', code], { cwd: projRoot, env, encoding: 'utf8', timeout: 90000, windowsHide: true })
    let m = /RESULT (.*)/.exec(r.stdout || '')
    //stderr 取末 4000 字元(本專案路徑含中文, 檔案 URL 被百分比編碼, 堆疊行長; 800 字元可能把錯誤訊息開頭切掉)
    return { status: r.status, out: m ? JSON.parse(m[1]) : null, stdout: r.stdout || '', err: (r.stderr || '').slice(-4000) }
}

//以真實 http 監聽占用一個埠(node 預設之雙棧位址); 記錄收到之請求數
let occupy = (port) => new Promise((resolve, reject) => {
    let hits = 0
    let server = http.createServer((req, res) => {
        hits++
        res.end('occupied')
    })
    server.once('error', reject)
    server.listen(port, () => resolve({ port, hits: () => hits, close: () => new Promise((r) => server.close(r)) }))
})

//埠是否仍在監聽(以 TCP 連線檢查, 不送 HTTP)
let isListening = (port) => new Promise((resolve) => {
    let s = net.connect({ host: '127.0.0.1', port })
    s.once('connect', () => {
        s.destroy()
        resolve(true)
    })
    s.once('error', () => resolve(false))
})

//埠是否空閒(同套件偵測 reserveE2ePorts: 127.0.0.1、0.0.0.0、::、::1 四個位址皆能綁定; 無 IPv6 之主機〔EAFNOSUPPORT／EADDRNOTAVAIL〕該位址視為通過)
let isFree = async (port) => {
    for (let host of ['127.0.0.1', '0.0.0.0', '::', '::1']) {
        let ok = await new Promise((resolve) => {
            let s = net.createServer()
            s.once('error', (err) => resolve(err.code === 'EAFNOSUPPORT' || err.code === 'EADDRNOTAVAIL'))
            s.listen(port, host, () => s.close(() => resolve(true)))
        })
        if (!ok) {
            return false
        }
    }
    return true
}

//作業系統配發之埠(listen(0) 後釋放)
let osPort = () => new Promise((resolve, reject) => {
    let s = net.createServer()
    s.once('error', reject)
    s.listen(0, '127.0.0.1', () => {
        let p = s.address().port
        s.close(() => resolve(p))
    })
})

//取兩個動態基準埠: 作業系統配發之埠往下移 20000(落在 29152～45535, 避開系統動態埠池 49152+ 常被他人連線暫用, 位移後相撞)、兩者相距 ≥ 400,
//  且位移 0～300 之各組埠皆空閒(占用情境之期望位移才可預測); 與 OTHER_TEST_PORTS 無交集
let pickBases = async () => {
    let avoid = otherPorts()
    for (let k = 0; k < 100; k++) {
        //Windows 連續配發相鄰之埠(實測 60831、60832…), 故前端基準埠另加 500, 確保兩組位移 0～300 之埠不重疊
        let a = (await osPort()) - 20000
        let b = (await osPort()) - 20000 + 500
        if (Math.abs(a - b) < 400 || [0, 100, 200, 300].some((o) => avoid.includes(a + o) || avoid.includes(b + o))) {
            continue
        }
        let ok = true
        for (let off of [0, 100, 200, 300]) {
            if (!(await isFree(a + off)) || !(await isFree(b + off))) {
                ok = false
                break
            }
        }
        if (ok) {
            return [a, b]
        }
    }
    throw new Error('找不到空閒之動態基準埠組')
}

//依「由小到大逐一試位移 0、100、200…, 兩個基準埠皆空閒、且不落在 OTHER_TEST_PORTS 之第一個」算出期望位移(與當下環境無關: 他人占用者、本測試之占用者皆計入)
let firstFreeOffset = async () => {
    let avoid = otherPorts()
    for (let off = 0; off < 2000; off += 100) {
        if (avoid.includes(bases[0] + off) || avoid.includes(bases[1] + off)) {
            continue
        }
        if ((await isFree(bases[0] + off)) && (await isFree(bases[1] + off))) {
            return off
        }
    }
    throw new Error('找不到空閒之位移')
}

let alive = (pid) => {
    try {
        process.kill(pid, 0)
        return true
    }
    catch (err) {
        return err.code === 'EPERM'
    }
}

let sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

//可執行碼之行(去掉整行註解與行尾 // 註解之文字; 區塊註解 /* */ 之行略過)。行尾 // 之判定略過字串內之 //(如 'http://')
let stripLineComment = (s) => {
    let q = null
    for (let i = 0; i < s.length; i++) {
        let c = s[i]
        if (q) {
            if (c === '\\') {
                i++
            }
            else if (c === q) {
                q = null
            }
            continue
        }
        if (c === '\'' || c === '"' || c === '`') {
            q = c
        }
        else if (c === '/' && s[i + 1] === '/') {
            return s.slice(0, i)
        }
    }
    return s
}
let sourceLines = (fp) => {
    let out = []
    let inBlock = false
    fs.readFileSync(fp, 'utf8').split(/\r?\n/).forEach((ln, k) => {
        let t = ln.trim()
        let doc = inBlock || t.startsWith('/*') || t.startsWith('*')
        if (t.startsWith('/*') && !t.includes('*/')) {
            inBlock = true
        }
        if (inBlock && t.includes('*/')) {
            inBlock = false
        }
        if (doc || t.startsWith('//')) {
            return
        }
        out.push({ no: k + 1, text: stripLineComment(ln) })
    })
    return out
}
let codeOf = (fp) => sourceLines(fp).map((l) => l.text).join('\n')

//遞迴列出目錄下 .mjs(不跟進連結: 以 lstat 判斷, 遇連結略過)
let listMjs = (fd) => {
    let out = []
    if (!fs.existsSync(fd)) {
        return out
    }
    for (let ent of fs.readdirSync(fd)) {
        let fp = path.join(fd, ent)
        let st = fs.lstatSync(fp)
        if (st.isSymbolicLink()) {
            continue
        }
        if (st.isDirectory()) {
            if (ent !== 'node_modules' && ent !== '_tmp' && ent !== 'pics') {
                out.push(...listMjs(fp))
            }
        }
        else if (/\.mjs$/.test(ent)) {
            out.push(fp)
        }
    }
    return out
}

let SELF = 'unit-e2ePortReserve.test.mjs'


describe('unit-e2ePortReserve (e2e 單開自動換埠與只動本實例之下殺, R-E2E-PORT-01)', function() {
    this.timeout(180000)

    before(async function() {
        fs.rmSync(fdTmp, { recursive: true, force: true })
        fs.mkdirSync(fdReg, { recursive: true })
        bases = await pickBases()
    })

    after(function() {
        fs.rmSync(fdTmp, { recursive: true, force: true })
    })

    describe('契約 1、2: 基準埠空閒即基準埠; 被占用整組位移且占用者不受影響', function() {
        it('PR-001 期望位移＝當下環境之首個空閒位移; 位移 0 時 E2E_PORT_OFFSET 維持未設, baseUrl／apiUrl／臨時設定同導入前、portCompareBuf 為 null', async function() {
            let exp = await firstFreeOffset()
            let { status, out, err } = runChild(baseEnv())
            A.equal(status, 0, `子行程失敗: ${err}`)
            A.equal(out.source, 'auto')
            A.equal(out.offset, exp, '位移須為當下環境之首個空閒位移(基準埠有他人占用時為其後之組)')
            A.deepEqual(out.bases, bases, '單元測試以動態基準埠取代真實之 11007／8080')
            A.deepEqual(out.ports, [bases[0] + exp, bases[1] + exp])
            A.equal(out.base, `http://127.0.0.1:${bases[1] + exp}`)
            A.equal(out.api, `http://127.0.0.1:${bases[0] + exp}`)
            if (exp === 0) {
                A.equal(out.env, null, '沒有位移時不得寫入 E2E_PORT_OFFSET(行為同導入前)')
                A.equal(out.shifted, false)
                A.equal(out.cmp, null, '未位移時不覆蓋(compareBuf 為 null, 比對與導入前逐位元相同)')
                A.equal(out.serverPort, settingsPort(), '未位移之臨時設定 serverPort 同 settings.json(不注入任何鍵)')
                A.equal(out.verifyBaseUrl, JSON5.parse(fs.readFileSync(path.join(projRoot, 'settings.json'), 'utf8')).verifyBaseUrl)
            }
            else {
                A.equal(out.env, String(exp))
            }
        })

        for (let [id, which, heldOffsets] of [
            ['PR-002', 0, [0]], //後端基準埠被占用
            ['PR-003', 1, [0]], //前端基準埠被占用: 後端也一起移位(只換一個埠, 服務之間就連不上, E3)
            ['PR-004', 0, [0, 100]], //第一個位移之後端埠也被占用: 再移一格
        ]) {
            it(`${id} 占用${which === 0 ? '後端' : '前端'}基準埠${heldOffsets.length > 1 ? '(含其位移 100)' : ''}: 整組位移至「首個空閒位移」; 占用者仍在監聽且沒收到任何請求; 網址與臨時設定皆為實際埠`, async function() {
                let occupiers = []
                try {
                    for (let off of heldOffsets) {
                        occupiers.push(await occupy(bases[which] + off))
                    }
                    let expOffset = await firstFreeOffset()
                    let expPorts = [bases[0] + expOffset, bases[1] + expOffset]
                    let minOffset = heldOffsets.length > 1 ? 200 : 100
                    A.ok(expOffset >= minOffset, `前提: 基準埠已被占用, 期望位移須 >= ${minOffset}, 實得 ${expOffset}`)
                    let { status, out, stdout, err } = runChild(baseEnv())
                    A.equal(status, 0, `子行程失敗: ${err}`)
                    A.equal(out.source, 'auto')
                    A.equal(out.offset, expOffset)
                    A.deepEqual(out.ports, expPorts)
                    A.equal(out.env, String(expOffset), '位移寫入 E2E_PORT_OFFSET, 供 resolveE2ePort／子行程／vue.config.js 取得同一組埠')
                    A.equal(out.base, `http://127.0.0.1:${expPorts[1]}`, 'baseUrl 為實際前端埠')
                    A.equal(out.api, `http://127.0.0.1:${expPorts[0]}`, 'apiUrl 為實際後端埠')
                    A.equal(out.shifted, true)
                    A.equal(out.cmp, 'function', '位移時畫面含實際埠之區域由比對端覆蓋(compareBuf 為 portCompareBuf)')
                    A.equal(out.serverPort, expPorts[0], '臨時設定之 serverPort 為實際後端埠(srv.mjs 之埠只能由 settings 決定)')
                    A.equal(out.verifyBaseUrl, `http://localhost:${expPorts[0]}`, '驗證信連結之後端網址須為實際後端埠(否則連到別人或無人之埠)')
                    A.equal(out.siteUrl, `http://localhost:${expPorts[1]}`)
                    A.ok(stdout.includes(`[e2e-port] 基準埠 [${bases[0]}, ${bases[1]}] → 實際埠 [${expPorts.join(', ')}]`), `[E6] 實際使用之埠須印入輸出: ${stdout.slice(0, 300)}`)
                    for (let o of occupiers) {
                        A.equal(await isListening(o.port), true, `占用者 ${o.port} 須仍在監聽(絕不殺占用者)`)
                        A.equal(o.hits(), 0, `占用者 ${o.port} 不得收到任何 HTTP 請求(只做綁定檢查, 不打到別人的服務)`)
                    }
                }
                finally {
                    for (let o of occupiers) {
                        await o.close()
                    }
                }
            })
        }

        it('PR-005 手動 E2E_PORT_OFFSET=0(沿用逃生口): 不換埠, 未位移之 baseUrl／apiUrl／臨時設定同導入前, 占用者仍不被動(只告警)', async function() {
            let o = await occupy(bases[0])
            try {
                let { status, out, stdout, err } = runChild({ ...baseEnv(), E2E_PORT_OFFSET: '0' })
                A.equal(status, 0, `子行程失敗: ${err}`)
                A.equal(out.source, 'pinned')
                A.deepEqual(out.ports, bases, '手動指定位移 0＝明確要求基準埠, 不自動換埠')
                A.equal(out.base, `http://127.0.0.1:${bases[1]}`)
                A.equal(out.api, `http://127.0.0.1:${bases[0]}`)
                A.equal(out.shifted, false)
                A.equal(out.serverPort, settingsPort(), '未位移之臨時設定 serverPort 同 settings.json')
                A.ok(/警告/.test(stdout), '被占用時須告警(不靜默)')
                A.equal(await isListening(bases[0]), true)
                A.equal(o.hits(), 0)
            }
            finally {
                await o.close()
            }
        })
    })

    describe('契約 3: 同時開跑之兩個行程不選到同一組埠(預約)', function() {
        it('PR-006 兩個子行程同一登錄目錄: 先到者取首個空閒位移, 後到者因預約而取更大之位移(兩組埠不重疊)', async function() {
            let off0 = await firstFreeOffset()
            let kids = []
            let startKid = () => new Promise((resolve, reject) => {
                let child = spawn(process.execPath, ['--input-type=module', '-e', CHILD_CODE], { cwd: projRoot, env: { ...baseEnv(), WS309_HOLD_OPEN: '1' }, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true })
                kids.push(child)
                let buf = ''
                let tm = setTimeout(() => reject(new Error(`子行程逾時未回報: ${buf.slice(-400)}`)), 60000)
                child.stdin.on('error', () => {}) //子行程已結束時寫入已關閉之管線會非同步發 error, 不得成為未捕捉例外
                child.once('exit', () => clearTimeout(tm))
                child.stdout.on('data', (d) => {
                    buf += d
                    let m = /RESULT (.*)/.exec(buf)
                    if (m) {
                        clearTimeout(tm)
                        resolve(JSON.parse(m[1]))
                    }
                })
                child.once('error', reject)
            })
            try {
                let a = await startKid()
                let b = await startKid() //a 仍持有(未結束), 其預約使 b 不得選同一組, 即使兩組埠都沒有真實監聽者
                A.equal(a.offset, off0, '先到者取首個空閒位移')
                A.ok(b.offset > a.offset, `後到者須因預約而位移(偵測與綁定之間有時間差, 不能只靠綁定檢查): 先 ${a.offset} 後 ${b.offset}`)
                A.ok(a.ports.every((p) => !b.ports.includes(p)), `兩組埠不得重疊: ${a.ports} vs ${b.ports}`)
            }
            finally {
                for (let k of kids) {
                    try {
                        k.stdin.write('go\n')
                        k.stdin.end() //關閉 stdin, 子行程才會自行結束(否則仍持有 stdin 而耗滿等待上限後被強殺)
                    }
                    catch (err) {}
                }
                //以可觀察之條件同步(輪詢至行程結束), 不以固定延時後斷言
                let t0 = Date.now()
                while (kids.some((k) => alive(k.pid)) && Date.now() - t0 < 15000) {
                    await sleep(100)
                }
                for (let k of kids) {
                    if (alive(k.pid)) {
                        k.kill()
                    }
                }
            }
        })
    })

    describe('契約 6: 自建前端 dev server 就緒後核對實際綁定埠(E5; vue-cli 之 portfinder 於埠被搶走時靜默改埠)', function() {
        it('PR-007 checkDevServerTail 判 ok／mismatch／unknown; verifyDevServerPort 於 mismatch 拋錯寫明實際埠、ok 通過、輸出一直無 Local 網址只警告', function() {
            //E2E_PORT_HOLD: 視為上層已保留(不在本子行程內選埠／預約), 只驗核對函數
            let code = `
import { EventEmitter } from 'events'
const m = await import(${JSON.stringify(SETUP_URL)})
const esc = String.fromCharCode(27)
const local = (p) => esc + '[2K  - Local:   http://localhost:' + p + '/' + '\\n  - Network: http://192.168.0.2:' + p + '/\\n'
const r = {
    ok: m.checkDevServerTail('App running at:\\n' + local(8180), 8180),
    mismatch: m.checkDevServerTail('App running at:\\n' + local(8181), 8180),
    unknown: m.checkDevServerTail('[3%] setup (watch run)\\n', 8180),
    lastWins: m.checkDevServerTail(local(8181) + local(8180), 8180),
}
const fake = () => {
    const c = new EventEmitter()
    c.stdout = new EventEmitter()
    c.stderr = new EventEmitter()
    return c
}
const v = {}
//mismatch: 預期 8180, 輸出為 8181
let c1 = fake()
m.trackDevServer(c1, 8180)
c1.stdout.emit('data', 'DONE  Compiled successfully\\n' + local(8181))
try {
    await m.verifyDevServerPort({ verifyTimeoutMs: 2000 })
    v.mismatch = { threw: false }
}
catch (e) {
    v.mismatch = { threw: true, msg: String(e.message) }
}
//ok
let c2 = fake()
m.trackDevServer(c2, 8180)
c2.stderr.emit('data', local(8180))
try {
    await m.verifyDevServerPort({ verifyTimeoutMs: 2000 })
    v.ok = { threw: false }
}
catch (e) {
    v.ok = { threw: true, msg: String(e.message) }
}
//unknown: 逾時只警告不拋錯
let c3 = fake()
m.trackDevServer(c3, 8180)
c3.stdout.emit('data', 'compiling...\\n')
try {
    await m.verifyDevServerPort({ verifyTimeoutMs: 600 })
    v.unknown = { threw: false }
}
catch (e) {
    v.unknown = { threw: true, msg: String(e.message) }
}
console.log('RESULT ' + JSON.stringify({ r, v }))
m.cleanup()
`
            let res = runChild({ ...baseEnv(), E2E_PORT_HOLD: 'ws309-unit-pr007' }, code)
            A.equal(res.status, 0, `子行程失敗: ${res.err}`)
            let { r, v } = res.out
            A.deepEqual({ ok: r.ok.state, mismatch: r.mismatch.state, unknown: r.unknown.state, lastWins: r.lastWins.state }, { ok: 'ok', mismatch: 'mismatch', unknown: 'unknown', lastWins: 'ok' }, '最後一個 Local 網址為準(重新編譯後輸出多次)')
            A.equal(r.mismatch.actual, 8181)
            A.equal(v.mismatch.threw, true, '實際綁定埠不同須拋錯(免打到別人的服務)')
            A.ok(v.mismatch.msg.includes('8181') && v.mismatch.msg.includes('8180'), `錯誤須寫明實際埠與預期埠: ${v.mismatch.msg}`)
            A.equal(v.ok.threw, false)
            A.equal(v.unknown.threw, false, '輸出格式不明(一直見不到 Local 網址)只警告, 不誤殺')
            A.ok(/警告: 未於 dev server 輸出見到 Local 網址/.test(res.stdout), '無法核對時須印警告(不靜默)')
        })
    })

    describe('契約 7: 標準圖只能在基準埠產製(畫面含前端埠之標準圖內是基準埠之文字)', function() {
        it('PR-016 位移實例(釘住位移 100)產製(E2E_REGEN=1)且未導向 E2E_BASELINE_OUT_DIR 時 e2e-setup 載入即拋錯; 導向暫存目錄、或基準埠(位移 0)產製則照常', function() {
            let regen = { ...baseEnv(), E2E_REGEN: '1' }
            let a = runChild({ ...regen, E2E_PORT_OFFSET: '100' })
            A.notEqual(a.status, 0, '位移實例不得寫正式標準圖')
            A.ok(/標準圖只能在基準埠/.test(a.err), `須寫明原因: ${a.err}`)
            let b = runChild({ ...regen, E2E_PORT_OFFSET: '100', E2E_BASELINE_OUT_DIR: path.join(fdTmp, 'out') })
            A.equal(b.status, 0, `導向暫存目錄(等價驗證)須照常: ${b.err}`)
            //基準埠(真實之 11007／8080 且釘住位移 0; 只預約登記、不綁定、不起占用者)產製須照常: 去掉單元測試專用之基準埠覆寫(覆寫生效時視同位移, 見 PR-017)
            //(E2E_PORT_HOLD: 視為上層已保留, 不在子行程內偵測／預約, 故不對真實 11007／8080 做任何綁定探測)
            let noOverride = { ...regen, E2E_PORT_OFFSET: '0', E2E_PORT_HOLD: 'ws309-unit-pr016c' }
            delete noOverride.E2E_PORTS_FOR_UNIT_TEST
            let c = runChild(noOverride)
            A.equal(c.status, 0, `基準埠(位移 0)產製須照常: ${c.err}`)
            A.deepEqual(c.out.bases, [11007, 8080])
        })
    })

    describe('契約 8: 單元測試專用基準埠覆寫(E2E_PORTS_FOR_UNIT_TEST)誤設不得靜默', function() {
        it('PR-017 有效覆寫印出一行告知、無效值印警告並忽略(基準埠維持 11007／8080); 覆寫生效時視同位移, 產製標準圖須導向暫存目錄', function() {
            let code = `
const p = await import(${JSON.stringify(PORTS_URL)})
console.log('RESULT ' + JSON.stringify({ ports: [p.BACKEND_PORT, p.FRONTEND_PORT], active: p.UNIT_TEST_PORTS_ACTIVE }))
`
            let ok = runChild({ ...baseEnv(), E2E_PORT_HOLD: 'ws309-unit-pr017' }, code)
            A.equal(ok.status, 0, ok.err)
            A.deepEqual(ok.out.ports, bases)
            A.equal(ok.out.active, true)
            A.ok(ok.stdout.includes('單元測試專用基準埠覆寫') && ok.stdout.includes(String(bases[0])), `覆寫生效須印出告知: ${ok.stdout.slice(0, 200)}`)
            for (let bad of ['abc', '80', '30000', '30000,abc', '30000,30500,31000', '0,70000', '30000,30000', '11207,30500', '30500,11097']) {
                let r = runChild({ ...baseEnv(), E2E_PORTS_FOR_UNIT_TEST: bad, E2E_PORT_HOLD: 'ws309-unit-pr017' }, code)
                A.equal(r.status, 0, r.err)
                A.deepEqual(r.out.ports, [11007, 8080], `無效值「${bad}」須忽略, 基準埠維持 11007／8080`)
                A.equal(r.out.active, false)
                A.ok(/警告: E2E_PORTS_FOR_UNIT_TEST/.test(r.stdout), `無效值「${bad}」須印警告(不靜默): ${r.stdout.slice(0, 200)}`)
            }
            //覆寫生效且 E2E_REGEN=1、未導向 E2E_BASELINE_OUT_DIR: e2e-setup 載入即拋錯(標準圖內是 8080 之文字, 不得以其他基準埠產製)
            let regen = runChild({ ...baseEnv(), E2E_REGEN: '1', E2E_PORT_OFFSET: '0' })
            A.notEqual(regen.status, 0, '覆寫生效時產製標準圖須被擋下')
            A.ok(/標準圖只能在基準埠/.test(regen.err), regen.err.slice(-300))
            //覆寫生效時不得起停服務(後端埠只由 settings.json 決定、前端指令與 vue.config.js 皆以 11007／8080 為準, 會錯配): startServersOnce／restartBackend 立即拋錯, 不 spawn 任何行程
            let svc = runChild({ ...baseEnv(), E2E_PORT_HOLD: 'ws309-unit-pr017' }, `
const m = await import(${JSON.stringify(SETUP_URL)})
const r = {}
for (const [name, fn] of [['start', () => m.startServersOnce()], ['restart', () => m.restartBackend('./settings.json')]]) {
    try {
        await fn()
        r[name] = { threw: false }
    }
    catch (e) {
        r[name] = { threw: true, msg: String(e.message) }
    }
}
console.log('RESULT ' + JSON.stringify(r))
m.cleanup()
`)
            A.equal(svc.status, 0, svc.err)
            for (let k of ['start', 'restart']) {
                A.equal(svc.out[k].threw, true, `${k}: 覆寫生效時須拋錯`)
                A.ok(/E2E_PORTS_FOR_UNIT_TEST 生效中/.test(svc.out[k].msg), svc.out[k].msg)
            }
        })
    })

    describe('契約 4: 無依埠下殺; 逐檔 runner 只殺本實例並於遇他人占用時中止', function() {
        it('PR-008 test/、test/tools/、spec/evidence/ 之可執行碼(含 e2eLib 轉出)不含依埠／依名稱／依命令列之下殺(killPortListeners、taskkill /IM、Stop-Process、wmic、pkill、killall、非訊號 0 之 process.kill)', function() {
            let hits = []
            //允許: process.kill(pid, 0) 只探測存活; 自己 spawn 之子行程 child.kill() 與 taskkill /PID(以自己 spawn 之 pid) 不在此列(不依埠、名稱、命令列)
            let banned = [/killPortListeners/, /taskkill[^\n]*\/(IM|FI)\b/i, /Stop-Process/i, /\bwmic\b/i, /\bpkill\b/, /\bkillall\b/, /\b(tree-kill|kill-port|fkill)\b/]
            //process.kill(…): 以整份可執行碼(可跨行)解析引數, 第二引數恰為 0(只探測存活)才允許; 單引數(預設 SIGTERM)、非 0 訊號皆違規
            let killCalls = (text) => {
                let bad = []
                for (let m of text.matchAll(/process\.kill\(([^)]*)\)/g)) {
                    let args = m[1].split(',').map((s) => s.trim())
                    if (args.length < 2 || args[1] !== '0') {
                        bad.push(m[0].replace(/\s+/g, ' '))
                    }
                }
                return bad
            }
            for (let fp of [...listMjs(fdTest), ...listMjs(path.join(projRoot, 'spec', 'evidence'))]) {
                if (path.basename(fp) === SELF) {
                    continue
                }
                for (let l of sourceLines(fp)) {
                    if (banned.some((re) => re.test(l.text))) {
                        hits.push(`${path.relative(projRoot, fp)}:${l.no}: ${l.text.trim().slice(0, 80)}`)
                    }
                }
                for (let b of killCalls(codeOf(fp))) {
                    hits.push(`${path.relative(projRoot, fp)}: ${b.slice(0, 80)}`)
                }
            }
            A.deepEqual(hits, [], `不得依埠／名稱／命令列下殺(占用者可能是別的套件之測試), 改用 reservation.killOwnListeners: ${hits.join(' | ')}`)
            //守門本身之鑑別力: 判定函數對合法／違規寫法的結果(避免正規式寫壞而恆綠或恆紅)
            A.deepEqual(killCalls('process.kill(pid, 0); process.kill(pid,0); process.kill( p , 0 )'), [], '只探測存活(訊號 0)不得判違規')
            A.equal(killCalls("process.kill(pid, 'SIGKILL')").length, 1)
            A.equal(killCalls('process.kill(-pid)').length, 1)
            A.equal(killCalls('process.kill(\n  pid,\n  9\n)').length, 1, '跨行亦須判出')
            A.ok(banned.some((re) => re.test('cmd /c taskkill /F /IM node.exe')) && banned.some((re) => re.test('taskkill /FI "IMAGENAME eq node.exe"')) && !banned.some((re) => re.test('taskkill /F /T /PID 123')), 'taskkill 依映像名／篩選條件為違規, 依自己 spawn 之 pid 不是')
        })

        it('PR-009 run-e2e-isolated 以 reservation.killOwnListeners 下殺、遇非本實例占用／查不到監聽者即拋錯中止; e2e-setup 之服務管理器明確帶入 reservation', function() {
            let runner = codeOf(path.join(fdTest, 'tools', 'run-e2e-isolated.mjs'))
            A.ok(/reservation\.killOwnListeners\(/.test(runner), 'runner 須以 reservation.killOwnListeners 下殺')
            A.ok(/skipped/.test(runner) && /throw new Error\(/.test(runner), 'runner 遇下殺略過(非本實例占用)須拋錯中止, 不得讓下一檔沿用他人之服務')
            A.ok(/beforeEachFile:[\s\S]*?killOwnBackend\(true\)/.test(runner), '每檔前之下殺須為 strict(遇他人占用拋錯); 僅收尾(afterAll)可只印出')
            A.ok(/pids === null\) \{\s*const msg = [^\n]*\n\s*if \(strict\) \{\s*throw new Error\(`\$\{msg\}/.test(runner), '查不到監聽者(pids===null)時 strict 亦須中止(null 不得當成無人: 否則下一檔沿用占用者之服務)')
            A.ok(/from '\.\/e2ePorts\.mjs'/.test(runner), 'runner 之基準埠與保留取自 e2ePorts.mjs(單一定義)')
            let setup = codeOf(path.join(fdTest, 'tools', 'e2e-setup.mjs'))
            A.ok(/from '\.\/e2ePorts\.mjs'/.test(setup), 'e2e-setup 之基準埠與保留取自 e2ePorts.mjs')
            A.ok(/createServiceManager\(\{[\s\S]*?\breservation,/.test(setup), 'createServiceManager 須明確帶入 reservation(只殺身分已確認屬本實例者)')
            let ports = codeOf(path.join(fdTest, 'tools', 'e2ePorts.mjs'))
            A.ok(/reserveE2ePorts\(\[BACKEND_PORT, FRONTEND_PORT\], \{ avoid: OTHER_TEST_PORTS \}\)/.test(ports), 'e2ePorts 須一次宣告全部基準埠(後端與前端)並帶 avoid')
        })

        it('PR-010 基準埠 11007／8080 只定義於 e2ePorts.mjs: e2e-setup、runner、e2eLib 之可執行碼不含這兩個字面值; vue.config.js 之 proxy 目標讀 E2E_PORT_OFFSET', function() {
            let hits = []
            for (let f of ['e2e-setup.mjs', 'run-e2e-isolated.mjs', 'e2eLib.mjs']) {
                for (let l of sourceLines(path.join(fdTest, 'tools', f))) {
                    if (/\b(11007|8080)\b/.test(l.text)) {
                        hits.push(`${f}:${l.no}: ${l.text.trim().slice(0, 80)}`)
                    }
                }
            }
            A.deepEqual(hits, [], `基準埠不得在 e2ePorts.mjs 以外寫死: ${hits.join(' | ')}`)
            let vue = fs.readFileSync(path.join(projRoot, 'vue.config.js'), 'utf8')
            A.ok(/11007\s*\+\s*Number\(process\.env\.E2E_PORT_OFFSET/.test(vue), 'vue.config.js 之 dev server proxy 目標須為 11007 + E2E_PORT_OFFSET(位移時前端轉到實際後端埠)')
        })
    })

    describe('契約 4b: 逐檔 runner 之行為(真實行程): 遇他人占用即於第一檔前中止, 不殺占用者', function() {
        it('PR-011 手動鎖基準埠(E2E_PORT_OFFSET=0)且後端基準埠有他人之服務: runner 以非 0 離開、沒有開跑任何 e2e 檔(不沿用他人之服務)、占用者仍在監聽且沒收到請求', async function() {
            //占用者占動態基準埠(不在真實之 11007／8080 起占用者); 子行程以 E2E_PORTS_FOR_UNIT_TEST 取之為基準埠
            let o = await occupy(bases[0])
            let child = null
            try {
                //以 spawn 觀察輸出: runner 應自行中止並離開; 若(迴歸時)它開始執行第一個 e2e 檔(輸出「執行」行), 立即終止整棵行程樹, 不讓 mocha／後端被起動
                child = spawn(process.execPath, [path.join(fdTest, 'tools', 'run-e2e-isolated.mjs')], { cwd: projRoot, env: { ...baseEnv(), E2E_PORT_OFFSET: '0' }, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true })
                let out = ''
                child.stdout.on('data', (d) => {
                    out += d
                })
                child.stderr.on('data', (d) => {
                    out += d
                })
                let code = await new Promise((resolve) => {
                    let t0 = Date.now()
                    let poll = setInterval(() => {
                        if (/\[run-e2e-isolated\] 執行/.test(out) || Date.now() - t0 > 90000) {
                            clearInterval(poll)
                            resolve(null) //未自行離開(已開始執行 e2e 檔或逾時)
                        }
                    }, 100)
                    child.once('exit', (c) => {
                        clearInterval(poll)
                        resolve(c)
                    })
                })
                if (alive(child.pid)) {
                    spawnSync('taskkill', ['/F', '/T', '/PID', String(child.pid)], { stdio: 'ignore', windowsHide: true })
                }
                A.ok(code !== null && code !== 0, `runner 須自行以非 0 離開碼中止(實得 ${code}): ${out.slice(-400)}`)
                A.ok(/為免下一檔沿用別人之服務而中止/.test(out), `須寫明中止原因: ${out.slice(-400)}`)
                A.ok(!/\[run-e2e-isolated\] 執行/.test(out), '第一檔開跑前即須中止(沒有任何 e2e 檔被執行, 沒有沿用他人之服務)')
                A.equal(await isListening(bases[0]), true, '占用者須仍在監聽(runner 不得殺非本實例之監聽者)')
                A.equal(o.hits(), 0, '占用者不得收到任何 HTTP 請求(沒有 mocha 子行程被起動而打到它)')
            }
            finally {
                if (child && alive(child.pid)) {
                    spawnSync('taskkill', ['/F', '/T', '/PID', String(child.pid)], { stdio: 'ignore', windowsHide: true })
                }
                await o.close()
            }
        })
    })

    describe('契約 5: 測試碼無寫死之連線網址; 寫死之監聽埠與 avoid 清單一致; 15 個 e2e 檔皆接 compareBuf', function() {
        //例外(資料不是連線): redir 資料字串 http://127.0.0.1:8080/?view=…&token={token}(各 api- 測試把它寫入使用者資料、再讀回比對; 不連線, 不隨位移改)。新增其他 host:埠 字面值即紅。
        //(以整行判定: 模板字串內可含空白與引號,如 ${u.isAdmin === 'y' ? … }; 只認 redir: 之值且路徑為 /?view=…&token={token})
        let REDIR_DATA = /\bredir:\s*['"`]https?:\/\/(localhost|127\.0\.0\.1):8080\/\?view=[^\n]*&token=\{token\}['"`]/

        it('PR-012 e2e-／api- 測試與 test/tools 之可執行碼不含「localhost／127.0.0.1 ＋ :數字埠」之寫死連線網址(redir 資料字串與刻意不可達之 :1 除外); 網址一律由 baseUrl／apiUrl／resolveE2ePort 衍生', function() {
            let hits = []
            let dataHits = 0
            let cand = [
                ...fs.readdirSync(fdTest).filter((f) => /^(e2e|api)-.*\.test\.mjs$/.test(f)).map((f) => path.join(fdTest, f)),
                ...fs.readdirSync(path.join(fdTest, 'tools')).filter((f) => /\.mjs$/.test(f)).map((f) => path.join(fdTest, 'tools', f)),
            ]
            for (let fp of cand) {
                for (let l of sourceLines(fp)) {
                    let re = /(['"`])?(https?:\/\/)?(localhost|127\.0\.0\.1):\d{2,5}[^\s'"`)]*(['"`])?/g
                    let m
                    while ((m = re.exec(l.text)) !== null) {
                        if (REDIR_DATA.test(l.text)) {
                            dataHits++
                            continue
                        }
                        hits.push(`${path.relative(projRoot, fp)}:${l.no}: ${l.text.trim().slice(0, 100)}`)
                    }
                }
            }
            A.deepEqual(hits, [], `寫死之連線網址(位移後會打到別人的服務): ${hits.join(' | ')}`)
            A.ok(dataHits >= 1, '前提: redir 資料字串之例外規則須有命中(若已全部移除, 請連同此例外一併刪除)')
        })

        it('PR-013 api-／unit- 測試及子行程腳本寫死之監聽埠＝e2ePorts.OTHER_TEST_PORTS(新增寫死埠而忘了列入 avoid 即紅); 且沒有任何測試在真實之 11007／8080 起監聽', function() {
            let found = new Set()
            let where = []
            let listenReal = []
            let cand = [
                ...fs.readdirSync(fdTest).filter((f) => /\.mjs$/.test(f) && f !== SELF).map((f) => path.join(fdTest, f)),
                ...fs.readdirSync(path.join(fdTest, 'tools')).filter((f) => /\.mjs$/.test(f) && f !== 'e2ePorts.mjs').map((f) => path.join(fdTest, 'tools', f)),
            ]
            for (let fp of cand) {
                for (let l of sourceLines(fp)) {
                    let re = /\b(PORT\w*|port|serverPort)\b\s*[:=]\s*(\d{4,5})\b|\blisten\(\s*(\d{4,5})\b/g
                    let m
                    while ((m = re.exec(l.text)) !== null) {
                        let n = Number(m[2] || m[3])
                        if (n === 11007 || n === 8080) {
                            //基準埠本身: 只可作為設定值／斷言用之資料(如 unit-ignoredOrmKeys 之 serverPort: 11007), 不得是監聽
                            if (/\blisten\(/.test(m[0])) {
                                listenReal.push(`${path.basename(fp)}:${l.no}`)
                            }
                            continue
                        }
                        found.add(n)
                        where.push(`${path.basename(fp)}:${l.no}=${n}`)
                    }
                }
            }
            //listen({ port: 8080 }) 物件形式(整份可執行碼可跨行)
            for (let fp of cand) {
                for (let m of codeOf(fp).matchAll(/\blisten\(\s*\{[^}]*\bport\s*:\s*(11007|8080)\b/g)) {
                    listenReal.push(`${path.basename(fp)}: ${m[0].replace(/\s+/g, ' ').slice(0, 60)}`)
                }
            }
            A.deepEqual(listenReal, [], `不得在真實之 11007／8080 起監聽(8080 多套件共用): ${listenReal.join(', ')}`)
            let listed = otherPorts()
            A.deepEqual([...found].sort((a, b) => a - b), listed.sort((a, b) => a - b), `寫死之監聽埠(${where.join(', ')})須與 e2ePorts.OTHER_TEST_PORTS 一致`)
        })

        it('PR-014 15 個 e2e 檔之 runBaselineCase 皆帶 compareBuf: portCompareBuf(畫面含埠之流程由比對端覆蓋, E7), 且自 e2e-setup 匯入 portCompareBuf', function() {
            let files = fs.readdirSync(fdTest).filter((f) => /^e2e-.*\.test\.mjs$/.test(f)).sort()
            A.ok(files.length >= 15, `e2e 檔數 ${files.length}`)
            let bad = []
            for (let f of files) {
                let src = codeOf(path.join(fdTest, f))
                if (!/runBaselineCase\(\{/.test(src)) {
                    continue
                }
                let calls = (src.match(/runBaselineCase\(\{/g) || []).length
                let cmps = (src.match(/compareBuf:\s*portCompareBuf\b/g) || []).length
                let imp = /import \{[^}]*\bportCompareBuf\b[^}]*\} from '\.\/tools\/e2e-setup\.mjs'/.test(src)
                if (calls !== cmps || !imp) {
                    bad.push(`${f}(runBaselineCase ${calls} 處, compareBuf ${cmps} 處, 匯入 ${imp})`)
                }
            }
            A.deepEqual(bad, [], `每個 runBaselineCase 皆須帶 compareBuf: portCompareBuf: ${bad.join(', ')}`)
            //截圖與後處理須經 e2e-setup 之包裝(位移時才會登記／延用含埠區域): e2e 檔不得自 e2eLib 匯入原生版
            let raw = []
            for (let f of files) {
                for (let m of codeOf(path.join(fdTest, f)).matchAll(/import \{([^}]*)\} from '\.\/tools\/e2eLib\.mjs'/g)) {
                    for (let name of m[1].split(',').map((s) => s.trim().split(/\s+as\s+/)[0])) {
                        if (['captureStable', 'captureStableWithBox', 'maskRegions', 'overlayRegions', 'composeBox'].includes(name)) {
                            raw.push(`${f}:${name}`)
                        }
                    }
                }
            }
            A.deepEqual(raw, [], `截圖／後處理須經 e2e-setup 之包裝(否則位移時不登記含埠區域): ${raw.join(', ')}`)
        })

        it('PR-015 api-serverport 於本實例後端埠不是預設 11007(位移)時明確略過並寫明原因(該案斷言產品預設埠本身, 不得為此下殺占用者)', function() {
            let src = fs.readFileSync(path.join(fdTest, 'api-serverport.test.mjs'), 'utf8')
            A.ok(/reservation\.portOf\(BACKEND_PORT\)\s*!==\s*BACKEND_PORT[\s\S]{0,40}this\.skip\(\)/.test(src), 'api-serverport 須在位移時 this.skip()')
            A.ok(/from '\.\/tools\/e2ePorts\.mjs'/.test(src))
        })
    })
})
