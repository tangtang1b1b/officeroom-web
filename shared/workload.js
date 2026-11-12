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

// 一個人身後最多顯示幾隻幽靈(卡片再多也只畫這麼多)
export const MAX_GHOSTS = 12
// 卡片超過這個數量就「融合」:每 FUSE_SIZE 張融合成 1 隻紅色幽靈,剩下不足的維持各 1 隻白色。
// 例:7 張 = 2 隻紅 + 1 隻白;4 張 = 1 紅 + 1 白;3 張以內各自一隻白色。
export const FUSE_THRESHOLD = 3
export const FUSE_SIZE = 3

// ClickUp 卡片優先度(由急到不急)與對應的幽靈大小倍率:越優先越大隻。沒設優先度視為普通。
export const PRIORITIES = ['urgent', 'high', 'normal', 'low']
export const PRIORITY_SCALE = { urgent: 1.7, high: 1.35, normal: 1.0, low: 0.8 }

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

// ClickUp 的 task.priority 是 { id, priority: 'urgent' | 'high' | 'normal' | 'low', ... } 或 null(沒設)
export const priorityOf = (task) => {
  const p = task.priority
  const name = typeof p === 'string' ? p : p?.priority
  const key = String(name ?? '').toLowerCase()
  if (PRIORITIES.includes(key)) return key
  return 'normal'
}

const emptyPriorities = () => ({ urgent: 0, high: 0, normal: 0, low: 0 })

export const isCounted = (task) => {
  const { name, type } = statusOf(task)
  if (type && FINISHED_STATUS_TYPES.has(String(type).toLowerCase())) return false
  return !EXCLUDED_STATUSES.has(normalizeStatus(name))
}

// tasks: ClickUp 任務陣列。回傳 { [seatId]: { open, overdue, priority: { urgent, high, normal, low } } };七位都有項目(沒卡片就是 0)。
// 多人共同指派的卡片,每位被指派的人各算一張。overdue:截止日已過(due_date 為毫秒時間戳字串)。
export function countWorkload(tasks, now = Date.now(), userSeats = CLICKUP_USER_SEATS) {
  const out = {}
  for (const seatId of Object.values(userSeats)) out[seatId] = { open: 0, overdue: 0, priority: emptyPriorities() }
  for (const task of tasks) {
    if (!isCounted(task)) continue
    const due = task.due_date == null ? null : Number(task.due_date)
    const isOverdue = due !== null && Number.isFinite(due) && due < now
    const priority = priorityOf(task)
    const seen = new Set() // 同一張卡片同一個人只算一次
    for (const assignee of task.assignees ?? []) {
      const seatId = userSeats[assignee.id]
      if (!seatId || seen.has(seatId)) continue
      seen.add(seatId)
      out[seatId].open++
      out[seatId].priority[priority]++
      if (isOverdue) out[seatId].overdue++
    }
  }
  return out
}

// 一個人的卡片 → 要畫的幽靈清單 [{ red, scale }],由大到小排好(第 0 隻最急)。
// record: { open, priority? }。priority 缺漏或加總不符時,不足的部分視為普通優先度。
// 1) 卡片依優先度由急到不急排序。
// 2) 3 張以內:每張各一隻白色幽靈,大小依自己的優先度。
// 3) 超過 3 張:由最急的開始,每 3 張融合成 1 隻紅色幽靈(大小依這 3 張裡最高的優先度);
//    剩下不足 3 張的(最不急的那幾張)各一隻白色幽靈。
// 4) 總隻數最多 MAX_GHOSTS(紅色優先保留)。
export function ghostPlan(record, max = MAX_GHOSTS) {
  const open = Math.max(0, Math.floor(typeof record === 'number' ? record : record?.open) || 0)
  const counts = (typeof record === 'object' && record?.priority) || {}
  const cards = []
  for (const key of PRIORITIES) {
    const n = Math.max(0, Math.floor(counts[key]) || 0)
    for (let i = 0; i < n && cards.length < open; i++) cards.push(key)
  }
  while (cards.length < open) cards.push('normal') // 沒標優先度的
  // 沒有任何優先度資料時,補上的 normal 排在最後面不影響排序(都是 normal)

  const scaleOf = (key) => PRIORITY_SCALE[key] ?? 1
  const ghosts = []
  if (cards.length <= FUSE_THRESHOLD) {
    for (const key of cards) ghosts.push({ red: false, scale: scaleOf(key) })
    return ghosts.slice(0, max)
  }
  const reds = Math.floor(cards.length / FUSE_SIZE)
  for (let k = 0; k < reds; k++) ghosts.push({ red: true, scale: scaleOf(cards[k * FUSE_SIZE]) })
  for (const key of cards.slice(reds * FUSE_SIZE)) ghosts.push({ red: false, scale: scaleOf(key) })
  return ghosts.slice(0, max)
}

// ---- 幽靈在角色身後的扇形排列(純計算,前端與測試共用) ----
// 第 0 排最近(3 隻:左後、正後、右後),往外每排多一點。
export const ROW_CAPACITY = [3, 4, 5]
export const ROW_HALF_ANGLE = [60, 62, 64] // 度:這一排左右各張開到身後幾度

// 第 i 隻幽靈在第幾排、排內第幾個
export const fanSlot = (i) => {
  let row = 0
  let left = i
  while (row < ROW_CAPACITY.length - 1 && left >= ROW_CAPACITY[row]) {
    left -= ROW_CAPACITY[row]
    row++
  }
  return { row, indexInRow: left }
}

// 這一排實際有幾隻(最後一排可能沒填滿)
const rowCount = (row, total) => {
  let before = 0
  for (let r = 0; r < row; r++) before += ROW_CAPACITY[r]
  return Math.max(0, Math.min(ROW_CAPACITY[row], total - before))
}

// 第 i 隻相對「正後方」的角度(度):0 = 正後方,負 = 左後,正 = 右後。
// 每一排由「正後方」往兩側依序填(最急、最大隻的排在正後方),所以第 0 排的順序是:正後、左後、右後。
export const fanAngle = (i, total) => {
  const { row, indexInRow } = fanSlot(i)
  const c = rowCount(row, total)
  if (c <= 1) return 0
  const half = ROW_HALF_ANGLE[row]
  const angles = Array.from({ length: c }, (_, j) => -half + (2 * half * j) / (c - 1))
  // 離正後方近的先填;距離相同時左邊先
  angles.sort((a, b) => Math.abs(a) - Math.abs(b) || a - b)
  return angles[indexInRow]
}
