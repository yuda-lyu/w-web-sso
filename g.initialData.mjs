import map from 'lodash-es/map.js'
import ds from './src/schema/index.mjs'
import hashPassword from './server/hashPassword.mjs'
import { woItems } from './g.mOrm.mjs'


let salt = '{salt}'


async function initialData() {

    let rs = [
        {
            id: 'id-for-viewer',
            account: 'ac-viewer',
            password: hashPassword('pw-viewer', salt),
            name: 'viewer',
            email: 'viewer@example.com',
            description: 'description-for-viewer',
            from: 'SSO',
            redir: 'https://github.com/?token={token}', //給予{token}使前端自動取代成真實token
            isAdmin: 'n',
            isVerified: 'y',
            timeVerified: '2025-01-01T00:00:00+08:00',
            timeExpired: '2030-01-01T00:00:00+08:00',
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
            redir: 'https://github.com/?token={token}', //給予{token}使前端自動取代成真實token
            isAdmin: 'n',
            isVerified: 'y',
            timeVerified: '2025-01-01T00:00:00+08:00',
            timeExpired: '2030-01-01T00:00:00+08:00',
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
            redir: 'https://github.com/?token={token}', //給予{token}使前端自動取代成真實token
            isAdmin: 'y',
            isVerified: 'y',
            timeVerified: '2025-01-01T00:00:00+08:00',
            timeExpired: '2030-01-01T00:00:00+08:00',
            timeBlocked: '',
            isActive: 'y',
        },
    ]
    rs = map(rs, (u, k) => {
        let v = ds.users.funNew({
            order: k,
            ...u,
        })
        v.id = u.id //id會重產故須重存
        v.isAdmin = u.isAdmin //isAdmin會重置回n故須重存
        return v
    })
    await woItems.users.delAll()
    await woItems.users.insert(rs)

    let ts = [
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
            isApp: true,
        },
    ]
    ts = map(ts, (t, k) => {
        let token = t.token
        let v = ds.tokens.funNew({
            ...t,
        })
        v.id = `id-for-${token}`
        v.token = token
        if (t.isApp) {
            v.timeEnd = '2030-00-00T00:00:00+08:00'
        }
        return v
    })
    await woItems.tokens.delAll()
    await woItems.tokens.insert(ts)

    console.log('finish.')
}

initialData()
    .catch((err) => {
        console.log('initialData catch', err)
    })


//重建資料庫
//node --experimental-modules g.initialData.mjs
