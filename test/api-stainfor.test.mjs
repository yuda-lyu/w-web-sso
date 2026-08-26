import assert from 'assert'
import ot from 'dayjs'
import ds from '../src/schema/index.mjs'
import hashPassword from '../server/hashPassword.mjs'
import { woItems } from '../g_mOrm.mjs'
import { startServersOnce, callFapi } from './api-setup.mjs'
import { resetToBaseSeed, deleteNonBaseSeed } from './e2e-setup.mjs'


//
// 對應 spec/流程_後台統計資訊.md (D13: 統計數字正確性 API 測試)
//
// 此檔補 critic 缺口: 統計子系統原本只有 e2e pixel baseline (cards 區整張視覺比對),
// 沒有「驗算出的數字」—— baseline 把當下 DB 的計數凍結成像素, 屬現狀指紋 (§6.2),
// 一旦計數邏輯偏離 spec, 偏離被凍進 baseline 而測試仍 pass = false negative.
//
// 本檔改為: seed 一組「已知狀態」資料 → 以 admin token 呼叫 getStaUserSummary /
// getStaTokenSummary / getStaIpSummary → 斷言回傳計數 == 由 spec 計數語意 + 已知 seed
// 推導出的「絕對預期值」. 每條 assert 註解標明對應 spec 哪一句計數定義.
//
// ---------------------------------------------------------------------------
// 計數語意真理來源 (procStaInfor.mjs 實作 + src/plugins/mShare.mjs 判定函式;
//   spec/流程_後台統計資訊.md「i18n 訊息粒度規則」表把各卡片 label 對到這些計數):
//
//   使用者 (getStaUserSummary, procStaInfor.mjs:27-71):
//     - total   = 全部使用者數                         (size(users))
//     - active  = isActive==='y' 之使用者數             (mShare.getIsActive, mShare.mjs:116)
//     - blocked = timeBlocked 有值且 now<=timeBlocked   (mShare.getIsBlocked, mShare.mjs:70 — 封鎖時間在未來=封鎖中)
//     - expired = timeExpired 有值且 now>=timeExpired   (mShare.getIsExpired, mShare.mjs:52 — 過期時間已過=已過期)
//       ※ active / blocked / expired 三者各自獨立判定 (同一 user 可同時 active 且 blocked 且 expired)
//
//   金鑰 (getStaTokenSummary, procStaInfor.mjs:88-140):
//     - ended      = timeEnd 有值且 now>timeEnd          (mShare.getIsEnded, mShare.mjs:88 — 到期時間已過=失效)
//     - active     = total(全部 token 數) - ended        (procStaInfor.mjs:129)
//     - created24h = timeCreate >= now-24h               (procStaInfor.mjs:104)
//     - ending24h  = timeEnd 落在 [now, now+24h] 區間     (procStaInfor.mjs:113)
//
//   IP (getStaIpSummary, procStaInfor.mjs:157-201):
//     - blocked = ips 表中 timeBlocked 有值且 now<=timeBlocked (mShare.getIsBlocked) → 由 ips 表可確定性 seed
//     - conn24h = 近 24h IP 連線 log 計數總和 (procStaInfor.mjs:171-183, 取自 staIp log worker)
//       ※ conn24h 為「請求時間相對 + log 聚合」(spec『參數來源』表), 非由 ips 表欄位決定, 無法由 seed
//         精確預測 → 本檔僅保守斷言 conn24h 為 number 且 >=0, 不杜撰精確值 (§6.2 / 任務紀律).
//
// ---------------------------------------------------------------------------
// 已知 seed 狀態 (在 before() 先 resetToBaseSeed() 把全表還原成 canonical base seed,
//   再插入本檔特化資料 → 整個 DB 成為「完全已知的固定資料集」, 故可斷言絕對計數):
//
//   base seed (g_initialData.buildBaseUsers / buildBaseTokens, 經 resetToBaseSeed 還原):
//     users  ×3: id-for-viewer(active,verified), id-for-basic(active,未驗證), id-for-admin(active,admin)
//                → 全部 isActive='y' / timeBlocked='' / timeExpired=2030(未過期)
//                → base 貢獻: total+3, active+3, blocked+0, expired+0
//     tokens ×4: 全部 timeEnd=2030(未失效) / timeCreate=now(funNew 於 before 當下建立)
//                → base 貢獻: tokens total+4, ended+0, ending24h+0(2030 在 24h 外), created24h+4(剛建立)
//     ips    ×0
//
//   本檔特化 users (前綴 id-ap-si-*, 由 deleteNonBaseSeed 於 teardown 清除):
//     - admin                  ×1: isActive=y, isAdmin=y, verified, 未封鎖, 未過期 (供取得 admin token)
//     - activeOnly             ×2: isActive=y, verified, timeBlocked='', timeExpired=未來 → 只計入 active
//     - blocked                ×2: isActive=y, verified, timeBlocked=未來 → 計入 active 且 blocked
//     - expired                ×2: isActive=y, verified, timeExpired=過去 → 計入 active 且 expired
//     - inactive               ×1: isActive='n' → 不計入 active
//     → 特化 users 共 8 個 (1+2+2+2+1)
//
//   使用者計數絕對預期 (base + 特化, 皆 wall-clock 無關: 未來/過去日期離 now 很遠):
//     total   = 3(base) + 8(特化)                       = 11
//     active  = 3(base) + 7(特化 isActive='y': admin+activeA+activeB+blockedA+blockedB+expiredA+expiredB) = 10
//               ※ blocked/expired 為獨立旗標, isActive='y' 之 blocked/expired user 仍計入 active; 僅 inactive('n') 不計
//     blocked = 0(base) + 2(特化 blocked)               = 2
//     expired = 0(base) + 2(特化 expired)               = 2
//
//   本檔特化 tokens (由 deleteNonBaseSeed 連動清除: userId 屬本檔特化 user):
//     - adminTok   ×1: userId=admin, timeEnd=now+60min → active, ending24h(在24h內), 未失效
//     - endingSoon ×1: userId=admin, timeEnd=now+12h   → active, ending24h(在24h內), 未失效
//     - ended      ×2: userId=admin, timeEnd=now-10min → 失效(ended); timeEnd<now 不在 ending24h 區間
//     → 特化 tokens 共 4 個, 全部 timeCreate=now(剛建立)
//
//   金鑰計數絕對預期:
//     tokens total = 4(base) + 4(特化) = 8
//     ended        = 0(base) + 2(特化 ended)                 = 2     (wall-clock 無關: 過去日期)
//     active       = total - ended = 8 - 2                   = 6
//     ending24h    = 0(base, 2030 在 24h 外) + adminTok + endingSoon = 2   (ended 之 timeEnd<now 不算)
//     created24h   = 8  (base 4 + 特化 4, 全部於本次 before 當下建立, timeCreate 皆 < 24h)
//
//   本檔特化 ips (id-ap-si-ip-*, 由 deleteNonBaseSeed 清空整張 ips 表):
//     - ipBlocked  ×2: timeBlocked=未來 → blocked
//     - ipPlain    ×1: timeBlocked=''   → 不 blocked
//     IP 計數絕對預期: blocked = 2 ; conn24h 不精確斷言 (log 相對, 見上)
//
// ---------------------------------------------------------------------------
// 快取處理 (關鍵): 後端 srv.mjs 為「另一個 spawn 的行程」, getStaXxxSummary 經
//   getUsersListCache / getTokensListCache / getIpsListCache (procCore.mjs, 各 30s 快取) 取數.
//   本檔以 woItems 直接寫 DB (繞過 procCore.updateXxxList → 不會觸發其 ocGetXxxList.clear()),
//   且無法跨行程清後端記憶體快取. 故 before() seed 完後等待略過 30s 快取窗 (見 CACHE_TTL_WAIT_MS),
//   確保各 it() 的 RPC 讀取為「快取過期後重新計算」之新鮮值. 本檔無瀏覽器/併發讀取,
//   seed 後在首次 RPC 前無其他人 warm 快取, 故單次等待即可保證新鮮 (非 per-assert 重試, 不構成現狀指紋).
//


let salt = '{salt}'

//30s 快取 + ~1s 偵測週期 + 餘裕 → 等 33s 確保 before() 之 seed 寫入前可能已 warm 的快取全部過期.
let CACHE_TTL_WAIT_MS = 33 * 1000


//日期工具: 遠未來 / 遠過去 (與 now 距離夠大, 不受測試執行 wall-clock 飄移影響), 以及近 24h 邊界內外.
let TIME_FAR_FUTURE = '2030-01-01T00:00:00.000+08:00'
let TIME_FAR_PAST = '2000-01-01T00:00:00.000+08:00'
function tFromNow(amount, unit) {
    return ot().add(amount, unit).format('YYYY-MM-DDTHH:mm:ss.SSSZ')
}


//本檔特化使用者定義 (id 前綴 ap-si- = api-stainfor, 避免與其他測試檔互撞)
let testUsers = {
    admin: {
        id: 'id-ap-si-admin', account: 'ap-si-admin', rawPassword: 'Pw@apsiadm1',
        name: 'API SI Admin', email: 'ap-si-admin@test.com',
        isAdmin: 'y', isActive: 'y', timeBlocked: '', timeExpired: TIME_FAR_FUTURE,
    },
    //active-only ×2 (只計入 active)
    activeA: {
        id: 'id-ap-si-active-a', account: 'ap-si-active-a', rawPassword: 'Pw@apsiact1',
        name: 'API SI Active A', email: 'ap-si-active-a@test.com',
        isAdmin: 'n', isActive: 'y', timeBlocked: '', timeExpired: TIME_FAR_FUTURE,
    },
    activeB: {
        id: 'id-ap-si-active-b', account: 'ap-si-active-b', rawPassword: 'Pw@apsiact2',
        name: 'API SI Active B', email: 'ap-si-active-b@test.com',
        isAdmin: 'n', isActive: 'y', timeBlocked: '', timeExpired: TIME_FAR_FUTURE,
    },
    //blocked ×2 (計入 active 且 blocked; timeBlocked 在未來 = 封鎖中)
    blockedA: {
        id: 'id-ap-si-blocked-a', account: 'ap-si-blocked-a', rawPassword: 'Pw@apsiblk1',
        name: 'API SI Blocked A', email: 'ap-si-blocked-a@test.com',
        isAdmin: 'n', isActive: 'y', timeBlocked: TIME_FAR_FUTURE, timeExpired: TIME_FAR_FUTURE,
    },
    blockedB: {
        id: 'id-ap-si-blocked-b', account: 'ap-si-blocked-b', rawPassword: 'Pw@apsiblk2',
        name: 'API SI Blocked B', email: 'ap-si-blocked-b@test.com',
        isAdmin: 'n', isActive: 'y', timeBlocked: TIME_FAR_FUTURE, timeExpired: TIME_FAR_FUTURE,
    },
    //expired ×2 (計入 active 且 expired; timeExpired 在過去 = 已過期)
    expiredA: {
        id: 'id-ap-si-expired-a', account: 'ap-si-expired-a', rawPassword: 'Pw@apsiexp1',
        name: 'API SI Expired A', email: 'ap-si-expired-a@test.com',
        isAdmin: 'n', isActive: 'y', timeBlocked: '', timeExpired: TIME_FAR_PAST,
    },
    expiredB: {
        id: 'id-ap-si-expired-b', account: 'ap-si-expired-b', rawPassword: 'Pw@apsiexp2',
        name: 'API SI Expired B', email: 'ap-si-expired-b@test.com',
        isAdmin: 'n', isActive: 'y', timeBlocked: '', timeExpired: TIME_FAR_PAST,
    },
    //inactive ×1 (isActive='n' → 不計入 active)
    inactive: {
        id: 'id-ap-si-inactive', account: 'ap-si-inactive', rawPassword: 'Pw@apsiina1',
        name: 'API SI Inactive', email: 'ap-si-inactive@test.com',
        isAdmin: 'n', isActive: 'n', timeBlocked: '', timeExpired: TIME_FAR_FUTURE,
    },
}

//由已知 seed 推導之「絕對預期計數」(對應上方檔頭推導表)
let EXPECT = {
    user: {
        total: 3 + 8,   //base 3 + 特化 8
        //base 3(全 active) + 特化中 isActive='y' 者 7 (admin/activeA/activeB/blockedA/blockedB/expiredA/expiredB;
        //僅 inactive 為 'n') ⇒ 10. blocked / expired 為獨立旗標, 不影響 active 計入.
        active: 3 + 7,
        blocked: 0 + 2,
        expired: 0 + 2,
    },
    token: {
        total: 4 + 4,   //base 4 + 特化 4
        ended: 0 + 2,
        active: (4 + 4) - 2,
        ending24h: 0 + 2,
        created24h: 4 + 4,
    },
    ip: {
        blocked: 2,
    },
}

let userTokens = {}


//插入本檔特化資料: 先 resetToBaseSeed() 還原 canonical base seed, 再插入特化 users / tokens / ips.
async function insertTestData() {

    //先 wipe 全表並重置為 canonical base seed (3 users + 4 tokens + 0 ips), 再插入本檔專屬資料.
    await resetToBaseSeed()

    //特化 users
    let arr = Object.values(testUsers)
    let us = arr.map((u, k) => {
        let v = ds.users.funNew({
            order: 700 + k,
            account: u.account,
            password: hashPassword(u.rawPassword, salt),
            name: u.name,
            email: u.email,
            description: '',
            from: 'test',
            redir: `http://127.0.0.1:8080/?view=${u.isAdmin === 'y' ? 'backstage' : 'user'}&token={token}`,
            isAdmin: u.isAdmin,
            timeVerified: '2025-01-01T00:00:00.000+08:00', //一律已驗證 (避免未驗證干擾 admin 登入語意; 統計計數不看 verified)
            timeExpired: u.timeExpired,
            timeBlocked: u.timeBlocked,
            isActive: u.isActive,
        })
        //funNew 會重產 id / 重置部分欄位, 須重存本檔指定值
        v.id = u.id
        v.isAdmin = u.isAdmin
        v.isActive = u.isActive
        v.timeVerified = '2025-01-01T00:00:00.000+08:00'
        v.timeExpired = u.timeExpired
        v.timeBlocked = u.timeBlocked
        return v
    })
    await woItems.users.insert(us)

    //特化 tokens (全部掛在 admin user 下, 由 deleteNonBaseSeed 連動清除)
    let adminId = testUsers.admin.id
    let mkTok = (id, timeEnd) => {
        let t = ds.tokens.funNew({ userId: adminId })
        t.id = id
        t.token = id //token 值用 id, 確保固定可預期
        t.timeEnd = timeEnd
        return t
    }
    let tks = [
        mkTok('id-ap-si-tok-admin', tFromNow(60, 'minute')),   //active + ending24h
        mkTok('id-ap-si-tok-ending', tFromNow(12, 'hour')),    //active + ending24h
        mkTok('id-ap-si-tok-ended-a', tFromNow(-10, 'minute')),//ended (timeEnd<now); 不在 ending24h
        mkTok('id-ap-si-tok-ended-b', tFromNow(-20, 'minute')),//ended (timeEnd<now); 不在 ending24h
    ]
    //admin session token (供呼叫統計 API), 即第一個 active token
    userTokens[adminId] = 'id-ap-si-tok-admin'
    await woItems.tokens.insert(tks)

    //特化 ips
    let mkIp = (id, ip, timeBlocked) => {
        let o = ds.ips.funNew({ ip, timeBlocked })
        o.id = id
        o.timeBlocked = timeBlocked
        return o
    }
    let ips = [
        mkIp('id-ap-si-ip-blk-a', '203.0.113.1', TIME_FAR_FUTURE), //blocked
        mkIp('id-ap-si-ip-blk-b', '203.0.113.2', TIME_FAR_FUTURE), //blocked
        mkIp('id-ap-si-ip-plain', '203.0.113.3', ''),              //not blocked
    ]
    await woItems.ips.insert(ips)
}


//teardown: 只刪本檔特化資料 (非 base seed 之 users/tokens 全清 + ips 整表清空), 保留 base seed.
async function deleteTestData() {
    await deleteNonBaseSeed()
}


describe('StaInfor API — 統計數字正確性 (D13)', function() {
    this.timeout(120000)

    before(async function() {
        //180s: 含 server 首次啟動 + seed + 33s 快取過期等待
        this.timeout(240000)
        await startServersOnce()
        await deleteTestData()
        await insertTestData()

        //等後端 30s list 快取窗過期, 確保各 it() 的統計 RPC 讀到 seed 後的新鮮計數 (見檔頭「快取處理」).
        await new Promise((r) => setTimeout(r, CACHE_TTL_WAIT_MS))
    })

    after(async function() {
        await deleteTestData()
    })


    it('D13-001-user-summary-counts: getStaUserSummary 之 total/active/blocked/expired == 已知 seed 推導值', async function() {
        let adminToken = userTokens[testUsers.admin.id]
        let r = await callFapi('getStaUserSummary', [adminToken])
        assert.strict.equal(r.ok, true, `預期 admin token 取得統計成功, 實際 reject: ${r.err}`)
        let s = r.val

        //spec「使用者區標籤 totalUsers」→ total = 全部使用者數 (procStaInfor.mjs:33, size(users))
        assert.strict.equal(s.total, EXPECT.user.total, `total 應為 ${EXPECT.user.total} (base 3 + 特化 8), 實際 ${s.total}`)

        //spec「activeUsers」→ active = isActive==='y' 之數 (procStaInfor.mjs:38 → mShare.getIsActive)
        //base 3 全 active + 特化中 isActive='y' 者 7 (僅 inactive 為 'n') ⇒ 10. blocked/expired 為獨立旗標不影響 active.
        assert.strict.equal(s.active, EXPECT.user.active, `active 應為 ${EXPECT.user.active} (base 3 + 特化 isActive=y 者 7), 實際 ${s.active}`)

        //spec「blockedUsers」→ blocked = timeBlocked 有值且 now<=timeBlocked (procStaInfor.mjs:47 → mShare.getIsBlocked)
        assert.strict.equal(s.blocked, EXPECT.user.blocked, `blocked 應為 ${EXPECT.user.blocked} (特化 blockedA/blockedB), 實際 ${s.blocked}`)

        //spec「expiredUsers」→ expired = timeExpired 有值且 now>=timeExpired (procStaInfor.mjs:56 → mShare.getIsExpired)
        assert.strict.equal(s.expired, EXPECT.user.expired, `expired 應為 ${EXPECT.user.expired} (特化 expiredA/expiredB), 實際 ${s.expired}`)
    })


    it('D13-002-token-summary-counts: getStaTokenSummary 之 active/ended/ending24h/created24h == 已知 seed 推導值', async function() {
        let adminToken = userTokens[testUsers.admin.id]
        let r = await callFapi('getStaTokenSummary', [adminToken])
        assert.strict.equal(r.ok, true, `預期 admin token 取得統計成功, 實際 reject: ${r.err}`)
        let s = r.val

        //spec「endedTokens」→ ended = timeEnd 有值且 now>timeEnd (procStaInfor.mjs:122 → mShare.getIsEnded)
        //base 4 個 timeEnd=2030(未失效) + 特化 2 個 ended(timeEnd 在過去) ⇒ 2
        assert.strict.equal(s.ended, EXPECT.token.ended, `ended 應為 ${EXPECT.token.ended} (特化 2 個過去 timeEnd), 實際 ${s.ended}`)

        //spec「activeTokens」→ active = total(全部 token) - ended (procStaInfor.mjs:129)
        //total = base 4 + 特化 4 = 8; ended = 2 ⇒ active = 6
        assert.strict.equal(s.active, EXPECT.token.active, `active 應為 ${EXPECT.token.active} (total 8 - ended 2), 實際 ${s.active}`)

        //spec「endingNext24h」→ ending24h = timeEnd 落在 [now, now+24h] (procStaInfor.mjs:113)
        //base 2030 在 24h 外不算; 特化 adminTok(now+60min) + endingSoon(now+12h) 在內; 特化 ended(timeEnd<now) 不在 ⇒ 2
        assert.strict.equal(s.ending24h, EXPECT.token.ending24h, `ending24h 應為 ${EXPECT.token.ending24h} (adminTok + endingSoon), 實際 ${s.ending24h}`)

        //spec「createdLast24h」→ created24h = timeCreate >= now-24h (procStaInfor.mjs:104)
        //base 4 + 特化 4 全部於本次 before 當下建立 (timeCreate=now, 皆 <24h) ⇒ 8
        assert.strict.equal(s.created24h, EXPECT.token.created24h, `created24h 應為 ${EXPECT.token.created24h} (全部 token 皆於 before 當下建立), 實際 ${s.created24h}`)
    })


    it('D13-003-ip-summary-counts: getStaIpSummary 之 blocked == 已知 seed 推導值, conn24h 保守斷言', async function() {
        let adminToken = userTokens[testUsers.admin.id]
        let r = await callFapi('getStaIpSummary', [adminToken])
        assert.strict.equal(r.ok, true, `預期 admin token 取得統計成功, 實際 reject: ${r.err}`)
        let s = r.val

        //spec「blockedIps」→ blocked = ips 表 timeBlocked 有值且 now<=timeBlocked (procStaInfor.mjs:188 → mShare.getIsBlocked)
        //特化 ipBlocked ×2 (timeBlocked 在未來) ⇒ 2 (deleteNonBaseSeed 已清空整表, 無其他 ip 干擾)
        assert.strict.equal(s.blocked, EXPECT.ip.blocked, `blocked 應為 ${EXPECT.ip.blocked} (特化 ipBlocked ×2), 實際 ${s.blocked}`)

        //spec「conn24h」(『參數來源』表: 請求時間相對 + log 聚合) → 無法由 ips 表 seed 精確預測 (procStaInfor.mjs:171-183
        //取自 staIp log worker). 保守斷言: 為 number 且 >=0 (不杜撰精確值, §6.2 / 任務紀律).
        assert.strict.equal(typeof s.conn24h, 'number', `conn24h 應為 number, 實際 ${typeof s.conn24h}`)
        assert.strict.equal(s.conn24h >= 0, true, `conn24h 應 >=0, 實際 ${s.conn24h}`)
    })


    it('D13-004-non-admin-token-rejected: 非 admin token 呼叫三統計 RPC 一律 reject (spec 權限: funCheckAdmin admin-only)', async function() {
        //spec『權限』+『spec 規則摘要』: 6 個 getSta* 皆以 funCheckAdmin 包裝, 僅 admin 有效 token 可存取.
        //base seed 之 token-for-viewer 屬非 admin user (id-for-viewer, isAdmin='n') → 三 RPC 均應 reject.
        let viewerToken = 'token-for-viewer'
        for (let fn of ['getStaUserSummary', 'getStaTokenSummary', 'getStaIpSummary']) {
            let r = await callFapi(fn, [viewerToken])
            assert.strict.equal(r.ok, false, `${fn} 以非 admin token 應 reject, 實際 resolve: ${JSON.stringify(r.val)}`)
        }
    })

})
