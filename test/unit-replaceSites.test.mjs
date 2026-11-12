import assert from 'assert'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'


//
// 字串替換站點全集之守護 (規則帳本 R-VAL-03; 與 unit-emailRender 的行為測試互補)
//
// String.prototype.replace / replaceAll 的「替換字串」中 $& $' $` $$ $<name> 是特殊樣式, 以字串代入使用者自填文字或隨機值會被展開,
// 使輸出與實際值不同 (重設密碼信中之新密碼與資料庫不同即此). 代入「非常數字串」的站點必須以函數回傳替換值 (replaceAll(token, () => 值)),
// 或登記於下方允許清單並寫明理由 (值為數字、固定集合、部署方設定文字, 或特殊樣式本身即所需).
//
// 本檔掃描 server/ 與 src/ 之原始碼: 抽出每個 .replace( / .replaceAll( / wsemi replace( 呼叫之替換值引數, 分類為
//   func (函數, 安全) / const (不含 $ 之字串常數, 安全) / literal$ (含 $ 之字串常數) / value (其他運算式: 變數、呼叫結果),
// literal$ 與 value 須在允許清單內; 允許清單內已不存在之條目亦視為失敗 (避免清單腐化).
//


let ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

//K_TPL: procCore.renderEmailText 內樣板字串 `{${k}}` 之原始碼文字 (以串接組出, 避免字串常數內出現 ${ 觸發 lint no-template-curly-in-string)
let K_TPL = '{$' + '{k}}'


//listFiles: 遞迴列出 dir 下副檔名在 exts 內之檔案 (略過 node_modules)
function listFiles(dir, exts) {
    let out = []
    for (let ent of fs.readdirSync(dir, { withFileTypes: true })) {
        if (ent.name === 'node_modules') {
            continue
        }
        let fp = path.join(dir, ent.name)
        if (ent.isDirectory()) {
            out.push(...listFiles(fp, exts))
        }
        else if (exts.includes(path.extname(ent.name))) {
            out.push(fp)
        }
    }
    return out
}


//splitArgs: 自 src[iOpen] ('(') 起拆出呼叫的引數文字 (略過字串、樣板字串與正規式字面量內的括號與逗號)
function splitArgs(src, iOpen) {
    let args = []
    let depth = 0
    let cur = ''
    let i = iOpen + 1
    let atStart = true
    while (i < src.length) {
        let ch = src[i]
        if (atStart && /\s/.test(ch)) {
            cur += ch
            i++
            continue
        }
        if (atStart && ch === '/' && src[i + 1] !== '/' && src[i + 1] !== '*') {
            //正規式字面量
            let j = i + 1
            let inCls = false
            while (j < src.length) {
                let c = src[j]
                if (c === '\\') {
                    j += 2
                    continue
                }
                if (c === '[') {
                    inCls = true
                }
                else if (c === ']') {
                    inCls = false
                }
                else if (c === '/' && !inCls) {
                    break
                }
                j++
            }
            j++
            while (j < src.length && /[a-z]/i.test(src[j])) {
                j++
            }
            cur += src.slice(i, j)
            i = j
            atStart = false
            continue
        }
        atStart = false
        if (ch === '\'' || ch === '"' || ch === '`') {
            let j = i + 1
            while (j < src.length && src[j] !== ch) {
                if (src[j] === '\\') {
                    j++
                }
                j++
            }
            cur += src.slice(i, j + 1)
            i = j + 1
            continue
        }
        if (ch === '(' || ch === '[' || ch === '{') {
            depth++
        }
        else if (ch === ')' || ch === ']' || ch === '}') {
            if (depth === 0 && ch === ')') {
                args.push(cur.trim())
                return args
            }
            depth--
        }
        else if (ch === ',' && depth === 0) {
            args.push(cur.trim())
            cur = ''
            i++
            atStart = true
            continue
        }
        cur += ch
        i++
    }
    return args
}


//classify: 替換值引數之分類
function classify(arg) {
    if (/^(async\s*)?(\([^)]*\)|[\w$]+)\s*=>/.test(arg) || /^function\b/.test(arg)) {
        return 'func'
    }
    let m = arg.match(/^(['"`])([\s\S]*)\1$/)
    if (m && !(m[1] === '`' && m[2].includes('${'))) {
        return m[2].includes('$') ? 'literal$' : 'const'
    }
    return 'value'
}


//scanSource: 抽出 src 內所有替換呼叫 → [{ line, method, args, cls }]
//method: '.replace' / '.replaceAll' (替換值為第 2 引數) 或 'replace()' (wsemi replace(c, t, r), 替換值為第 3 引數)
function scanSource(src) {
    let sites = []
    let re = /(\.replaceAll|\.replace|(?<![.\w$])replace)\s*\(/g
    let m
    while ((m = re.exec(src)) !== null) {
        //略過註解行內之出現
        let lineStart = src.lastIndexOf('\n', m.index) + 1
        let before = src.slice(lineStart, m.index)
        let stripped = before.replace(/'[^']*'|"[^"]*"|`[^`]*`/g, '')
        if (stripped.includes('//') || /^\s*(\*|\/\*)/.test(before)) {
            continue
        }
        let iOpen = m.index + m[0].length - 1
        let args = splitArgs(src, iOpen)
        let isFn = m[1] === 'replace' //wsemi replace(c, t, r)
        let rep = isFn ? args[2] : args[1]
        if (rep === undefined) {
            continue //非替換呼叫 (例: replace() 自行定義之同名函數)
        }
        let line = src.slice(0, m.index).split('\n').length
        sites.push({ line, method: isFn ? 'replace()' : m[1], args, rep, cls: classify(rep) })
    }
    return sites
}


//允許清單: key = `${檔案}::${方法}::${引數以 | 相連}`; 這些站點的替換值不是「使用者自填文字或隨機值」
let ALLOW = {
    //前端: 密碼政策數值 (minLength / maxLength / consecutiveCharsMinMatch 為數字, 轉字串只含數字)
    'src/components/PageLogin.vue::.replace::\'{minLength}\'|p.minLength': '密碼政策數值 (數字)',
    'src/components/PageLogin.vue::.replace::\'{maxLength}\'|p.maxLength': '密碼政策數值 (數字)',
    'src/plugins/mUI.mjs::.replace::\'{minLength}\'|get(p, \'minLength\', \'\')': '密碼政策數值 (數字)',
    'src/plugins/mUI.mjs::.replace::\'{maxLength}\'|get(p, \'maxLength\', \'\')': '密碼政策數值 (數字)',
    'src/plugins/mUI.mjs::.replace::\'{consecutiveCharsMinMatch}\'|get(p, \'consecutiveCharsMinMatch\', \'\')': '密碼政策數值 (數字)',
    //前端: 轉址網址之 token 為 UUID v7 (十六進位與連字號), lang 為 eng / cht
    'src/plugins/mUI.mjs::.replaceAll::\'{token}\'|token': 'session 權杖 (wsemi genIDSeq → UUID v7, 無 $)',
    'src/plugins/mUI.mjs::.replaceAll::\'{lang}\'|lang': '語系碼 (eng / cht)',
    //前端: 正規式跳脫, '\\$&' 即欲展開 $& (在比對到的字元前加反斜線)
    'src/fetchSsoMsg.mjs::.replace::/[.*+?^${}()|[\\]\\\\]/g|\'\\\\$&\'': '特殊樣式本身即所需 (正規式跳脫)',
    //後端: 結果頁模板與子路徑之置換, 值為部署方於 settings 自填之設定文字或內建語系字典, 不是外部輸入或隨機值.
    //wsemi replace() 內部為 String.replaceAll(字串), 設定文字若含 $& $$ 等仍會被展開 (已列回饋 sgud/feedback/feedback.md, 由自有套件統一處理, 不在本套件繞道)
    'server/WWebSso.mjs::replace()::c|\'{sfd}\'|subfolder': '設定值 (subfolder), 部署方自填',
    'server/WWebSso.mjs::replace()::c|\'{language}\'|language': '設定值 (language), 部署方自填',
    'server/WWebSso.mjs::replace()::html|\'{title}\'|title': '語系字典 (webName), 部署方自填',
    'server/WWebSso.mjs::replace()::html|\'{message}\'|message': '語系字典 (結果頁訊息), 內建或部署方自填',
}


//scanAll: 掃描 server/ 與 src/ → [{ file, ...site, key }]
function scanAll() {
    let files = [
        ...listFiles(path.join(ROOT, 'server'), ['.mjs']),
        ...listFiles(path.join(ROOT, 'src'), ['.mjs', '.vue', '.js']),
    ]
    let out = []
    for (let fp of files) {
        let file = path.relative(ROOT, fp).split(path.sep).join('/')
        let src = fs.readFileSync(fp, 'utf8')
        for (let s of scanSource(src)) {
            let argsKey = (s.method === 'replace()' ? [s.args[0], s.args[1], s.args[2]] : [s.args[0], s.args[1]]).join('|')
            out.push({ file, ...s, key: `${file}::${s.method}::${argsKey}` })
        }
    }
    return out
}


describe('字串替換站點全集 (server/、src/)', function() {

    it('SITE-RP-00 掃描器本身: 已知正例與反例分類正確 (掃描範圍壞掉時不會誤判為「無問題」)', function() {
        let src = [
            'a.replaceAll(\'{x}\', v)',
            'a.replaceAll(\'{x}\', () => v)',
            'a.replace(\'{x}\', function() { return v })',
            'a.replace(/[,()]/g, \'\')',
            'a.replace(/[.*+?^${}()|[\\]\\\\]/g, \'\\\\$&\')',
            'a.replaceAll(`' + K_TPL + '`, (m) => v[m])',
            'let r = replace(c, \'{t}\', val)',
            '//    c.replaceAll(\'{x}\', comment)',
            'import replace from \'wsemi/src/replace.mjs\'',
        ].join('\n')
        let sites = scanSource(src)
        assert.deepStrictEqual(sites.map((s) => s.cls), ['value', 'func', 'func', 'const', 'literal$', 'func', 'value'])
    })

    it('SITE-RP-01 掃描範圍: 有掃到已知站點 (renderEmailText、前端確認文字、wsemi replace 呼叫), 檔數與站點數不為 0', function() {
        let sites = scanAll()
        assert.ok(sites.length >= 15, `站點數 ${sites.length}`)
        let has = (file, part) => sites.some((s) => s.file === file && s.key.includes(part))
        assert.ok(has('server/procCore.mjs', K_TPL), 'procCore renderEmailText')
        assert.ok(has('src/components/LayoutContentUsers.vue', '{account}'))
        assert.ok(has('src/components/LayoutContentUsers.vue', '{email}'))
        assert.ok(has('server/WWebSso.mjs', '{title}'))
    })

    it('SITE-RP-02 代入非常數字串之站點一律為函數替換值, 或登記於允許清單 (R-VAL-03); 允許清單無已不存在之條目', function() {
        let sites = scanAll()
        let bad = sites.filter((s) => (s.cls === 'value' || s.cls === 'literal$') && !(s.key in ALLOW))
        assert.deepStrictEqual(bad.map((s) => `${s.file}:${s.line} ${s.key}`), [], '未登記且非函數替換值之站點')
        let keys = new Set(sites.map((s) => s.key))
        let stale = Object.keys(ALLOW).filter((k) => !keys.has(k))
        assert.deepStrictEqual(stale, [], '允許清單中已不存在之條目')
    })

    it('SITE-RP-03 四個寄信點共用之 renderEmailText 與前端確認文字 {account} / {email} 皆為函數替換值', function() {
        let sites = scanAll()
        let pick = (file, part) => sites.filter((s) => s.file === file && s.key.includes(part))
        for (let [file, part] of [
            ['server/procCore.mjs', K_TPL],
            ['src/components/LayoutContentUsers.vue', '{account}'],
            ['src/components/LayoutContentUsers.vue', '{email}'],
        ]) {
            let ss = pick(file, part)
            assert.strictEqual(ss.length, 1, `${file} ${part}`)
            assert.strictEqual(ss[0].cls, 'func', `${file}:${ss[0].line} ${ss[0].key}`)
        }
    })

})
