# 後台新增使用者流程

## 觸發

管理員於 LayoutContentUsers.vue 後台 Users list 點擊「新增」按鈕，於資料表中插入一筆空白列就地填寫帳號 / 密碼 / 姓名 / Email / Redir 等欄位，再點「儲存」批次提交至後端。

## 重要流程
- 管理員於後台點新增, 填妥帳號/密碼/姓名/email/redir, 儲存成功（timeVerified 自動填 now, password 經 hash 寫入 DB）
- 管理員於後台點新增, 但點「儲存」前帳號為空, 前端 isError 攔下無法儲存
- 管理員於後台點新增, 但點「儲存」前密碼為空, 前端 isError 攔下無法儲存
- 管理員於後台點新增, 但點「儲存」前密碼不符策略（過短 / 缺字母 / 缺數字 / 缺特殊符號 / 黑名單等）, 前端只擋空值, 其他策略違反由後端 checkUserPassword reject 後以 CheckYes modal 顯示語系化訊息要 admin 點擊確認
- 管理員於後台點新增, 但點「儲存」前帳號與表中其他列重複, 前端 isError 攔下無法儲存
- 管理員於後台點新增, 但點「儲存」前 email 為空 / 格式錯 / 重複, 前端 isError 攔下無法儲存
- 管理員於後台點新增, 但點「儲存」前 redir 為空, 前端 isError 攔下無法儲存
- 管理員於後台點新增, 帳號或 email 與 DB 既有 row 衝突（同表內無重複但 ltdtDiffByKey 後重複）, 後端 ckKey reject
- 管理員於後台點新增, 點儲存時 token 已過期 / 已被刪, 後端 reject 'token expired'
- 管理員以非 admin token 呼叫 updateUsersList API, 後端 funCheckAdmin 判否 → 同樣 reject 'token expired'（不洩露身分檢查細節）
- 管理員於後台點新增, 但 rows 整張表為空（極少見：刪光所有列再儲存）, 前端以 CheckYes modal 顯示 'userAddEmpty' 後不送出
- 管理員於後台儲存時, 把自己列的 isAdmin 由 'y' 改為 'n', 前端以 CheckYes modal 顯示「不可解除自己的管理員權限」並不送出（後端為第二道防線同條訊息 reject）
- 管理員於後台儲存時, 把自己列的 isActive 由 'y' 改為 'n', 前端以 CheckYes modal 顯示「不可停用自己的帳號」並不送出（後端為第二道防線同條訊息 reject）
- 管理員儲存成功後, 前端緊接重拉 getUsersList, 表格刷新顯示後端寫入的 timeVerified=now、userId/userIdUpdate=操作者 id、order 重排等

## 執行流程

### 一、新增空白列（addItem）

```
001  管理員點「+」新增按鈕（僅 isEditable 顯示）  [LayoutContentUsers.vue:122]
002  addItem 取既有 vo.opt.rows 並 cloneDeep
003  vo.$ds.users.funNew() 產生新 row（id 用 genIDSeq, timeCreate=now,
        isActive='y', isForceChangePw='n', 其餘欄位由 dtmapping 補空字串）
004  填入暫時佔位字串:
        name = $s.getNameNew(rows, 'name', '', $t('userAddNameNew'))   //如「new user N」, 確保不撞名
        userId / timeCreate / userIdUpdate / timeUpdate = `{${$t('userAddIdNew')}}`
            （送至後端時由 procOrm 以實際操作者 id 與 nowms2str 覆寫,
              詳見「四、儲存」）
        _isNew = true   //transient flag, 標示此列為「未儲存的新列」, 用於 password 欄位顯示
                            為輸入框（非按鈕）並啟用密碼空值檢查; 送後端前由 saveUsers 剝除
005  將新 row 插入 rows 最首
006  vo.users = cloneDeep(rows) → 連帶驅動 computed 重算 items / opt.rows
007  isModified=true → 顯示紅底「儲存」按鈕
```

### 二、就地編輯欄位（資料表 cell-render）

```
account / email / redir / name / description / from / order
    可直接輸入文字; cell 顯示警告 icon 表示有 errItemsBy* 偵測到錯誤

password (新增列, _isNew=true)
    顯示為 WText 輸入框（type=password 預設遮罩）
    rightIcon 為眼睛 toggle: passwordVisible[id] 切換顯/隱明文
    @input → onPasswordInput(id, value) 寫回 row.password 並觸發 isModified
    cell 右側顯示警告 icon 若 cellPasswordErr(id) 非空（目前僅檢查空值）

password (既有列, _isNew=false 或 undefined)
    顯示為「重設密碼」按鈕 (本流程不負責設定既有使用者密碼)

isAdmin / isActive
    checkbox 形式; click 走 $dg.toggleItemIsAdminById / toggleItemIsActiveById, 切 'y' / 'n'

timeVerified / timeExpired / timeBlocked
    WTimeminute 日期時間選擇器, 解析後以 timemsTZ 格式寫回 row
```

### 三、即時前端驗證（computed）

```
errItemsByAccount
    每列 account 為空 → kpErr[<value>] = $t('userAccountEmpty')
    同表內 account 重複 → kpErr[<value>] = $t('userAccountDuplicate')

errItemsByEmail
    email 為空 → $t('userEmailEmpty')
    email 格式錯誤（!isEmail）→ $t('userEmailError')
    同表內 email 重複 → $t('userEmailDuplicate')

errItemsByRedir
    redir 為空 → $t('userRedirEmpty')

errItemsByPassword
    僅檢查 _isNew=true 之列;
    password 為空 → kpErr[<row.id>] = $t('userPasswordEmpty')
    （其他 policy 違反不在前端檢查, 由後端 checkUserPassword 把關）

isError computed（整體錯誤訊息）
    errItemsByAccount 非空 → $t('errInAccounts')
    errItemsByEmail   非空 → $t('errInEmails')
    errItemsByRedir   非空 → $t('errInRedir')
    errItemsByPassword 非空 → $t('errInPasswords')
    cellFieldErr 在 cell 顯示警告 icon + tooltip 細節錯誤;
    cellPasswordErr 同樣機制但 lookup 鍵為 row.id（password 不適合做 key）
```

### 四、儲存（saveUsers）

```
001  管理員點紅底「儲存」按鈕（僅 isEditable && isModified 顯示）
002  $ui.updateLoading(true)
003  檢查 isError
004      非空字串:
005          hideLoading + await showCheckYes(isError) 後 return（不送後端）
006  rows = vo.opt.rows
007  檢查 rows 是否為空 → 為空 hideLoading + await showCheckYes('userAddEmpty') return
008  自我鎖死保護（前端第一道）:
009      尋找 rows 內 row.id === userSelf.id
010      若該列 isAdmin !== 'y' → hideLoading + await showCheckYes('cannotDemoteSelf') return
011      若該列 isActive !== 'y' → hideLoading + await showCheckYes('cannotDisableSelf') return
012  剝除 transient flag _isNew (不送後端)
013  vo.$fapi.updateUsersList(token, lang, rows) 批次提交
014      handler 帶入 funCheckAdmin 後呼叫 p.checkTokenAndUpdateUsersList(token, lang, rows, opt)
015          checkToken({ fun: funCheckAdmin })
016              token 為空 / 過期 / 無效 → reject('invalid token' / 'token expired')
017              token 有效但 funCheckAdmin 回 false（非 admin）→ b2=false → reject('token expired')
018                  （注意: 此路徑不分歧錯誤訊息, 與真過期共用同一字串）
019          getUserByToken 取操作者 → operatorId
020          自我鎖死保護（後端第二道, 與前端同條訊息）:
021              rows 內找操作者 row, 若 isAdmin !== 'y' → reject('cannotDemoteSelf')
022                                     若 isActive !== 'y' → reject('cannotDisableSelf')
023          updateUsersList(rows, { lang, operatorId }) 委派
024              updateTabItems('users', rows, 'id', { resetOrder: true, lang, operatorId })
025                  ltdtmapping(rows, ds.users.keys) 補齊缺失欄位
026                  resetOrder: rows 依陣列順序重指派 order = k+1
027                  ckKey('id'): 表內 id 不可為空或重複 → reject 'rows[k].id is not effective / ... is duplicate'
028                  ckKey('email'): 表內 email 不可為空或重複 → reject 同上格式
029                  ltdtOld = woItems.users.select() 取 DB 既有資料
030                  既有 row password 保留: 將 ltdtOld 內對應 id 的 password (hash) 寫回 rows 該列
031                      （getUsersList 已 strip password, 前端送回的 password 是 '', 此步避免覆蓋既有 hash）
032                  ltdtDiffByKey(ltdtOld, rows, 'id') 拆 add / diff / del 三組
033                  add 群組（新增列）:
034                      checkUserPassword(lang, row.password, { account: row.account })
035                          state==='error' → reject 對應語系化錯誤訊息 (空、過短、缺字母、黑名單等)
036                      row.password = hashPassword(明文, salt)
037                      若 timeVerified 為空 → row.timeVerified = now2str()
038                      procOrm(operatorId, 'users', 'insert', r.add) 寫入 DB
039                          procOrm 內部對 add 群組自動覆寫:
040                              userId = operatorId
041                              timeCreate = now
042                              userIdUpdate = operatorId
043                              timeUpdate = now
044                  diff 群組（既有 row 有變動）:
045                      procOrm(operatorId, 'users', 'save', r.diff)
046                          procOrm 內部對 save 群組自動覆寫:
047                              userIdUpdate = operatorId
048                              timeUpdate = now
049                          （password 已在步驟 030 還原為 DB hash, save 時 merge 不會覆蓋）
050                  del 群組:
051                      procOrm(operatorId, 'users', 'del', r.del)
052                  return ltdtNew (剝除 password 欄位避免 hash 經 API 洩漏)
053  .catch err → errTemp = err
054  errTemp 非 null:
055      hideLoading + await $dg.showCheckYes(`${$t('userSaveUsersFail')}: ${errTemp}`) 後 return
            （改用 modal 強制 admin 點擊確認, 避免 transient toast 漏看後端錯誤訊息）
056  $fapi.getUsersList(token) 重拉同步, 覆寫 vo.users
057      （讓 timeVerified=now、userId/userIdUpdate=operatorId、order 重排等後端寫入結果立即顯示）
058  isModified = false（紅底儲存按鈕收起）
059  hideLoading + await showCheckYes($t('userSaveUsersSuccess'))
```

### 五、衍生操作（同一表共用 saveUsers 路徑）

```
copyItem
    對勾選的單一列 cloneDeep, 換新 id（funNew 產的）, 占位 userId/time*,
    清空 password, 標記 _isNew=true, 插入最首
    儲存路徑與 addItem 完全相同（走 add 群組）

deleteItemsCheck
    對 itemsCheck 多選列從 rows 過濾掉, isModified=true
    儲存時 ltdtDiffByKey 將其放入 del 群組

toggleItemIsAdminById / toggleItemIsActiveById
    checkbox click → 切 'y'/'n'，isModified=true
    儲存時走 diff 群組（procOrm save）;
    若被切的列 id === userSelf.id 且新值非 'y', 儲存階段會被自我鎖死保護擋下
```

### 六、新增使用者欄位預設值

| 欄位 | 預設值來源 | 備註 |
|---|---|---|
| id | `genIDSeq()` (前端 funNew) | 後端 procOrm insert 不覆寫 |
| password | `''`，由 admin 就地輸入明文 | 後端在 add 群組 checkUserPassword + hashPassword 後寫入 |
| timeCreate | 前端佔位 → 後端 procOrm 覆寫為 now |  |
| timeUpdate | 前端佔位 → 後端 procOrm 覆寫為 now |  |
| userId | 前端佔位 → 後端 procOrm 覆寫為操作者 id | audit: 此 user 由哪個 admin 建立 |
| userIdUpdate | 前端佔位 → 後端 procOrm 覆寫為操作者 id | audit: 此 user 最後由哪個 admin 變更 |
| isActive | `'y'` (funNew 預設) | checkbox 可改 |
| isForceChangePw | `'n'` (funNew 預設) |  |
| timeVerified | 前端 `''` → 後端在 insert 階段填 now | 後台建帳即已驗證, 不寄驗證信 |
| isAdmin | `''` (dtmapping 預設) | checkbox 可改, 預設視同 'n' |
| order | 前端不指定 → 後端 resetOrder 重排 |  |
| timeExpired / timeBlocked | `''` | 可選輸入 |
| tokenVerify | `''` | 後台建帳不產生（不寄驗證信） |
| _isNew (transient) | `true` (addItem 設置) | 送後端前由 saveUsers 剝除 |

### 七、安全性 / 設計取捨

| 項目 | 處理方式 / trade-off |
|---|---|
| 非 admin 呼叫 updateUsersList | funCheckAdmin 判否 → checkToken 端 b2=false → reject('token expired')。**訊息與「真過期」共用**，不分歧；簡化但無法區分「token 還在但身分不夠」與「token 已過期」。Admin UI 受 isEditable 與選單可見性保護，正常操作不會誤觸 |
| admin 就地輸入新使用者密碼 | 設計上允許（用於臨時展示帳號、代建帳號等帳密已知情境）。前端只擋空值, 其他 policy 由後端 `checkUserPassword` 把關；通過後 `hashPassword(salt)` 寫入。回傳前剝除 password 避免 hash 從 API 流出 |
| 既有使用者 password 不可由本流程修改 | password 欄位對既有列顯示為「重設密碼」按鈕（走另一條獨立 API）。後端 saveUsers 流程在 ltdtDiffByKey 前把 ltdtOld 內既有 password 寫回新 rows, 防止前端送回 `''` 經 procOrm save 把 DB hash 洗掉（修補先前隱性 bug） |
| 自我鎖死保護 | rows 內若包含操作者本人, 不允許將自己 isAdmin 或 isActive 改為非 'y'。前端先擋（清楚錯誤訊息）, 後端為第二道防線同條訊息 reject |
| 批次儲存 | 整表 ltdtDiffByKey 一次同步 add / diff / del；簡化前後端互動，但 admin 中途編輯多列任一驗證錯誤即整批不能儲存（ckKey / checkUserPassword 對整批 reject） |
| timeVerified 自動填 now | 後台建帳預設已驗證, 不寄驗證信、不產生 tokenVerify；admin 信任邊界內可接受。若需「後台建帳但要求使用者驗證信」, 須另設旗標, 目前不支援 |
| 儲存後立即重拉 getUsersList | 後端在 add 群組會寫入 timeVerified=now、procOrm 會覆寫 audit fields, 不重拉前端會持續顯示舊值。重拉成本：一次 API 呼叫, 換 admin 看到正確結果, 划算 |
