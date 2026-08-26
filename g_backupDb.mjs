import { woItems } from './g_mOrm.mjs'
import getDb from 'w-serv-orm/src/getDb.mjs'


getDb.backup(woItems)
// getDb.recover(woItems, './ooo.json')


//備份資料重與由備份資料重建資料庫
//node g_backupDb.mjs
