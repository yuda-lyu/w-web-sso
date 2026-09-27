//unit-appPerms.test.mjs — 應用系統金鑰(app token)之權限字串與有效權限計算 (ADR-069)
//
// 對象: src/appPerms.mjs
// 依據: ADR-069 之權限契約
//   - 權限全集 7 個字串, 順序固定: readUsers / writeUsers / readTokens / writeTokens / readIps / writeIps / readStats
//   - 基本權限 readUsers 恆具備(「預設只提供查使用者」); perms 陣列多元素即多權限聯集
//   - 讀取端 fail closed: perms 非陣列或含未登錄字串時, 未登錄部分一律忽略, 不擴權
//   - 寫入端驗證: 未設定(undefined / null / '')或全為已登錄字串之陣列才合法
// 以 namespace import 取函數: 修正前模組不存在時整檔紅; 模組存在後各案例各自斷言

import assert from 'assert'
import * as ap from '../src/appPerms.mjs'
import ds from '../src/schema/index.mjs'
import procLang from '../server/procLang.mjs'


describe('應用系統金鑰權限 — src/appPerms.mjs (ADR-069)', function() {

    it('PERM-U-001-vocabulary: 權限全集為 7 個字串且順序固定, 基本權限僅 readUsers, 可取得管理者權限者為 writeUsers / readTokens / writeTokens', function() {
        assert.deepStrictEqual(ap.keysAppPerm, ['readUsers', 'writeUsers', 'readTokens', 'writeTokens', 'readIps', 'writeIps', 'readStats'])
        assert.deepStrictEqual(ap.keysAppPermBase, ['readUsers'])
        assert.deepStrictEqual(ap.keysAppPermHigh, ['writeUsers', 'readTokens', 'writeTokens'])
    })

    it('PERM-U-002-default: perms 未設定(undefined / null / 空字串 / 空陣列)→ 有效權限只有 readUsers', function() {
        for (let perms of [undefined, null, '', []]) {
            assert.deepStrictEqual(ap.getAppPerms({ isApp: 'y', perms }), ['readUsers'], `perms=${JSON.stringify(perms)}`)
        }
        //無 perms 鍵(升級前既有之 app token)亦同
        assert.deepStrictEqual(ap.getAppPerms({ isApp: 'y' }), ['readUsers'])
    })

    it('PERM-U-003-union: 多元素即多權限聯集, 並含基本權限', function() {
        assert.deepStrictEqual(ap.getAppPerms({ perms: ['readTokens', 'writeIps'] }), ['readUsers', 'readTokens', 'writeIps'])
        assert.deepStrictEqual(ap.getAppPerms({ perms: ap.keysAppPerm }), ap.keysAppPerm)
    })

    it('PERM-U-004-dedupe-order: 重複元素去重, 結果依全集順序排列(與輸入順序無關)', function() {
        assert.deepStrictEqual(ap.getAppPerms({ perms: ['readStats', 'readTokens', 'readStats', 'readUsers'] }), ['readUsers', 'readTokens', 'readStats'])
        assert.deepStrictEqual(ap.normAppPerms(['writeUsers', 'readIps', 'writeUsers']), ['writeUsers', 'readIps'])
    })

    it('PERM-U-005-fail-closed-read: perms 非陣列或含未登錄字串 → 未登錄部分忽略, 只剩合法元素與基本權限', function() {
        //非陣列: 字串形式之權限名亦不生效(不因「看起來像權限」而擴權)
        for (let perms of ['writeUsers', 'readTokens,writeTokens', { readTokens: true }, 1, true]) {
            assert.deepStrictEqual(ap.getAppPerms({ perms }), ['readUsers'], `perms=${JSON.stringify(perms)}`)
        }
        //陣列含未登錄字串 / 大小寫不符 / 非字串
        assert.deepStrictEqual(ap.getAppPerms({ perms: ['admin', 'READTOKENS', '', null, 1, 'readIps'] }), ['readUsers', 'readIps'])
    })

    it('PERM-U-006-has: hasAppPerm 依有效權限判斷; 未登錄之權限名一律 false', function() {
        let tk = { isApp: 'y', perms: ['readTokens'] }
        assert.strict.equal(ap.hasAppPerm(tk, 'readUsers'), true, '基本權限恆具備')
        assert.strict.equal(ap.hasAppPerm(tk, 'readTokens'), true)
        assert.strict.equal(ap.hasAppPerm(tk, 'writeTokens'), false, '讀不蘊含寫')
        assert.strict.equal(ap.hasAppPerm({ perms: ['writeTokens'] }, 'readTokens'), false, '寫不蘊含讀')
        //perms 內放了未登錄字串, 以該字串查詢亦 false(未登錄之權限閘不可被 perms 開啟)
        assert.strict.equal(ap.hasAppPerm({ perms: ['admin'] }, 'admin'), false)
        assert.strict.equal(ap.hasAppPerm(tk, ''), false)
        assert.strict.equal(ap.hasAppPerm(tk, undefined), false)
    })

    it('PERM-U-007-write-validate: isAppPermsValue 只接受未設定或全為已登錄字串之陣列', function() {
        for (let perms of [undefined, null, '', [], ['readTokens'], ap.keysAppPerm, ['readStats', 'readStats']]) {
            assert.strict.equal(ap.isAppPermsValue(perms), true, `應合法: ${JSON.stringify(perms)}`)
        }
        for (let perms of ['readTokens', { readTokens: true }, 1, true, ['readToken'], ['readTokens', 1], [null], [''], ['READUSERS']]) {
            assert.strict.equal(ap.isAppPermsValue(perms), false, `應不合法: ${JSON.stringify(perms)}`)
        }
    })

    it('PERM-U-008-norm-storage: normAppPerms 為寫入正規化, 不自動補基本權限(儲存「授予了什麼」)', function() {
        assert.deepStrictEqual(ap.normAppPerms([]), [])
        assert.deepStrictEqual(ap.normAppPerms(''), [])
        assert.deepStrictEqual(ap.normAppPerms(undefined), [])
        assert.deepStrictEqual(ap.normAppPerms(['readStats', 'readUsers']), ['readUsers', 'readStats'])
    })

    it('PERM-U-009-i18n: 每個權限皆有 eng / cht 名稱(鍵 appPerm_<權限>), 欄名 / 基本權限說明 / 寫入錯誤鍵亦齊備', function() {
        let kp = procLang()
        let keys = [...ap.keysAppPerm.map((p) => `appPerm_${p}`), 'tokenPerms', 'tokenPermsBase', 'tokenPermsHigh', 'tokenPermsInvalid']
        for (let lang of ['eng', 'cht']) {
            for (let k of keys) {
                assert.strict.equal(typeof kp[lang][k], 'string', `${lang}.${k} 應為字串`)
                assert.ok(kp[lang][k].length > 0, `${lang}.${k} 不得為空`)
            }
        }
    })

    it('PERM-U-010-schema: tokens 表含 perms 欄; funNew 未給 perms 時為空陣列(僅基本權限), 有給陣列則保留', function() {
        assert.ok(ds.tokens.keys.includes('perms'), 'tokens.keys 應含 perms')
        assert.deepStrictEqual(ds.tokens.funNew({ userId: 'u1' }).perms, [])
        assert.deepStrictEqual(ds.tokens.funNew({ userId: 'u1', isApp: 'y', perms: ['readTokens'] }).perms, ['readTokens'])
    })

})
