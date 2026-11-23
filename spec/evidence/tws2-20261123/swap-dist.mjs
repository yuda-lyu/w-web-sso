//swap-dist: 全套 e2e 前以「本輪建置」暫時覆蓋 dist/(後端 serve dist/ 之案例讀已建置之 dist/), 驗畢原位元組還原
//  backup  : dist/ → ./tmp/tws2/dist-orig/, 寫 sha256 清單並驗複本
//  apply   : 以 ./tmp/tws2/dist-new/(vue-cli-service build --dest)之 css/、js/ 覆蓋 dist/ 之 css/、js/, index.html 依 genEntry 同法(/msso/ → {sfd}/)轉為 index.tmp, 刪 index.html; 保留 w-web-sso.umd.js(.map)
//  restore : 清空 dist/ 並自 dist-orig/ 還原, 以清單逐檔 sha256 回驗(含無多餘檔)
//  verify  : 只回驗 dist/ 是否等於備份清單
//用法: node tmp/tws2/swap-dist.mjs <backup|apply|restore|verify>
import fs from 'fs'
import path from 'path'
import crypto from 'crypto'
import { fileURLToPath } from 'url'

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const dist = path.join(root, 'dist')
const orig = path.join(root, 'tmp', 'tws2', 'dist-orig')
const fresh = path.join(root, 'tmp', 'tws2', 'dist-new')
const manifestFp = path.join(root, 'tmp', 'tws2', 'dist-orig.manifest.json')

let manifest = (dir) => {
    let m = {}
    let walk = (d) => {
        for (let n of fs.readdirSync(d, { withFileTypes: true })) {
            let fp = path.join(d, n.name)
            if (n.isDirectory()) {
                walk(fp)
            }
            else {
                m[path.relative(dir, fp).replace(/\\/g, '/')] = crypto.createHash('sha256').update(fs.readFileSync(fp)).digest('hex')
            }
        }
    }
    walk(dir)
    return m
}
let diff = (a, b) => {
    let out = []
    for (let k of new Set([...Object.keys(a), ...Object.keys(b)])) {
        if (a[k] !== b[k]) {
            out.push(`${k}: ${a[k] ? a[k].slice(0, 12) : '(無)'} vs ${b[k] ? b[k].slice(0, 12) : '(無)'}`)
        }
    }
    return out
}

let cmd = process.argv[2]
if (cmd === 'backup') {
    if (fs.existsSync(orig)) {
        throw new Error('dist-orig 已存在, 不覆寫備份')
    }
    fs.cpSync(dist, orig, { recursive: true })
    let m = manifest(dist)
    let mc = manifest(orig)
    let d = diff(m, mc)
    if (d.length > 0) {
        throw new Error(`備份複本與原檔不符: ${d.join('; ')}`)
    }
    fs.writeFileSync(manifestFp, JSON.stringify(m, null, 2), 'utf8')
    console.log(`backup ok: ${Object.keys(m).length} 檔`)
}
else if (cmd === 'apply') {
    let m0 = JSON.parse(fs.readFileSync(manifestFp, 'utf8'))
    let d0 = diff(m0, manifest(dist))
    if (d0.length > 0) {
        throw new Error(`apply 前 dist 已與備份不同: ${d0.join('; ')}`)
    }
    let html = fs.readFileSync(path.join(fresh, 'index.html'), 'utf8')
    let tmpl = html.split('/msso/').join('{sfd}/')
    for (let n of ['css', 'js']) {
        fs.rmSync(path.join(dist, n), { recursive: true, force: true })
        fs.cpSync(path.join(fresh, n), path.join(dist, n), { recursive: true })
    }
    fs.rmSync(path.join(dist, 'index.html'), { force: true })
    fs.writeFileSync(path.join(dist, 'index.tmp'), tmpl, 'utf8')
    let jsFiles = fs.readdirSync(path.join(dist, 'js'))
    console.log(`apply ok: js=${jsFiles.join(',')}; index.tmp 含 {sfd}: ${tmpl.includes('{sfd}')}`)
}
else if (cmd === 'restore' || cmd === 'verify') {
    let m0 = JSON.parse(fs.readFileSync(manifestFp, 'utf8'))
    if (cmd === 'restore') {
        fs.rmSync(dist, { recursive: true, force: true })
        fs.cpSync(orig, dist, { recursive: true })
    }
    let d = diff(m0, manifest(dist))
    if (d.length > 0) {
        console.log(`${cmd} 失敗(與備份不同): ${d.join('; ')}`)
        process.exit(1)
    }
    console.log(`${cmd} ok: dist 與備份逐檔 sha256 相同(${Object.keys(m0).length} 檔, 無多餘檔)`)
}
else {
    throw new Error('用法: backup|apply|restore|verify')
}
