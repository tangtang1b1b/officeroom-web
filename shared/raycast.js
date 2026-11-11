// 射線檢測純函式。dir 需為單位向量。pos 為玩家腳底位置。
import { ROOM, PLAYER, COLLIDERS } from './layout.js'

const EPS = 1e-9

// slab 法:射線 vs AABB。回傳 { distance, point, normal } 或 null(起點在盒內視為未命中)
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
  if (axis < 0 || tmin < 0 || tmin > maxDist) return null
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

// 直立圓柱(側面 + 上下蓋),高度依姿勢
export function raycastPlayer(origin, dir, pos, pose = 'stand', maxDist = Infinity) {
  const r = PLAYER.radius
  const h = PLAYER.bodyHeight[pose] ?? PLAYER.bodyHeight.stand
  const y0 = pos[1]
  const y1 = pos[1] + h
  let best = null
  const consider = (t, normal) => {
    if (t < 0 || t > maxDist) return
    if (!best || t < best.distance) best = { distance: t, point: at(origin, dir, t), normal }
  }

  // 側面:(ox+t dx - cx)^2 + (oz+t dz - cz)^2 = r^2
  const ox = origin[0] - pos[0]
  const oz = origin[2] - pos[2]
  const a = dir[0] * dir[0] + dir[2] * dir[2]
  if (a > EPS) {
    const b = 2 * (ox * dir[0] + oz * dir[2])
    const c = ox * ox + oz * oz - r * r
    const disc = b * b - 4 * a * c
    if (disc >= 0) {
      const t = (-b - Math.sqrt(disc)) / (2 * a)
      const y = origin[1] + t * dir[1]
      if (t >= 0 && y >= y0 && y <= y1) {
        const px = ox + t * dir[0]
        const pz = oz + t * dir[2]
        consider(t, [px / r, 0, pz / r])
      }
    }
  }
  // 上下蓋
  if (Math.abs(dir[1]) > EPS) {
    for (const [yy, ny] of [[y1, 1], [y0, -1]]) {
      const t = (yy - origin[1]) / dir[1]
      if (t < 0) continue
      const px = ox + t * dir[0]
      const pz = oz + t * dir[2]
      if (px * px + pz * pz <= r * r) consider(t, [0, ny, 0])
    }
  }
  return best
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
// players: [{ id, pos, pose }]。回傳 { kind: 'wall'|'box'|'player', distance, point, normal, targetId? } 或 null
export function raycastWorld(origin, dir, { players = [], ignoreId = null, boxes = COLLIDERS, maxDist = 100 } = {}) {
  let best = null
  const room = raycastRoom(origin, dir, maxDist)
  if (room) best = { kind: 'wall', ...room }
  const box = raycastBoxes(origin, dir, boxes, best ? best.distance : maxDist)
  if (box && (!best || box.distance < best.distance)) {
    best = { kind: 'box', distance: box.distance, point: box.point, normal: box.normal, boxId: box.box.id }
  }
  for (const p of players) {
    if (p.id === ignoreId) continue
    const hit = raycastPlayer(origin, dir, p.pos, p.pose, best ? best.distance : maxDist)
    if (hit && (!best || hit.distance < best.distance)) {
      best = { kind: 'player', ...hit, targetId: p.id }
    }
  }
  return best
}

function at(o, d, t) {
  return [o[0] + d[0] * t, o[1] + d[1] * t, o[2] + d[2] * t]
}
