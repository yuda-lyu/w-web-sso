//unit-ignoredOrmKeys.test.mjs — w-serv-orm 已移除之使用者檢查設定之忽略判定 (R-ORM-02, ADR-083 / ADR-085)
//
// 依據: CLAUDE_rulebook.md R-ORM-02; spec/設計要點與取捨.md ADR-085
//   - 本套件不轉交 useCheckUser、getUserById、useExcludeWhenNotAdmin(WServOrm 不傳 opt)
//   - settings / optExt 給予「上游會拒絕之值」者列出(供啟動時記警告), 依 useCheckUser、getUserById、useExcludeWhenNotAdmin 之序; undefined、null、false 不列
//   - 判準與上游一致: 列出 ⇔ w-serv-orm 以該值建構會拋錯(若轉交即啟動失敗之值)

import assert from 'assert'
import getMapOrm from 'w-serv-orm/src/getMapOrm.mjs'
import getProc from 'w-serv-orm/src/getProc.mjs'
import ds from '../src/schema/index.mjs'
import getIgnoredOrmKeys from '../server/getIgnoredOrmKeys.mjs'


let KEYS = ['useCheckUser', 'getUserById', 'useExcludeWhenNotAdmin']
//上游接受(視同未給)之值
let ACCEPTED = [['undefined', undefined], ['null', null], ['false', false]]
//上游拒絕之值: 布林 true、非布林(字串、數字、空字串)、函數、物件、陣列
let REJECTED = [['true', true], ['字串 true', 'true'], ['字串 false', 'false'], ['0', 0], ['1', 1], ['空字串', ''], ['函數', async () => null], ['{}', {}], ['[]', []]]


describe('getIgnoredOrmKeys - w-serv-orm 已移除之使用者檢查設定之忽略判定 (R-ORM-02, ADR-085)', function() {

    it('IOK-001 未給或給 undefined / null / false(各鍵與三鍵同給): 不列任何鍵', function() {
        //spec: undefined、null、false 不列
        let opts = [undefined, {}]
        for (let [, v] of ACCEPTED) {
            opts.push({ useCheckUser: v, getUserById: v, useExcludeWhenNotAdmin: v })
            for (let k of KEYS) {
                opts.push({ [k]: v })
            }
        }
        opts.push({ useCheckUser: false, getUserById: null, useExcludeWhenNotAdmin: false }) //2026-10-12 版固定交出之值
        for (let opt of opts) {
            assert.deepStrictEqual(getIgnoredOrmKeys(opt), [], String(JSON.stringify(opt)))
        }
    })

    for (let [i, k] of KEYS.entries()) {
        it(`IOK-00${i + 2} ${k} 給上游會拒絕之 ${REJECTED.length} 種值: 列出 ['${k}']`, function() {
            //spec: 上游會拒絕之值列出
            for (let [label, v] of REJECTED) {
                assert.deepStrictEqual(getIgnoredOrmKeys({ [k]: v }), [k], label)
            }
        })
    }

    it('IOK-005 三鍵皆給: 依 useCheckUser、getUserById、useExcludeWhenNotAdmin 之序列出; 不改動輸入物件; 其他鍵不影響', function() {
        let fn = async () => null
        let opt = { useExcludeWhenNotAdmin: true, getUserById: fn, useCheckUser: 'true', serverPort: 11007 }
        assert.deepStrictEqual(getIgnoredOrmKeys(opt), ['useCheckUser', 'getUserById', 'useExcludeWhenNotAdmin'])
        assert.deepStrictEqual(Object.keys(opt), ['useExcludeWhenNotAdmin', 'getUserById', 'useCheckUser', 'serverPort'])
        assert.strictEqual(opt.useCheckUser, 'true')
        assert.strictEqual(opt.getUserById, fn)
        assert.strictEqual(opt.serverPort, 11007)
        //只給部分者只列該部分
        assert.deepStrictEqual(getIgnoredOrmKeys({ useCheckUser: true, getUserById: null, useExcludeWhenNotAdmin: true }), ['useCheckUser', 'useExcludeWhenNotAdmin'])
    })

    it('IOK-006 opt 非物件(null、字串、數字、陣列): 回空陣列且不拋錯', function() {
        for (let opt of [null, 'useCheckUser', 1, [], [true]]) {
            assert.deepStrictEqual(getIgnoredOrmKeys(opt), [], String(JSON.stringify(opt)))
        }
    })

    it('IOK-007 判準與上游一致: 三鍵 × 12 種值, 列出 ⇔ w-serv-orm 之 getProc 以該值建構會拋錯', function() {
        //spec: 警告恰為「若轉交即被上游拒絕」之值; 以上游之公開建構函式(getProc, 與 WServOrm 同一檢查)為判準
        let mapOrm = getMapOrm(ds, {})
        let n = 0
        for (let k of KEYS) {
            for (let [label, v] of [...ACCEPTED, ...REJECTED]) {
                let upstreamRejects = false
                try {
                    getProc(mapOrm, { [k]: v })
                }
                catch (err) {
                    upstreamRejects = true
                }
                assert.strictEqual(getIgnoredOrmKeys({ [k]: v }).includes(k), upstreamRejects, `${k}=${label}`)
                n++
            }
        }
        assert.strictEqual(n, 36)
    })

})
