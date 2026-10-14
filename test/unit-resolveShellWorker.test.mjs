//unit-resolveShellWorker：staLogs worker 檔之解析與「打包後可用」之站點不變式（CLAUDE_rulebook.md R-PKG-01；X1；ADR-086；與 w-web-api / w-web-perm 同一組案例，另加 RSW-008）。
//受測：server/staLogs/resolveShellWorker.mjs 之 resolveShellWorker、server/staLogs/staLogsCore.callWorker.mjs 之 getShellWorkerPath／runWorker。
//RSW-0xx：假套件佈局於 test/_tmp/unit-resolveShellWorker/（真檔案系統、真 createRequire），涵蓋 (a) 名稱相符（源碼與 dist 位置）、(a) 名稱不符、
//         (a) 名稱相符但無 worker 檔、(b) 模組解析（被下游打包）、(c) 僅 cwd 可解析、(d) 皆失敗之訊息；另以注入之 existsSync 驗「上方無 package.json」，
//         以注入之 createRequire 驗「模組解析回傳之路徑不存在即不採用」（真 Node 解析於檔案不存在時即拋 MODULE_NOT_FOUND，此防護只在替換解析器時可達）。
//RSW-REAL-*：本 repo 之源碼與 dist 位置解析到本 repo 之 worker 檔；getShellWorkerPath 與之相同；runWorker 未給 fpWk 時以之跑真 worker。
//SITE-X1-*：會被打包之範圍（server/ 全部＋入口 server/WWebSso.mjs 之相對 import 閉包內之 src/ 檔）可執行碼不於頂層宣告 __filename／__dirname、
//           不用 import.meta.dirname／filename／resolve；callWorker 之 import.meta.url 只在函數內；runWorker 解析失敗時 reject 而不拋。
//           本套件之打包範圍除 server/ 外另含 src/appPerms.mjs、src/maskUrl.mjs、src/plugins/mShare.mjs、src/schema/（由閉包求得，不寫死）。
//「由 src 建出 dist → 載入 → 實際觸發一次統計」之測試依賴 w-syslog 1.0.33，待主控續接時補（X1 指示 §3）。
//跑法：npx mocha test/unit-resolveShellWorker.test.mjs --timeout 30000（不開埠）
import fs from 'fs'
import path from 'path'
import assert from 'assert'
import { fileURLToPath } from 'url'
import resolveShellWorker from '../server/staLogs/resolveShellWorker.mjs'
import { getShellWorkerPath, runWorker } from '../server/staLogs/staLogsCore.callWorker.mjs'


let projRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
let fdTmp = path.join(projRoot, 'test', '_tmp', 'unit-resolveShellWorker')
let REL = path.join('server', 'staLogs', 'staLogsCore.shellWorker.mjs')
let PKG = 'w-web-sso'

//mkPkg：於 dir 建 package.json（name），withWorker 時另建 worker 檔；回傳 dir
function mkPkg(dir, name, withWorker) {
    fs.mkdirSync(dir, { recursive: true })
    fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ name, version: '0.0.0' }), 'utf8')
    if (withWorker) {
        fs.mkdirSync(path.join(dir, 'server', 'staLogs'), { recursive: true })
        fs.writeFileSync(path.join(dir, REL), '//fake worker\n', 'utf8')
    }
    return dir
}

let settle = (fn) => {
    try {
        return { ok: true, v: fn() }
    }
    catch (err) {
        return { ok: false, v: String(err && err.message ? err.message : err) }
    }
}

//blankStrings：字串字面值換成空字串，避免字串內之文字被當成程式碼
let blankStrings = (s) => s.replace(/'(?:\\.|[^'\\])*'|"(?:\\.|[^"\\])*"|`(?:\\.|[^`\\])*`/g, '""')

//codeLines：讀檔回傳 [{ no, text }]，區塊註解與行註解（字串外）換成空白，保留行號與縮排
function codeLines(fp) {
    let src = fs.readFileSync(fp, 'utf8')
    src = src.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
    return src.split(/\r?\n/).map((line, i) => {
        let t = blankStrings(line)
        let k = t.indexOf('//')
        return { no: i + 1, text: k >= 0 ? line.slice(0, k) : line }
    })
}

//walk：列出 dir 下全部 .mjs／.js
function walk(dir, out = []) {
    for (let fn of fs.readdirSync(dir)) {
        let fp = path.join(dir, fn)
        if (fs.statSync(fp).isDirectory()) {
            walk(fp, out)
        }
        else if (/\.(mjs|js)$/.test(fn)) {
            out.push(fp)
        }
    }
    return out
}

//importClosure：由入口檔遞迴追相對 import（含動態 import 之字面路徑），回傳閉包內全部檔案之絕對路徑
function importClosure(fpEntry) {
    let seen = new Set()
    let stack = [fpEntry]
    while (stack.length > 0) {
        let fp = stack.pop()
        if (seen.has(fp)) {
            continue
        }
        seen.add(fp)
        let src = fs.readFileSync(fp, 'utf8')
        for (let m of src.matchAll(/(?:from|import)\s*\(?\s*['"](\.{1,2}\/[^'"]+)['"]/g)) {
            stack.push(path.resolve(path.dirname(fp), m[1]))
        }
    }
    return [...seen]
}


describe('unit-resolveShellWorker（staLogs worker 檔之解析，打包後可用：R-PKG-01／X1）', function() {
    this.timeout(30000)

    let dirEmptyCwd = ''

    before(function() {
        fs.rmSync(fdTmp, { recursive: true, force: true })
        fs.mkdirSync(fdTmp, { recursive: true })
        dirEmptyCwd = mkPkg(path.join(fdTmp, 'emptyCwd'), 'empty-cwd', false) //(c) 之基準：無 node_modules
    })

    after(function() {
        fs.rmSync(fdTmp, { recursive: true, force: true })
        let fdParent = path.join(projRoot, 'test', '_tmp')
        if (fs.existsSync(fdParent) && fs.readdirSync(fdParent).length === 0) {
            fs.rmSync(fdParent, { recursive: true, force: true })
        }
    })

    it('RSW-001 (a) 最近之 package.json 名稱相符：源碼位置與 dist 位置皆解析到套件根下之 worker 檔', function() {
        let root = mkPkg(path.join(fdTmp, 'a1', PKG), PKG, true)
        let want = path.join(root, REL)
        let fromSrc = resolveShellWorker({ fpSelf: path.join(root, 'server', 'staLogs', 'staLogsCore.callWorker.mjs'), cwd: dirEmptyCwd })
        let fromDist = resolveShellWorker({ fpSelf: path.join(root, 'dist', `${PKG}.umd.js`), cwd: dirEmptyCwd })
        assert.strictEqual(fromSrc, want)
        assert.strictEqual(fromDist, want)
    })

    it('RSW-002 (a) 最近之 package.json 名稱不符（旁有同名 worker 檔亦不採用）、(b)(c) 皆解析不到 → 拋錯，訊息含名稱與三段已試位置', function() {
        let other = mkPkg(path.join(fdTmp, 'a2', 'other-app'), 'other-app', true)
        let r = settle(() => resolveShellWorker({ fpSelf: path.join(other, 'dist', 'x.js'), cwd: dirEmptyCwd }))
        assert.strictEqual(r.ok, false, `不得採用他套件旁之同名檔，實得 ${r.v}`)
        assert.ok(r.v.includes(PKG) && r.v.includes('name[other-app]') && r.v.includes('(b)') && r.v.includes('(c)'), r.v)
    })

    it('RSW-003 (a) 名稱相符但無 worker 檔 → 續試 (b)(c)，皆失敗時拋錯且訊息含該缺檔位置', function() {
        let root = mkPkg(path.join(fdTmp, 'a3', PKG), PKG, false)
        let r = settle(() => resolveShellWorker({ fpSelf: path.join(root, 'dist', `${PKG}.umd.js`), cwd: dirEmptyCwd }))
        assert.strictEqual(r.ok, false)
        assert.ok(r.v.includes(path.join(root, REL)), r.v)
    })

    it('RSW-004 (b) 被下游打包：bundle 位於下游專案，由其 node_modules 解析到已安裝套件之 worker 檔', function() {
        let app = mkPkg(path.join(fdTmp, 'b1', 'app'), 'app', false)
        let inst = mkPkg(path.join(app, 'node_modules', PKG), PKG, true)
        let got = resolveShellWorker({ fpSelf: path.join(app, 'dist', 'app.js'), cwd: dirEmptyCwd })
        assert.strictEqual(fs.realpathSync(got), fs.realpathSync(path.join(inst, REL)))
    })

    it('RSW-005 (c) bundle 被搬離套件與 node_modules 樹，只能由 cwd 解析', function() {
        let moved = mkPkg(path.join(fdTmp, 'c1', 'moved'), 'moved-bundle', false)
        let proj = mkPkg(path.join(fdTmp, 'c1', 'proj'), 'proj', false)
        let inst = mkPkg(path.join(proj, 'node_modules', PKG), PKG, true)
        let got = resolveShellWorker({ fpSelf: path.join(moved, 'bundle.js'), cwd: proj })
        assert.strictEqual(fs.realpathSync(got), fs.realpathSync(path.join(inst, REL)))
    })

    it('RSW-006 (d) 上方無 package.json 且模組解析皆失敗（注入）→ 拋錯，訊息含 no package.json 與 (b)(c)', function() {
        let r = settle(() => resolveShellWorker({
            fpSelf: path.join(fdTmp, 'd1', 'x.js'),
            cwd: dirEmptyCwd,
            existsSync: () => false,
            createRequire: () => ({
                resolve: () => {
                    throw new Error('MODULE_NOT_FOUND')
                },
            }),
        }))
        assert.strictEqual(r.ok, false)
        assert.ok(r.v.includes('no package.json') && r.v.includes('(b)') && r.v.includes('(c)'), r.v)
        assert.ok(r.v.startsWith('cannot resolve'), r.v)
    })

    it('RSW-007 fpSelf 無效 → 拋 invalid fpSelf', function() {
        assert.throws(() => resolveShellWorker({}), /invalid fpSelf/)
    })

    it('RSW-008 (b)(c) 模組解析回傳之路徑不存在（注入之 createRequire）→ 不採用，皆失敗時拋錯，訊息含 (b)(c) 所得之路徑', function() {
        let app = mkPkg(path.join(fdTmp, 'g1', 'app'), 'app', false)
        let ghost = path.join(fdTmp, 'g1', 'ghost', PKG, REL)
        let r = settle(() => resolveShellWorker({
            fpSelf: path.join(app, 'dist', 'app.js'),
            cwd: dirEmptyCwd,
            createRequire: () => ({
                resolve: () => ghost,
            }),
        }))
        assert.strictEqual(r.ok, false, `不得採用不存在之路徑，實得 ${r.v}`)
        assert.ok(r.v.includes(`(b) ${ghost}`) && r.v.includes(`(c) ${ghost}`), r.v)
    })

    it('RSW-REAL-001 本 repo：源碼位置與 dist 位置皆解析到 server/staLogs/staLogsCore.shellWorker.mjs；getShellWorkerPath 同（第二次取快取）', function() {
        let want = path.join(projRoot, REL)
        assert.strictEqual(resolveShellWorker({ fpSelf: path.join(projRoot, 'server', 'staLogs', 'staLogsCore.callWorker.mjs') }), want)
        assert.strictEqual(resolveShellWorker({ fpSelf: path.join(projRoot, 'dist', `${PKG}.umd.js`) }), want)
        assert.strictEqual(getShellWorkerPath(), want)
        assert.strictEqual(getShellWorkerPath(), want, '第二次取快取')
    })

    it('RSW-REAL-002 runWorker 未給 fpWk 時以解析之 worker 執行（空清單之掃描回空陣列）', async function() {
        let r = await runWorker({ files: [], tStartMs: 0, fmt: 'YYYY-MM-DDTHH' })
        assert.deepStrictEqual(r, [])
    })

    //R-PKG-01 之站點：會被打包之範圍（server/ 全部＋入口之相對 import 閉包）之可執行碼
    it('SITE-X1-001 打包範圍之可執行碼不於頂層宣告 __filename／__dirname，不用 import.meta.dirname／filename／resolve', function() {
        let closure = importClosure(path.join(projRoot, 'server', 'WWebSso.mjs'))
        let files = [...new Set([...walk(path.join(projRoot, 'server')), ...closure])]
        let fromSrc = closure.filter((fp) => !fp.startsWith(path.join(projRoot, 'server') + path.sep))
        let bad = []
        for (let fp of files) {
            for (let l of codeLines(fp)) {
                let t = blankStrings(l.text)
                if (/^(let|const|var)\s+__(filename|dirname)\b/.test(t.trim()) || /import\.meta\.(dirname|filename|resolve)\b/.test(t)) {
                    bad.push(`${path.relative(projRoot, fp)}:${l.no} ${l.text.trim()}`)
                }
            }
        }
        assert.ok(files.length > 20, `應掃到 server 與打包閉包之檔案（實得 ${files.length}）`)
        assert.ok(fromSrc.length >= 4, `打包閉包應含 src/ 之檔案（實得 ${fromSrc.map((fp) => path.relative(projRoot, fp)).join(', ')}）`)
        assert.deepStrictEqual(bad, [], bad.join('\n'))
    })

    it('SITE-X1-002 callWorker：import.meta.url 只在函數內；頂層不以模組位置組路徑；runWorker 解析失敗時 reject', function() {
        let fp = path.join(projRoot, 'server', 'staLogs', 'staLogsCore.callWorker.mjs')
        let ls = codeLines(fp)
        let metas = ls.filter((l) => /import\.meta/.test(blankStrings(l.text)))
        assert.ok(metas.length >= 1, '應以 import.meta.url 取本模組位置')
        assert.deepStrictEqual(metas.filter((l) => !/^\s+/.test(l.text)).map((l) => l.no), [], 'import.meta 不得出現在頂層（無縮排）之行')
        let top = ls.filter((l) => /^(let|const|var)\s/.test(l.text) && /path\.(resolve|join|dirname)\(|fileURLToPath\(/.test(blankStrings(l.text)))
        assert.deepStrictEqual(top.map((l) => `:${l.no} ${l.text.trim()}`), [], '頂層不得以模組位置組路徑')
        let code = ls.map((l) => l.text).join('\n')
        assert.ok(/try \{\s*fpWk = getShellWorkerPath\(\)\s*\}\s*catch \(err\) \{\s*pm\.reject\(err\)/.test(code), 'runWorker 須於解析失敗時 reject')
    })

})
