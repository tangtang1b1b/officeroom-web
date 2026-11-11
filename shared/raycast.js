// 射線檢測純函式。dir 需為單位向量。pos 為玩家腳底位置。
import { ROOM, COLLIDERS, HIT_PARTS } from './layout.js'
import { objectBox } from './physics.js'

const EPS = 1e-9

// slab 法:射線 vs AABB。回傳 { distance, point, normal } 或 null。
// 起點在盒內時回傳 distance 0、point=origin 的命中。
export function raycastBox(origin, dir, min, max, maxDist = Infinity) {
  let tmin = -Infinity
  let tmax = Infinity
  let axis = -1
  let sign = 0
  for (let i = 0; i < 3; i++) {
    if (Math.abs(dir[i]) < EPS) {
      if (origin[i] < min[i] || origin[i] > max[i]) return null
      continue
    }
    let t1 = (min[i] - origin[i]) / dir[i]
    let t2 = (max[i] - origin[i]) / dir[i]
    let s = -1
    if (t1 > t2) {
      ;[t1, t2] = [t2, t1]
      s = 1
    }
    if (t1 > tmin) {
      tmin = t1
      axis = i
      sign = s
    }
    if (t2 < tmax) tmax = t2
    if (tmin > tmax) return null
  }
  if (tmax < 0) return null // 盒子在射線後方
  if (tmin < 0) {
    // 起點在盒內:回傳距離 0 的命中,法線取與射線主要方向相反的面
    let major = 0
    for (let i = 1; i < 3; i++) if (Math.abs(dir[i]) > Math.abs(dir[major])) major = i
    const n = [0, 0, 0]
    n[major] = dir[major] > 0 ? -1 : 1
    return { distance: 0, point: [origin[0], origin[1], origin[2]], normal: n }
  }
  if (axis < 0 || tmin > maxDist) return null
  const normal = [0, 0, 0]
  normal[axis] = sign
  return { distance: tmin, point: at(origin, dir, tmin), normal }
}

// 多個方塊取最近命中。boxes: [{ id?, min, max }]
export function raycastBoxes(origin, dir, boxes = COLLIDERS, maxDist = Infinity) {
  let best = null
  for (const box of boxes) {
    const hit = raycastBox(origin, dir, box.min, box.max, maxDist)
    if (hit && (!best || hit.distance < best.distance)) {
      best = { ...hit, box }
    }
  }
  return best
}

// 玩家命中:把射線轉到角色局部座標 (右, 上, 前) 後,對該姿勢的所有部位盒取最近命中。
// 前 = (-sin yaw, 0, -cos yaw)、右 = (cos yaw, 0, -sin yaw)。回傳 { distance, point, normal, part } 或 null。
export function raycastPlayer(origin, dir, pos, pose = 'stand', maxDist = Infinity, yaw = 0) {
  const parts = HIT_PARTS[pose] ?? HIT_PARTS.stand
  const s = Math.sin(yaw)
  const c = Math.cos(yaw)
  const fwd = [-s, 0, -c]
  const right = [c, 0, -s]
  const toLocal = (v) => [v[0] * right[0] + v[2] * right[2], v[1], v[0] * fwd[0] + v[2] * fwd[2]]
  const lo = toLocal([origin[0] - pos[0], origin[1] - pos[1], origin[2] - pos[2]])
  const ld = toLocal(dir)
  let best = null
  for (const part of Object.keys(parts)) {
    const hit = raycastBox(lo, ld, parts[part].min, parts[part].max, maxDist)
    if (hit && (!best || hit.distance < best.distance)) best = { ...hit, part }
  }
  if (!best) return null
  const [nr, ny, nf] = best.normal
  return {
    distance: best.distance,
    point: at(origin, dir, best.distance),
    // + 0 把 -0 正規化成 0
    normal: [nr * right[0] + nf * fwd[0] + 0, ny + 0, nr * right[2] + nf * fwd[2] + 0],
    part: best.part,
  }
}

// 房間內側六面(從內往外打)。起點需在房間內
export function raycastRoom(origin, dir, maxDist = Infinity) {
  const min = [ROOM.minX, 0, ROOM.minZ]
  const max = [ROOM.maxX, ROOM.height, ROOM.maxZ]
  let best = null
  for (let i = 0; i < 3; i++) {
    if (Math.abs(dir[i]) < EPS) continue
    const forward = dir[i] > 0
    const plane = forward ? max[i] : min[i]
    const t = (plane - origin[i]) / dir[i]
    if (t < 0 || t > maxDist) continue
    if (!best || t < best.distance) {
      const normal = [0, 0, 0]
      normal[i] = forward ? -1 : 1
      best = { distance: t, point: at(origin, dir, t), normal }
    }
  }
  if (best) {
    // 夾回邊界內避免浮點誤差
    best.point = best.point.map((v, i) => Math.min(max[i], Math.max(min[i], v)))
  }
  return best
}

// 整體檢測:房間、家具、玩家(略過 ignoreId)。
// players: [{ id, pos, pose, yaw }]。回傳 { kind: 'wall'|'box'|'object'|'player', distance, point, normal, targetId?, objectId? } 或 null
export function raycastWorld(origin, dir, { players = [], ignoreId = null, boxes = COLLIDERS, objects = [], maxDist = 100 } = {}) {
  let best = null
  const room = raycastRoom(origin, dir, maxDist)
  if (room) best = { kind: 'wall', ...room }
  const box = raycastBoxes(origin, dir, boxes, best ? best.distance : maxDist)
  if (box && (!best || box.distance < best.distance)) {
    best = { kind: 'box', distance: box.distance, point: box.point, normal: box.normal, boxId: box.box.id }
  }
  if (objects.length) {
    const hit = raycastBoxes(origin, dir, objects.map(objectBox), best ? best.distance : maxDist)
    if (hit && (!best || hit.distance < best.distance)) {
      best = { kind: 'object', distance: hit.distance, point: hit.point, normal: hit.normal, objectId: hit.box.id }
    }
  }
  for (const p of players) {
    if (p.id === ignoreId) continue
    const hit = raycastPlayer(origin, dir, p.pos, p.pose, best ? best.distance : maxDist, p.yaw ?? 0)
    if (hit && (!best || hit.distance < best.distance)) {
      best = { kind: 'player', ...hit, targetId: p.id }
    }
  }
  return best
}

function at(o, d, t) {
  return [o[0] + d[0] * t, o[1] + d[1] * t, o[2] + d[2] * t]
}
