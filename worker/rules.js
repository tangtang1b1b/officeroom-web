// 伺服器規則的純函式(不依賴 Durable Object,方便單元測試)。時間單位:毫秒。
import { ROOM, PLAYER, SEATS, seatSpot } from '../shared/layout.js'
import { isBlocked, groundHeight, activeColliders } from '../shared/collision.js'
import { MAX_HP } from '../shared/protocol.js'

export const MOVE_SPEED_FACTOR = 1.3
export const MOVE_BUDGET_CAP = 2.0 // 公尺;約 0.6 秒的行走距離,容許短暫卡頓後的位置跳動
export const COLLISION_RADIUS_TOLERANCE = 0.01
export const MAX_SHOOT_ORIGIN_HORIZ = 1.5 // 伺服器位置會落後客戶端
export const SHOOT_ORIGIN_Y_MARGIN = 0.1
export const SHOOT_ORIGIN_AIR_LAG = 0.6 // 跳躍中伺服器記錄的高度會落後客戶端
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

// ---- 血量 / 倒地 / 跳躍 ----
export const HIT_DAMAGE = 20 // 被打中一次扣的血(MAX_HP 100 → 5 發倒地)
export const DOWN_DURATION_MS = 10_000 // 倒地(只能趴著爬)到復活的時間
export const JUMP_REACH = 1.15 // 腳底最多離「腳下支撐面」這麼高(客戶端跳躍頂點 1.0m + 容許)
export const CLAIM_MAX_Y = ROOM.height - PLAYER.bodyHeight.stand + 0.05 // 客戶端回報的腳底高度上限:頭不能穿過天花板(與客戶端 MAX_FEET_Y 一致)
export const JUMP_MAX_AIR_MS = 1300 // 連續離地超過這個時間就強制落地(從桌上跳到地上約 1 秒)
export const DOWN_RECONNECT_KEEP_MS = DOWN_DURATION_MS // 倒地者斷線後保留狀態的時間,防止重連回滿血

// 倒地中:只能趴著移動,不能射擊,再被打不扣血也不延長時間
export const isDowned = (player, now) => (player.downedUntil ?? 0) > now

// 被打中。回傳 { damaged, downed }(downed:這發把血打到 0,進入倒地)
export function applyHit(player, now) {
  reviveIfReady(player, now) // 時間到但廣播計時器還沒跑到:先復活,避免滿血前被打一發就秒倒
  if (isDowned(player, now)) return { damaged: false, downed: false }
  player.hp = Math.max(0, player.hp - HIT_DAMAGE)
  if (player.hp > 0) return { damaged: true, downed: false }
  player.downedUntil = now + DOWN_DURATION_MS
  player.pose = 'prone'
  return { damaged: true, downed: true }
}

// 時間到就復活(回滿血、可以起身)。回傳是否剛復活。
export function reviveIfReady(player, now) {
  if (!player.downedUntil || now < player.downedUntil) return false
  player.downedUntil = 0
  player.hp = MAX_HP
  return true
}

export const downRemaining = (player, now) => Math.max(0, (player.downedUntil ?? 0) - now)

// 滯空時間限制:腳離開支撐面(ground)連續超過 JUMP_MAX_AIR_MS 就強制貼回支撐面,要先落地才能再離地。
// player 需有 airSince(離地開始時間,0 = 貼地)。回傳可採用的高度。
export function limitAirTime(player, y, now, ground = 0) {
  if (y <= ground + 0.01) {
    player.airSince = 0
    return ground
  }
  if (!player.airSince) player.airSince = now
  if (now - player.airSince > JUMP_MAX_AIR_MS) return ground // 超時:算貼地,但 airSince 保留,直到真的落地
  return y
}

// 站著才能離地;其他姿勢與倒地一律貼在支撐面(ground,例如桌面)上。回傳夾在 [ground, ground + JUMP_REACH] 的高度。
export function sanitizeJumpY(y, pose, downed, ground = 0) {
  if (pose !== 'stand' || downed) return ground
  if (!Number.isFinite(y)) return ground
  return Math.min(ground + JUMP_REACH, Math.max(ground, y))
}

// 客戶端回報的高度先夾在合理範圍
export const clampClaimY = (y) => (Number.isFinite(y) ? Math.min(CLAIM_MAX_Y, Math.max(0, y)) : 0)

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
// disabled:可選的停用碰撞盒 id 集合(被射走的物品),原樣傳給 isBlocked。
export function evaluateMove(player, newPos, now, disabled = null) {
  const bucket = player.move
  const dt = Math.max(0, (now - bucket.at) / 1000)
  bucket.at = now
  const rate = (PLAYER.walkSpeed[player.pose] ?? PLAYER.walkSpeed.stand) * MOVE_SPEED_FACTOR
  bucket.budget = Math.min(MOVE_BUDGET_CAP, bucket.budget + rate * dt)

  const dist = Math.hypot(newPos[0] - player.pos[0], newPos[2] - player.pos[2])
  if (dist > bucket.budget) return { ok: false, reason: 'speed' }
  if (isBlocked(newPos[0], newPos[2], PLAYER.radius - COLLISION_RADIUS_TOLERANCE, newPos[1] || 0, disabled)) {
    return { ok: false, reason: 'blocked' }
  }
  bucket.budget -= dist
  return { ok: true, pos: [newPos[0], 0, newPos[2]], cost: dist }
}

// 伺服器採用的腳底高度:先算新位置腳下的支撐面(參考高度取「上次記錄」與「回報值,最多比上次高一個跳躍」的較大者,
// 這樣被強制落地後仍能正確站回桌面),再依姿勢 / 倒地 / 滯空時間得到高度。
// 碰撞判定用這個高度,而不是客戶端回報的原始值,避免用假高度穿過家具。
export function evaluateHeight(player, msg, now, disabled = null) {
  const prevY = player.pos[1] || 0
  const claimY = clampClaimY(msg.pos[1])
  const downed = isDowned(player, now)
  const pose = downed ? 'prone' : msg.pose
  const ref = Math.max(prevY, Math.min(claimY, prevY + JUMP_REACH))
  const ground = groundHeight(msg.pos[0], msg.pos[2], ref, disabled)
  const y = limitAirTime(player, sanitizeJumpY(claimY, pose, downed, ground), now, ground)
  return { y, ground, prevY }
}

// ---- 被移下圓桌後的保護期 ----
// 伺服器把站在桌上的人移到地板(dropPlayersOffProp)後,客戶端在收到 CORRECT 前送出的舊 state
// (還在桌上、y > 0)會把人放回空中,讓移動中的桌子提早被擋停。保護期內這類 state 一律忽略(不回 CORRECT,避免洗版)。
export const DROP_GUARD_MS = 300

// 記錄保護期:area 為物品原位碰撞盒({ min, max })
export function setDropGuard(player, area, now) {
  player.dropGuard = { until: now + DROP_GUARD_MS, min: [...area.min], max: [...area.max] }
}

// 這筆 state 是否為保護期內的舊位置:在原位範圍內(水平放寬玩家半徑)且腳底高於地板。過期的保護自動清除。
export function isStaleDropState(player, msg, now) {
  const g = player.dropGuard
  if (!g) return false
  if (now >= g.until) {
    player.dropGuard = null
    return false
  }
  const [x, y, z] = msg.pos
  if (!(y > 0)) return false
  const r = PLAYER.radius
  return x >= g.min[0] - r && x <= g.max[0] + r && z >= g.min[2] - r && z <= g.max[2] + r
}

// 訪客名稱是否與座位表的員工名衝突(不分大小寫)
export function isNameReserved(name) {
  const n = String(name).toLowerCase()
  return SEATS.some((s) => s.name && s.name.toLowerCase() === n)
}

// 狀態更新規則(含坐姿)。player: { pos, pose, seatId, move }。
// 回傳 { pos, pose, yaw, pitch, correct };correct 為 true 表示應回傳 CORRECT(由呼叫端節流,內容為 pos)。
export function evaluateStateChange(player, msg, now, disabled = null) {
  reviveIfReady(player, now)
  // 倒地中只能趴著(不能蹲、起身)
  if (isDowned(player, now) && msg.pose !== 'prone') msg = { ...msg, pose: 'prone' }
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
  const result = evaluateMove(player, msg.pos, now, disabled)
  if (player.pose === 'sit') {
    // 起身:失敗則留在座位
    if (!result.ok) return { ...base, pos: player.pos, pose: 'sit', correct: true }
    return { ...base, pos: result.pos, pose: msg.pose, correct: false }
  }
  return { ...base, pos: result.ok ? result.pos : player.pos, pose: msg.pose, correct: !result.ok }
}

// 選出生點:優先不與固定碰撞方塊重疊的候選,離現有玩家最遠者;全部重疊時退回不考慮方塊。
// points: [{x,z}];playerPositions: [[x,y,z]]
export function pickSpawnPoint(points, playerPositions, disabled = null) {
  const free = points.filter((sp) => !isBlocked(sp.x, sp.z, PLAYER.radius, 0, disabled))
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
// disabled:可選的碰撞疊加層(停用 id 的 Set / 陣列,或 shared/props.js 的 propsOverlay):
// 被停用的方塊不算「射出點在方塊內」,疊加層的額外盒(移動後的物品)則算。
export function isShootOriginValid(origin, pos, airborne = false, disabled = null) {
  if (Math.hypot(origin[0] - pos[0], origin[2] - pos[2]) > MAX_SHOOT_ORIGIN_HORIZ) return false
  const base = pos[1] || 0 // 站在桌上 / 跳起來時,眼睛高度要加上腳底高度
  const lag = base > 0 || airborne ? SHOOT_ORIGIN_AIR_LAG : 0 // 貼地時維持嚴格;離地 / 在桌上 / 剛起跳時容許高度落後
  const yMin = base + PLAYER.eyeHeight.prone - SHOOT_ORIGIN_Y_MARGIN - lag
  const yMax = base + PLAYER.eyeHeight.stand + SHOOT_ORIGIN_Y_MARGIN + lag
  if (origin[1] < yMin || origin[1] > yMax) return false
  if (origin[0] < ROOM.minX || origin[0] > ROOM.maxX) return false
  if (origin[1] < 0 || origin[1] > ROOM.height) return false
  if (origin[2] < ROOM.minZ || origin[2] > ROOM.maxZ) return false
  return !activeColliders(disabled).some((box) => insideBox(origin, box))
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
