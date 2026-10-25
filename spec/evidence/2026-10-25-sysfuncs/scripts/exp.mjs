//exp.mjs — 暫時改 server/WWebSso.mjs 之 sysFuncsPublic → 跑真瀏覽器擷取(probe-capture) → 一律還原並回驗 sha256(sso-run01 暫存; 須在測試鎖內)
//用法: node tmp/sso-run01/exp.mjs   (實驗 E3: 只公開 [sys:polling])
import fs from 'fs'
import path from 'path'
import crypto from 'crypto'
import { spawnSync } from 'child_process'

const file = 'server/WWebSso.mjs'
const orig = fs.readFileSync(file, 'utf8')
fs.writeFileSync(path.resolve('./tmp/sso-run01/WWebSso.orig.mjs'), orig)
const sha = (s) => crypto.createHash('sha256').update(s).digest('hex')
const LINE = "sysFuncsPublic: ['[sys:getFuncList]', '[sys:polling]'],"
if (!orig.includes(LINE)) {
    throw new Error('找不到 sysFuncsPublic 行')
}
try {
    fs.writeFileSync(file, orig.replace(LINE, "sysFuncsPublic: ['[sys:polling]'], //E3"))
    let r = spawnSync(process.execPath, ['tmp/sso-run01/probe-capture.mjs', 'exp-e3', './tmp/sso-run01/net-exp-e3.jsonl'], { cwd: process.cwd(), encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, windowsHide: true })
    fs.writeFileSync(path.resolve('./tmp/sso-run01/exp-e3.log'), (r.stdout || '') + (r.stderr || ''))
    console.log('[exp] E3 probe exit', r.status)
}
finally {
    fs.writeFileSync(file, orig)
    console.log('[exp] 還原後 sha256', sha(fs.readFileSync(file, 'utf8')) === sha(orig) ? '相符' : '**不符**')
}
