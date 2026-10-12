//w-serv-orm 之 procOrm 對 tokens 列之 userId(擁有者)處理實測(ADR-083 同類盤點發現, ADR-084 取證; 本套件之修正見 server/procCore.mjs updateTabItems 新增步驟)
//getMapOrm 之 adjustData 將名為 userId 之欄位視為建立者, insert 時一律改寫為 procOrm 之 userId 參數(save 只改 userIdUpdate / timeUpdate);
//本套件 tokens 表之 userId 為令牌擁有者, 金鑰清單未傳操作者(updateTabItems 預設 ''), 故經清單新增之列擁有者被改寫為 ''
//以真 getMapOrm 搭配只記錄寫入內容之假資料表(不碰資料庫)
//執行: node spec/evidence/2026-10-12-tokens-insert-owner-overwrite.mjs
//2026-10-12 結果(w-serv-orm 1.1.8): insert 之 userId 'u-owner' → ''(operatorId '')、'u-admin'(operatorId 'u-admin'); save 保留 'u-owner'
import getMapOrm from 'w-serv-orm/src/getMapOrm.mjs'
import ds from '../../src/schema/index.mjs'

for (let k of ['users', 'tokens', 'ips']) {
    console.log(`${k} keys:`, JSON.stringify(ds[k].keys))
}
let captured = {}
let mk = (name) => ({
    select: async () => [],
    insert: async (d) => {
        captured[`${name}.insert`] = d
        return { n: d.length, nInserted: d.length, ok: 1 }
    },
    save: async (d) => {
        captured[`${name}.save`] = d
        return d.map(() => ({ n: 1, nInserted: 0, nModified: 1, ok: 1 }))
    },
    del: async (d) => d.map(() => ({ n: 1, nDeleted: 1, ok: 1 })),
})
let woItems = { users: mk('users'), tokens: mk('tokens'), ips: mk('ips') }
let mapOrm = getMapOrm(ds, woItems)
let rowToken = (id) => ({ id, token: `tk-${id}`, userId: 'u-owner', isApp: 'n', perms: [], timeEnd: '2099-01-01T00:00:00.000+08:00' })

for (let op of ['', 'u-admin']) {
    await mapOrm(op, 'tokens', 'insert', [rowToken('t-ins')])
    console.log(`tokens insert, operatorId=${JSON.stringify(op)} -> userId=${JSON.stringify(captured['tokens.insert'][0].userId)}`)
    await mapOrm(op, 'tokens', 'save', [rowToken('t-sav')])
    console.log(`tokens save,   operatorId=${JSON.stringify(op)} -> userId=${JSON.stringify(captured['tokens.save'][0].userId)}`)
}
