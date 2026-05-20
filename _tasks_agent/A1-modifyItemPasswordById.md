# Agent 任務 A1: modifyItemPasswordById 統一風格

- **狀態**: done-pending-accept (agent 已改, 待 e2e-resetpassword admin-UI 驗證通過後才接受刪檔)
- **檔案**: src/components/LayoutContentUsers.vue (modifyItemPasswordById, ~line 1097)
- **目標**: 重構為 canonical core()+finally; updateLoading 在使用者確認 Yes 之後; 修 Yes-undefined / No-無catch bug (實測 bug 已不存在); 保留 $alert (row-action 無 form field, modal 適當)
- **canonical**: PageUser.submitChangePassword / 全域 §5.1
- **驗收**: e2e-resetpassword admin-UI (E2E-001~004) 通過 (見 _todo_tests/T2)
- **接受條件**: T2 綠 + 我讀過 diff 確認結構正確 → 刪此檔
