//eslint-compare: 對本輪變更之檔跑 eslint(專案既有設定: package.json 之 eslintConfig), 與 HEAD 版逐檔比較 error／warning 數; 新增筆數須為 0
//  HEAD 版以 `git show HEAD:<檔>` 經 --stdin --stdin-filename 餵 eslint(沿用專案設定與外掛解析); 已刪之檔(src/describeShape.mjs)只在 HEAD 側
//用法: node tmp/tws2/eslint-compare.mjs
import fs from 'fs'
import path from 'path'
import { spawnSync } from 'child_process'
import { fileURLToPath } from 'url'

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const eslintBin = path.join(root, 'node_modules', 'eslint', 'bin', 'eslint.js')

let sh = (cmd, args, opt = {}) => spawnSync(cmd, args, { cwd: root, encoding: 'utf8', windowsHide: true, maxBuffer: 64 * 1024 * 1024, ...opt })

//變更檔清單(工作樹相對於 HEAD)
let st = sh('git', ['diff', '--name-only', 'HEAD']).stdout.split('\n').map((s) => s.trim()).filter(Boolean)
let changed = st.filter((f) => /\.(mjs|js|vue)$/.test(f) && fs.existsSync(path.join(root, f)))
let deleted = st.filter((f) => /\.(mjs|js|vue)$/.test(f) && !fs.existsSync(path.join(root, f)))
console.log(`changed=${changed.length} deleted=${deleted.length}`)

let count = (r, f) => {
    let j = JSON.parse(r.stdout)
    let x = j[0]
    if (!x) {
        throw new Error(`${f}: eslint 無輸出: ${r.stderr}`)
    }
    //致命(解析)錯誤另列
    let fatal = x.messages.filter((m) => m.fatal).length
    return { error: x.errorCount, warning: x.warningCount, fatal }
}
let nowOf = (f) => count(sh(process.execPath, [eslintBin, '-f', 'json', f]), f)
let wasOf = (f) => {
    let src = sh('git', ['show', `HEAD:${f}`], { encoding: 'buffer' }).stdout
    return count(sh(process.execPath, [eslintBin, '-f', 'json', '--stdin', '--stdin-filename', f], { input: src }), f)
}

let rows = []
let addErr = 0
let addWarn = 0
let totA = { error: 0, warning: 0 }
let totB = { error: 0, warning: 0 }
for (let f of [...changed, ...deleted]) {
    let a = wasOf(f)
    let b = deleted.includes(f) ? { error: 0, warning: 0, fatal: 0 } : nowOf(f)
    rows.push(`${f}: HEAD error=${a.error} warning=${a.warning}${a.fatal ? ' fatal=' + a.fatal : ''} → 現 error=${b.error} warning=${b.warning}${b.fatal ? ' fatal=' + b.fatal : ''}`)
    addErr += Math.max(0, b.error - a.error)
    addWarn += Math.max(0, b.warning - a.warning)
    totA.error += a.error
    totA.warning += a.warning
    totB.error += b.error
    totB.warning += b.warning
}
console.log(rows.join('\n'))
console.log(`HEAD 合計 ${JSON.stringify(totA)}; 現合計 ${JSON.stringify(totB)}; 逐檔新增 error=${addErr} warning=${addWarn}`)
