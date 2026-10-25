//mutate.mjs — 變異驗證(sso-run01 暫存): 暫時改 server/WWebSso.mjs 一處 → 跑對應測試 → 一律還原並以 sha256 回驗
//用法(於 repo 根): node tmp/sso-run01/mutate.mjs [M1,M2,...]   (未給則全跑); 須在測試鎖內執行(api 變異會重啟後端)
import fs from 'fs'
import path from 'path'
import crypto from 'crypto'
import { spawnSync } from 'child_process'

const file = 'server/WWebSso.mjs'
const bak = path.resolve('./tmp/sso-run01/WWebSso.orig.mjs')
const orig = fs.readFileSync(file, 'utf8')
fs.writeFileSync(bak, orig)
const sha = (s) => crypto.createHash('sha256').update(s).digest('hex')
const origSha = sha(orig)
console.log('[mutate] 原檔 sha256', origSha)

const LINE = "sysFuncsPublic: ['[sys:getFuncList]', '[sys:polling]'],"
const GU = "return '' //不檢核, 查找與變更數據皆由kpFunExt內各函數各自檢核"
const SRV = 'instWServHapiServer = new WServHapiServer(optHapi)'
const rep = (s, a, b) => {
    if (!s.includes(a)) throw new Error(`變異目標不存在: ${a.slice(0, 60)}`)
    return s.replace(a, b)
}
const API = 'test/api-sysfuncs.test.mjs'
const UNIT = 'test/unit-sysfuncs-premise.test.mjs'
const mutations = [
    { id: 'M1', desc: '註解掉 sysFuncsPublic(改回框架預設)', f: (s) => rep(s, LINE, '//' + LINE), test: API },
    { id: 'M2', desc: "只列 ['[sys:getFuncList]']", f: (s) => rep(s, LINE, "sysFuncsPublic: ['[sys:getFuncList]'],"), test: API },
    { id: 'M3', desc: "只列 ['[sys:polling]']", f: (s) => rep(s, LINE, "sysFuncsPublic: ['[sys:polling]'],"), test: API },
    { id: 'M4', desc: '明列三者', f: (s) => rep(s, LINE, "sysFuncsPublic: ['[sys:getFuncList]', '[sys:polling]', '[sys:getTableTags]'],"), test: API },
    { id: 'M5', desc: '空陣列 []', f: (s) => rep(s, LINE, 'sysFuncsPublic: [],'), test: API },
    { id: 'M6', desc: 'null(框架退回全公開)', f: (s) => rep(s, LINE, 'sysFuncsPublic: null,'), test: API },
    { id: 'U1', desc: '加入 broadcast 呼叫(前提被破壞)', f: (s) => rep(s, SRV, SRV + "\n    instWServHapiServer.broadcast({ mode: 'x', data: 1 })"), test: UNIT },
    { id: 'U2', desc: "tableNamesSync: ['users'](新增同步表)", f: (s) => rep(s, 'tableNamesSync: [],', "tableNamesSync: ['users'],"), test: UNIT },
    { id: 'U3', desc: "getUserIdByToken 回非空('u')", f: (s) => rep(s, GU, "return 'u'"), test: UNIT },
    { id: 'U4', desc: 'getUserIdByToken 拋錯', f: (s) => rep(s, GU, "throw new Error('x')"), test: UNIT },
    { id: 'U5', desc: '明列三者(靜態)', f: (s) => rep(s, LINE, "sysFuncsPublic: ['[sys:getFuncList]', '[sys:polling]', '[sys:getTableTags]'],"), test: UNIT },
]
let pick = (process.argv[2] || '').split(',').map((x) => x.trim()).filter(Boolean)
let todo = pick.length > 0 ? mutations.filter((m) => pick.includes(m.id)) : mutations

let results = []
try {
    for (let m of todo) {
        let mut
        try {
            mut = m.f(orig)
        }
        catch (err) {
            results.push({ id: m.id, desc: m.desc, error: err.message })
            continue
        }
        fs.writeFileSync(file, mut)
        console.log(`\n[mutate] === ${m.id}: ${m.desc} → ${m.test}`)
        let r = spawnSync(process.execPath, ['node_modules/mocha/bin/mocha.js', m.test, '--no-parallel', '--reporter', 'spec', '--timeout', '180000'], { cwd: process.cwd(), encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, windowsHide: true })
        fs.writeFileSync(file, orig) //立即還原
        let out = (r.stdout || '') + (r.stderr || '')
        let pass = (out.match(/(\d+) passing/) || [])[1] || '0'
        let fail = (out.match(/(\d+) failing/) || [])[1] || '0'
        let failedIds = [...out.matchAll(/^\s+\d+\) .*$\n\s+((?:SF|SP)-\d+[a-z]?)/gm)].map((x) => x[1])
        //另以 ✔ 之外的編號列(spec reporter 失敗列為 "N) 標題")
        let titles = [...out.matchAll(/^\s+\d+\) ((?:SF|SP)-\d+)/gm)].map((x) => x[1])
        let ids = [...new Set([...failedIds, ...titles])]
        results.push({ id: m.id, desc: m.desc, test: m.test, passing: +pass, failing: +fail, failed: ids, exit: r.status })
        console.log(`[mutate] ${m.id}: passing=${pass} failing=${fail} failed=${ids.join(',') || '(未解析)'} exit=${r.status}`)
        let logf = path.resolve(`./tmp/sso-run01/mutate-${m.id}.log`)
        fs.writeFileSync(logf, out)
    }
}
finally {
    fs.writeFileSync(file, orig)
    let now = sha(fs.readFileSync(file, 'utf8'))
    console.log(`\n[mutate] 還原後 sha256 ${now === origSha ? '相符' : '**不符**'} (${now})`)
    fs.writeFileSync(path.resolve('./tmp/sso-run01/mutations.json'), JSON.stringify(results, null, 2))
    console.log('[mutate] 摘要')
    for (let r of results) console.log(`  ${r.id}\t${r.desc}\t${r.error ? 'ERROR ' + r.error : `passing=${r.passing} failing=${r.failing} failed=[${r.failed.join(',')}]`}`)
}
