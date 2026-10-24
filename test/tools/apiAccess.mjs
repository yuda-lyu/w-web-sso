//apiAccess.mjs — 存取矩陣與應用系統金鑰用途類 api 測試之共用夾具與輔助 (api-accessmatrix / api-apptoken-usage; ADR-095)
//
// 呼叫者 7 類(dspec w-web存取管控表.md〇): 無 token、使用者 token 一般(U)、使用者 token 管理員(A)、
// 應用系統 token・使用者用途綁一般使用者(AU-U)、綁管理員(AU-A)、系統服務用途具全部 perms(AS+)、僅基本權限(AS-).
// fixture 以直寫庫建立(測試行程與後端共用同一 LMDB), 鑄造 API 本身由 api-apptoken-usage 另測.

import { woItems } from '../../g_mOrm.mjs'
import ds from '../../src/schema/index.mjs'
import { apiUrl, callFapi } from './api-setup.mjs'


let PERMS_ALL = ['readUsers', 'writeUsers', 'readTokens', 'writeTokens', 'readIps', 'writeIps', 'readStats']
let NEW_PW = 'Zq#8765Wm'


//callers: admin 為其代表之使用者角色(U/A/AU 依(所綁)使用者, AS 無)
let callers = [
    { key: 'none', kind: 'none', token: '', admin: false },
    { key: 'U', kind: 'user', token: 'token-for-viewer', admin: false, userId: 'id-for-viewer', account: 'ac-viewer', pw: 'pw-viewer' },
    { key: 'A', kind: 'user', token: 'token-for-admin', admin: true, userId: 'id-for-admin', account: 'ac-admin', pw: 'pw-admin' },
    { key: 'AU-U', kind: 'appUser', token: 'm-au-u', admin: false, userId: 'id-for-viewer', account: 'ac-viewer', pw: 'pw-viewer' },
    { key: 'AU-A', kind: 'appUser', token: 'm-au-a', admin: true, userId: 'id-for-admin', account: 'ac-admin', pw: 'pw-admin' },
    { key: 'AS+', kind: 'appSystem', token: 'm-as-all', admin: false, perms: PERMS_ALL },
    { key: 'AS-', kind: 'appSystem', token: 'm-as-base', admin: false, perms: [] },
]


//mkAppToken: 應用系統金鑰列(不給期限: timeEnd 為 ''); usage 為 'user' | 'system' | undefined(既有列, 不寫用途與名稱欄)
function mkAppToken(id, token, userId, usage, name, perms) {
    let t = ds.tokens.funNew({ userId, isApp: 'y', perms })
    t.id = id
    t.token = token
    t.timeEnd = ''
    if (usage === undefined) {
        delete t.appUsage
        delete t.appName
    }
    else {
        t.appUsage = usage
        t.appName = name
    }
    return t
}


//insertFixtures: 建立者(一般使用者, 證明系統服務用途之授權不來自建立者)、重設密碼目標、各用途金鑰、探針金鑰、一筆 ip
async function insertFixtures(targetId = 'id-m-target') {
    let creator = ds.users.funNew({ order: 800, account: 'ac-creator', password: 'not-used', name: 'creator', email: 'creator@example.com', description: 'desc-orig', from: 'test', redir: '', isAdmin: 'n' })
    creator.id = 'id-creator'
    creator.timeVerified = '2025-01-01T00:00:00.000+08:00'
    let target = ds.users.funNew({ order: 801, account: `ac-${targetId}`, password: 'not-used', name: targetId, email: `${targetId}@example.com`, description: 'desc-orig', from: 'test', redir: '', isAdmin: 'n' })
    target.id = targetId
    target.timeVerified = '2025-01-01T00:00:00.000+08:00'
    await woItems.users.insert([creator, target])

    await woItems.tokens.insert([
        mkAppToken('id-m-au-u', 'm-au-u', 'id-for-viewer', 'user', 'au-viewer', []),
        mkAppToken('id-m-au-a', 'm-au-a', 'id-for-admin', 'user', 'au-admin', []),
        mkAppToken('id-m-as-all', 'm-as-all', 'id-creator', 'system', 'as-all-name', PERMS_ALL),
        mkAppToken('id-m-as-base', 'm-as-base', 'id-creator', 'system', 'as-base-name', []),
        mkAppToken('id-m-probe', 'm-probe', 'id-creator', 'system', 'probe', []),
    ])

    let ip = ds.ips.funNew({ ip: '192.0.2.10', timeBlocked: '' })
    ip.id = 'id-m-ip'
    await woItems.ips.insert([ip])
}


//httpApi: HTTP GET → 對齊 callFapi 之 { ok, val, err }
async function httpApi(route, params) {
    let q = new URLSearchParams(params).toString()
    let res = await fetch(`${apiUrl}/api/${route}?${q}`)
    let body = await res.json()
    if (body.state === 'success') {
        return { ok: true, val: body.msg }
    }
    return { ok: false, err: typeof body.msg === 'string' ? body.msg : JSON.stringify(body.msg) }
}


//getRowsForSave: 比照後台前端, 清單不含 password(後端存回時自 DB 補回)
async function getRowsForSave(tableName) {
    let rs = await woItems[tableName].select()
    return rs.map((r) => {
        let v = { ...r }
        delete v.password
        return v
    })
}


//usable: 該 token 此刻是否可通過 checkToken(HTTP 與 kpfun 兩者須一致)
async function usable(token) {
    let a = await httpApi('checkToken', { token })
    let b = await callFapi('checkToken', [token])
    if (a.ok !== b.ok) {
        throw new Error(`HTTP 與 kpfun checkToken 不一致: ${JSON.stringify(a)} / ${JSON.stringify(b)}`)
    }
    return a.ok
}


export { PERMS_ALL, NEW_PW, callers, mkAppToken, insertFixtures, httpApi, getRowsForSave, usable }
