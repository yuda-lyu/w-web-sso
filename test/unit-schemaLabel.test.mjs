import assert from 'assert'
import each from 'lodash-es/each.js'
import procLang from '../server/procLang.mjs'
import ds from '../src/schema/index.mjs'


describe('schema 欄位顯示名稱 - 與畫面語系用詞一致 (角色名稱統一為「系統管理者」)', function() {
    //spec: 全系統之角色名稱統一為「系統管理者」(使用者裁定, w-web-sso issue #17, 2026-10-26);
    //schema 欄位 name(經 w-data-collector build 成為 kpHead)須與畫面語系字典同欄位之 cht 文字一致,
    //使用者看得到之文字(語系字典 cht、schema 欄位名)不得出現「系統管理員」

    // SL-1: users.isAdmin 之 schema name 與畫面語系字典同欄位一致
    it('SL-1: users.isAdmin 之 schema name 等於語系字典 isAdmin 之 cht, 且為「是否為系統管理者」', function() {
        let r = procLang({})
        assert.strict.equal(ds.users.kpHead.isAdmin, r.cht.isAdmin)
        assert.strict.equal(ds.users.kpHead.isAdmin, '是否為系統管理者')
    })

    // SL-2: 三表所有欄位之 schema name 不含舊詞
    it('SL-2: ips / tokens / users 所有欄位之 schema name 皆不含「系統管理員」', function() {
        let n = 0
        each(ds, (t, keyTable) => {
            each(t.kpHead, (name, key) => {
                n++
                assert.strict.ok(!name.includes('系統管理員'), `${keyTable}.${key} 之 schema name 含舊詞: ${name}`)
            })
        })
        assert.strict.ok(n > 0, '應至少掃到一個欄位名稱')
    })

    // SL-3: 語系字典 cht 全部文字不含舊詞
    it('SL-3: 語系字典 cht 全部文字皆不含「系統管理員」', function() {
        let r = procLang({})
        let n = 0
        each(r.cht, (text, key) => {
            n++
            assert.strict.ok(!String(text).includes('系統管理員'), `cht.${key} 含舊詞`)
        })
        assert.strict.ok(n > 0, '應至少掃到一個語系鍵')
    })

})
