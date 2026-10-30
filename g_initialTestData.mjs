import getDiagBriefErr from 'wsemi/src/getDiagBriefErr.mjs'
import ds from './src/schema/index.mjs'
import { woItems } from './g_mOrm.mjs'
import genTestData from 'w-serv-orm/src/genTestData.mjs'


async function initialTestData() {

    //genTestData
    await genTestData(ds, woItems)

    console.log('finish.')
}

initialTestData()
    .catch((err) => {
        console.log('initialTestData catch', getDiagBriefErr(err)) //錯誤原文不印, 只給摘要 (ADR-101)
    })


//刪除舊檔與重建測試資料庫
//node g_initialTestData.mjs
