import map from 'lodash-es/map.js'
import ds from './src/schema/index.mjs'
import hashPassword from './server/hashPassword.mjs'
import { woItems } from './g.mOrm.mjs'


async function initialData() {

    let rs = [
        {
            id: 'id-for-Surra',
            account: 'acSurra',
            password: hashPassword('pwSurra', '{salt}'),
            name: 'Surra',
            email: 'Surra@mail.com',
            description: '',
            from: '',
            ruleGroupsIds: 'id-for-viewer',
            redir: 'https://github.com/?token={token}', //給予{token}使前端自動取代成真實token
            isAdmin: 'n',
        },
        {
            id: 'id-for-Irene',
            account: 'acIrene',
            password: hashPassword('pwIrene', '{salt}'),
            name: 'Irene',
            email: 'Irene@mail.com',
            description: '',
            from: '',
            ruleGroupsIds: 'id-for-basic',
            redir: 'https://github.com/?token={token}', //給予{token}使前端自動取代成真實token
            isAdmin: 'n',
        },
        {
            id: 'id-for-Kirk',
            account: 'acKirk',
            password: hashPassword('pwKirk', '{salt}'),
            name: 'Kirk',
            email: 'Kirk@mail.com',
            description: '',
            from: '',
            ruleGroupsIds: 'id-for-admin',
            redir: 'https://github.com/?token={token}', //給予{token}使前端自動取代成真實token
            isAdmin: 'n',
        },
    ]
    rs = map(rs, (u, k) => {
        let v = ds.users.funNew({
            order: k,
            ...u,
        })
        v.id = u.id
        return v
    })
    await woItems.users.delAll()
    await woItems.users.insert(rs)

    let ts = [
        {
            token: 'token-for-Surra',
            userId: 'id-for-Surra',
        },
        {
            token: 'token-for-Irene',
            userId: 'id-for-Irene',
        },
        {
            token: 'token-for-Kirk',
            userId: 'id-for-Kirk',
        },
    ]
    ts = map(ts, (t, k) => {
        let token = t.token
        let v = ds.tokens.funNew({
            ...t,
        })
        v.id = `id-for-${token}`
        v.token = token
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
