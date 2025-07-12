// import staIp from './staIp.mjs' //一般版
import staIp from './staIp.callWorker.mjs' //worker版

async function main() {
    let rs = await staIp(7, 'hr')
    console.log(JSON.stringify(rs, null, 2))
}
main()
// [
//   {
//     "time": "2025-07-11T12",
//     "data": {
//       "count": 554,
//       "127.0.0.1": 554
//     }
//   },
//   {
//     "time": "2025-07-11T13",
//     "data": {
//       "count": 747,
//       "127.0.0.1": 747
//     }
//   },
//   ...
// ]

//node server/staLogs/test_staIp.mjs
