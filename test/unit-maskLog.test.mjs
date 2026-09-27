//unit-maskLog.test.mjs — 權杖寫入 log 前之遮罩契約(M 契約; perm / api / task 以同一組測資守護, 見 spec/設計要點與取捨.md ADR-068)
//
// 對象: server/srLog.mjs 之 maskToken / maskUrl / maskKv
// 依據: ADR-068 之 M 契約
//   - maskToken: 空值 → ''; 陣列逐元素; 字串取 k=min(4, floor(n/8)), k=0 只給長度, 否則前 k 後 k + 長度;
//     露出字元之控制字元換成 '?'; 其他型別只給型別, 絕不輸出原值
//   - maskUrl: 只留 origin + pathname (捨棄 query / fragment / userinfo); 無法解析 → '(invalid-url)'
//   - maskKv: key 為 id / account / email / name 時照記, 其餘以 maskToken 遮罩
// 以 namespace import 取函數: 修正前 maskUrl / maskKv 尚不存在, 各案例各自紅, 不因單一 export 缺漏整檔無法載入

import assert from 'assert'
import * as m from '../server/srLog.mjs'


describe('權杖遮罩契約 — maskToken / maskUrl / maskKv (ADR-068 M 契約)', function() {

    it('MASK-001-empty: undefined / null / 空字串 → 空字串', function() {
        assert.strict.equal(m.maskToken(undefined), '')
        assert.strict.equal(m.maskToken(null), '')
        assert.strict.equal(m.maskToken(''), '')
    })

    it('MASK-002-short: 長度 < 8 只給長度, 不露任何字元', function() {
        assert.strict.equal(m.maskToken('abc'), '(len=3)')
        assert.strict.equal(m.maskToken('abcdefg'), '(len=7)')
    })

    it('MASK-003-reveal-by-length: 前後各露 min(4, floor(n/8)) 字', function() {
        assert.strict.equal(m.maskToken('abcdefgh'), 'a...h(len=8)')
        assert.strict.equal(m.maskToken('token-for-app'), 't...p(len=13)')
        assert.strict.equal(m.maskToken('abcdefghijklmnop'), 'ab...op(len=16)')
    })

    it('MASK-004-session-token-compatible: 36 字元 session token 之輸出與既有格式相同', function() {
        assert.strict.equal(m.maskToken('0199a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b'), '0199...4a5b(len=36)')
    })

    it('MASK-005-array: 陣列逐元素遮罩 (Hapi 對重複之 query 參數給陣列)', function() {
        assert.deepStrictEqual(m.maskToken(['abcdefghijklmnop', 'x']), ['ab...op(len=16)', '(len=1)'])
    })

    it('MASK-006-non-string: 其他型別只給型別, 不輸出原值', function() {
        assert.strict.equal(m.maskToken({ a: 'SECRET' }), '(object)')
        assert.strict.equal(m.maskToken(12345), '(number)')
        assert.strict.equal(m.maskToken(true), '(boolean)')
    })

    it('MASK-007-control-chars: 露出字元中之控制字元換成 ?', function() {
        assert.strict.equal(m.maskToken('\nbcdefghijklmno\r'), '?b...o?(len=16)')
    })

    it('MASK-008-url: maskUrl 只留 origin + pathname', function() {
        assert.strict.equal(m.maskUrl('http://127.0.0.1:11007/?view=x&token=SECRET-TOKEN-VALUE'), 'http://127.0.0.1:11007/')
        assert.strict.equal(m.maskUrl('https://user:pass@example.com/a/b?k=SECRET#frag'), 'https://example.com/a/b')
        assert.strict.equal(m.maskUrl(''), '')
        assert.strict.equal(m.maskUrl(undefined), '')
        assert.strict.equal(m.maskUrl('not a url'), '(invalid-url)')
        assert.deepStrictEqual(m.maskUrl(['http://a.example.com/x?t=1', 'http://b.example.com/y?t=2']), ['http://a.example.com/x', 'http://b.example.com/y'])
        assert.strict.equal(m.maskUrl({ href: 'http://a.example.com/?t=SECRET' }), '(object)')
    })

    it('MASK-009-kv: maskKv 對識別欄照記, 其餘欄位遮罩', function() {
        assert.strict.equal(m.maskKv('account', 'ac-admin'), 'ac-admin')
        assert.strict.equal(m.maskKv('id', 'id-for-admin'), 'id-for-admin')
        assert.strict.equal(m.maskKv('email', 'admin@example.com'), 'admin@example.com')
        assert.strict.equal(m.maskKv('name', 'admin'), 'admin')
        assert.strict.equal(m.maskKv('token', 'abcdefghijklmnop'), 'ab...op(len=16)')
        assert.strict.equal(m.maskKv('tokenVerify', '0199a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b'), '0199...4a5b(len=36)')
        assert.strict.equal(m.maskKv(['account'], 'abcdefghijklmnop'), 'ab...op(len=16)')
    })

})
