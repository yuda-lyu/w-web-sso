# Agent 任務 A2: register() 統一風格 (production code)

- **狀態**: pending-dispatch (等 e2e-login 跑完, 避免編輯 PageLogin.vue 觸發 dev server 重編譯打斷測試)
- **檔案**: src/components/PageLogin.vue (register, ~line 581; data() 加 regError; template register 區加紅字), server/procLang.mjs (缺的 i18n key 補 eng+cht)
- **目標**:
  1. data() 加 `regError: ''` (比照 loginError/resendError)
  2. template: register 送出鈕下方加 inline 紅字 `v-if="viewMode==='register' && regError"` (比照 line ~235 loginError 紅字)
  3. register() 改 canonical core()+finally(updateLoading 在內、無同步早退檢查則在 API 前): createUser 自己 catch → 後端錯誤映射成 inline regError; 成功 $alert + reset + viewMode='login'; 外層 catch console.log+$alert
  4. createUser 後端 reject 字串 (查 server/procCore.mjs createUser + procLang.mjs) → 對應 i18n inline key; 缺則補 eng+cht
- **canonical**: 全域 §5.1 (非同步提交統一寫法); 成功用 $alert (非阻塞), 非重導 → 用 finally
- **約束**: 只動 register 相關; 不動其他 method; 不動 baseline/test
- **驗收**: 我讀 diff 確認結構 + i18n key 正確; 連動 A3 (e2e rework) + T3 (e2e-register 驗證)
