# Agent 任務 A5: LayoutContentUsers.saveUsers #1 loading 位置修 (deferred)

- **狀態**: deferred (待 register/resetpassword 清空再辦; 連動 3 個後台 e2e 測試成本高)
- **檔案**: src/components/LayoutContentUsers.vue (saveUsers, ~line 1386)
- **問題 #1**: updateLoading(true) 在 core 開頭、同步檢查(isError/empty-rows/self-lockout)之前 → 靠 ~7 處手動 updateLoading(false) 硬補
- **目標**: updateLoading(true) 移到同步檢查全過之後、實際 API save 之前; 移除冗餘手動 updateLoading(false); showCheckYes (非 $alert) 為刻意設計, 保留 (#4 by-design 不改)
- **canonical**: 全域 §5.1
- **連動測試**: e2e-adduser + e2e-deleteuser + e2e-modifyuser (T4/T5/T6) — baseline 應不變(截 settled 態), 但須驗
