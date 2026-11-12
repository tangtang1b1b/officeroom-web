# .claude 設定說明(可整個資料夾複製到別的專案)

```text
.claude/
  CLAUDE.md                  短原則:分工規則 + 專案指令(換專案時只改最後兩行)
  agents/
    bulk-worker.md           haiku  — 易:機械批次
    api-dev.md               sonnet — 中:一般實作
    hard-dev.md              opus   — 難:安全 / 共用核心 / 並發
    reviewer.md              opus   — 高風險審查(唯讀)
  skills/
    write-plan/              討論完說「寫規劃書」→ 產出規劃書並印出可複製的執行 prompt
      SKILL.md
      plan-template.md
    dispatch/                說「執行規劃書」→ 依難度派給對應工人並整合
      SKILL.md
```

## 日常使用
1. 在強模型(opus)的對話裡討論需求。
2. 說「寫規劃書」→ 存到 `docs/plans/`,最後會給一段可複製的 prompt。
3. 在新對話(sonnet 即可)貼上那段 prompt,或在原對話說「執行規劃書」→ 自動依難度分派。

## 複製到別的專案
- 整個 `.claude/` 資料夾複製過去即可。
- 改 `CLAUDE.md` 最後的「專案指令」(測試指令、規劃書位置)。
- `launch.json` 是這個專案專用的,不要帶走。
