import assert from 'assert'
import procLang from '../server/procLang.mjs'


describe('procLang - 語系字典合併順序 (內建 → kpLangExtEmail → kpLangExt)', function() {
    //spec: 信件文字統一存於語系字典; settings 信件鍵(kpLangExtEmail)逐語系覆寫內建同名鍵;
    //kpLangExt 為最終覆寫層(整鍵取代), 供測試/CI 全面覆寫

    // L1: 未給任何覆寫 → 採內建
    it('L1: should use built-in email text when no override', function() {
        let r = procLang({})
        assert.strict.equal(r.eng.chpwEmTitle, 'Password has been changed')
        assert.strict.equal(r.cht.chpwEmTitle, '密碼已進行變更')
        assert.strict.ok(r.eng.regVerifyEmContent.includes('{verifyUrl}'))
    })

    // L2: kpLangExtEmail 逐語系覆寫, 未給語系回退內建
    it('L2: should merge kpLangExtEmail per-lang and fall back to built-in for missing lang', function() {
        let r = procLang({ kpLangExtEmail: { chpwEmTitle: { eng: 'custom-eng-title' } } })
        assert.strict.equal(r.eng.chpwEmTitle, 'custom-eng-title')
        assert.strict.equal(r.cht.chpwEmTitle, '密碼已進行變更') //cht 未給, 回退內建
    })

    // L3: kpLangExt 為最終覆寫層, 蓋過 kpLangExtEmail
    it('L3: should let kpLangExt override kpLangExtEmail (final layer for CI/CD)', function() {
        let r = procLang({
            kpLangExtEmail: { chpwEmTitle: { eng: 'from-settings' } },
            kpLangExt: { chpwEmTitle: { eng: 'from-ext', cht: 'ext-cht' } },
        })
        assert.strict.equal(r.eng.chpwEmTitle, 'from-ext')
        assert.strict.equal(r.cht.chpwEmTitle, 'ext-cht')
    })

    // L4: kpLangExt 未覆寫之鍵不受影響
    it('L4: should keep other keys intact when overriding one key', function() {
        let r = procLang({ kpLangExtEmail: { resetPwEmContent: { cht: '客製重設信' } } })
        assert.strict.equal(r.cht.resetPwEmContent, '客製重設信')
        assert.strict.ok(r.eng.resetPwEmContent.includes('{newPassword}')) //eng 回退內建
        assert.strict.equal(r.cht.chpwEmTitle, '密碼已進行變更') //他鍵不受影響
    })

})
