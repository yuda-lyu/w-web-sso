import assert from 'assert'
import fs from 'fs'
import { fileURLToPath } from 'url'
import each from 'lodash-es/each.js'
import procLang from '../server/procLang.mjs'
import ds from '../src/schema/index.mjs'


//舊用詞(員字版)與單獨之「管理」+「者」以 Unicode 跳脫表示, 使本檔本身不含該字串(專案以 git grep 檢查用詞統一)
let reOld = new RegExp('\\u7ba1\\u7406\\u54e1') //舊用詞: 「管理」+「員」
let reBare = new RegExp('(?<!\\u7cfb\\u7d71)\\u7ba1\\u7406\\u8005') //前面沒有「系統」之「管理」+「者」


describe('使用者可見文字 - 角色用詞統一為「系統管理者」', function() {
    //spec: 全系統之角色名稱統一為「系統管理者」(使用者裁定 2026-10-26, Gitea issue #17; sso-run01 schema 欄位名, sso-run02 全面統一):
    //指系統管理者角色之詞一律為「系統管理者」, 不得出現舊用詞(員字版)或未加「系統」前綴之單獨用詞;
    //schema 欄位 name(經 w-data-collector build 成為 kpHead)須與畫面語系字典同欄位之 cht 文字一致

    // SL-1: users.isAdmin 之 schema name 與畫面語系字典同欄位一致
    it('SL-1: users.isAdmin 之 schema name 等於語系字典 isAdmin 之 cht, 且為「是否為系統管理者」', function() {
        let r = procLang({})
        assert.strict.equal(ds.users.kpHead.isAdmin, r.cht.isAdmin)
        assert.strict.equal(ds.users.kpHead.isAdmin, '是否為系統管理者')
    })

    // SL-2: 三表所有欄位之 schema name 符合統一用詞
    it('SL-2: ips / tokens / users 所有欄位之 schema name 不含舊用詞, 亦無未加「系統」前綴之單獨用詞', function() {
        let n = 0
        each(ds, (t, keyTable) => {
            each(t.kpHead, (name, key) => {
                n++
                assert.strict.ok(!reOld.test(name), `${keyTable}.${key} 之 schema name 含舊用詞: ${name}`)
                assert.strict.ok(!reBare.test(name), `${keyTable}.${key} 之 schema name 含未加「系統」前綴之單獨用詞: ${name}`)
            })
        })
        assert.strict.ok(n > 0, '應至少掃到一個欄位名稱')
    })

    // SL-3: 語系字典 cht 全部文字符合統一用詞(畫面訊息、提示、信件預設文字)
    it('SL-3: 語系字典 cht 全部文字不含舊用詞, 亦無未加「系統」前綴之單獨用詞', function() {
        let r = procLang({})
        let n = 0
        each(r.cht, (text, key) => {
            n++
            assert.strict.ok(!reOld.test(String(text)), `cht.${key} 含舊用詞`)
            assert.strict.ok(!reBare.test(String(text)), `cht.${key} 含未加「系統」前綴之單獨用詞`)
        })
        assert.strict.ok(n > 0, '應至少掃到一個語系鍵')
    })

    // SL-4: 部署設定範本 settings.json(信件範本等覆寫文字)符合統一用詞
    it('SL-4: settings.json 全文不含舊用詞, 亦無未加「系統」前綴之單獨用詞', function() {
        let txt = fs.readFileSync(fileURLToPath(new URL('../settings.json', import.meta.url)), 'utf8')
        assert.strict.ok(txt.includes('chpwEmContent'), '應讀到信件範本鍵')
        assert.strict.ok(!reOld.test(txt), 'settings.json 含舊用詞')
        assert.strict.ok(!reBare.test(txt), 'settings.json 含未加「系統」前綴之單獨用詞')
    })

})
