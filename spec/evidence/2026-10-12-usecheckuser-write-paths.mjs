//w-serv-orm 之使用者檢查(useCheckUser)與本套件各寫入點之相容性實測(ADR-083 取證; 2026-10-14 改為各版皆可跑完, ADR-085)
//以真 getProc / getMapOrm 搭配只回成功之假資料表(不碰資料庫), 對各寫入點所傳之 userId 逐一呼叫 procOrm:
//  自助註冊之新使用者自身 id、使用者清單之管理者 id 與應用系統金鑰之虛擬 id、金鑰 / IP 清單之空字串(server/procCore.mjs createUser、updateTabItems)
//設定: S1 useCheckUser:true 未給 getUserById; S2 另給查 users 之 getUserById(部署方之合理實作); S3 useCheckUser 為非布林(null); S0 false(ADR-083 時本套件交出之值)
//執行: node spec/evidence/2026-10-12-usecheckuser-write-paths.mjs
//結果(歷史, 2026-10-12, w-serv-orm 1.1.8): S1 / S3 五者皆拒(invalid getUserById; 金鑰 / IP 清單為 invalid userId); S2 只有使用者清單(管理者 id)通過; S0 五者皆通過
//結果(2026-10-14):
//  - w-serv-orm 1.1.9: 四組五者皆通過(getProc 不收 opt, 設定被靜默忽略)
//  - w-serv-orm 1.1.10: S1、S2 於建構時即拒(opt.useCheckUser has been removed, …); S3(null)、S0(false)視同未給, 五者皆通過
//  - 原於 S1 拋錯即中止, 2026-10-14 起逐組攔下建構期之錯誤並印「建構即拒」, 使各版皆可跑完
//重現舊版結果: npm pack w-serv-orm@1.1.8(或 1.1.9)解壓後, 以 node --import 註冊模組解析 hook 把 'w-serv-orm/src/*' 導向其 src 再執行本檔(不動 node_modules)
import getMapOrm from 'w-serv-orm/src/getMapOrm.mjs'
import getProc from 'w-serv-orm/src/getProc.mjs'
import ds from '../../src/schema/index.mjs'

let users = [{ id: 'id-for-admin', isAdmin: 'y', isActive: 'y' }]
let mk = () => ({
    select: async () => [],
    insert: async (d) => ({ n: d.length, nInserted: d.length, ok: 1 }),
    save: async (d) => d.map(() => ({ n: 1, nInserted: 0, nModified: 1, ok: 1 })),
    del: async (d) => d.map(() => ({ n: 1, nDeleted: 1, ok: 1 })),
})
let woItems = { users: mk(), tokens: mk(), ips: mk() }
let mapOrm = getMapOrm(ds, woItems)

let variants = {
    'S1 useCheckUser:true, getUserById 未給': { useCheckUser: true, getUserById: null, useExcludeWhenNotAdmin: false },
    'S2 useCheckUser:true, getUserById 查 users': { useCheckUser: true, getUserById: async (id) => users.find((u) => u.id === id) || null, useExcludeWhenNotAdmin: false },
    'S3 useCheckUser:null(非布林)': { useCheckUser: null, getUserById: null, useExcludeWhenNotAdmin: false },
    'S0 useCheckUser:false': { useCheckUser: false, getUserById: null, useExcludeWhenNotAdmin: false },
}
let calls = [
    ['W1 createUser(新使用者自身 id)', 'u-new-self', 'users', 'insert', [{ id: 'u-new-self', account: 'a', email: 'a@x.y' }]],
    ['W2 使用者清單(管理者 id)', 'id-for-admin', 'users', 'save', [{ id: 'u-1', name: 'n' }]],
    ['W2 使用者清單(應用系統金鑰之虛擬 id)', 'id-for-app', 'users', 'save', [{ id: 'u-1', name: 'n' }]],
    ['W3 金鑰清單(operatorId 空字串)', '', 'tokens', 'del', [{ id: 't-1' }]],
    ['W4 IP 清單(operatorId 空字串)', '', 'ips', 'save', [{ id: 'ip-1', ip: '10.0.0.1' }]],
]
for (let [vk, opt] of Object.entries(variants)) {
    console.log(`== ${vk}`)
    let procOrm = null
    try {
        procOrm = getProc(mapOrm, opt).procOrm
    }
    catch (err) {
        console.log(`  建構即拒: ${err.message}`)
        continue
    }
    for (let [label, userId, woName, mode, input] of calls) {
        let r = await procOrm(userId, woName, mode, input).then(() => 'ok', (e) => `reject: ${typeof e === 'string' ? e : e.message}`)
        console.log(`  ${label}: ${r}`)
    }
}
