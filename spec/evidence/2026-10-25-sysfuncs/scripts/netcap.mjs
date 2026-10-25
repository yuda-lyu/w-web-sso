//netcap.mjs — 真瀏覽器網路擷取(sso-run01 探測用; 暫存, 結束前清理)
//用法: (1) 其他 probe 腳本 import { installNetcap } 後對 context 掛上; (2) 作為 node --import 預載(設 NETCAP_OUT=<jsonl 路徑>)時,
//自動攔截 playwright 之 chromium.launch, 對其後建立之每個 context 掛上擷取, 供直接跑既有 e2e 檔時擷取全部請求.
//只記通訊路由(/api/main 等 POST)之解碼結果與 /api/* 之 GET; 靜態資源只計數. token 一律遮蔽(只記 空 / 非空 / 長度).
import fs from 'fs'
import path from 'path'
import u8arr2obj from 'wsemi/src/u8arr2obj.mjs'

function maskTok(v) {
    if (v === undefined) return 'absent'
    if (typeof v !== 'string') return `nonstring:${typeof v}`
    return v === '' ? 'empty' : `nonempty(len=${v.length})`
}

function safeDecode(buf) {
    try {
        return u8arr2obj(new Uint8Array(buf))
    }
    catch (err) {
        return { __decodeError__: String(err && err.message || err).slice(0, 80) }
    }
}

function summarize(o, depth = 0) {
    if (o === null || o === undefined) return o
    if (typeof o === 'string') return o.length > 120 ? o.slice(0, 120) + `…(${o.length})` : o
    if (typeof o !== 'object') return o
    if (Array.isArray(o)) return depth > 2 ? `[array(${o.length})]` : o.slice(0, 6).map((x) => summarize(x, depth + 1)).concat(o.length > 6 ? [`…(+${o.length - 6})`] : [])
    if (depth > 2) return '{…}'
    let r = {}
    for (let k of Object.keys(o).slice(0, 12)) {
        if (/token/i.test(k) && typeof o[k] === 'string') r[k] = maskTok(o[k])
        else r[k] = summarize(o[k], depth + 1)
    }
    return r
}

let installed = new WeakSet()

export function installNetcap(context, { out, label = '' }) {
    if (installed.has(context)) return
    installed.add(context)
    fs.mkdirSync(path.dirname(out), { recursive: true })
    let write = (rec) => {
        try {
            fs.appendFileSync(out, JSON.stringify({ label, t: Date.now(), ...rec }) + '\n')
        }
        catch (err) { /* ignore */ }
    }
    let reqInfo = new Map()
    //請求本體: postDataBuffer() 對 XHR 二進位本體回 null, 改由頁面端攔截 XMLHttpRequest.send 取位元組, 經綁定回傳解碼(僅 /api 路徑)
    context.exposeBinding('__netcapSend', (source, b64, url) => {
        try {
            let o = safeDecode(Buffer.from(b64, 'base64'))
            let rec = { phase: 'send', path: new URL(url, 'http://x').pathname, func: o && o.func }
            let inp = o && o.input
            if (inp && typeof inp === 'object') {
                rec.inputKeys = Object.keys(inp)
                rec.sysToken = maskTok(inp.__sysToken__)
                if (Array.isArray(inp.__sysInputArgs__)) rec.nArgs = inp.__sysInputArgs__.length
                if (rec.func === '[sys:polling]') rec.pollingInput = summarize(inp)
            }
            if (!rec.func) rec.decoded = summarize(o)
            try { rec.frame = source.page.url().replace(/([?&]token=)[^&#]*/g, '$1<masked>') } catch (e) { /* ignore */ }
            write(rec)
        }
        catch (err) { /* ignore */ }
    })
    context.addInitScript(() => {
        let osend = XMLHttpRequest.prototype.send
        let oopen = XMLHttpRequest.prototype.open
        XMLHttpRequest.prototype.open = function(m, u) { this.__ncUrl = String(u); return oopen.apply(this, arguments) }
        let report = (u8, url) => {
            let s = ''
            for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000))
            window.__netcapSend(btoa(s), url)
        }
        XMLHttpRequest.prototype.send = function(body) {
            try {
                if (this.__ncUrl && this.__ncUrl.includes('/api') && body && window.__netcapSend) {
                    if (body instanceof ArrayBuffer) report(new Uint8Array(body), this.__ncUrl)
                    else if (ArrayBuffer.isView(body)) report(new Uint8Array(body.buffer, body.byteOffset, body.byteLength), this.__ncUrl)
                    else if (typeof Blob !== 'undefined' && body instanceof Blob) { let u = this.__ncUrl; body.arrayBuffer().then((ab) => report(new Uint8Array(ab), u)) }
                }
            }
            catch (e) { /* ignore */ }
            return osend.apply(this, arguments)
        }
    })
    context.on('request', (req) => {
        let u = new URL(req.url())
        let isApi = u.pathname.includes('/api')
        if (!isApi) return
        let rec = { phase: 'req', method: req.method(), path: u.pathname, hasQueryToken: u.searchParams.has('token') }
        let hdr = req.headers()
        let auth = hdr['authorization']
        rec.auth = auth === undefined ? 'absent' : (/^Bearer\s*$/.test(auth) ? 'Bearer-empty' : 'Bearer-nonempty')
        let page = ''
        try { page = req.frame().url() } catch (e) { /* ignore */ }
        rec.frame = page.replace(/([?&]token=)[^&#]*/g, '$1<masked>')
        if (req.method() === 'POST') {
            let b = req.postDataBuffer()
            rec.dbg = { ct: hdr['content-type'], len: b ? b.length : null, head: b ? Buffer.from(b).subarray(0, 24).toString('hex') : null }
            if (b) {
                let o = safeDecode(b)
                rec.func = o && o.func
                let inp = o && o.input
                if (inp && typeof inp === 'object') {
                    rec.inputKeys = Object.keys(inp)
                    rec.sysToken = maskTok(inp.__sysToken__)
                    if (Array.isArray(inp.__sysInputArgs__)) rec.nArgs = inp.__sysInputArgs__.length
                    if (rec.func === '[sys:polling]') rec.pollingInput = summarize(inp)
                }
                if (!rec.func) rec.decoded = summarize(o)
            }
        }
        reqInfo.set(req, rec)
        write(rec)
    })
    context.on('response', async (res) => {
        let req = res.request()
        let rec0 = reqInfo.get(req)
        if (!rec0) return
        let rec = { phase: 'res', func: rec0.func, path: rec0.path, status: res.status() }
        try {
            let ct = res.headers()['content-type'] || ''
            let body = await res.body()
            rec.bytes = body.length
            if (ct.includes('octet-stream')) {
                let o = safeDecode(body)
                rec.resp = summarize(o)
            }
            else {
                rec.ct = ct
            }
        }
        catch (err) {
            rec.bodyErr = String(err && err.message || err).slice(0, 80)
        }
        write(rec)
    })
}

//預載模式
if (process.env.NETCAP_OUT && process.argv.some((a) => /mocha/i.test(String(a)))) {
    let { chromium } = await import('playwright')
    let orig = chromium.launch.bind(chromium)
    chromium.launch = async (...a) => {
        let b = await orig(...a)
        let nc = b.newContext.bind(b)
        b.newContext = async (...x) => {
            let ctx = await nc(...x)
            installNetcap(ctx, { out: process.env.NETCAP_OUT, label: process.env.NETCAP_LABEL || '' })
            return ctx
        }
        let np = b.newPage.bind(b)
        b.newPage = async (...x) => {
            let p = await np(...x)
            installNetcap(p.context(), { out: process.env.NETCAP_OUT, label: process.env.NETCAP_LABEL || '' })
            return p
        }
        return b
    }
}
