# Agent 任務 A6: LayoutContentIps.saveIps #1(+#4) (deferred / 待確認)

- **狀態**: deferred + 待使用者確認 (此功能無 e2e → 改了無法用 e2e 驗證, 違反「改 UI 就要測」; 需先決定是否補 e2e 或暫緩)
- **檔案**: src/components/LayoutContentIps.vue (saveIps, ~line 680)
- **問題**: #1 updateLoading(true) 在 isError 同步檢查前 (isError 寫死 '' 為死碼, 實際無 flash); #4 後端錯誤用 $alert (save 結果用 modal 可接受)
- **目標(若辦)**: updateLoading(true) 移到 isError 檢查後; #4 視 save 結果是否該 inline (無 form field, modal 可能合理)
- **阻擋**: 無 e2e 覆蓋 → 無法依原則驗證; 須先問使用者是否補 e2e 或暫緩
