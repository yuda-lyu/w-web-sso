//tokens 表之寫入契約(應用系統金鑰, isApp === 'y'): 後台擁有之列, 嚴格整表比對.
//session 列(isApp 非 'y')由登入新增 / 續期改 timeEnd / 登出或封鎖刪除, 系統頻繁增刪, 另立 tokensSession 契約以逐列寬鬆比對處理
//(規格 §3「系統頻繁增刪之列」, 主控 2026-10-22 採選項 P; 見 sgud/rule/rulebook_concurrency.md R-CONC-03).
//- fields: userId 為擁有者(使用者用途為所綁使用者; 系統服務用途為建立者, 稽核用), 須入基準; timeEnd 為雙方欄位(refreshToken 會寫)
//- serverOnly: timeUpdate(每次 save 由 adjustData 重設, 編輯無法留存)、userIdUpdate(稽核);
//  appUsage / appName 為應用系統金鑰之用途與名稱(ADR-095): 只由 createAppToken 於鑄造時寫入、其後不可變更(後台清單存檔不寫入、不採用客戶端值), 故不入基準
export default {
    table: 'tokens',
    pk: 'id',
    fields: ['token', 'userId', 'isApp', 'perms', 'timeCreate', 'timeEnd'],
    serverOnly: ['timeUpdate', 'userIdUpdate', 'appUsage', 'appName'],
    scope: (r) => r.isApp === 'y',
}
