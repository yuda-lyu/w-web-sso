import map from 'lodash-es/map.js'
import ds from './src/schema/index.mjs'
import provideUsers from './server/provideUsers.mjs'


async function provide() {

    let url = `http://localhost:11007/syncAndReplaceUsers?token=sys`

    let from = `pd`

    let rs = [
        ['pd-viewer', 'pd-普通瀏覽者'],
        ['pd-basic', 'pd-一般使用者'],
        ['pd-admin', 'pd-系統管理者'],
    ]
    rs = map(rs, ([key, name], k) => {
        let v = ds.users.funNew({
            order: 1000 + k,
            name,
            email: `${key}@example.com`,
            userId: 'id-for-admin',
            from,
        })
        v.id = `id-for-${key}`
        if (key === 'pd-admin') {
            v.isAdmin = 'y'
        }
        return v
    })
    console.log('rs', rs)

    let r = await provideUsers(url, from, rs)
    console.log('r.msg', r.msg)

}

provide()
    .catch((err) => {
        console.log('provide catch', err)
    })


//node --experimental-modules g.provideUsers.mjs
