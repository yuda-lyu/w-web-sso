//migrate-front: 前端 src 之 describeShape／describeErr 呼叫批次改為 wsemi getDiagShape／getDiagBriefErr(依詞界取代, 保留各檔換行格式)
//  匯入行: `import { describeShape, describeErr } from '<相對路徑>describeShape.mjs'` → 依名稱改為 wsemi 之預設匯入(各一行)
//  呼叫處: `describeShape(` → `getDiagShape(`; `describeErr(` → `getDiagBriefErr(`
//  只處理含匯入行之檔; 結果印每檔處理數, 並對照處理前後之全 src 殘留(describeShape.mjs 本身由人工刪除)
//用法: node tmp/tws2/migrate-front.mjs [--dry]
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const dry = process.argv.includes('--dry')

let walk = (d) => {
    let out = []
    for (let n of fs.readdirSync(d, { withFileTypes: true })) {
        let fp = path.join(d, n.name)
        if (n.isDirectory()) {
            out.push(...walk(fp))
        }
        else if (/\.(vue|js|mjs)$/.test(n.name)) {
            out.push(fp)
        }
    }
    return out
}

const reImport = /^import \{ ([A-Za-z, ]+) \} from '((?:\.\/|\.\.\/)+)describeShape\.mjs'$/m
let totalShape = 0
let totalErr = 0
let nFile = 0
for (let fp of walk(path.join(root, 'src')).sort()) {
    if (path.basename(fp) === 'describeShape.mjs') {
        continue
    }
    let code = fs.readFileSync(fp, 'utf8')
    let m = code.match(reImport)
    if (!m) {
        if (/describeShape|describeErr/.test(code)) {
            throw new Error(`${fp} 含 describeShape／describeErr 但無預期匯入行`)
        }
        continue
    }
    let eol = code.includes('\r\n') ? '\r\n' : '\n'
    let names = m[1].split(',').map((s) => s.trim())
    for (let n of names) {
        if (!['describeShape', 'describeErr'].includes(n)) {
            throw new Error(`${fp} 匯入非預期名稱 ${n}`)
        }
    }
    let lines = []
    if (names.includes('describeShape')) {
        lines.push(`import getDiagShape from 'wsemi/src/getDiagShape.mjs'`)
    }
    if (names.includes('describeErr')) {
        lines.push(`import getDiagBriefErr from 'wsemi/src/getDiagBriefErr.mjs'`)
    }
    let nextCode = code.replace(reImport, lines.join(eol))
    let cShape = (nextCode.match(/\bdescribeShape\(/g) || []).length
    let cErr = (nextCode.match(/\bdescribeErr\(/g) || []).length
    nextCode = nextCode.replace(/\bdescribeShape\(/g, 'getDiagShape(').replace(/\bdescribeErr\(/g, 'getDiagBriefErr(')
    if (/\bdescribe(Shape|Err)\b/.test(nextCode)) {
        throw new Error(`${fp} 取代後仍有殘留: ${nextCode.match(/.*\bdescribe(Shape|Err)\b.*/)[0]}`)
    }
    if (names.includes('describeShape') !== (cShape > 0) && cShape === 0) {
        console.log(`WARN ${path.relative(root, fp)}: 匯入 describeShape 但無呼叫`)
    }
    if (names.includes('describeErr') !== (cErr > 0) && cErr === 0) {
        console.log(`WARN ${path.relative(root, fp)}: 匯入 describeErr 但無呼叫`)
    }
    console.log(`${path.relative(root, fp).replace(/\\/g, '/')}: eol=${eol === '\r\n' ? 'CRLF' : 'LF'} import ${names.join('+')} → ${lines.length} 行; describeShape( ${cShape}, describeErr( ${cErr}`)
    totalShape += cShape
    totalErr += cErr
    nFile++
    if (!dry) {
        fs.writeFileSync(fp, nextCode, 'utf8')
    }
}
console.log(`files=${nFile} describeShape(=${totalShape} describeErr(=${totalErr} dry=${dry}`)
