//前端瀏覽器 console 不印資料值(排程第 206 項; 規則帳本 R-LOG-02; 規格 dspec〈診斷輸出與遮罩〉D2「預設不輸出資料值」、〈輸入參數之檢測機制〉V20)
//  承 2026-10-31 sso 輪(伺服端 console 不印資料值, R-LOG-01, ADR-101; 當時派工限定伺服端、不改畫面, 瀏覽器端列為範圍外待裁示), 本輪補前端:
//  src/ 下可執行之 console 呼叫(.vue 之 <script>、.js、.mjs)只印固定字面值、typeof、或不含值之摘要函數(describeShape／describeErr), 不印選取列、使用者物件、回應內容、錯誤本體、網址參數.
//CNVF-001 站點不變式: src/ 下每個可執行 console 呼叫之每個引數皆不印值(引用方後端執行之 fetchSsoMsg 另依 SITE-CNL-004, 見 CNVF-005)
//CNVF-002 範圍: 掃描範圍含前端進入檔、全部 .vue 元件與 src 下 .mjs; 站點全集已盤點(CNVF-002 釘住各檔之站點數, 新增站點須先判定)
//CNVF-002b/c 掃描器盲點(別名、解構、括號存取、傳遞、其他方法、區塊註解後接呼叫)與自測
//CNVF-003 單一實作: 前端用之摘要函數唯一定義於 src/describeShape.mjs(暫行單一模組, 日後收斂為 wsemi 共用函數, 排程第 603 項); 用到者皆自該模組匯入; 其依賴閉包不含 Node 內建模組(瀏覽器可載入)
//CNVF-004 行為: 摘要不含值(以識別值植入選取列、授權字串、錯誤訊息逐一驗)
//CNVF-005 範圍外之 src 站點(引用方後端執行之 fetchSsoMsg)為 SITE-CNL-004 所涵蓋, 此處只確認其為唯一之例外
//跑法: npx mocha test/unit-consoleNoValuesFront.test.mjs --timeout 60000
import assert from 'assert'
import fs from 'fs'
import path from 'path'
import { builtinModules } from 'module'
import { fileURLToPath } from 'url'
import { scanConsoleValueArgs, importClosure, sourceLines, blankStrings } from './tools/srcScan.mjs'
import { describeShape, describeErr, safeCtl } from '../src/describeShape.mjs'

const A = assert.strict
const projRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
const rel = (fp) => path.relative(projRoot, fp).replace(/\\/g, '/')

//src/ 與 server/ 下全部可執行檔(.vue、.js、.mjs)
function walk(dir) {
    let out = []
    let w = (d) => {
        for (let n of fs.readdirSync(d, { withFileTypes: true })) {
            let fp = path.join(d, n.name)
            if (n.isDirectory()) {
                w(fp)
            }
            else if (/\.(vue|js|mjs)$/.test(n.name)) {
                out.push(fp)
            }
        }
    }
    w(path.join(projRoot, dir))
    return out.sort()
}

//引用方後端執行之 src 模組: 其 console 站點由 unit-consoleNoLeak 之 SITE-CNL-004 涵蓋(明細不含 url、鍵集合固定), 不在前端掃描範圍
const EXCEPT = ['src/fetchSsoMsg.mjs']

//各檔可執行 console 呼叫之站點數(2026-11-23 盤點, 共 54 處; 不含 EXCEPT)——新增站點須先判定其引數是否印值
const SITES = {
    'src/App.vue': 2,
    'src/baselineOf.mjs': 1,
    'src/components/AppTokenAddDialog.vue': 3,
    'src/components/Layout.vue': 3,
    'src/components/LayoutContentIps.vue': 5,
    'src/components/LayoutContentStaInfor.vue': 8,
    'src/components/LayoutContentTokens.vue': 5,
    'src/components/LayoutContentUserInfor.vue': 1,
    'src/components/LayoutContentUsers.vue': 9,
    'src/components/PageLogin.vue': 6,
    'src/components/PageUser.vue': 6,
    'src/main.js': 2,
    'src/plugins/mUI.mjs': 3,
}
//允許於 console 引數內呼叫之摘要函數(只此二者; 不沿用掃描器預設之 maskTok／maskUrl／nameOfErr)
const ALLOW_CALLS = ['describeShape', 'describeErr']


//findOddConsoleRefs: 可執行碼中「不是 console.(log|error|warn|info|debug)( 形式」之 console 引用(別名、解構、括號存取、傳遞 `.catch(console.log)`、其他方法 table／dir／trace／group／assert／count…)
//  與「行首為區塊註解但其後接 console 呼叫」之行(sourceLines 會把以 /* 開頭之行整行視為註解而略過)
function findOddConsoleRefs(fp) {
    let bad = []
    for (let { no, text } of sourceLines(fp, 'code')) {
        let code = blankStrings(text) //字串字面值內之 console 字樣(如語系文字)不算引用
        let isOdd = false
        for (let m of code.matchAll(/\bconsole\b/g)) {
            if (!/^console\.(log|error|warn|info|debug)\(/.test(code.slice(m.index)) || /\b(window|globalThis|self|top|parent)\s*\.\s*$/.test(code.slice(0, m.index))) {
                isOdd = true
                break
            }
        }
        //括號存取之字串鍵(blankStrings 會清空字串內容, 須以原文判定): window['console']、globalThis["console"]
        if (!isOdd && /\[\s*['"`]console['"`]\s*\]/.test(text)) {
            isOdd = true
        }
        if (isOdd) {
            bad.push(`${path.basename(fp)}:${no}: ${text.trim()}`)
        }
    }
    fs.readFileSync(fp, 'utf8').split(/\r?\n/).forEach((ln, k) => {
        if (/\*\/\s*console\b/.test(ln)) {
            bad.push(`${path.basename(fp)}:${k + 1}: ${ln.trim()}`)
        }
    })
    return bad
}


describe('unit-consoleNoValuesFront (前端 console 不印資料值, 排程第 206 項)', function() {

    let files = null

    before(function() {
        files = walk('src').filter((fp) => !EXCEPT.includes(rel(fp)))
    })

    it('CNVF-001 前端 src 檔: 每個可執行 console 呼叫之每個引數皆為固定字面值／typeof／describeShape／describeErr(修前 2026-11-23 於 54 處站點中 48 處含未遮罩之引數: 選取列、整列資料、回應物件、錯誤本體、網址參數、$alert 之訊息等)', function() {
        let bad = []
        for (let fp of files) {
            bad.push(...scanConsoleValueArgs(fp, 'code', { allowCalls: ALLOW_CALLS }).map((x) => `${rel(fp)} ${x}`))
        }
        A.deepEqual(bad, [], `前端 console 站點印出可能含資料值之引數 ${bad.length} 處:\n${bad.join('\n')}`)
    })

    it('CNVF-002 站點全集: 各檔之可執行 console 呼叫數與已盤點者相同; 範圍涵蓋進入檔與全部元件', function() {
        let got = {}
        for (let fp of files) {
            let n = sourceLines(fp, 'code').filter((l) => /\bconsole\.(log|warn|error|info|debug|table|dir|trace|group)\b/.test(l.text)).length
            if (n > 0) {
                got[rel(fp)] = n
            }
        }
        A.deepEqual(got, SITES, '各檔站點數與盤點不符(新增或移除站點須先判定引數是否印值, 再更新 SITES 與規則帳本 R-LOG-02)')
        let rels = files.map(rel)
        for (let f of ['src/App.vue', 'src/main.js', 'src/components/PageLogin.vue', 'src/components/LayoutContentTokens.vue', 'src/plugins/mUI.mjs', 'src/baselineOf.mjs']) {
            A.ok(rels.includes(f), `掃描範圍缺 ${f}`)
        }
        //掃描器未空轉: 至少掃到 .vue 與 .mjs 之可執行行
        A.ok(files.some((fp) => fp.endsWith('.vue')) && files.some((fp) => fp.endsWith('.mjs')))
    })

    it('CNVF-002b console 之引用皆為 console.(log|error|warn|info|debug)( 形式: 無別名、解構、括號存取、`.catch(console.log)` 式傳遞、其他方法、區塊註解後接呼叫(掃描器 CNVF-001 之盲點)', function() {
        let bad = []
        for (let fp of walk('src')) {
            bad.push(...findOddConsoleRefs(fp).map((x) => `${rel(fp)} ${x}`))
        }
        A.deepEqual(bad, [], `console 之非常規引用(CNVF-001 之掃描器不涵蓋)${bad.length} 處, 須先改為常規形式或擴充掃描器:\n${bad.join('\n')}`)
    })

    it('CNVF-002c 掃描器自測: 對 .vue 之 <script> 區與各種盲點寫法確實回報(防掃描器空轉)', function() {
        let fd = path.join(projRoot, 'test', '_tmp', 'consoleNoValuesFront-scan')
        let fpVue = path.join(fd, 'Sample.vue')
        let fpJs = path.join(fd, 'sample.mjs')
        fs.mkdirSync(fd, { recursive: true })
        try {
            let linesVue = [
                '<template><div></div></template>',
                '<script>',
                'export default {',
                '    methods: {',
                '        f: function() {',
                '            console.log(\'user\', user)',
                '            console.log(\'ok\', describeShape(user), describeErr(err))',
                '            console.log(maskUrl(url))',
                '        },',
                '    },',
                '}',
                '</script>',
            ]
            fs.writeFileSync(fpVue, linesVue.join('\n'), 'utf8')
            //第 1 別名、2 解構、3 括號存取、4 傳遞、5 table、6 區塊註解後接呼叫、7 window 括號存取字串鍵、8 globalThis.console 皆為盲點寫法; 第 9 行合格
            let linesJs = [
                'let c = console',
                'let { log } = console',
                'console[\'log\'](x)',
                'p.catch(console.log)',
                'console.table(rows)',
                '/* x */ console.log(user)',
                'window[\'console\'].log(x)',
                'globalThis.console.log(x)',
                'console.log(\'固定字面值\')',
            ]
            fs.writeFileSync(fpJs, linesJs.join('\n'), 'utf8')
            let v = scanConsoleValueArgs(fpVue, 'code', { allowCalls: ALLOW_CALLS })
            A.deepEqual(v.map((x) => Number(/:(\d+)/.exec(x)[1])), [6, 8], `.vue 之 <script> 內 console.log('user', user) 與非允許之函數(maskUrl)須被回報(第 6、8 行), 實得 ${v.join(' | ')}`)
            let o = findOddConsoleRefs(fpJs)
            A.deepEqual(o.map((x) => Number(/:(\d+):/.exec(x)[1])).sort((a, b) => a - b), [1, 2, 3, 4, 5, 6, 7, 8], `非常規引用須回報第 1～8 行(第 9 行合格), 實得 ${o.join(' | ')}`)
        }
        finally {
            fs.rmSync(fd, { recursive: true, force: true })
        }
    })

    it('CNVF-003 describeShape／describeErr 單一實作(src/describeShape.mjs): src 與 server 內無第二份定義; 用到者皆自該模組匯入; 依賴閉包不含 Node 內建模組', function() {
        //單一定義
        let defs = []
        for (let fp of [...walk('src'), ...walk('server')]) {
            let code = sourceLines(fp, 'code').map((l) => l.text).join('\n')
            if (/function (describeShape|describeErr|safeCtl)\(|(?:const|let|var) (describeShape|describeErr|safeCtl)\s*=/.test(code)) {
                defs.push(rel(fp))
            }
        }
        A.deepEqual(defs, ['src/describeShape.mjs'], '摘要函數只能定義於 src/describeShape.mjs(不另寫等價實作, 規格 D1)')
        //使用端皆自該模組匯入(缺匯入則於瀏覽器執行時 ReferenceError)
        for (let fp of walk('src')) {
            if (rel(fp) === 'src/describeShape.mjs') {
                continue
            }
            let code = sourceLines(fp, 'code').map((l) => l.text).join('\n')
            for (let nm of ['describeShape', 'describeErr']) {
                if (new RegExp(`\\b${nm}\\(`).test(code)) {
                    let re = new RegExp(`import\\s*\\{[^}]*\\b${nm}\\b[^}]*\\}\\s*from\\s*['"]((?:\\./|\\.\\./)+describeShape\\.mjs)['"]`)
                    A.ok(re.test(code), `${rel(fp)} 使用 ${nm}( 但未自 describeShape.mjs 匯入`)
                }
            }
        }
        //閉包: src/describeShape.mjs → wsemi 之 isarr、getDiagBriefErr(再往下私有依賴); 不得靜態匯入 Node 內建模組
        let entries = [
            path.join(projRoot, 'src', 'describeShape.mjs'),
            path.join(projRoot, 'node_modules', 'wsemi', 'src', 'isarr.mjs'),
            path.join(projRoot, 'node_modules', 'wsemi', 'src', 'getDiagBriefErr.mjs'),
        ]
        let builtins = new Set([...builtinModules, ...builtinModules.map((m) => `node:${m}`)])
        let all = new Set()
        for (let e of entries) {
            for (let fp of importClosure(e)) {
                all.add(fp)
            }
        }
        A.ok(all.size >= 5, `閉包應至少含 5 檔(describeShape、isarr、getDiagBriefErr 及其私有依賴), 實得 ${all.size}`)
        let hits = []
        for (let fp of all) {
            let t = fs.readFileSync(fp, 'utf8')
            let re = /(?:^|\n)\s*(?:import|export)\s[^'"\n]*?from\s*['"]([^'"]+)['"]|(?:^|\n)\s*import\s*['"]([^'"]+)['"]/g
            let m
            while ((m = re.exec(t)) !== null) {
                let spec = m[1] || m[2]
                if (builtins.has(spec)) {
                    hits.push(`${rel(fp)} 匯入 ${spec}`)
                }
            }
        }
        A.deepEqual(hits, [], `前端用之摘要函數閉包不得靜態匯入 Node 內建模組(webpack 5 不自動填補): ${hits}`)
    })

    it('CNVF-004 摘要不含值: 選取列、授權字串、請求回應、錯誤訊息之識別值皆不出現; 輸出有界; 永不拋錯', function() {
        const SEC = 'ZZ-secret-front-5521'
        //登入回應或使用者物件: 只列鍵名
        let user = { id: SEC, name: SEC, email: `${SEC}@example.com`, token: SEC }
        A.equal(describeShape(user), '(keys: id,name,email,token)')
        A.ok(!describeShape(user).includes(SEC))
        //網址參數(view)、$alert 之訊息: 只標型別
        A.equal(describeShape(SEC), '(typeof string)')
        A.equal(describeShape(''), '(typeof string, empty)')
        //選取列陣列(LayoutContent*): 只標筆數
        A.equal(describeShape([{ data: { id: SEC } }, { data: { id: SEC } }]), '(array, length=2)')
        A.equal(describeShape(null), '(null)')
        A.equal(describeShape(undefined), '(undefined)')
        A.equal(describeShape(7), '(typeof number)')
        //錯誤: 伺服端回傳之語系鍵(字串)、Error 本體、帶 code 之錯誤、含識別值之訊息
        for (let e of [SEC, new Error(SEC), Object.assign(new Error(SEC), { code: 'ENOENT' }), { message: SEC }, { err: SEC }]) {
            let s = describeErr(e)
            A.ok(!s.includes(SEC), `describeErr 不得含識別值, 實得 ${s}`)
        }
        A.equal(describeErr(SEC), '(string)')
        A.equal(describeErr(new Error(SEC)), '(Error)')
        //控制字元: C0、DEL、C1(U+0085)、行／段分隔(U+2028、U+2029)、雙向文字控制(U+202E、U+2067)皆換成 '?', 不可偽造 log 行或改變顯示順序
        let ctl = {}
        for (let [k, x] of [['a', 0x2028], ['c', 0x202e], ['e', 0x85], ['g', 0x2029], ['i', 7], ['k', 0x7f], ['m', 0x2067]]) {
            ctl[`${k}${String.fromCharCode(x)}z`] = 1 //以 fromCharCode 組成, 原始碼不含字面控制字元
        }
        A.equal(describeShape(ctl), '(keys: a?z,c?z,e?z,g?z,i?z,k?z,m?z)')
        A.equal(safeCtl(`x${String.fromCharCode(10)}y`), 'x?y')
        //一般文字(含中文與全形標點)不受影響
        A.equal(describeShape({ '名稱': 1, 'user-id': 2 }), '(keys: 名稱,user-id)')
        //有界與不拋錯
        let huge = {}
        for (let i = 0; i < 3000; i++) {
            huge[`k${i}${SEC}`] = 1
        }
        A.ok(describeShape(huge).length < 1500)
        //上限逐字釘住: 鍵數超過 20 只列前 20 個並標 `,...+N`; 單一鍵名超過 40 字截斷並標 `...`(複審採納: 原只斷言長度 < 1500, 上限改大仍通過)
        A.ok(describeShape(huge).endsWith(',...+2980)'), '3000 個鍵只列前 20 個, 其餘標 ,...+2980')
        let long = {}
        long['K'.repeat(100)] = 1
        A.equal(describeShape(long), `(keys: ${'K'.repeat(40)}...)`)
        let exact40 = {}
        exact40['E'.repeat(40)] = 1
        A.equal(describeShape(exact40), `(keys: ${'E'.repeat(40)})`, '剛好 40 字不截斷')
        let many = {}
        let names20 = []
        for (let i = 0; i < 25; i++) {
            let k = `k${String(i).padStart(2, '0')}`
            many[k] = 1
            if (i < 20) {
                names20.push(k)
            }
        }
        A.equal(describeShape(many), `(keys: ${names20.join(',')},...+5)`)
        let exact20 = {}
        for (let k of names20) {
            exact20[k] = 1
        }
        A.equal(describeShape(exact20), `(keys: ${names20.join(',')})`, '剛好 20 個鍵不標 ...')
        let evil = new Proxy({}, {
            ownKeys: () => {
                throw new Error(SEC)
            },
        })
        A.doesNotThrow(() => describeShape(evil))
        A.ok(!describeShape(evil).includes(SEC))
        A.doesNotThrow(() => describeErr(evil))
    })

    it('CNVF-005 前端掃描範圍外之 src 站點只有 fetchSsoMsg(引用方後端執行; 其診斷行由 unit-consoleNoLeak SITE-CNL-004 逐字釘住)', function() {
        let n = sourceLines(path.join(projRoot, EXCEPT[0]), 'code').filter((l) => /\bconsole\./.test(l.text)).length
        A.equal(n, 1, 'fetchSsoMsg 恰一個 console 站點(SITE-CNL-004 涵蓋)')
        A.deepEqual(EXCEPT, ['src/fetchSsoMsg.mjs'])
    })
})
