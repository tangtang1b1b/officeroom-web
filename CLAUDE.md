## 分工規則
- 批次改檔、格式化、補 props → 派給 bulk-worker，可平行
- API、資料層、store → 派給 api-dev
- 跑 Vitest → 派給 tester，只回報摘要
- 全部完成後 → 派給 reviewer 審查
- 主對話只負責協調與整合，subagent 只回簡短摘要，不貼完整程式碼
- 單檔小修改直接自己做，不派工
