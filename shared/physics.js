// 簡化物理(純函式,俯視 xz 的圓形剛體)。伺服器權威使用,前端不跑。
// 物件:{ id, kind, x, z, yaw, vx, vz, w, radius, height, mass, canFall, state, downUntil, sleeping, sleepT, dirty }
// - state: 'up' | 'down';downUntil 為毫秒時間戳(倒下時才有意義)
// - dirty: 被外力喚醒或狀態改變,下一次 stepObjects 一定廣播一次
import { ROOM, PLAYER } from './layout.js'

export const MAX_SUBSTEP = 0.025
export const LINEAR_DAMPING = 4 // 1/s,指數阻尼
export const ANGULAR_DAMPING = 4
export const RESTITUTION = 0.3
export const SLEEP_SPEED = 0.05
export const SLEEP_SPIN = 0.1
export const SLEEP_TIME = 0.5
export const FALL_SPEED = 2.0
export const DOWN_DURATION_MS = 15000
export const PUSH_MAX_SPEED = 3
export const DOWN_HEIGHT_FACTOR = 0.4
export const DOWN_FOOTPRINT_EXTRA = 0.3 // 倒下時射線判定框的額外半徑(推擠/碰撞仍用圓形半徑)
export const MAX_OBJECT_SPEED = 8 // 水平速度上限,避免高速穿透
const PUSH_MARGIN = 0.001

export function createObjects(defs) {
  return defs.map((def) => makeObject(def))
}

function makeObject(def) {
  return {
    id: def.id,
    kind: def.kind,
    x: def.x,
    z: def.z,
    yaw: def.yaw,
    vx: 0,
    vz: 0,
    w: 0,
    radius: def.radius,
    height: def.height,
    mass: def.mass,
    canFall: def.canFall,
    state: 'up',
    downUntil: 0,
    sleeping: true,
    sleepT: 0,
    dirty: false,
  }
}

// 原地重置回初始狀態(依 id 對應 defs)
export function resetObjects(objects, defs) {
  for (const def of defs) {
    const obj = objects.find((o) => o.id === def.id)
    if (obj) Object.assign(obj, makeObject(def))
  }
  return objects
}

const round3 = (n) => Math.round(n * 1000) / 1000

// 廣播用格式
export function publicObject(obj) {
  return { id: obj.id, x: round3(obj.x), z: round3(obj.z), yaw: round3(obj.yaw), state: obj.state }
}

export function objectBox(obj) {
  const down = obj.state === 'down'
  const h = down ? obj.height * DOWN_HEIGHT_FACTOR : obj.height
  const e = down ? obj.radius + DOWN_FOOTPRINT_EXTRA : obj.radius
  return {
    id: obj.id,
    min: [obj.x - e, 0, obj.z - e],
    max: [obj.x + e, h, obj.z + e],
  }
}

export function clampSpeed(obj) {
  const sp = Math.hypot(obj.vx, obj.vz)
  if (sp > MAX_OBJECT_SPEED) {
    obj.vx = (obj.vx / sp) * MAX_OBJECT_SPEED
    obj.vz = (obj.vz / sp) * MAX_OBJECT_SPEED
  }
}

function wake(obj) {
  obj.sleeping = false
  obj.sleepT = 0
  obj.dirty = true
}

// 圓 vs AABB:回傳 { nx, nz, depth }(法線由方塊指向圓心)或 null
function circleVsBox(x, z, r, box) {
  const nearestX = Math.max(box.min[0], Math.min(x, box.max[0]))
  const nearestZ = Math.max(box.min[2], Math.min(z, box.max[2]))
  const dx = x - nearestX
  const dz = z - nearestZ
  const d2 = dx * dx + dz * dz
  if (d2 >= r * r) return null
  if (d2 > 1e-12) {
    const d = Math.sqrt(d2)
    return { nx: dx / d, nz: dz / d, depth: r - d }
  }
  // 圓心在盒內(或恰在邊上):沿最淺穿透軸推出
  const left = x - box.min[0]
  const right = box.max[0] - x
  const back = z - box.min[2]
  const front = box.max[2] - z
  const px = Math.min(left, right)
  const pz = Math.min(back, front)
  if (px <= pz) return { nx: left <= right ? -1 : 1, nz: 0, depth: px + r }
  return { nx: 0, nz: back <= front ? -1 : 1, depth: pz + r }
}

function collideRoom(obj, room) {
  const r = obj.radius
  if (obj.x < room.minX + r) {
    obj.x = room.minX + r
    if (obj.vx < 0) obj.vx = -obj.vx * RESTITUTION
  } else if (obj.x > room.maxX - r) {
    obj.x = room.maxX - r
    if (obj.vx > 0) obj.vx = -obj.vx * RESTITUTION
  }
  if (obj.z < room.minZ + r) {
    obj.z = room.minZ + r
    if (obj.vz < 0) obj.vz = -obj.vz * RESTITUTION
  } else if (obj.z > room.maxZ - r) {
    obj.z = room.maxZ - r
    if (obj.vz > 0) obj.vz = -obj.vz * RESTITUTION
  }
}

function collideStatics(obj, statics) {
  for (const box of statics) {
    const hit = circleVsBox(obj.x, obj.z, obj.radius, box)
    if (!hit) continue
    obj.x += hit.nx * hit.depth
    obj.z += hit.nz * hit.depth
    const vn = obj.vx * hit.nx + obj.vz * hit.nz
    if (vn < 0) {
      obj.vx -= (1 + RESTITUTION) * vn * hit.nx
      obj.vz -= (1 + RESTITUTION) * vn * hit.nz
    }
  }
  clampSpeed(obj)
}

function collidePair(a, b) {
  let dx = b.x - a.x
  let dz = b.z - a.z
  const min = a.radius + b.radius
  const d2 = dx * dx + dz * dz
  if (d2 >= min * min) return false
  let d = Math.sqrt(d2)
  if (d < 1e-6) {
    dx = 1
    dz = 0
    d = 1e-6
  } else {
    dx /= d
    dz /= d
  }
  const nx = d === 1e-6 ? 1 : dx
  const nz = d === 1e-6 ? 0 : dz
  const overlap = min - d
  const total = a.mass + b.mass
  a.x -= nx * overlap * (b.mass / total)
  a.z -= nz * overlap * (b.mass / total)
  b.x += nx * overlap * (a.mass / total)
  b.z += nz * overlap * (a.mass / total)
  const vn = (a.vx - b.vx) * nx + (a.vz - b.vz) * nz // >0 表示靠近
  if (vn > 0) {
    const j = ((1 + RESTITUTION) * vn) / (1 / a.mass + 1 / b.mass)
    a.vx -= (j / a.mass) * nx
    a.vz -= (j / a.mass) * nz
    b.vx += (j / b.mass) * nx
    b.vz += (j / b.mass) * nz
  }
  return true
}

function subStep(objects, h, statics, room) {
  // 積分 + 阻尼
  const lin = Math.exp(-LINEAR_DAMPING * h)
  const ang = Math.exp(-ANGULAR_DAMPING * h)
  for (const o of objects) {
    if (o.sleeping) continue
    o.x += o.vx * h
    o.z += o.vz * h
    o.yaw += o.w * h
    o.vx *= lin
    o.vz *= lin
    o.w *= ang
  }
  // 物件互推(睡著的被撞到會醒)
  for (let i = 0; i < objects.length; i++) {
    for (let j = i + 1; j < objects.length; j++) {
      const a = objects[i]
      const b = objects[j]
      if (a.sleeping && b.sleeping) continue
      if (collidePair(a, b)) {
        if (a.sleeping) wake(a)
        if (b.sleeping) wake(b)
      }
    }
  }
  // 固定物與房間最後處理,確保不穿透
  for (const o of objects) {
    if (o.sleeping) continue
    clampSpeed(o) // 物件互撞後先夾速度
    collideStatics(o, statics)
    collideRoom(o, room)
    clampSpeed(o)
  }
}

// 推進物理。回傳本步需廣播的物件 id 集合:醒著的、剛睡著的、被標記 dirty 的。
export function stepObjects(objects, dt, statics, room = ROOM) {
  const out = new Set()
  if (dt > 0 && objects.some((o) => !o.sleeping)) {
    const n = Math.max(1, Math.ceil(dt / MAX_SUBSTEP))
    const h = dt / n
    for (let i = 0; i < n; i++) subStep(objects, h, statics, room)
    for (const o of objects) {
      if (o.sleeping) continue
      out.add(o.id)
      const calm = Math.hypot(o.vx, o.vz) < SLEEP_SPEED && Math.abs(o.w) < SLEEP_SPIN
      o.sleepT = calm ? o.sleepT + dt : 0
      if (o.sleepT >= SLEEP_TIME) {
        o.sleeping = true
        o.sleepT = 0
        o.vx = 0
        o.vz = 0
        o.w = 0
      }
    }
  }
  for (const o of objects) {
    if (o.dirty) {
      out.add(o.id)
      o.dirty = false
    }
  }
  return out
}

// 衝量。水平衝量 = speed * |dir 的水平分量|(近乎垂直的射擊只給很小的水平速度)。now 毫秒。
// 已倒下的物件再被擊中不會延長 downUntil。
export function applyImpulse(obj, dir, speed, now, rng = Math.random) {
  const len = Math.hypot(dir[0], dir[2])
  if (len > 1e-6) {
    const s = speed * Math.min(1, len)
    obj.vx += ((dir[0] / len) * s) / obj.mass
    obj.vz += ((dir[2] / len) * s) / obj.mass
  }
  clampSpeed(obj)
  obj.w += (rng() < 0.5 ? -1 : 1) * (1.5 + rng() * 1.5)
  wake(obj)
  if (obj.canFall && obj.state !== 'down' && Math.hypot(obj.vx, obj.vz) >= FALL_SPEED) {
    obj.state = 'down'
    obj.downUntil = now + DOWN_DURATION_MS
  }
}

// 倒下時間到就扶正。回傳狀態改變的 id 集合(同時標記 dirty)。
export function tickStanding(objects, now) {
  const changed = new Set()
  for (const o of objects) {
    if (o.state === 'down' && now >= o.downUntil) {
      o.state = 'up'
      o.downUntil = 0
      o.dirty = true
      changed.add(o.id)
    }
  }
  return changed
}

// 玩家推物件。playerPos [x,y,z];playerVel [vx,vz] 或 [vx,vy,vz]。
// others:不含自己的其他物件。推不動(落點在固定物/房間外/其他物件內)回傳 false 且不修改物件。
// prevPos(選填):玩家移動前的位置。若玩家原本就與物件重疊,且新位置沒有更深入,
// 即使物件推不動也放行(回傳 true、不修改物件),避免玩家被卡死。
export function pushOutByPlayer(obj, playerPos, playerVel, statics, room = ROOM, others = [], prevPos = null) {
  const px = playerPos[0]
  const pz = playerPos[2]
  let dx = obj.x - px
  let dz = obj.z - pz
  const min = PLAYER.radius + obj.radius
  const d2 = dx * dx + dz * dz
  if (d2 >= min * min) return true
  const vx = playerVel[0]
  const vz = playerVel.length >= 3 ? playerVel[2] : playerVel[1]
  let d = Math.sqrt(d2)
  if (d < 1e-6) {
    // 完全重合:沿玩家速度方向推,沒有速度就任選 +x
    const sp = Math.hypot(vx, vz)
    dx = sp > 1e-6 ? vx / sp : 1
    dz = sp > 1e-6 ? vz / sp : 0
  } else {
    dx /= d
    dz /= d
  }
  const nx = dx
  const nz = dz
  let canPass = false
  if (prevPos) {
    const prevD = Math.hypot(obj.x - prevPos[0], obj.z - prevPos[2])
    canPass = prevD < min && d >= prevD - 1e-6
  }
  const nxPos = px + nx * (min + PUSH_MARGIN)
  const nzPos = pz + nz * (min + PUSH_MARGIN)

  // 落點合法性
  const r = obj.radius
  if (nxPos < room.minX + r || nxPos > room.maxX - r || nzPos < room.minZ + r || nzPos > room.maxZ - r) return canPass
  for (const box of statics) {
    if (circleVsBox(nxPos, nzPos, r, box)) return canPass
  }
  for (const other of others) {
    if (other === obj || other.id === obj.id) continue
    const od = Math.hypot(other.x - nxPos, other.z - nzPos)
    if (od < r + other.radius) return canPass
  }

  // 玩家速度水平上限
  let svx = vx
  let svz = vz
  const sp = Math.hypot(svx, svz)
  if (sp > PUSH_MAX_SPEED) {
    svx = (svx / sp) * PUSH_MAX_SPEED
    svz = (svz / sp) * PUSH_MAX_SPEED
  }
  const vn = Math.max(0, svx * nx + svz * nz)
  obj.x = nxPos
  obj.z = nzPos
  obj.vx += nx * vn
  obj.vz += nz * vn
  clampSpeed(obj)
  wake(obj)
  return true
}

// 玩家移到 pos 時推開附近重疊的物件;任一推不動(且不符合放行條件)則回滾已推動的物件並回傳 ok:false。
// 回傳 { ok, moved: 被推動的物件 id 陣列 }(失敗時 moved 為空)。
export function pushObjectsAround(objects, pos, vel, prevPos, statics, room = ROOM) {
  const reach = PLAYER.radius + 1
  const saved = new Map()
  for (const obj of objects) {
    if (Math.hypot(obj.x - pos[0], obj.z - pos[2]) > reach) continue
    const before = { ...obj }
    const others = objects.filter((o) => o !== obj)
    if (!pushOutByPlayer(obj, pos, vel, statics, room, others, prevPos)) {
      for (const [o, snap] of saved) Object.assign(o, snap)
      return { ok: false, moved: [] }
    }
    if (obj.x !== before.x || obj.z !== before.z) saved.set(obj, before)
  }
  return { ok: true, moved: [...saved.keys()].map((o) => o.id) }
}
