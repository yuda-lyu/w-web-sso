import ips from './tables/ips.mjs'
import tokens from './tables/tokens.mjs'
import users from './tables/users.mjs'
import build from 'w-data-collector/src/build.mjs'


let cs = {
    ips,
    tokens,
    users,
}

//ds
let ds = {}
for (let k in cs) {
    ds[k] = build(cs[k], { useCreateStorage: false })
}


export default ds
