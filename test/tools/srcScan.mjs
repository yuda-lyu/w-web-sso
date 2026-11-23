//原始碼靜態盤點工具(供 unit-consoleNoValuesFront 之前端 console 站點不變式 CNVF-* 共用; 規則見 sgud/rule/rulebook_security.md R-LOG-02)。
//以行為單位處理: 前端 console 呼叫皆為單行; 跨行之 console 呼叫會回報為「無法解析」而非靜默略過。
//來源: 與同系列之權限管理套件之同名工具同形; 摘要函數已收斂為 wsemi 共用函數 getDiagShape / getDiagBriefErr(排程第 603 項), 預設允許之呼叫即此二者。
import fs from 'fs'
import path from 'path'


//takeParen: 自 i0(左括號之後)取平衡括號內之字串, 略過字串字面值; 未閉合(跨行)回 null
export function takeParen(s, i0) {
    let depth = 1
    let q = null
    for (let i = i0; i < s.length; i++) {
        let c = s[i]
        if (q) {
            if (c === '\\') {
                i++
                continue
            }
            if (c === q) {
                q = null
            }
            continue
        }
        if (c === '\'' || c === '"' || c === '`') {
            q = c
            continue
        }
        if (c === '(') {
            depth++
        }
        else if (c === ')') {
            depth--
            if (depth === 0) {
                return s.slice(i0, i)
            }
        }
    }
    return null
}


//blankStrings: 字串字面值換成空字串, 避免 '...token...' 之文字被當成識別字
export function blankStrings(s) {
    return s.replace(/'(?:\\.|[^'\\])*'|"(?:\\.|[^"\\])*"|`(?:\\.|[^`\\])*`/g, '""')
}


//stripLineComment: 去掉行尾 // 註解(字串內之 // 不算, 如 'http://')
export function stripLineComment(s) {
    let q = null
    for (let i = 0; i < s.length; i++) {
        let c = s[i]
        if (q) {
            if (c === '\\') {
                i++
                continue
            }
            if (c === q) {
                q = null
            }
            continue
        }
        if (c === '\'' || c === '"' || c === '`') {
            q = c
            continue
        }
        if (c === '/' && s[i + 1] === '/') {
            return s.slice(0, i)
        }
    }
    return s
}


/**
 * 取檔案之行
 *
 * @param {String} fp 輸入檔案路徑
 * @param {String} mode 輸入模式: 'code' 可執行碼(略過 // 註解行、JSDoc 與區塊註解, 並去掉行尾註解); 'doc' 只取 JSDoc / 區塊註解行(去掉前導 *); 'md' 全部行
 * @returns {Array} 回傳 [{ no, text }], no 為 1 起算之行號
 */
export function sourceLines(fp, mode) {
    let lines = fs.readFileSync(fp, 'utf8').split(/\r?\n/)
    let out = []
    let inBlock = false
    lines.forEach((ln, k) => {
        if (mode === 'md') {
            out.push({ no: k + 1, text: ln })
            return
        }
        let t = ln.trim()
        let isDoc = inBlock || t.startsWith('/*') || t.startsWith('*')
        if (t.startsWith('/*') && !t.includes('*/')) {
            inBlock = true
        }
        if (inBlock && t.includes('*/')) {
            inBlock = false
        }
        if (mode === 'code') {
            if (isDoc || t.startsWith('//')) {
                return
            }
            out.push({ no: k + 1, text: stripLineComment(ln) })
        }
        else if (isDoc) { //doc
            out.push({ no: k + 1, text: t.replace(/^\/?\*+\s?/, '') })
        }
    })
    return out
}


//dropMaskCalls: 移除 maskTok(...) / maskUrl(...) / getDiagShape(...) / getDiagBriefErr(...) 整段(已遮罩或只印鍵名／型別之引數)
function dropMaskCalls(s) {
    let re = /\b(maskTok|maskUrl|getDiagShape|getDiagBriefErr)\(/
    for (let n = 0; n < 100; n++) {
        let m = re.exec(s)
        if (!m) {
            break
        }
        let i0 = m.index + m[0].length
        let inner = takeParen(s, i0)
        if (inner === null) {
            break
        }
        s = s.slice(0, m.index) + '""' + s.slice(i0 + inner.length + 1)
    }
    return s
}


/**
 * 盤點 console.log / error / warn / info 呼叫中未經遮罩之權杖引數
 * 判準: 引數(去掉 maskTok / maskUrl / getDiagShape / getDiagBriefErr 之整段後)含權杖類識別字 token / tokenSelf / authorization / headers / referer,
 * 或含 get(req, 'query') / req.query 者為違規
 *
 * @param {String} fp 輸入檔案路徑
 * @param {String} mode 輸入模式, 同 sourceLines
 * @returns {Array} 回傳違規描述字串陣列, 形如 'WWebPerm.mjs:399: console.log(`token`, token)'
 */
export function scanConsoleTokenArgs(fp, mode) {
    let bad = []
    for (let { no, text } of sourceLines(fp, mode)) {
        let re = /console\.(log|error|warn|info)\(/g
        let m
        while ((m = re.exec(text)) !== null) {
            let args = takeParen(text, m.index + m[0].length)
            if (args === null) {
                bad.push(`${path.basename(fp)}:${no} 無法解析(跨行呼叫, 請改單行或人工盤點): ${text.trim()}`)
                continue
            }
            let a = dropMaskCalls(args)
            let aCode = blankStrings(a) //識別字判斷須排除字串字面值(如標籤 'req.query')
            let hasQuery = /get\(\s*req\s*,\s*['"`]query['"`]/.test(a) || /\breq\.query\b/.test(aCode)
            let hasTok = /\b(token|tokenSelf|authorization|headers|referer)\b/.test(aCode)
            if (hasQuery || hasTok) {
                bad.push(`${path.basename(fp)}:${no}: ${text.trim()}`)
            }
        }
    }
    return bad
}


/**
 * 取靜態匯入閉包: 自入口檔起, 遞迴收集相對路徑之 import／export from／動態 import('...') 所指之檔(套件名等非相對路徑不跟進)
 *
 * @param {String} entry 輸入入口檔路徑
 * @returns {Set} 回傳絕對路徑之集合(含入口檔; 不存在之檔不收)
 */
export function importClosure(entry) {
    let seen = new Set()
    let stack = [path.resolve(entry)]
    while (stack.length > 0) {
        let fp = stack.pop()
        if (seen.has(fp) || !fs.existsSync(fp) || !fs.statSync(fp).isFile()) {
            continue
        }
        seen.add(fp)
        let t = fs.readFileSync(fp, 'utf8')
        let re = /(?:import|export)\s[^'"]*?from\s*['"](\.{1,2}\/[^'"]+)['"]|import\s*['"](\.{1,2}\/[^'"]+)['"]|import\(\s*['"](\.{1,2}\/[^'"]+)['"]\s*\)/g
        let m
        while ((m = re.exec(t)) !== null) {
            stack.push(path.resolve(path.dirname(fp), m[1] || m[2] || m[3]))
        }
    }
    return seen
}


//splitTopLevel: 依最外層逗號切引數(括號、方括號、大括號與字串／樣板字串內之逗號不算); 未閉合回 null
export function splitTopLevel(s) {
    let out = []
    let depth = 0
    let q = null
    let cur = ''
    for (let i = 0; i < s.length; i++) {
        let c = s[i]
        if (q) {
            cur += c
            if (c === '\\') {
                i++
                cur += s[i] || ''
                continue
            }
            if (c === q) {
                q = null
            }
            continue
        }
        if (c === '\'' || c === '"' || c === '`') {
            q = c
            cur += c
            continue
        }
        if (c === '(' || c === '[' || c === '{') {
            depth++
        }
        else if (c === ')' || c === ']' || c === '}') {
            depth--
        }
        if (c === ',' && depth === 0) {
            out.push(cur.trim())
            cur = ''
            continue
        }
        cur += c
    }
    if (q || depth !== 0) {
        return null
    }
    out.push(cur.trim())
    return out
}


/**
 * 盤點 console.log / error / warn / info / debug 呼叫中「可能印出資料值」之引數(規則帳本 R-CONSOLE-NOVAL-01; R-DIAG-01 D2、V20)
 * 判準: 每個最外層引數須為下列之一, 否則違規——
 *   ①無插值之字串／樣板字串字面值; ②`typeof 識別字`; ③allowCalls 所列函數之呼叫(預設 getDiagShape／getDiagBriefErr／maskTok／maskUrl; 其引數即其內部保證不輸出值);
 *   ④allowIds 所列之識別字(須逐一有理由: 固定詞彙或非資料值); ⑤allowExprs 所列之整段運算式; ⑥樣板字串之每個插值皆符合②～⑤或 `識別字.length`(筆數)
 *
 * @param {String} fp 輸入檔案路徑
 * @param {String} mode 輸入模式, 同 sourceLines
 * @param {Object} [opt] 輸入設定物件
 * @param {Array} [opt.allowIds=[]] 允許之識別字
 * @param {Array} [opt.allowCalls] 允許之函數名稱
 * @param {Array} [opt.allowExprs=[]] 允許之整段運算式
 * @returns {Array} 回傳違規描述字串陣列, 形如 'WWebPerm.mjs:435: console.log(\'user\', user)'
 */
export function scanConsoleValueArgs(fp, mode, opt = {}) {
    let allowIds = opt.allowIds || []
    let allowCalls = opt.allowCalls || ['getDiagShape', 'getDiagBriefErr', 'maskTok', 'maskUrl']
    let allowExprs = opt.allowExprs || []
    let bad = []

    let isCallOk = (a) => {
        for (let nm of allowCalls) {
            if (a.startsWith(`${nm}(`)) {
                let inner = takeParen(a, nm.length + 1)
                return inner !== null && a === `${nm}(${inner})`
            }
        }
        return false
    }

    let isAtomOk = (a) => {
        return /^typeof [A-Za-z_$][\w$]*$/.test(a) ||
            /^[A-Za-z_$][\w$]*\.length$/.test(a) ||
            allowIds.includes(a) ||
            allowExprs.includes(a) ||
            isCallOk(a)
    }

    let isArgOk = (a) => {
        if (/^'(?:\\.|[^'\\])*'$/.test(a) || /^"(?:\\.|[^"\\])*"$/.test(a)) {
            return true
        }
        if (a.length >= 2 && a[0] === '`' && a[a.length - 1] === '`') {
            let body = a.slice(1, -1)
            let re = /\$\{/g
            let m
            while ((m = re.exec(body)) !== null) {
                let inner = takeParenBrace(body, m.index + 2)
                if (inner === null || !isAtomOk(inner.trim())) {
                    return false
                }
                re.lastIndex = m.index + 2 + inner.length + 1
            }
            return true
        }
        return isAtomOk(a)
    }

    //takeParenBrace: 自 i0(「${」之後)取至對應之「}」之內容; 未閉合回 null
    let takeParenBrace = (s, i0) => {
        let depth = 1
        for (let i = i0; i < s.length; i++) {
            if (s[i] === '{') {
                depth++
            }
            else if (s[i] === '}') {
                depth--
                if (depth === 0) {
                    return s.slice(i0, i)
                }
            }
        }
        return null
    }

    for (let { no, text } of sourceLines(fp, mode)) {
        let re = /console\.(log|error|warn|info|debug)\(/g
        let m
        while ((m = re.exec(text)) !== null) {
            let args = takeParen(text, m.index + m[0].length)
            if (args === null) {
                bad.push(`${path.basename(fp)}:${no} 無法解析(跨行呼叫, 請改單行或人工盤點): ${text.trim()}`)
                continue
            }
            let parts = splitTopLevel(args)
            if (parts === null) {
                bad.push(`${path.basename(fp)}:${no} 無法解析引數: ${text.trim()}`)
                continue
            }
            for (let a of parts) {
                if (a !== '' && !isArgOk(a)) {
                    bad.push(`${path.basename(fp)}:${no}: ${text.trim()}`)
                    break
                }
            }
        }
    }
    return bad
}
