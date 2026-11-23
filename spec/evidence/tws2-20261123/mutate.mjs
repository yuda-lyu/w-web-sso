//mutate: 第 603 項(sso)之變異驗證——逐項植入單點缺陷, 跑對應測試, 須轉紅(失敗數 > 0)才算擊殺; 每項還原後以 sha256 回驗
//  錨點(from)須恰出現指定次數(預設 1), 否則該項回報「錨點不符」並中止(不靜默略過); 先跑未變異之對照組須全綠
//  測試一律經 quiet-run --lock; 項目分 unit(三檔, 約 3 秒)與 e2e(e2e-consoleNoValues, 每項約 45 秒; --e2e 才跑)
//用法: QUIET_RUN=<測試執行器腳本路徑> node <本檔> [--e2e] [--only <名稱前綴>]
//  (本檔隨證據存於 spec/evidence/tws2-20261123/; 執行時須置於 ./tmp/tws2/ 之下, root 以本檔上兩層計, 修前碼鏡像根為 ./tmp/tws2/pre/; 測試執行器為經鎖定並寫摘要日誌之外部工具, 路徑以環境變數 QUIET_RUN 給)
import fs from 'fs'
import path from 'path'
import crypto from 'crypto'
import { spawnSync } from 'child_process'
import { fileURLToPath } from 'url'

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const pre = path.join(root, 'tmp', 'tws2', 'pre')
const outJson = path.join(root, 'tmp', 'tws2', 'evidence', 'mutation-results.json')
const withE2e = process.argv.includes('--e2e')
const onlyIdx = process.argv.indexOf('--only')
const only = onlyIdx >= 0 ? process.argv[onlyIdx + 1] : ''

const UNIT = ['test/unit-consoleNoValuesFront.test.mjs', 'test/unit-consoleNoLeak.test.mjs', 'test/unit-queryKey.test.mjs']
const E2E = ['test/e2e-consoleNoValues.test.mjs']

let sha = (buf) => crypto.createHash('sha256').update(buf).digest('hex')
let abs = (f) => path.join(root, f)

//edit: { file, from, to, n? } 取代; { file, create } 新建檔; { file, overlayFrom } 以鏡像(HEAD 版)覆蓋
let M = [
    //----- 前端 console 摘要(unit: CNVF-*) -----
    { id: 'F1', what: 'PageLogin 登入失敗站點改印錯誤本體(err)', tests: UNIT, kill: 'CNVF-001', edits: [{ file: 'src/components/PageLogin.vue', from: `console.log('login err', getDiagBriefErr(err), `, to: `console.log('login err', err, ` }] },
    { id: 'F2', what: 'App.vue autoLogin 站點改印 view 值', tests: UNIT, kill: 'CNVF-001', edits: [{ file: 'src/App.vue', from: 'goto view[${getDiagShape(view)}] page', to: 'goto view[${view}] page' }] },
    { id: 'F3', what: 'main.js getWebInfor catch 改用 getDiagShape(allowed 但錯誤函數)', tests: UNIT, kill: 'CNVF-006', edits: [{ file: 'src/main.js', from: 'console.log(getDiagBriefErr(err))', to: 'console.log(getDiagShape(err))' }] },
    { id: 'F4', what: 'Layout.vue 缺 getDiagBriefErr 匯入', tests: UNIT, kill: 'CNVF-003', edits: [{ file: 'src/components/Layout.vue', from: `import getDiagBriefErr from 'wsemi/src/getDiagBriefErr.mjs'\n`, to: '' }] },
    { id: 'F5', what: 'PageUser logout 站點把錯誤摘要物件內插於樣板字串', tests: UNIT, kill: 'CNVF-006', edits: [{ file: 'src/components/PageUser.vue', from: `console.log('logout err', getDiagBriefErr(err))`, to: 'console.log(`logout err[${getDiagBriefErr(err)}]`)' }] },
    { id: 'F6', what: '復活本地模組 src/describeShape.mjs', tests: UNIT, kill: 'CNVF-003', edits: [{ file: 'src/describeShape.mjs', create: 'export function describeShape(v) { return String(v) }\nexport default describeShape\n' }] },
    { id: 'F7', what: '新增未盤點之前端站點(印使用者物件)', tests: UNIT, kill: 'CNVF-001/002', edits: [{ file: 'src/components/PageUser.vue', from: `console.log('error[res]', getDiagShape(res))`, to: `console.log('error[res]', getDiagShape(res))\n                            console.log('user', res)` }] },
    { id: 'F8', what: 'LayoutContentUsers 一站改回舊名 describeShape(未匯入)', tests: UNIT, kill: 'CNVF-001/003', edits: [{ file: 'src/components/LayoutContentUsers.vue', from: 'console.log(`size(vo.itemsCheck) !== 1`, getDiagShape(vo.itemsCheck))', to: 'console.log(`size(vo.itemsCheck) !== 1`, describeShape(vo.itemsCheck))' }] },
    { id: 'F9', what: 'App.vue getDiagShape 匯入指向錯誤之 wsemi 模組', tests: UNIT, kill: 'CNVF-003', edits: [{ file: 'src/App.vue', from: `import getDiagShape from 'wsemi/src/getDiagShape.mjs'`, to: `import getDiagShape from 'wsemi/src/getDiagBriefErr.mjs'` }] },
    { id: 'F10', what: 'mUI 兩個 getDiagShape 站點之一改印值(圖示名 icon)', tests: UNIT, kill: 'CNVF-001', edits: [{ file: 'src/plugins/mUI.mjs', from: 'console.log(`invalid icon[${getDiagShape(icon)}]`)', to: 'console.log(`invalid icon[${icon}]`)' }] },
    //----- 伺服端 console 摘要(unit: SITE-CNL / CNL-C / CNL-H) -----
    { id: 'S1', what: 'procCore valueUser 站點改印原值', tests: UNIT, kill: 'SITE-CNL-001 / CNL-C01', edits: [{ file: 'server/procCore.mjs', from: `console.log('valueUser', getDiagShape(valueUser))`, to: `console.log('valueUser', valueUser)` }] },
    { id: 'S2', what: 'procCore 復活本地 logType(自寫形狀摘要)並使用', tests: UNIT, kill: 'CNL-H02 / SITE-CNL-001', edits: [{ file: 'server/procCore.mjs', from: `console.log('valueUser', getDiagShape(valueUser))`, to: "const logType = (v) => `(typeof ${typeof v})`\n            console.log('valueUser', logType(valueUser))" }] },
    { id: 'S3', what: 'srLog logKey 名單外改回傳原值', tests: UNIT, kill: 'CNL-H01 / CNL-C01', edits: [{ file: 'server/srLog.mjs', from: 'return getDiagShape(key)', to: 'return key' }] },
    { id: 'S4', what: 'srLog logKey 名單判定改恆真', tests: UNIT, kill: 'CNL-H01', edits: [{ file: 'server/srLog.mjs', from: 'isarr(allowed) && allowed.includes(key)', to: 'isarr(allowed) && true' }] },
    { id: 'S5', what: 'WWebSso invalid db 站點改印原值', tests: UNIT, kill: 'SITE-CNL-001 / CNL-H03', edits: [{ file: 'server/WWebSso.mjs', from: `console.log('invalid db', getDiagShape(db))`, to: `console.log('invalid db', db)` }] },
    { id: 'S6', what: 'srLog 重新匯出 logType', tests: UNIT, kill: 'CNL-H02', edits: [{ file: 'server/srLog.mjs', from: '//maskUrl: 網址只留', to: 'export function logType(v) { return `(typeof ${typeof v})` }\n//maskUrl: 網址只留' }] },
    { id: 'S7', what: 'procCore 缺 getDiagShape 匯入', tests: UNIT, kill: 'CNL-H02', edits: [{ file: 'server/procCore.mjs', from: `import getDiagShape from 'wsemi/src/getDiagShape.mjs'\r\n`, to: '' }] },
    { id: 'S8', what: 'procCore 語系字典站點改印字典本體', tests: UNIT, kill: 'CNL-C09 / SITE-CNL-001', edits: [{ file: 'server/procCore.mjs', from: `getDiagShape(get(kpLang, lang))`, to: `get(kpLang, lang)` }] },
    { id: 'S9', what: 'procCore 一個 timeEnd 站點改印 String(值)', tests: UNIT, kill: 'SITE-CNL-001 / CNL-H03', edits: [{ file: 'server/procCore.mjs', from: "console.log(`timeEnd`, getDiagShape(timeEnd)) //權杖列之值, 只給型別", to: "console.log(`timeEnd`, String(timeEnd)) //權杖列之值, 只給型別" }] },
    { id: 'S10', what: 'srLog logKey 名單外改 getDiagShape 之取代: 回 typeof 字串(未走 wsemi, 輸出契約改變)', tests: UNIT, kill: 'CNL-H01', edits: [{ file: 'server/srLog.mjs', from: 'return getDiagShape(key)', to: 'return `(typeof ${typeof key})`' }] },
    //----- e2e(真瀏覽器; e2e-consoleNoValues) -----
    { id: 'E1', what: 'PageLogin 登入失敗站點改印錯誤本體', tests: E2E, e2e: true, kill: 'E2E-CN-001', edits: [{ file: 'src/components/PageLogin.vue', from: `console.log('login err', getDiagBriefErr(err), `, to: `console.log('login err', err, ` }] },
    { id: 'E2', what: 'App.vue autoLogin 站點改印 view 值', tests: E2E, e2e: true, kill: 'E2E-CN-001', edits: [{ file: 'src/App.vue', from: 'goto view[${getDiagShape(view)}] page', to: 'goto view[${view}] page' }] },
    { id: 'E3', what: 'main.js getWebInfor catch 改印錯誤本體', tests: E2E, e2e: true, kill: 'E2E-CN-002', edits: [{ file: 'src/main.js', from: 'console.log(getDiagBriefErr(err))', to: 'console.log(err)' }] },
    { id: 'PRE', what: '修前碼(HEAD 版 App.vue／PageLogin.vue／main.js 與本地模組 describeShape.mjs 覆蓋回去; 新測試不變)', tests: E2E, e2e: true, kill: 'E2E-CN-001 與 E2E-CN-002', edits: [
        { file: 'src/App.vue', overlayFrom: 'src/App.vue' }, { file: 'src/components/PageLogin.vue', overlayFrom: 'src/components/PageLogin.vue' }, { file: 'src/main.js', overlayFrom: 'src/main.js' }, { file: 'src/describeShape.mjs', overlayFrom: 'src/describeShape.mjs' },
    ] },
]

let runTests = (name, tests) => {
    let r = spawnSync(process.execPath, [process.env.QUIET_RUN, '--lock', '--name', name, '--cwd', root, '--timeout', '900', '--', process.execPath, path.join(root, 'node_modules', 'mocha', 'bin', 'mocha.js'), '--no-parallel', ...tests, '--reporter', 'dot', '--timeout', '300000'], { cwd: root, encoding: 'utf8', windowsHide: true })
    let out = `${r.stdout || ''}\n${r.stderr || ''}`
    let m = out.match(/log=([^\s]+\.log)/)
    let logText = m && fs.existsSync(m[1]) ? fs.readFileSync(m[1], 'utf8') : out
    let pass = Number((logText.match(/(\d+) passing/) || [0, 0])[1])
    let fail = Number((logText.match(/(\d+) failing/) || [0, 0])[1])
    return { code: r.status, pass, fail, log: m ? m[1] : '' }
}

//續跑(--only)時沿用既有結果檔, 同 id 者以新結果取代
let results = fs.existsSync(outJson) ? JSON.parse(fs.readFileSync(outJson, 'utf8')) : []
let record = (o) => {
    results = results.filter((x) => x.id !== o.id)
    results.push(o)
    fs.mkdirSync(path.dirname(outJson), { recursive: true })
    fs.writeFileSync(outJson, JSON.stringify(results, null, 2), 'utf8')
    console.log(JSON.stringify(o))
}

//對照組(未變異)
for (let [name, tests] of [['unit', UNIT], ...(withE2e ? [['e2e', E2E]] : [])]) {
    if (only && !'CONTROL'.startsWith(only.toUpperCase())) {
        continue
    }
    let r = runTests(`tws2-mut-ctl-${name}`, tests)
    record({ id: `CONTROL-${name}`, what: '未變異對照組', pass: r.pass, fail: r.fail, code: r.code, verdict: r.fail === 0 && r.pass > 0 && r.code === 0 ? 'GREEN(預期)' : 'UNEXPECTED' })
    if (!(r.fail === 0 && r.pass > 0 && r.code === 0)) {
        console.log('對照組非全綠, 中止')
        process.exit(1)
    }
}

for (let m of M) {
    if (m.e2e && !withE2e) {
        continue
    }
    if (only && !m.id.startsWith(only)) {
        continue
    }
    //備份與套用
    let backups = []
    let ok = true
    try {
        for (let e of m.edits) {
            let fp = abs(e.file)
            let existed = fs.existsSync(fp)
            let orig = existed ? fs.readFileSync(fp) : null
            backups.push({ fp, existed, orig, sha: orig ? sha(orig) : null })
            if (e.create !== undefined) {
                if (existed) {
                    throw new Error(`${e.file} 已存在, 無法 create`)
                }
                fs.writeFileSync(fp, e.create, 'utf8')
            }
            else if (e.overlayFrom !== undefined) {
                fs.writeFileSync(fp, fs.readFileSync(path.join(pre, e.overlayFrom)))
            }
            else {
                let t = orig.toString('utf8')
                let n = e.n || 1
                let cnt = t.split(e.from).length - 1
                if (cnt !== n) {
                    throw new Error(`錨點出現 ${cnt} 次(預期 ${n}): ${e.file}: ${e.from.slice(0, 60)}`)
                }
                fs.writeFileSync(fp, t.split(e.from).join(e.to), 'utf8')
            }
        }
        let r = runTests(`tws2-mut-${m.id}`, m.tests)
        let killed = r.fail > 0
        let undecided = r.fail === 0 && r.pass === 0
        record({ id: m.id, what: m.what, expectKilledBy: m.kill, pass: r.pass, fail: r.fail, code: r.code, verdict: undecided ? '未判定' : (killed ? '擊殺' : '存活') })
    }
    catch (err) {
        ok = false
        record({ id: m.id, what: m.what, verdict: `錨點或套用失敗: ${err.message}` })
    }
    finally {
        //還原並以 sha256 回驗
        for (let b of backups.reverse()) {
            if (b.existed) {
                fs.writeFileSync(b.fp, b.orig)
                if (sha(fs.readFileSync(b.fp)) !== b.sha) {
                    console.log(`還原回驗失敗: ${b.fp}`)
                    process.exit(2)
                }
            }
            else if (fs.existsSync(b.fp)) {
                fs.rmSync(b.fp)
                if (fs.existsSync(b.fp)) {
                    console.log(`還原回驗失敗(未刪除): ${b.fp}`)
                    process.exit(2)
                }
            }
        }
    }
    if (!ok) {
        process.exit(3)
    }
}
let alive = results.filter((x) => x.verdict === '存活' || x.verdict === '未判定' || String(x.verdict).startsWith('錨點'))
console.log(`DONE total=${results.length} killed=${results.filter((x) => x.verdict === '擊殺').length} alive/undecided/anchorFail=${alive.length}`)
