// 工作量(ClickUp 未完成卡片數)→ 小幽靈。前後端共用的純函式。

// 這些狀態的卡片不算(比對時不分大小寫、去掉表情符號與標點;例如 "qa ready 👀" → "qa ready")
export const EXCLUDED_STATUSES = new Set([
  'in review',
  'pending',
  'block',
  'complete',
  'fixed',
  'stuck',
  'qa ready',
  'done',
  'resolved',
])
// ClickUp 狀態類型為這些的也算已完成
const FINISHED_STATUS_TYPES = new Set(['done', 'closed'])

// 一個人身邊最多顯示幾隻幽靈(卡片再多也只畫這麼多)
export const MAX_GHOSTS = 12

// ClickUp 使用者 id → 座位 id(座位表見 shared/layout.js)。只有這七位會有幽靈;其他成員直接忽略。
export const CLICKUP_USER_SEATS = {
  3640413: 'seat-will', // Will
  1039322: 'seat-yuhua', // Yuhua
  37730718: 'seat-3', // Amin
  89648572: 'seat-4', // Kai
  95403890: 'seat-6', // Sean
  101646376: 'seat-7', // Eric
  66797193: 'seat-8', // Sandy
}

export const normalizeStatus = (status) =>
  String(status ?? '')
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[-_]/g, ' ') // "in-review" / "qa_ready" 也視為 "in review" / "qa ready"
    .replace(/[^\p{L}\p{N}\s]/gu, '')
    .replace(/\s+/g, ' ')
    .trim()

// task.status 可能是字串("qa ready 👀")或物件({ status, type })
const statusOf = (task) => {
  const s = task.status
  if (s && typeof s === 'object') return { name: s.status, type: s.type }
  return { name: s, type: undefined }
}

export const isCounted = (task) => {
  const { name, type } = statusOf(task)
  if (type && FINISHED_STATUS_TYPES.has(String(type).toLowerCase())) return false
  return !EXCLUDED_STATUSES.has(normalizeStatus(name))
}

// tasks: ClickUp 任務陣列。回傳 { [seatId]: { open, overdue } };七位都有項目(沒卡片就是 0)。
// 多人共同指派的卡片,每位被指派的人各算一張。overdue:截止日已過(due_date 為毫秒時間戳字串)。
export function countWorkload(tasks, now = Date.now(), userSeats = CLICKUP_USER_SEATS) {
  const out = {}
  for (const seatId of Object.values(userSeats)) out[seatId] = { open: 0, overdue: 0 }
  for (const task of tasks) {
    if (!isCounted(task)) continue
    const due = task.due_date == null ? null : Number(task.due_date)
    const isOverdue = due !== null && Number.isFinite(due) && due < now
    const seen = new Set() // 同一張卡片同一個人只算一次
    for (const assignee of task.assignees ?? []) {
      const seatId = userSeats[assignee.id]
      if (!seatId || seen.has(seatId)) continue
      seen.add(seatId)
      out[seatId].open++
      if (isOverdue) out[seatId].overdue++
    }
  }
  return out
}

// 卡片數 → 要畫幾隻普通 / 逾期(紅色)幽靈
export function ghostPlan(open, overdue = 0, max = MAX_GHOSTS) {
  const total = Math.min(Math.max(0, Math.floor(open) || 0), max)
  const red = Math.min(Math.max(0, Math.floor(overdue) || 0), total)
  return { normal: total - red, overdue: red }
}
