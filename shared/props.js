// 可被射走的物品(辦公椅、桌上螢幕、會客室的椅子與圓桌):清單、回復時間、簡易物理與碰撞疊加層的純函式。前後端共用。
//
// 狀態(PropsState)是普通物件 { [propId]: PropEntry },只放「目前被射走」(離開原位)的物品。
// PropEntry = {
//   id, kind: 'chair' | 'monitor' | 'table',
//   knockedAt, until,          // 最後一次被射的時間與回復時間(ms)
//   dir: [dx, dz],             // 最後一次被射的水平方向(單位向量;長度 0 時 [0, 0])
//   x, y, z,                   // 物品位置:xz 為中心,y 為底面高度
//   yaw,                       // 朝向(弧度,與 layout 的 yaw 同義)
//   vx, vy, vz,                // 速度(m/s)
//   spin,                      // 朝向角速度(rad/s)
//   tilt,                      // 倒下角度(0 = 直立,PROP_PHYSICS[kind].fallenTilt = 完全倒下/躺平)
//   moving,                    // true = 移動中(stepProps 會模擬);false = 靜止
//   moveMs,                    // 這次移動已模擬的時間(超過 PROP_MAX_MOVE_MS 強制停下)
// }
// 所有函式都不修改傳入的 state,而是回傳新的 state。
import { CHAIRS, DESKS, COLLIDERS, FIXTURES, MONITOR, PLAYER, ROOM, seatById } from './layout.js'
import { isBlocked, groundHeight, moveCircle, circleBlockedByBox, activeColliders, STEP_HEIGHT } from './collision.js'

// 回復時間(毫秒),從最後一次被射算起
export const PROP_RESTORE_MS = { chair: 20_000, monitor: 30_000, table: 30_000 }

// ---- 物理參數(試玩後調整) ----
export const PROP_GRAVITY = 9.8 // m/s²
export const PROP_STOP_SPEED = 0.05 // 在地上且水平速度低於此值即停下(m/s)
export const PROP_MAX_MOVE_MS = 3000 // 單次移動最長模擬時間,超過強制停下
export const PROP_SUBSTEP_MS = 10 // 模擬子步長(高速時避免穿過薄的隔板)
export const PROP_MAX_STEP_MS = 1000 // 單次 stepProps 最多模擬的時間(避免計時器停擺後一次追太多)
export const PROP_SUPPORT_MARGIN = 0.5 // 物品中心超出可站立面邊緣不到「半徑 × 此值」仍算被撐住(不會從兩張桌子間的細縫掉下去)
export const PROP_MAX_UP_SPEED = 2 // 向上速度上限(m/s);另外在空中(vy ≠ 0)被再射不再加向上速度,避免連射把物品越打越高
// 與 worker/rules.js 的 COLLISION_RADIUS_TOLERANCE 同值(伺服器容許玩家多進入障礙物的距離);
// shared 不引用 worker,所以在這裡寫同值,兩邊要一起改(tests/props-physics.test.js 會檢查一致)。
export const PROP_PLAYER_RADIUS_TOLERANCE = 0.01
export const PROP_PHYSICS = {
  chair: {
    knockSpeed: 3.5, // 每次被射加上的水平速度
    knockUp: 0, // 每次被射加上的向上速度
    knockSpin: 6, // 每次被射加上的角速度
    maxSpeed: 6, // 水平速度上限
    friction: 4, // 地面摩擦減速度(m/s²)
    bounce: 0.35, // 撞牆/家具的反彈係數(0 = 貼著滑,1 = 完全彈回)
    spinDamping: 3, // 角速度衰減率(1/s)
    tiltSpeed: 3.5, // 移動中倒下的速度(rad/s)
    fallenTilt: Math.PI / 2, // 停下時的倒下角度
    radius: 0.25, // 模擬時與牆/家具碰撞的圓半徑
    boxHalf: 0.25, // 碰撞盒半寬(正方形,不隨朝向旋轉;與原位盒同寬,射中瞬間不會長大罩住旁邊的玩家)
    uprightHeight: 1.15, // 直立時碰撞高度(與原位盒同高)
    fallenHeight: 0.6, // 倒下後碰撞高度
  },
  monitor: {
    knockSpeed: 3.2,
    knockUp: 0.8,
    knockSpin: 4,
    maxSpeed: 5,
    friction: 6,
    bounce: 0.3,
    spinDamping: 4,
    tiltSpeed: 6,
    fallenTilt: Math.PI / 2,
    landKeep: 0.5, // 落地時保留的水平速度比例
    // 落在高於地板的可站立面(桌面、沙發)上時,水平速度至少維持這麼快(沒有速度時沿射擊方向),
    // 一路滑出邊緣掉到地板 —— 螢幕被射後一定落地,不會停在自己或隔壁桌上
    surfaceSlideSpeed: 1.6,
    radius: 0.2,
    boxHalf: 0.22,
    uprightHeight: 0.32,
    fallenHeight: 0.12, // 躺著時碰撞高度;必須 > collision.js 的 STEP_HEIGHT(0.05),否則會被當成可跨過
  },
  // 會客室圓桌:比椅子重,滑得短(單次約 0.7m,連射上限約 1.5m)、側躺(桌面立起來,高度約等於直徑)
  table: {
    knockSpeed: 2.0,
    knockUp: 0,
    knockSpin: 1.5,
    maxSpeed: 3,
    friction: 3,
    bounce: 0.2,
    spinDamping: 3,
    tiltSpeed: 2.5,
    fallenTilt: Math.PI / 2,
    radius: 0.6,
    boxHalf: 0.6, // 與原位盒(1.2 × 1.2)同寬,射中瞬間不會長大罩住旁邊的玩家
    uprightHeight: 0.75,
    fallenHeight: 1.2, // 側躺:桌面立起來,高度 = 直徑
  },
}

// 個別物品的尺寸覆寫(與種類預設不同時):會客室椅子比辦公椅小,原位盒 0.45 × 0.45 × 0.9
const RECEPTION_CHAIR_DIMS = { radius: 0.225, boxHalf: 0.225, uprightHeight: 0.9, fallenHeight: 0.45 }

// ---- 螢幕的放大命中盒(只用在射線判定;物理碰撞與顯示不變) ----
// 螢幕本體只有 3 公分厚,很難瞄中:射線用的盒子水平各邊多 MONITOR_HIT_PAD 公尺(只放大寬度與厚度)。
// 頂面與底面維持真實高度 —— 頂面若加高,從對面射坐著同事的頭(坐姿頭部約 1.06~1.34)會先打到螢幕的放大盒。
// 原位:MONITOR_HIT_SIZE 為螢幕局部尺寸(w 沿螢幕寬、h 垂直、d 厚度),中心與螢幕中心相同 —— 客戶端瞄準代理 mesh 用這個尺寸。
// 移動後:propHitBox(entry)(propBox 水平各邊加 MONITOR_HIT_PAD,上下不變)。
export const MONITOR_HIT_PAD = 0.12
export const MONITOR_HIT_SIZE = {
  w: MONITOR.w + 2 * MONITOR_HIT_PAD,
  h: MONITOR.h,
  d: MONITOR.d + 2 * MONITOR_HIT_PAD,
}

export const monitorPropId = (deskId) => `${deskId}-monitor`

// 可射物品清單:{ id, kind, box, home: { x, y, z, yaw } }(box 即 COLLIDERS 裡同 id 的原位碰撞盒)
const colliderById = new Map(COLLIDERS.map((b) => [b.id, b]))
const homeOf = (box, yaw) => ({ x: (box.min[0] + box.max[0]) / 2, y: box.min[1], z: (box.min[2] + box.max[2]) / 2, yaw: yaw || 0 })
// 可射的固定家具(layout.js 的 FIXTURES id → 物品種類與尺寸覆寫)。沒有座位:不適用「有人坐就射不走」。
const FIXTURE_PROPS = {
  'reception-chair-w': { kind: 'chair', dims: RECEPTION_CHAIR_DIMS },
  'reception-chair-e': { kind: 'chair', dims: RECEPTION_CHAIR_DIMS },
  'reception-chair-s': { kind: 'chair', dims: RECEPTION_CHAIR_DIMS },
  'round-table': { kind: 'table' },
}
export const FIXTURE_PROP_IDS = Object.keys(FIXTURE_PROPS)
export const SHOOTABLE_PROPS = [
  ...CHAIRS.map((c) => {
    const box = colliderById.get(c.id)
    return { id: c.id, kind: 'chair', box, home: homeOf(box, c.yaw) }
  }),
  ...DESKS.map((d) => {
    const box = colliderById.get(monitorPropId(d.id))
    return { id: monitorPropId(d.id), kind: 'monitor', box, home: homeOf(box, d.yaw) }
  }),
  ...FIXTURES.filter((f) => FIXTURE_PROPS[f.id]).map((f) => {
    const box = colliderById.get(f.id)
    const { kind, dims } = FIXTURE_PROPS[f.id]
    return { id: f.id, kind, box, home: homeOf(box, f.yaw), ...(dims ? { dims } : {}) }
  }),
]
const PROP_BY_ID = new Map(SHOOTABLE_PROPS.map((p) => [p.id, p]))

export const propById = (id) => PROP_BY_ID.get(id) || null
export const isShootableProp = (id) => PROP_BY_ID.has(id)

export const createPropsState = () => ({})

export const isKnocked = (state, id) => Object.prototype.hasOwnProperty.call(state, id)

export const hasMovingProps = (state) => Object.values(state).some((e) => e.moving)

// ---- 碰撞盒與疊加層 ----

// 物品的物理與尺寸參數:種類預設(PROP_PHYSICS[kind])加上個別物品的尺寸覆寫(radius / boxHalf / uprightHeight / fallenHeight)。
// e 需有 id 與 kind。客戶端擺放模型(例如躺下時抬高半個厚度)也要用這個,不要直接讀 PROP_PHYSICS。
export const propDims = (e) => {
  const dims = PROP_BY_ID.get(e.id)?.dims
  return dims ? { ...PROP_PHYSICS[e.kind], ...dims } : PROP_PHYSICS[e.kind]
}

// 目前碰撞高度:依倒下角度在直立與倒下高度間內插
const propHeight = (e) => {
  const P = propDims(e)
  const k = Math.min(1, Math.max(0, e.tilt / P.fallenTilt))
  return P.uprightHeight + (P.fallenHeight - P.uprightHeight) * k
}

// 物品目前位置的碰撞盒 { id, min, max, standable: false };id 與原位盒相同(射線命中時可直接拿來再射)
export const propBox = (e, at = e) => {
  const P = propDims(e)
  const h = P.boxHalf
  return {
    id: e.id,
    min: [at.x - h, at.y, at.z - h],
    max: [at.x + h, at.y + propHeight(e), at.z + h],
    standable: false,
  }
}

// 碰撞疊加層:傳給 collision.js 的 isBlocked / moveCircle / groundHeight / standUpSpot、
// worker/rules.js 的 evaluateMove / evaluateHeight / evaluateStateChange / pickSpawnPoint / isShootOriginValid 的 disabled 參數。
// has(id):被射走物品的原位盒停用;boxes:被射走物品目前位置的碰撞盒(移動中與靜止都有)。
export const propsOverlay = (state) => {
  const ids = new Set(Object.keys(state))
  return { has: (id) => ids.has(id), boxes: Object.values(state).map((e) => propBox(e)) }
}

// 射線判定用的盒子(只有螢幕放大,其他物品與碰撞盒相同):原位與移動後的螢幕都只在水平各邊加 MONITOR_HIT_PAD。
const isMonitorId = (id) => PROP_BY_ID.get(id)?.kind === 'monitor'
const padBox = (box, pad) => ({
  ...box,
  min: [box.min[0] - pad, box.min[1], box.min[2] - pad],
  max: [box.max[0] + pad, box.max[1], box.max[2] + pad],
})
const hitBoxOf = (box) => (isMonitorId(box.id) ? padBox(box, MONITOR_HIT_PAD) : box)
const containsPoint = (box, p) =>
  p[0] >= box.min[0] && p[0] <= box.max[0] && p[1] >= box.min[1] && p[1] <= box.max[1] && p[2] >= box.min[2] && p[2] <= box.max[2]
// 移動後物品的射線盒(客戶端瞄準代理用;非螢幕即 propBox)
export const propHitBox = (e) => hitBoxOf(propBox(e))
// 原位物品的射線盒;不是可射物品回 null
export const homeHitBox = (id) => {
  const prop = propById(id)
  return prop ? hitBoxOf(prop.box) : null
}

// 射線檢測用的碰撞盒清單(raycastWorld 的 boxes):base 去掉原位盒、加上移動後的盒;
// 螢幕(原位與移動後)換成放大的命中盒,id 不變。stateOrOverlay 可傳 PropsState 或 propsOverlay 的結果。
// origin(可選,射線起點 [x, y, z]):起點在放大盒內、但不在真實盒內時,該螢幕改用真實盒
// (raycast 起點在盒內會回距離 0 的命中:例如趴在桌上頭伸到螢幕旁,否則朝哪開槍都只打到螢幕)。
export const propsRaycastBoxes = (stateOrOverlay, base = COLLIDERS, origin = null) => {
  const overlay = typeof stateOrOverlay?.has === 'function' ? stateOrOverlay : propsOverlay(stateOrOverlay || {})
  const o = Array.isArray(origin) && origin.length >= 3 && origin.every(Number.isFinite) ? origin : null
  return activeColliders(overlay, base).map((box) => {
    const hit = hitBoxOf(box)
    if (hit !== box && o && containsPoint(hit, o) && !containsPoint(box, o)) return box
    return hit
  })
}

// ---- 射中 ----

const horizontalDir = (dir) => {
  const dx = Number(dir?.[0]) || 0
  const dz = Number(dir?.length >= 3 ? dir[2] : dir?.[1]) || 0
  const len = Math.hypot(dx, dz)
  return len > 1e-9 ? [dx / len, dz / len] : [0, 0]
}

const freshEntry = (prop) => ({
  id: prop.id,
  kind: prop.kind,
  knockedAt: 0,
  until: 0,
  dir: [0, 0],
  x: prop.home.x,
  y: prop.home.y,
  z: prop.home.z,
  yaw: prop.home.yaw,
  vx: 0,
  vy: 0,
  vz: 0,
  spin: 0,
  tilt: 0,
  moving: false,
  moveMs: 0,
})

// 射中:給一次衝量並重新計算回復時間。可對已被射走(移動中或靜止)的物品重複呼叫。
// dir:射線方向 [x, y, z] 或 [x, z],只取水平分量。
// hitPoint(可選,[x, y, z]):命中點;偏離中心時決定旋轉方向(沒給時固定正向)。
// 不是可射物品 → 回 { state(原樣), entry: null }。「坐著的椅子不能射」由呼叫端判斷。
export const knockProp = (state, id, dir, now, hitPoint = null) => {
  const prop = propById(id)
  if (!prop) return { state, entry: null }
  const P = PROP_PHYSICS[prop.kind]
  const prev = isKnocked(state, id) ? state[id] : freshEntry(prop)
  const [dx, dz] = horizontalDir(dir)
  let vx = prev.vx + dx * P.knockSpeed
  let vz = prev.vz + dz * P.knockSpeed
  const speed = Math.hypot(vx, vz)
  if (speed > P.maxSpeed) {
    vx *= P.maxSpeed / speed
    vz *= P.maxSpeed / speed
  }
  let spinSign = 1
  if (hitPoint) {
    // 命中點相對中心的水平偏移與射線方向的外積:打在右側往一邊轉、左側往另一邊
    const cross = dx * (Number(hitPoint[2]) - prev.z) - dz * (Number(hitPoint[0]) - prev.x)
    if (Math.abs(cross) > 1e-6) spinSign = Math.sign(cross)
  }
  const entry = {
    ...prev,
    knockedAt: now,
    until: now + PROP_RESTORE_MS[prop.kind],
    dir: [dx, dz],
    vx,
    vz,
    // 在空中(vy ≠ 0)被再射:保留目前垂直速度,不再往上加(否則輪流連射可抵銷重力一路升高)
    vy: Math.min(PROP_MAX_UP_SPEED, prev.vy !== 0 ? prev.vy : P.knockUp),
    spin: prev.spin + spinSign * P.knockSpin,
    moving: true,
    moveMs: 0,
  }
  return { state: { ...state, [id]: entry }, entry }
}

// ---- 物理模擬 ----

const PARTITION_SUFFIX = '-partition'

// 會客室唯一出口(wall-b 與 wall-c 之間的門口)前的圓桌禁入區:只放在圓桌的模擬疊加層。
// 圓桌倒下後 1.2m 高、不可站立也跳不過,停在門口會把會客室裡的人困住。禁入區左右各比門口寬 TABLE_DOOR_SIDE_MARGIN、
// 往會客室內延伸 TABLE_DOOR_DEPTH:桌子(模擬用圓,碰撞盒是正方形,轉角最多多伸進 radius × (1 − 1/√2) ≈ 0.18)
// 任何射擊序列下都離門口至少一個玩家直徑以上,禁入區兩側沿牆也留得出通道。
export const TABLE_DOOR_SIDE_MARGIN = 0.6
export const TABLE_DOOR_DEPTH = 0.8
const wallB = colliderById.get('wall-b')
const wallC = colliderById.get('wall-c')
export const TABLE_KEEP_OUT = {
  id: 'round-table-keep-out',
  min: [wallB.max[0] - TABLE_DOOR_SIDE_MARGIN, 0, wallB.min[2]],
  max: [wallC.min[0] + TABLE_DOOR_SIDE_MARGIN, ROOM.height, wallB.max[2] + TABLE_DOOR_DEPTH],
  standable: false,
}

// 模擬用疊加層:可射物品(原位與移動後)原則上都不擋 —— 物品之間不互撞,只和固定的牆、家具、玩家碰。
// 例外:椅子與圓桌互相擋「還在原位」的對方(會客室椅子圍著圓桌,不會滑穿過去);被射走後就不擋。
// 螢幕另外忽略桌上隔板(隔板很矮,螢幕會翻過去);圓桌另外被門口禁入區(TABLE_KEEP_OUT)擋住。
// state:這次模擬開始時的 PropsState。
const simOverlay = (kind, state) => ({
  has: (id) => {
    if (kind === 'monitor' && id.endsWith(PARTITION_SUFFIX)) return true
    const other = PROP_BY_ID.get(id)
    if (!other) return false
    const solidPair = (kind === 'chair' && other.kind === 'table') || (kind === 'table' && other.kind === 'chair')
    return !(solidPair && !isKnocked(state, id))
  },
  boxes: kind === 'table' ? [TABLE_KEEP_OUT] : [],
})

// 物品腳下的支撐面:與 groundHeight 相同,但可站立面的範圍往外放寬 radius × PROP_SUPPORT_MARGIN。
// 回 { top, box }(地板:top = 0、box = null)
const supportAt = (x, z, y, radius, off) => {
  const m = radius * PROP_SUPPORT_MARGIN
  let g = 0
  let best = null
  for (const box of activeColliders(off)) {
    if (!box.standable) continue
    if (x < box.min[0] - m || x > box.max[0] + m || z < box.min[2] - m || z > box.max[2] + m) continue
    const top = box.max[1]
    if (top <= y + STEP_HEIGHT && top > g) {
      g = top
      best = box
    }
  }
  return { top: g, box: best }
}
const supportHeight = (x, z, y, radius, off) => supportAt(x, z, y, radius, off).top

// 在高於地板的支撐面上:水平速度至少 surfaceSlideSpeed(螢幕一路滑出桌緣落地)。
// 方向依序取目前速度、最後一次射擊方向、從支撐面中心往外。
const keepSliding = (e, P, box) => {
  const min = P.surfaceSlideSpeed
  if (!min || !box) return
  const speed = Math.hypot(e.vx, e.vz)
  if (speed >= min) return
  let u
  if (speed > 1e-6) u = [e.vx / speed, e.vz / speed]
  else if (Math.hypot(e.dir[0], e.dir[1]) > 1e-6) u = e.dir
  else {
    const ox = e.x - (box.min[0] + box.max[0]) / 2
    const oz = e.z - (box.min[2] + box.max[2]) / 2
    const len = Math.hypot(ox, oz)
    u = len > 1e-6 ? [ox / len, oz / len] : [1, 0]
  }
  e.vx = u[0] * min
  e.vz = u[1] * min
}

// 單一移動中物品前進 dt 秒(原地修改 e,e 為 stepProps 內的複本)
const stepEntry = (e, dt, off, players) => {
  const P = propDims(e)
  const h = propHeight(e)
  // 這一步開始時的位置與碰撞盒:已經和它重疊的玩家不算(避免物品被卡在原地;玩家那邊會被移動預測推出)
  const start = { x: e.x, y: e.y, z: e.z }
  const startBox = propBox(e)
  const hitsNewPlayer = (at) => {
    const box = propBox(e, at)
    return players.some((p) => touchesPlayer(box, p) && !touchesPlayer(startBox, p))
  }

  // 水平:碰撞牆/家具(moveCircle 推出並滑動,再依推出方向反彈),碰到玩家就停住
  const dx = e.vx * dt
  const dz = e.vz * dt
  let hitPlayer = false
  if (dx !== 0 || dz !== 0) {
    const moved = moveCircle(e.x, e.z, dx, dz, P.radius, e.y, off, h)
    if (hitsNewPlayer({ x: moved.x, y: e.y, z: moved.z })) {
      hitPlayer = true
      e.vx = 0
      e.vz = 0
    } else {
      const nx = moved.x - (e.x + dx)
      const nz = moved.z - (e.z + dz)
      const n = Math.hypot(nx, nz)
      if (n > 1e-6) {
        const ux = nx / n
        const uz = nz / n
        const vn = e.vx * ux + e.vz * uz
        if (vn < 0) {
          e.vx -= (1 + P.bounce) * vn * ux
          e.vz -= (1 + P.bounce) * vn * uz
        }
        e.spin *= 0.5
      }
      e.x = moved.x
      e.z = moved.z
    }
  }

  // 垂直:重力、落地
  const support = supportAt(e.x, e.z, e.y, P.radius, off)
  const ground = support.top
  let onGround = false
  if (e.y > ground + 1e-6 || e.vy > 0) {
    e.vy = Math.min(PROP_MAX_UP_SPEED, e.vy - PROP_GRAVITY * dt)
    e.y += e.vy * dt
    // 天花板:頂端不超過房間高度,碰到就往下彈
    const ceiling = ROOM.height - h
    if (e.y > ceiling) {
      e.y = ceiling
      if (e.vy > 0) e.vy = -e.vy * P.bounce
    }
    if (e.y <= ground) {
      e.y = ground
      e.vy = 0
      onGround = true
      const keep = P.landKeep ?? 1
      e.vx *= keep
      e.vz *= keep
      // 落下後若與家具側面重疊(例如貼著桌緣掉下),推出到最近的空位;推出後會碰到玩家就不推,
      // 不推也碰到就放回這一步開始的位置並停住
      const fixed = moveCircle(e.x, e.z, 0, 0, P.radius, e.y, off, h)
      if (!hitsNewPlayer({ x: fixed.x, y: e.y, z: fixed.z })) {
        e.x = fixed.x
        e.z = fixed.z
      } else if (hitsNewPlayer(e)) {
        Object.assign(e, start)
        hitPlayer = true
      } else {
        hitPlayer = true
      }
    }
  } else {
    e.y = ground
    e.vy = 0
    onGround = true
    const speed = Math.hypot(e.vx, e.vz)
    const next = Math.max(0, speed - P.friction * dt)
    if (speed > 0) {
      e.vx *= next / speed
      e.vz *= next / speed
    }
  }
  // 停在高於地板的面上(桌面、沙發)且沒碰到玩家:會滑的物品(螢幕)繼續滑向邊緣
  if (onGround && !hitPlayer && ground > 0 && e.y >= ground - 1e-9) keepSliding(e, P, support.box)

  e.yaw += e.spin * dt
  e.spin *= Math.max(0, 1 - P.spinDamping * dt)
  e.tilt = Math.min(P.fallenTilt, e.tilt + P.tiltSpeed * dt)
  e.moveMs += dt * 1000

  // 保險:位置一定在房間外接框內(下發的座標不會超出 protocol.js 的 COORD_LIMIT)
  e.x = Math.min(ROOM.maxX, Math.max(ROOM.minX, e.x))
  e.z = Math.min(ROOM.maxZ, Math.max(ROOM.minZ, e.z))
  e.y = Math.min(ROOM.height, Math.max(0, e.y))

  const slow = Math.hypot(e.vx, e.vz) < PROP_STOP_SPEED
  if ((onGround && (slow || hitPlayer)) || e.moveMs >= PROP_MAX_MOVE_MS) settle(e, off, hitsNewPlayer, start)
}

// 碰撞盒是否碰到玩家:半徑扣掉伺服器的容許值(玩家可合法多進入障礙物這麼多,不算碰到)
const touchesPlayer = (box, p) =>
  circleBlockedByBox(p.pos[0], p.pos[2], PLAYER.radius - PROP_PLAYER_RADIUS_TOLERANCE, p.pos[1] || 0, box)

// 停下:速度歸零、呈倒下狀態;若還在空中(只會在逾時或碰到玩家時發生)放到支撐面上。
// 放下去會碰到玩家就留在原高度;仍碰到(例如倒下)就放回這一步開始的位置。
const settle = (e, off, hitsNewPlayer = () => false, start = null) => {
  const P = propDims(e)
  const y = supportHeight(e.x, e.z, e.y, P.radius, off)
  if (!hitsNewPlayer({ x: e.x, y, z: e.z })) e.y = y
  else if (start && hitsNewPlayer(e)) Object.assign(e, start)
  e.vx = 0
  e.vy = 0
  e.vz = 0
  e.spin = 0
  e.tilt = P.fallenTilt
  e.moving = false
}

// 前進 dtMs 毫秒。players:[{ pos: [x, y, z] }](移動中的物品碰到玩家就停住,不推人)。
// 只模擬 moving 的物品;沒有移動中的物品(或 dtMs <= 0)時回傳同一個 state 物件。
export const stepProps = (state, dtMs, players = []) => {
  const total = Math.min(Number(dtMs) || 0, PROP_MAX_STEP_MS)
  if (total <= 0 || !hasMovingProps(state)) return state
  const people = players.filter((p) => Array.isArray(p?.pos))
  const next = { ...state }
  const moving = Object.values(state).filter((e) => e.moving).map((e) => ({ ...e, dir: [...e.dir] }))
  for (const e of moving) next[e.id] = e
  const n = Math.ceil(total / PROP_SUBSTEP_MS)
  const dt = total / n / 1000
  const overlays = Object.fromEntries(Object.keys(PROP_PHYSICS).map((kind) => [kind, simOverlay(kind, state)]))
  for (let i = 0; i < n; i++) {
    for (const e of moving) if (e.moving) stepEntry(e, dt, overlays[e.kind], people)
  }
  return next
}

// ---- 回復 ----

// 回復指定 id(不在 state 裡的忽略)。回 { state, restored: [id] }
export const restoreProps = (state, ids) => {
  const restored = [...new Set(ids)].filter((id) => isKnocked(state, id))
  if (restored.length === 0) return { state, restored }
  const next = { ...state }
  for (const id of restored) delete next[id]
  return { state: next, restored }
}

// 到期回復:until <= now 的全部回復
export const expireProps = (state, now) =>
  restoreProps(state, Object.values(state).filter((e) => e.until <= now).map((e) => e.id))

// 下一個到期時間(排計時器用);沒有被射走的物品回 null
export const nextExpiry = (state) => {
  let t = null
  for (const e of Object.values(state)) if (t === null || e.until < t) t = e.until
  return t
}

// 座位的椅子與螢幕 id;找不到座位回 []
export const seatPropIds = (seatId) => {
  const seat = seatById(seatId)
  return seat ? [seat.chairId, monitorPropId(seat.deskId)] : []
}

// 依座位強制回復(主人上線/離線:椅子+螢幕;坐下:只回復椅子,傳 { chairOnly: true })
export const restoreSeatProps = (state, seatId, { chairOnly = false } = {}) => {
  const ids = seatPropIds(seatId)
  return restoreProps(state, chairOnly ? ids.slice(0, 1) : ids)
}

// ---- 下發格式 ----

// 新格式(welcome / 快照):[{ id, kind, pos: [x, y, z], yaw, tilt, moving, remainingMs }]
export const propsSnapshot = (state, now) =>
  Object.values(state).map((e) => ({
    id: e.id,
    kind: e.kind,
    pos: [e.x, e.y, e.z],
    yaw: e.yaw,
    tilt: e.tilt,
    moving: e.moving,
    remainingMs: Math.max(0, e.until - now),
  }))

// ---- 被射走時,站在上面的玩家落地 ----

// 原位盒可站立的物品(圓桌)第一次被射離原位時,腳在它頂面高度以上、圓心在它範圍內的玩家失去支撐:
// 移到附近「地板」上的空位(不被移動中的物品擋住),避免往下掉進移動後的盒子裡卡住。
// prevState:射中「之前」的 PropsState(已被射走的物品不處理);players:[{ id, pos, pose? }](坐著的略過);
// disabled:射中「之後」的碰撞疊加層(propsOverlay(新 state))。回 [{ id, pos: [x, 0, z] }]。
export const dropPlayersOffProp = (prevState, id, players, disabled, radius = PLAYER.radius) => {
  const prop = propById(id)
  if (!prop || !prop.box.standable || isKnocked(prevState, id)) return []
  const b = prop.box
  const out = []
  for (const p of players) {
    if (p.pose === 'sit' || !Array.isArray(p.pos)) continue
    const [x, , z] = p.pos
    if ((p.pos[1] || 0) < b.max[1] - STEP_HEIGHT) continue
    if (x < b.min[0] || x > b.max[0] || z < b.min[2] || z > b.max[2]) continue
    const spot = findFreeSpot(x, z, 0, radius, disabled, true)
    if (spot) out.push({ id: p.id, pos: [spot.x, spot.y, spot.z] })
  }
  return out
}

// ---- 回復時推開玩家 ----

// 找空位:從 (x, z) 開始一圈圈往外試,第一個不被擋的點;都被擋回 null。floorOnly:只接受地板(支撐高度 0)
const RING_STEP = 0.1
const RING_MAX = 3
const RING_ANGLES = 16
const findFreeSpot = (x, z, y, radius, disabled, floorOnly = false) => {
  for (let r = RING_STEP; r <= RING_MAX + 1e-9; r += RING_STEP) {
    for (let i = 0; i < RING_ANGLES; i++) {
      const a = (i / RING_ANGLES) * Math.PI * 2
      const px = x + Math.cos(a) * r
      const pz = z + Math.sin(a) * r
      const g = groundHeight(px, pz, y, disabled)
      if (floorOnly && g > 0) continue
      if (!isBlocked(px, pz, radius, g, disabled)) return { x: px, z: pz, y: g }
    }
  }
  return null
}

// 回復時找出與「剛回到原位的物品」重疊的玩家,算出推出後位置。
// restoredIds:剛回復的 id(以原位碰撞盒判斷重疊);players:[{ id, pos: [x, y, z], pose? }](坐著的玩家略過);
// disabled:回復「之後」的碰撞疊加層(propsOverlay(回復後 state),或舊的 id Set / 陣列),
//   找推出位置時:仍被射走的物品原位視同不存在、移動後的盒照樣擋人。
// 回 [{ id, pos: [x, y, z] }],只含需要移動的玩家;y 為新位置腳下的支撐高度(不會比原本高)。
export const pushPlayersOutOfProps = (restoredIds, players, disabled = null, radius = PLAYER.radius) => {
  const boxes = restoredIds.map((id) => propById(id)?.box).filter(Boolean)
  if (boxes.length === 0) return []
  const out = []
  for (const p of players) {
    if (p.pose === 'sit') continue
    const [x, , z] = p.pos
    const y = p.pos[1] || 0
    if (!boxes.some((b) => circleBlockedByBox(x, z, radius, y, b))) continue
    let spot = null
    const moved = moveCircle(x, z, 0, 0, radius, y, disabled)
    if (moved.x !== x || moved.z !== z) {
      const g = groundHeight(moved.x, moved.z, y, disabled)
      if (!isBlocked(moved.x, moved.z, radius, g, disabled)) spot = { x: moved.x, z: moved.z, y: g }
    }
    if (!spot) spot = findFreeSpot(x, z, y, radius, disabled)
    if (spot) out.push({ id: p.id, pos: [spot.x, spot.y, spot.z] })
  }
  return out
}
