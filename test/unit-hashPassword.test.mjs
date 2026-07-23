import assert from 'assert'
import { hashPassword, verifyPassword } from '../server/hashPassword.mjs'


//SALTLEN 供 case 11 組字串使用 (與 server/hashPassword.mjs 內部常數同值 16 bytes = 32 hex chars)
const SALTLEN_FOR_TEST = 16


//
// UNIT-D42-hash-password-scrypt-boundary:
//   對應 v3 審計 D01 (server/hashPassword.mjs 重寫為 scrypt + per-user salt) 之邊界測試.
//   驗證 hashPassword(pw, salt, opt) / verifyPassword(pw, stored, salt) 之正確性與穩定性
//   (尤其是 stored 格式損壞 / 非法輸入時須穩定回 false, 不可 throw).
//
// 採 unit-test 性質 (無 server / 無 browser), 純函式呼叫.
// 跑法: npx mocha test/unit-hashPassword.test.mjs --timeout 30000
//


describe('hashPassword / verifyPassword unit test (UNIT-D42)', function() {
    this.timeout(30000)

    it('UNIT-D42-01-correct-password-verifies-true: 正確密碼與 pepper 可驗證通過', function() {
        let stored = hashPassword('pw', 'pepper')
        assert.strict.equal(verifyPassword('pw', stored, 'pepper'), true)
    })

    it('UNIT-D42-02-wrong-password-verifies-false: 錯誤明文密碼驗證失敗', function() {
        let stored = hashPassword('pw', 'pepper')
        assert.strict.equal(verifyPassword('wrong-pw', stored, 'pepper'), false)
    })

    it('UNIT-D42-03-per-user-salt-is-random: 同密碼同 pepper 兩次呼叫產出不同字串(per-user salt 隨機), 但各自皆可驗證通過', function() {
        let stored1 = hashPassword('pw', 'pepper')
        let stored2 = hashPassword('pw', 'pepper')
        assert.notStrictEqual(stored1, stored2, '兩次 hashPassword 應因 per-user 隨機 salt 而產出不同字串')
        assert.strict.equal(verifyPassword('pw', stored1, 'pepper'), true)
        assert.strict.equal(verifyPassword('pw', stored2, 'pepper'), true)
    })

    it('UNIT-D42-04-wrong-pepper-verifies-false: hash 時 pepper 與 verify 時 pepper 不同則驗證失敗', function() {
        let stored = hashPassword('pw', 'a')
        assert.strict.equal(verifyPassword('pw', stored, 'b'), false)
    })

    it('UNIT-D42-05-stored-null-returns-false-not-throw: stored 為 null 時回 false 且不 throw', function() {
        assert.doesNotThrow(() => {
            assert.strict.equal(verifyPassword('pw', null, 'pepper'), false)
        })
    })

    it('UNIT-D42-06-stored-non-string-returns-false-not-throw: stored 為非字串(undefined/數字/物件)時回 false 且不 throw', function() {
        let nonStrings = [undefined, 123, {}, [], true]
        for (let v of nonStrings) {
            assert.doesNotThrow(() => {
                assert.strict.equal(verifyPassword('pw', v, 'pepper'), false, `stored=${JSON.stringify(v)} 應回 false`)
            })
        }
    })

    it('UNIT-D42-07-stored-empty-string-returns-false-not-throw: stored 為空字串時回 false 且不 throw', function() {
        assert.doesNotThrow(() => {
            assert.strict.equal(verifyPassword('pw', '', 'pepper'), false)
        })
    })

    it('UNIT-D42-08-stored-malformed-segments-returns-false-not-throw: stored 段數不符 3 段(tag非scrypt/兩段/四段)時回 false 且不 throw', function() {
        let malformed = [
            'notscrypt:abc:def', //tag 非 scrypt 但仍 3 段 (此案例同時涵蓋 case 09, 留在此驗證段數解析路徑不 throw)
            'scrypt:abc', //只有兩段
            'scrypt:a:b:c', //四段
        ]
        for (let s of malformed) {
            assert.doesNotThrow(() => {
                assert.strict.equal(verifyPassword('pw', s, 'pepper'), false, `stored="${s}" 應回 false`)
            })
        }
    })

    it('UNIT-D42-09-stored-tag-not-scrypt-returns-false: stored 的 tag 非 "scrypt"(模擬舊格式)時回 false, 對齊 D19 不向後相容', function() {
        assert.doesNotThrow(() => {
            assert.strict.equal(verifyPassword('pw', 'sha512:xxx:yyy', 'pepper'), false)
        })
    })

    it('UNIT-D42-10-invalid-hex-chars-return-false-not-throw: saltHex/hashHex 含非法 hex 字元時仍穩定回 false, 不 throw', function() {
        //關鍵邊界: Buffer.from(非法hex字串, 'hex') 在 Node 並不會 throw,
        //而是解析到第一個非法字元就停止, 回傳「已解析部分」對應長度的 buffer (可能長度為 0 或截斷值),
        //因此不能只靠 try/catch 擋住非法輸入, 必須靠後續 saltBuf.length / hashBuf.length 之顯式長度檢查才能擋下.
        //('zz' 全非法字元 → Buffer.from('zz','hex') 產出長度 0 的 buffer; 'xyz123' 前綴 'xyz' 非法 → 同樣被截斷)
        let invalidHexCases = [
            'scrypt:zz:zz',
            'scrypt:xyz123:xyz123',
        ]
        for (let s of invalidHexCases) {
            assert.doesNotThrow(() => {
                assert.strict.equal(verifyPassword('pw', s, 'pepper'), false, `stored="${s}" 應回 false`)
            })
        }
    })

    it('UNIT-D42-11-hex-length-mismatch-returns-false-not-throw: saltHex/hashHex 長度不符 SALTLEN(16 bytes)/KEYLEN(64 bytes) 時回 false 且不 throw', function() {
        //合法 hex 字元但長度不足 (如僅 2 bytes 的 salt, 2 bytes 的 hash), 不對應 SALTLEN=16 / KEYLEN=64
        let shortHexCases = [
            'scrypt:aabb:aabb', //saltHex/hashHex 皆過短
            `scrypt:${'aa'.repeat(SALTLEN_FOR_TEST)}:aabb`, //saltHex 長度正確但 hashHex 過短
        ]
        for (let s of shortHexCases) {
            assert.doesNotThrow(() => {
                assert.strict.equal(verifyPassword('pw', s, 'pepper'), false, `stored="${s}" 應回 false`)
            })
        }
    })

    it('UNIT-D42-12-tampered-hash-returns-false: 正確 hashPassword 結果之 hashHex 末位被竄改後, verifyPassword 回 false', function() {
        let stored = hashPassword('pw', 'pepper')
        let parts = stored.split(':')
        let tag = parts[0]
        let saltHex = parts[1]
        let hashHex = parts[2]
        let lastChar = hashHex.slice(-1)
        let replacement = lastChar === '0' ? '1' : '0'
        let tamperedHashHex = hashHex.slice(0, -1) + replacement
        let tamperedStored = `${tag}:${saltHex}:${tamperedHashHex}`
        assert.strict.equal(verifyPassword('pw', tamperedStored, 'pepper'), false)
    })

    it('UNIT-D42-13-hash-password-mode-opt-non-scrypt-throws: hashPassword opt.mode 非 "scrypt" 時拋錯(既有防呆邏輯)', function() {
        assert.throws(
            () => hashPassword('pw', 'pepper', { mode: 'sha512' }),
            /暫時不支援scrypt以外方法/
        )
    })

})
