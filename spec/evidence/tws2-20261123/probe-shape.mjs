//probe-shape: 同一組輸入分別跑修前之本地實作(HEAD 鏡像根 ./tmp/tws2/pre/)與 wsemi 共用函數, 輸出字樣差異表(結果 shape-diff.json)
//用法: node tmp/tws2/probe-shape.mjs [輸出檔]
import fs from 'fs'
import path from 'path'
import { fileURLToPath, pathToFileURL } from 'url'

const here = path.dirname(fileURLToPath(import.meta.url))
const pre = path.join(here, 'pre')
const old = await import(pathToFileURL(path.join(pre, 'src', 'describeShape.mjs')).href)
const oldLog = await import(pathToFileURL(path.join(pre, 'server', 'srLog.mjs')).href)
const { default: getDiagShape } = await import('wsemi/src/getDiagShape.mjs')
const { default: getDiagBriefErr } = await import('wsemi/src/getDiagBriefErr.mjs')

let mk = (n, v) => ({ n, v })

//形狀摘要輸入(describeShape 與 logType 共用)
let revoked = (() => {
    let r = Proxy.revocable({}, {})
    r.revoke()
    return r.proxy
})()
let circ = { a: 1 }
circ.self = circ
let nullProto = Object.create(null)
nullProto.k = 1
class Foo {
    constructor() {
        this.x = 1
    }
}
let evilKeys = { 'a\nb': 1, 'c\u007fd': 2, 'e\u0085f': 3, 'g h': 4, 'i‮j': 5, 'k​l': 6, 'm﻿n': 7, 'o­p': 8 }
let ownKeysThrow = new Proxy({}, { ownKeys() { throw new Error('boom') } })
let manyKeys = {}
for (let i = 0; i < 25; i++) {
    manyKeys[`k${i}`] = i
}
let shapeInputs = [
    mk('string', 'abc'), mk('empty string', ''), mk('number', 7), mk('NaN', NaN), mk('boolean', true), mk('function', () => 1), mk('bigint', 10n), mk('symbol', Symbol('s')),
    mk('null', null), mk('undefined', undefined), mk('array(3)', [1, 2, 3]), mk('empty array', []),
    mk('object', { id: 'u1', name: 'n' }), mk('empty object', {}), mk('null-prototype object', nullProto), mk('class instance', new Foo()), mk('circular', circ),
    mk('25 keys', manyKeys), mk('key len 35', { ['K'.repeat(35)]: 1 }), mk('key len 60', { ['K'.repeat(60)]: 1 }),
    mk('control/format char keys', evilKeys),
    mk('Proxy ownKeys throws', ownKeysThrow), mk('revoked Proxy', revoked),
    mk('Map', new Map([['a', 1]])), mk('Set', new Set([1])), mk('Uint8Array', new Uint8Array(4)), mk('Date', new Date(0)), mk('RegExp', /x/), mk('Promise', Promise.resolve(1)), mk('Error object', new Error('x')), mk('boxed String', new String('abc')), mk('WeakMap', new WeakMap()),
]

let rows = []
//呼叫舊函數, 拋錯者記為 THROWS(舊 logType 對已撤銷之 Proxy 同步拋 TypeError)
let call = (fn, v) => {
    try {
        return fn(v)
    }
    catch (err) {
        return `THROWS ${err && err.name}`
    }
}
for (let { n, v } of shapeInputs) {
    let oldShape = call(old.describeShape, v)
    let oldLogType = call(oldLog.logType, v)
    let nw = getDiagShape(v)
    rows.push({ kind: 'shape', input: n, 'describeShape(舊,前端)': oldShape, 'logType(舊,伺服端)': oldLogType, 'getDiagShape(新)': nw, sameAsDescribeShape: oldShape === nw, sameAsLogType: oldLogType === nw })
}

//logKey(舊) 對照
for (let [n, k, allowed] of [['logKey 名單內', 'account', ['id', 'account']], ['logKey 名單外字串', 'tokenVerify', ['id', 'account']], ['logKey 空字串', '', ['id', 'account']], ['logKey 陣列', ['id'], ['id', 'account']], ['logKey 名單未給', 'id', undefined]]) {
    rows.push({ kind: 'logKey', input: n, 'logKey(舊)': oldLog.logKey(k, allowed) })
}

//錯誤摘要輸入(describeErr 舊 → getDiagBriefErr 新)
let e1 = new Error('secret msg')
let e2 = new TypeError('x')
let e3 = new Error('x')
e3.code = 'ENOENT'
class Evil extends Error { }
let e4 = new Evil('x')
e4.name = 'ZZ-secret-name'
let errInputs = [mk('Error', e1), mk('TypeError', e2), mk('Error code ENOENT', e3), mk('自訂類別且 name 自設為識別字', e4), mk('字串(含語系鍵)', 'tokenExpired'), mk('null', null), mk('undefined', undefined), mk('{ message }', { message: 'm' }), mk('number', 1), mk('revoked Proxy', revoked)]
for (let { n, v } of errInputs) {
    let oldS = old.describeErr(v)
    let nw = getDiagBriefErr(v)
    rows.push({ kind: 'err', input: n, 'describeErr(舊)': oldS, 'getDiagBriefErr(新)': nw })
}

let out = process.argv[2] || path.join(here, 'evidence', 'shape-diff.json')
fs.mkdirSync(path.dirname(out), { recursive: true })
fs.writeFileSync(out, JSON.stringify(rows, null, 2), 'utf8')
for (let r of rows) {
    console.log(JSON.stringify(r))
}
console.log(`wrote ${rows.length} rows -> ${path.relative(process.cwd(), out)}`)
