//unit-optWServOrm.test.mjs — WServOrm 之設定由 getOptWServOrm 固定 (ADR-083)
//
// 依據: spec/設計要點與取捨.md ADR-083
//   - 交予 WServOrm 之設定恆為 useCheckUser:false、getUserById:null、useExcludeWhenNotAdmin:false(本套件不開放 ORM 通道, 寫入授權由各功能自行負責)
//   - settings / optExt 仍給予非預設值者列為忽略(供啟動時記警告); w-serv-orm 對非布林之 useCheckUser 預設為 true, 故非布林亦不得交出
//   - 以所得設定建立之真 procOrm, 本套件各寫入點所傳之 userId 皆照常寫入(新使用者自身 id、管理者 id、應用系統金鑰之虛擬 id、金鑰 / IP 清單之空字串)

import assert from 'assert'
import getMapOrm from 'w-serv-orm/src/getMapOrm.mjs'
import getProc from 'w-serv-orm/src/getProc.mjs'
import ds from '../src/schema/index.mjs'
import getOptWServOrm from '../server/getOptWServOrm.mjs'


let FIXED = { useCheckUser: false, getUserById: null, useExcludeWhenNotAdmin: false }


describe('getOptWServOrm - WServOrm 之設定固定且列出被忽略之鍵 (ADR-083)', function() {

    it('OPT-001 未給或給預設值: 設定固定, 無忽略項', function() {
        for (let opt of [undefined, {}, { ...FIXED }, { useCheckUser: undefined, getUserById: undefined, useExcludeWhenNotAdmin: undefined }]) {
            let r = getOptWServOrm(opt)
            assert.deepStrictEqual(r.optWServOrm, FIXED, JSON.stringify(opt))
            assert.deepStrictEqual(r.ignored, [], JSON.stringify(opt))
        }
    })

    it('OPT-002 useCheckUser 為 true 或非布林(null、字串、數字): 交出者仍為 false, 列為忽略', function() {
        for (let v of [true, null, 'true', 'false', 1, 0]) {
            let r = getOptWServOrm({ useCheckUser: v })
            assert.strictEqual(r.optWServOrm.useCheckUser, false, JSON.stringify(v))
            assert.deepStrictEqual(r.ignored, ['useCheckUser'], JSON.stringify(v))
        }
    })

    it('OPT-003 getUserById 為函數(或其他非 null 值): 交出者為 null, 列為忽略', function() {
        for (let v of [async () => ({ id: 'x', isActive: 'y' }), 'fun']) {
            let r = getOptWServOrm({ getUserById: v })
            assert.strictEqual(r.optWServOrm.getUserById, null)
            assert.deepStrictEqual(r.ignored, ['getUserById'])
        }
    })

    it('OPT-004 useExcludeWhenNotAdmin 為 true 或非布林: 交出者為 false, 列為忽略', function() {
        for (let v of [true, null, 'true']) {
            let r = getOptWServOrm({ useExcludeWhenNotAdmin: v })
            assert.strictEqual(r.optWServOrm.useExcludeWhenNotAdmin, false, JSON.stringify(v))
            assert.deepStrictEqual(r.ignored, ['useExcludeWhenNotAdmin'], JSON.stringify(v))
        }
    })

    it('OPT-005 三鍵皆給: 交出者固定, 依 useCheckUser、getUserById、useExcludeWhenNotAdmin 之序列出; 不改動輸入物件', function() {
        let opt = { useCheckUser: true, getUserById: async () => null, useExcludeWhenNotAdmin: true, serverPort: 11007 }
        let r = getOptWServOrm(opt)
        assert.deepStrictEqual(r.optWServOrm, FIXED)
        assert.deepStrictEqual(r.ignored, ['useCheckUser', 'getUserById', 'useExcludeWhenNotAdmin'])
        assert.strictEqual(opt.useCheckUser, true)
        assert.strictEqual(opt.serverPort, 11007)
    })

    it('OPT-006 以所得設定建立之真 procOrm: 部署方給予 useCheckUser:true 時, 本套件各寫入點所傳之 userId 皆照常寫入', async function() {
        let mk = () => ({
            select: async () => [],
            insert: async (d) => ({ n: d.length, nInserted: d.length, ok: 1 }),
            save: async (d) => d.map(() => ({ n: 1, nInserted: 0, nModified: 1, ok: 1 })),
            del: async (d) => d.map(() => ({ n: 1, nDeleted: 1, ok: 1 })),
        })
        let woItems = { users: mk(), tokens: mk(), ips: mk() }
        let { optWServOrm } = getOptWServOrm({ useCheckUser: true, getUserById: async () => null })
        let { procOrm } = getProc(getMapOrm(ds, woItems), optWServOrm)
        //各寫入點之 userId: server/procCore.mjs createUser(新使用者自身 id)、updateTabItems(使用者清單之操作者; 金鑰 / IP 清單未傳操作者為 '')
        let calls = [
            ['createUser', 'u-new-self', 'users', 'insert', [{ id: 'u-new-self', account: 'a', email: 'a@x.y' }]],
            ['使用者清單(管理者)', 'id-for-admin', 'users', 'save', [{ id: 'u-1', name: 'n' }]],
            ['使用者清單(應用系統金鑰之虛擬 id)', 'id-for-app', 'users', 'del', [{ id: 'u-2' }]],
            ['金鑰清單', '', 'tokens', 'del', [{ id: 't-1' }]],
            ['IP 清單', '', 'ips', 'save', [{ id: 'ip-1', ip: '10.0.0.1' }]],
        ]
        for (let [label, userId, woName, mode, input] of calls) {
            let err = await procOrm(userId, woName, mode, input).then(() => null, (e) => e)
            assert.strictEqual(err, null, `${label}: ${err}`)
        }
    })

})
