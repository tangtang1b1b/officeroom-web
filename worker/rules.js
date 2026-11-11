// 伺服器規則的純函式(不依賴 Durable Object,方便單元測試)。時間單位:毫秒。
import { ROOM, PLAYER, COLLIDERS, SEATS, seatSpot } from '../shared/layout.js'
import { isBlocked } from '../shared/collision.js'

export const MOVE_SPEED_FACTOR = 1.3
export const MOVE_BUDGET_CAP = 2.0 // 公尺;約 0.6 秒的行走距離,容許短暫卡頓後的位置跳動
export const COLLISION_RADIUS_TOLERANCE = 0.01
export const MAX_SHOOT_ORIGIN_HORIZ = 1.5 // 伺服器位置會落後客戶端
export const SHOOT_ORIGIN_Y_MARGIN = 0.1
export const SIT_MAX_PLAYER_DIST = 1.5 // 坐下時玩家距座位中心上限
export const SIT_MAX_CLIENT_DIST = 0.1 // 客戶端回報的坐下位置與座位中心的容許誤差
export const SHOOT_COOLDOWN_MS = 150
export const CHAT_WINDOW_MS = 1000
export const CHAT_MAX_PER_WINDOW = 3
export const STATE_MAX_PER_SEC = 30
export const MESSAGE_MAX_PER_SEC = 60
export const JOIN_TIMEOUT_MS = 5_000
export const MAX_CONNECTIONS = 20
export const MAX_UNJOINED = 6
export const MAX_CONNECTIONS_PER_IP = 5
export const IDLE_CHECK_MS = 30_000
export const IDLE_TIMEOUT_MS = 60_000

// 閒置:超過 timeout 沒收到任何訊息
export function isIdle(lastMessageAt, now, timeoutMs = IDLE_TIMEOUT_MS) {
  return now - lastMessageAt > timeoutMs
}

// 連線名額檢查。sessions: 可迭代的 { joined, ip }。回傳 null(可接受)或拒絕原因。
export function checkAdmission(sessions, ip) {
  let total = 0
  let unjoined = 0
  let sameIp = 0
  for (const s of sessions) {
    total++
    if (!s.joined) unjoined++
    if (s.ip === ip) sameIp++
  }
  if (sameIp >= MAX_CONNECTIONS_PER_IP) return 'ip limit'
  if (unjoined >= MAX_UNJOINED) return 'too many unjoined'
  if (total >= MAX_CONNECTIONS) return 'too many connections'
  return null
}

// 固定視窗限頻。limiter: { start, count }。允許回傳 true 並計數。
export function createLimiter() {
  return { start: 0, count: 0 }
}
export function rateAllow(limiter, now, max, windowMs = 1000) {
  if (now - limiter.start >= windowMs) {
    limiter.start = now
    limiter.count = 0
  }
  if (limiter.count >= max) return false
  limiter.count++
  return true
}

// 簡單冷卻:回傳是否可執行,可執行時更新 holder[key]
export function cooldownReady(holder, key, now, ms) {
  if (now - holder[key] < ms) return false
  holder[key] = now
  return true
}

// ---- token bucket 移動檢查 ----
export function createMoveBucket(now) {
  return { budget: MOVE_BUDGET_CAP, at: now }
}

// player: { pos, pose, move }。依「目前記錄的姿勢」補充額度,消耗實際水平位移。
// 回傳 { ok, reason?, pos? };只有 ok 時才消耗額度,但任何情況都會補充並更新時間。
export function evaluateMove(player, newPos, now) {
  const bucket = player.move
  const dt = Math.max(0, (now - bucket.at) / 1000)
  bucket.at = now
  const rate = (PLAYER.walkSpeed[player.pose] ?? PLAYER.walkSpeed.stand) * MOVE_SPEED_FACTOR
  bucket.budget = Math.min(MOVE_BUDGET_CAP, bucket.budget + rate * dt)

  const dist = Math.hypot(newPos[0] - player.pos[0], newPos[2] - player.pos[2])
  if (dist > bucket.budget) return { ok: false, reason: 'speed' }
  if (isBlocked(newPos[0], newPos[2], PLAYER.radius - COLLISION_RADIUS_TOLERANCE)) {
    return { ok: false, reason: 'blocked' }
  }
  bucket.budget -= dist
  return { ok: true, pos: [newPos[0], 0, newPos[2]], cost: dist }
}

// 訪客名稱是否與座位表的員工名衝突(不分大小寫)
export function isNameReserved(name) {
  const n = String(name).toLowerCase()
  return SEATS.some((s) => s.name && s.name.toLowerCase() === n)
}

// 狀態更新規則(含坐姿)。player: { pos, pose, seatId, move }。
// 回傳 { pos, pose, yaw, pitch, correct };correct 為 true 表示應回傳 CORRECT(由呼叫端節流,內容為 pos)。
export function evaluateStateChange(player, msg, now) {
  const base = { yaw: msg.yaw, pitch: msg.pitch }
  if (player.pose === 'sit' && msg.pose === 'sit') {
    return { ...base, pos: player.pos, pose: 'sit', correct: false }
  }
  if (player.pose !== 'sit' && msg.pose === 'sit') {
    const spot = player.seatId ? seatSpot(player.seatId) : null
    const ok =
      spot &&
      Math.hypot(player.pos[0] - spot.x, player.pos[2] - spot.z) <= SIT_MAX_PLAYER_DIST &&
      Math.hypot(msg.pos[0] - spot.x, msg.pos[2] - spot.z) <= SIT_MAX_CLIENT_DIST
    if (!ok) return { ...base, pos: player.pos, pose: player.pose, correct: true }
    return { ...base, pos: [spot.x, 0, spot.z], pose: 'sit', correct: false }
  }
  const result = evaluateMove(player, msg.pos, now)
  if (player.pose === 'sit') {
    // 起身:失敗則留在座位
    if (!result.ok) return { ...base, pos: player.pos, pose: 'sit', correct: true }
    return { ...base, pos: result.pos, pose: msg.pose, correct: false }
  }
  return { ...base, pos: result.ok ? result.pos : player.pos, pose: msg.pose, correct: !result.ok }
}

// 選出生點:優先不與固定碰撞方塊重疊的候選,離現有玩家最遠者;全部重疊時退回不考慮方塊。
// points: [{x,z}];playerPositions: [[x,y,z]]
export function pickSpawnPoint(points, playerPositions) {
  const free = points.filter((sp) => !isBlocked(sp.x, sp.z, PLAYER.radius))
  const candidates = free.length > 0 ? free : points
  let best = candidates[0]
  let bestScore = -1
  for (const sp of candidates) {
    let score = Infinity
    for (const p of playerPositions) score = Math.min(score, Math.hypot(p[0] - sp.x, p[2] - sp.z))
    if (score > bestScore) {
      bestScore = score
      best = sp
    }
  }
  return best
}

// ---- 射擊起點 ----
const insideBox = (p, box) =>
  p[0] >= box.min[0] && p[0] <= box.max[0] &&
  p[1] >= box.min[1] && p[1] <= box.max[1] &&
  p[2] >= box.min[2] && p[2] <= box.max[2]

// pos: 伺服器記錄的玩家位置 [x,_,z]。水平距離寬鬆,y 限制在趴/站眼高範圍內。
export function isShootOriginValid(origin, pos) {
  if (Math.hypot(origin[0] - pos[0], origin[2] - pos[2]) > MAX_SHOOT_ORIGIN_HORIZ) return false
  const yMin = PLAYER.eyeHeight.prone - SHOOT_ORIGIN_Y_MARGIN
  const yMax = PLAYER.eyeHeight.stand + SHOOT_ORIGIN_Y_MARGIN
  if (origin[1] < yMin || origin[1] > yMax) return false
  if (origin[0] < ROOM.minX || origin[0] > ROOM.maxX) return false
  if (origin[1] < 0 || origin[1] > ROOM.height) return false
  if (origin[2] < ROOM.minZ || origin[2] > ROOM.maxZ) return false
  return !COLLIDERS.some((box) => insideBox(origin, box))
}

// 出生朝向:面向房間中心(yaw=0 朝 -z)
export function spawnYaw(x, z) {
  return Math.atan2(x, z)
}

// ---- Origin 檢查 ----
const LOCAL_HOSTNAMES = ['localhost', '127.0.0.1', '[::1]']
const hostnameOf = (host) => {
  try {
    return new URL('http://' + host).hostname
  } catch {
    return ''
  }
}

// 逗號分隔字串 -> 陣列(trim、去空字串);未設定時回 []
export function parseAllowedOrigins(str) {
  if (typeof str !== 'string') return []
  return str
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
}

const originOf = (s) => {
  try {
    const o = new URL(s).origin
    return o === 'null' ? null : o
  } catch {
    return null
  }
}

export function isOriginAllowed(origin, requestHost, allowedOrigins = []) {
  const requestLocal = LOCAL_HOSTNAMES.includes(hostnameOf(requestHost))
  if (origin === null || origin === undefined || origin === '') return requestLocal
  let u
  try {
    u = new URL(origin)
  } catch {
    return false
  }
  if (u.host === requestHost) return true
  if (u.origin !== 'null' && allowedOrigins.some((a) => originOf(a) === u.origin)) return true
  return requestLocal && LOCAL_HOSTNAMES.includes(u.hostname)
}
