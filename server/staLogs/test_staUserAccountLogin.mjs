
// import staUserAccountLogin from './staUserAccountLogin.mjs' //一般版
import staUserAccountLogin from './staUserAccountLogin.callWorker.mjs' //worker版

async function main() {
    let rs = await staUserAccountLogin(7, 'hr')
    console.log(JSON.stringify(rs, null, 2))
}
main()
// [
//   {
//     "time": "2025-07-11T12",
//     "data": {
//       "attempt": 0,
//       "success": 0,
//       "error": 0
//     }
//   },
//   {
//     "time": "2025-07-11T13",
//     "data": {
//       "attempt": 0,
//       "success": 0,
//       "error": 0
//     }
//   },
//   ...
// ]

//node server/staLogs/test_staUserAccountLogin.mjs
