// import staToken from './staToken.mjs' //一般版
import staToken from './staToken.callWorker.mjs' //worker版

async function main() {
    let rs = await staToken(7, 'hr')
    console.log(JSON.stringify(rs, null, 2))
}
main()
// [
//   {
//     "time": "2025-07-11T12",
//     "data": {
//       "count": 342,
//       "id-for-admin": 342
//     }
//   },
//   {
//     "time": "2025-07-11T13",
//     "data": {
//       "count": 477,
//       "id-for-admin": 477
//     }
//   },
//   ...
// ]

//node server/staLogs/test_staToken.mjs
