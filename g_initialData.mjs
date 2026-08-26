import map from 'lodash-es/map.js'
import { pathToFileURL } from 'url'
import ds from './src/schema/index.mjs'
import hashPassword from './server/hashPassword.mjs'
import { woItems } from './g_mOrm.mjs'


let salt = process.env.SALT || '{salt}' //D21: 生產經 SALT env 注入真實 pepper, 須與後端 verify pepper 一致; 未設時用佔位符(僅測試/開發)


//基本測試數據 (使用者) 原始定義 — 為 g_initialData 重建 DB 與 e2e setup 的單一真理來源.
//e2e 各測試 setup 階段透過 buildBaseUsers() 重建這批基本數據 (含系統管理員 ac-admin),
//確保每個 e2e 都從相同已知 DB 狀態起跑, 不受其他 e2e 非預期殘留影響.
let baseUsersRaw = [
    {
        id: 'id-for-viewer',
        account: 'ac-viewer',
        password: hashPassword('pw-viewer', salt),
        name: 'viewer',
        email: 'viewer@example.com',
        description: 'description-for-viewer',
        from: 'SSO',
        redir: 'http://localhost:8080/?view=user&token={token}', //給予{token}使前端自動取代成真實token
        isAdmin: 'n',
        timeVerified: '2025-01-01T00:00:00.000+08:00',
        timeExpired: '2030-01-01T00:00:00.000+08:00',
        timeBlocked: '',
        isActive: 'y',
    },
    {
        id: 'id-for-basic',
        account: 'ac-basic',
        password: hashPassword('pw-basic', salt),
        name: 'basic',
        email: 'basic@example.com',
        description: 'description-for-basic',
        from: 'SSO',
        redir: 'http://localhost:8080/?view=user&token={token}', //給予{token}使前端自動取代成真實token
        isAdmin: 'n',
        timeVerified: '', //未驗證
        timeExpired: '2030-01-01T00:00:00.000+08:00',
        timeBlocked: '',
        isActive: 'y',
    },
    {
        id: 'id-for-admin',
        account: 'ac-admin',
        password: hashPassword('pw-admin', salt),
        name: 'admin',
        email: 'admin@example.com',
        description: 'description-for-admin',
        from: 'SSO',
        redir: 'http://localhost:8080/?view=backstage&token={token}', //給予{token}使前端自動取代成真實token
        isAdmin: 'y',
        timeVerified: '2025-01-01T00:00:00.000+08:00',
        timeExpired: '2030-01-01T00:00:00.000+08:00',
        timeBlocked: '',
        isActive: 'y',
    },
]


//基本測試數據 (token) 原始定義
let baseTokensRaw = [
    {
        token: 'token-for-viewer',
        userId: 'id-for-viewer',
    },
    {
        token: 'token-for-basic',
        userId: 'id-for-basic',
    },
    {
        token: 'token-for-admin',
        userId: 'id-for-admin',
    },
    {
        token: 'token-for-app',
        userId: 'id-for-app',
        isApp: 'y',
    },
]


//建立基本使用者 records (funNew 補齊欄位, 並重存會被重置的 id / isAdmin)
function buildBaseUsers() {
    return map(baseUsersRaw, (u, k) => {
        let v = ds.users.funNew({
            order: k,
            ...u,
        })
        v.id = u.id //id會重產故須重存
        v.isAdmin = u.isAdmin //isAdmin會重置回n故須重存
        return v
    })
}


//建立基本 token records (各 token 皆給予超長時效)
function buildBaseTokens() {
    return map(baseTokensRaw, (t) => {
        let token = t.token
        let v = ds.tokens.funNew({
            ...t,
        })
        v.id = `id-for-${token}`
        v.token = token
        v.timeEnd = '2030-01-01T00:00:00.000+08:00' //測試各token皆給予超長時效
        return v
    })
}


//重建整個資料庫為基本測試數據 (清空 users / tokens 後插入基本種子). 供 node g_initialData.mjs 用.
async function initialData() {
    await woItems.users.delAll()
    await woItems.users.insert(buildBaseUsers())

    await woItems.tokens.delAll()
    await woItems.tokens.insert(buildBaseTokens())

    console.log('finish.')
}


export { baseUsersRaw, baseTokensRaw, buildBaseUsers, buildBaseTokens, initialData }


//main-guard: 僅在「直接以 node g_initialData.mjs 執行」時重建 DB; 被 import 時不執行 (避免副作用)
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
    initialData()
        .catch((err) => {
            console.log('initialData catch', err)
        })
}


//重建資料庫
//node g_initialData.mjs
