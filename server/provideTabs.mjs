import axios from 'axios'
import ltdtpick from 'wsemi/src/ltdtpick.mjs'
import genPm from 'wsemi/src/genPm.mjs'


async function provideTabs(url, keyTable, group, rows) {
    //url: 伺服器提供的接入網址, 例如 http://localhost:11007/syncAndReplaceTabs?token={token}&keyTable={keyTable}
    //keyTable: 資料表名
    //from: 指陣列數據來源
    //rows: 陣列數據

    //pm
    let pm = genPm()

    // //ks
    // let ks = [
    //     'id',
    //     'order',
    //     'name',
    //     'email',
    //     'description',
    //     'from',
    //     'isAdmin',
    //     'userId',
    //     'timeCreate',
    //     'userIdUpdate',
    //     'timeUpdate',
    //     'isActive',
    // ]

    // //ltdtpick
    // users = ltdtpick(users, ks)

    // //rin
    // let rin = {
    //     from,
    //     users,
    // }
    // // rin = JSON.stringify(rin)

    // //axios
    // await axios({
    //     method: 'post',
    //     url,
    //     headers: { 'Content-Type': 'application/json; charset=utf-8' },
    //     data: rin,
    // })
    //     .then((res) => {
    //         // console.log(res)
    //         let r = {
    //             msg: '成功傳輸Users清單',
    //             res,
    //         }
    //         pm.resolve(r)
    //     })
    //     .catch((err) => {
    //         // console.log(err)
    //         let r = {
    //             msg: '無法傳輸Users清單',
    //             res: err,
    //         }
    //         pm.reject(r)
    //     })

    pm.reject(`incompleted`)

    return pm
}


export default provideTabs
