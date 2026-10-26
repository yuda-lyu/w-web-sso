//unit-usersRedir.test.mjs — 後台使用者清單之 redir(登入後轉址)檢查 (R-VAL-02, ADR-094; sso-run04 第 116 項)
//
// 依據:
//   - spec/流程_後台變更使用者資訊.md E2E-007(redir 改空攔下)、E2E-016(載入時即為空之既有列不擋存檔)與〈規則摘要〉redir 列
//   - spec/流程_後台新增使用者.md E2E-008(新增列 redir 空攔下)
//   - spec/流程_使用者創建帳密.md〈自助註冊者之 redir〉: 註冊流程不收 redir, 預設空字串(設計事實)
//   - 原則 3「一列之既有資料問題不得擋住整份清單之存檔而無提示」
// 規則: 系統管理者本次新增 / 由非空改為空者攔下(該列 redir 格警示); 載入時即為空之既有列不擋、不標警示; 基準有效而列不在其中且非新增者嚴格檢查;
//   基準算不出(null)時只檢查新增列(此時 baseline 亦為 null, 後端無基準之存檔一律拒收並提示重新載入; 外審 sol#4).
// 前端元件 LayoutContentUsers.vue 以同一模組判定(UR-W01~W03 靜態守護接線); 基準以 Map 存於 Vue data(外審 sol#3: 純物件被 Vue 2 響應式處理會以 `__ob__` 鍵覆蓋同名主鍵之值).

import assert from 'assert'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import Vue from 'vue'
import { redirOrigOfUsers, redirErrIdsOfUsers } from '../src/usersRedirCheck.mjs'


let __dirname = path.dirname(fileURLToPath(import.meta.url))
let REDIR = 'http://localhost:8080/?view=user&token={token}'


//載入時畫面所見之列: a、b 有 redir; s 為自助註冊者(redir 空)
let loaded = () => [
    { id: 'a', account: 'a', redir: REDIR },
    { id: 'b', account: 'b', redir: REDIR },
    { id: 's', account: 's', redir: '' },
]
let ids = (o) => Object.keys(o).sort()


describe('後台使用者清單 redir 檢查 (R-VAL-02)', function() {

    it('UR-U-001 載入後未改: 自助註冊者(載入時 redir 空)不攔下、不標警示 → 其他列之存檔不被擋', function() {
        let rows = loaded()
        assert.deepStrictEqual(ids(redirErrIdsOfUsers(rows, redirOrigOfUsers(loaded()))), [])
    })

    it('UR-U-002 系統管理者改他列欄位(redir 不動)、自助註冊者仍空 → 不攔下', function() {
        let rows = loaded()
        rows[0].account = 'a-renamed'
        assert.deepStrictEqual(ids(redirErrIdsOfUsers(rows, redirOrigOfUsers(loaded()))), [])
    })

    it('UR-U-003 既有列 redir 由非空改為空(E2E-007) → 只攔下該列, 自助註冊者不連帶被標', function() {
        let rows = loaded()
        rows[0].redir = ''
        assert.deepStrictEqual(ids(redirErrIdsOfUsers(rows, redirOrigOfUsers(loaded()))), ['a'])
    })

    it('UR-U-004 新增列 redir 空(E2E-008) → 攔下該新增列; 同一批中自助註冊者仍不被標', function() {
        let rows = loaded()
        rows.push({ id: 'n1', account: 'n1', redir: '', _isNew: true })
        assert.deepStrictEqual(ids(redirErrIdsOfUsers(rows, redirOrigOfUsers(loaded()))), ['n1'])
    })

    it('UR-U-005 新增列 redir 有值 → 合規', function() {
        let rows = loaded()
        rows.push({ id: 'n1', account: 'n1', redir: REDIR, _isNew: true })
        assert.deepStrictEqual(ids(redirErrIdsOfUsers(rows, redirOrigOfUsers(loaded()))), [])
    })

    it('UR-U-006 自助註冊者列由系統管理者補上 redir → 合規; 補上後又改回空 → 與載入值相同, 視為未動, 不攔下', function() {
        let rows = loaded()
        rows[2].redir = REDIR
        assert.deepStrictEqual(ids(redirErrIdsOfUsers(rows, redirOrigOfUsers(loaded()))), [])
        rows[2].redir = ''
        assert.deepStrictEqual(ids(redirErrIdsOfUsers(rows, redirOrigOfUsers(loaded()))), [])
    })

    it('UR-U-007 自助註冊者列補上 redir 後改為其他值再清空(非空→空以載入值為準)仍屬載入時即為空 → 不攔下; 但有值之既有列清空 → 攔下', function() {
        let rows = loaded()
        rows[2].redir = 'x'
        rows[2].redir = ''
        rows[1].redir = ''
        assert.deepStrictEqual(ids(redirErrIdsOfUsers(rows, redirOrigOfUsers(loaded()))), ['b'])
    })

    it('UR-U-008 基準有效而列不在基準內且非新增 → 嚴格檢查(空即攔下)', function() {
        assert.deepStrictEqual(ids(redirErrIdsOfUsers([{ id: 'z', redir: '' }], redirOrigOfUsers(loaded()))), ['z'])
    })

    it('UR-U-008b 基準算不出(null / 非 Map, 如存檔成功後重新讀取失敗; 外審 sol#4): 只檢查新增列, 既有列(含自助註冊者)不檢查——此時 baseline 亦為 null, 後端無基準一律拒收並提示重新載入', function() {
        let rows = loaded()
        rows[0].redir = '' //既有非空列被清空: 無基準無從判定載入時原值, 交由後端拒收(saveBaselineFormat)
        rows.push({ id: 'n1', account: 'n1', redir: '', _isNew: true })
        for (let orig of [null, undefined, {}, [], 'x']) {
            assert.deepStrictEqual(ids(redirErrIdsOfUsers(rows, orig)), ['n1'], `orig=${JSON.stringify(orig)}`)
        }
    })

    it('UR-U-009 redir 缺欄 / 非字串 / 空白字串之判定與 isestr 一致(缺欄與 null 視為空; 全空白字串之判定同 wsemi isestr)', function() {
        let orig = redirOrigOfUsers([{ id: 'p', redir: REDIR }, { id: 'q', redir: REDIR }])
        assert.deepStrictEqual(ids(redirErrIdsOfUsers([{ id: 'p' }, { id: 'q', redir: null }], orig)), ['p', 'q'])
    })

    it('UR-U-010 鍵安全(R-KEY-01): 列主鍵為 __proto__ / constructor / toString 等原型鍵名時不誤判、不污染原型', function() {
        let names = ['__proto__', 'constructor', 'toString', 'hasOwnProperty']
        let rowsLoaded = names.map((id) => ({ id, redir: id === 'toString' ? '' : REDIR }))
        let orig = redirOrigOfUsers(rowsLoaded)
        assert.ok(orig instanceof Map, '基準為 Map(不被 Vue 響應式處理, 無原型鍵衝突)')
        let rows = names.map((id) => ({ id, redir: id === 'toString' ? '' : REDIR }))
        assert.deepStrictEqual(ids(redirErrIdsOfUsers(rows, orig)), [], '未動之列不攔下(含載入時即為空之 toString)')
        rows[0].redir = ''
        let errs = redirErrIdsOfUsers(rows, orig)
        assert.strictEqual(Object.getPrototypeOf(errs), null)
        assert.deepStrictEqual(Object.keys(errs), ['__proto__'])
        assert.strictEqual({}.polluted, undefined)
    })

    it('UR-U-014 基準經 Vue 2 data 後仍正確(外審 sol#3): 列主鍵為 `__ob__` 等之列, 載入時非空 → 清空須攔下(純物件基準會被響應式之 Observer 覆蓋而誤判為載入時即空)', function() {
        let names = ['__ob__', '__proto__', 'constructor']
        let rowsLoaded = names.map((id) => ({ id, redir: REDIR }))
        let vm = new Vue({ data: { redirOrig: null } })
        vm.redirOrig = redirOrigOfUsers(rowsLoaded) //同元件: 載入後賦值於 data
        let rows = names.map((id) => ({ id, redir: REDIR }))
        assert.deepStrictEqual(ids(redirErrIdsOfUsers(rows, vm.redirOrig)), [], '未動不攔')
        for (let k of names) {
            let rs = names.map((id) => ({ id, redir: id === k ? '' : REDIR }))
            assert.deepStrictEqual(ids(redirErrIdsOfUsers(rs, vm.redirOrig)), [k], `${k} 清空須攔下`)
        }
        //對照(證明此測試抓得到舊作法): 同樣之基準若為純物件, 經 Vue 2 data 後 `__ob__` 鍵之值被 Observer 覆蓋
        let plain = Object.create(null)
        for (let r of rowsLoaded) {
            plain[r.id] = r.redir
        }
        let vm2 = new Vue({ data: { o: null } })
        vm2.o = plain
        assert.notStrictEqual(typeof vm2.o.__ob__, 'string', '純物件之 __ob__ 鍵值已被 Vue 覆蓋為 Observer')
    })

    it('UR-U-012 新增列標記優先: _isNew 之列即使其主鍵碰巧與載入時某空 redir 列相同, 仍依新增列處置(空即攔下)', function() {
        let rows = loaded()
        rows[2] = { id: 's', account: 'again', redir: '', _isNew: true }
        assert.deepStrictEqual(ids(redirErrIdsOfUsers(rows, redirOrigOfUsers(loaded()))), ['s'])
    })

    it('UR-U-013 基準隨存檔後重讀更新(外審 nemotron#3 補): 系統管理者補上 redir 並存檔成功後, 重讀之基準為有值; 其後再把該列清空 → 攔下(不再屬載入時即為空)', function() {
        //存檔成功後重讀: s 已有值
        let reloaded = loaded()
        reloaded[2].redir = REDIR
        let orig2 = redirOrigOfUsers(reloaded)
        let rows = loaded()
        rows[2].redir = '' //系統管理者又把 s 清空
        assert.deepStrictEqual(ids(redirErrIdsOfUsers(rows, orig2)), ['s'])
        //對照: 未重讀(仍用載入時之舊基準)則視為載入時即為空, 不攔——元件於存檔成功後必重讀並更新基準(UR-W02)
        assert.deepStrictEqual(ids(redirErrIdsOfUsers(rows, redirOrigOfUsers(loaded()))), [])
    })

    it('UR-U-011 輸入形狀: rows 非陣列 → 無錯誤、不拋例外', function() {
        assert.deepStrictEqual(ids(redirErrIdsOfUsers(undefined, null)), [])
        assert.deepStrictEqual(ids(redirErrIdsOfUsers('x', {})), [])
        assert.deepStrictEqual(ids(redirOrigOfUsers(undefined)), [])
    })

})


describe('LayoutContentUsers.vue 接線 (靜態守護; R-VAL-02)', function() {

    let src = fs.readFileSync(path.join(__dirname, '..', 'src', 'components', 'LayoutContentUsers.vue'), 'utf8')

    it('UR-W01 引用 usersRedirCheck 模組, errItemsByRedir 以其判定(不自行對全部列檢查 redir 空值)', function() {
        assert.ok(/from '\.\.\/usersRedirCheck\.mjs'/.test(src), '須 import ../usersRedirCheck.mjs')
        assert.ok(/redirErrIdsOfUsers\(/.test(src), 'errItemsByRedir 須呼叫 redirErrIdsOfUsers')
        let m = src.match(/errItemsByRedir: function\(\) \{([\s\S]*?)\n        \},/)
        assert.ok(m, '找到 errItemsByRedir')
        assert.ok(!/isestr\(redir\)/.test(m[1]), 'errItemsByRedir 不得自行逐列 isestr(redir) 檢查')
    })

    it('UR-W02 載入與存檔成功後重新讀取皆以同一快照更新比對基準 redirOrig(去除行尾註解後計數, 註解不算接線; 外審 sol#6); 重新讀取失敗則清為 null', function() {
        let code = src.split(/\r?\n/).map((l) => l.replace(/\s\/\/.*$/, '')).join('\n')
        assert.strictEqual((code.match(/vo\.redirOrig = redirOrigOfUsers\(res\)/g) || []).length, 2, '兩處(載入、存檔後重讀)')
        assert.strictEqual((code.match(/vo\.redirOrig = null/g) || []).length, 1, '重新讀取失敗須清空基準')
        //兩處賦值各與 baseline 賦值相鄰(同一快照): 載入處與存檔後重讀處之前一行皆為 baselineOfUsers(res)
        let lines = code.split('\n').map((l) => l.trim())
        let idx = lines.map((l, i) => (l === 'vo.redirOrig = redirOrigOfUsers(res)' ? i : -1)).filter((i) => i >= 0)
        assert.strictEqual(idx.length, 2)
        for (let i of idx) {
            assert.ok(/^vo\.baseline = baselineOfUsers\(res\)/.test(lines[i - 1]), `redirOrig 賦值之前一行須為 baseline 賦值(同一快照), 實際: ${lines[i - 1]}`)
        }
    })

    it('UR-W03 redir 儲存格之警示以列主鍵查詢(cellRedirErr), 不再以 redir 值為鍵(空值會讓所有空 redir 儲存格同時被標)', function() {
        assert.ok(/cellRedirErr\(\$ui\.gv\(props\.row, 'id'\)\)/.test(src), 'redir 儲存格須以列 id 查警示')
        assert.ok(!/cellFieldErr\('redir'/.test(src), 'redir 不得再走以值為鍵之 cellFieldErr')
    })

})
