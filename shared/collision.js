// 2D 碰撞(俯視 xz)。前後端共用:圓形玩家 vs ROOM 邊界與 COLLIDERS 的 AABB。
import { ROOM, PLAYER, COLLIDERS, minZAt, WALL_SLANT, seatSpot } from './layout.js'

const circleHitsBox = (x, z, radius, box) => {
  const nearestX = Math.max(box.min[0], Math.min(x, box.max[0]))
  const nearestZ = Math.max(box.min[2], Math.min(z, box.max[2]))
  const dx = x - nearestX
  const dz = z - nearestZ
  return dx * dx + dz * dz < radius * radius
}

// 腳底高度 y 的角色身體佔 [y, y + 身高]。方塊只有在高度範圍與身體重疊時才擋人:
// 頂面不高於腳底(+ 一小段容許)的方塊不擋,所以跳到桌面上後可以在桌上走;桌上的隔板、螢幕仍會擋。
// y = 0 時與原本「所有方塊都擋」的行為相同。
export const STEP_HEIGHT = 0.05
const BODY_HEIGHT = PLAYER.bodyHeight.stand
const affects = (box, y) => box.max[1] > y + STEP_HEIGHT && box.min[1] < y + BODY_HEIGHT

// 腳底在 y、圓心在 (x, z) 時,腳下的支撐高度:圓心在可站立方塊(桌子、沙發)範圍內且頂面不高於 y + STEP 的最高頂面;否則 0。
export const groundHeight = (x, z, y = 0) => {
  let g = 0
  for (const box of COLLIDERS) {
    if (!box.standable) continue
    if (x < box.min[0] || x > box.max[0] || z < box.min[2] || z > box.max[2]) continue
    const top = box.max[1]
    if (top <= y + STEP_HEIGHT && top > g) g = top
  }
  return g
}

export const isBlocked = (x, z, radius = PLAYER.radius, y = 0) => {
  if (x - radius < ROOM.minX || x + radius > ROOM.maxX) return true
  if (z + radius > ROOM.maxZ) return true
  // -z 側是斜牆:以圓心 x 處的牆線為準,斜率約 0.2,距離換算乘上 1/cos
  if (z - radius * 1.02 < minZAt(x)) return true
  return COLLIDERS.some((box) => affects(box, y) && circleHitsBox(x, z, radius, box))
}

// 圓形角色的移動:先走完整位移,若被擋則把圓心從重疊的障礙物「推出」(沿最近點法線),
// 讓角色能沿牆、沿斜牆與方塊轉角順暢滑動,不會像逐軸判斷那樣卡在斜牆或轉角上。
const SLANT_NORM = Math.sqrt(1 + ((WALL_SLANT.z1 - WALL_SLANT.z0) / (WALL_SLANT.x1 - WALL_SLANT.x0)) ** 2)
const SLANT_SLOPE = (WALL_SLANT.z1 - WALL_SLANT.z0) / (WALL_SLANT.x1 - WALL_SLANT.x0)
const EPS = 0.002

const pushOut = (pos, radius, y = 0) => {
  let moved = false
  if (pos.x - radius < ROOM.minX) { pos.x = ROOM.minX + radius; moved = true }
  if (pos.x + radius > ROOM.maxX) { pos.x = ROOM.maxX - radius; moved = true }
  if (pos.z + radius > ROOM.maxZ) { pos.z = ROOM.maxZ - radius; moved = true }
  // 斜牆:有號距離 d = (z - minZAt(x)) / SLANT_NORM,法線 (-slope, 1) / SLANT_NORM
  const d = (pos.z - minZAt(pos.x)) / SLANT_NORM
  if (d < radius * 1.0) {
    const push = radius - d + EPS
    pos.x += (-SLANT_SLOPE / SLANT_NORM) * push
    pos.z += (1 / SLANT_NORM) * push
    moved = true
  }
  for (const box of COLLIDERS) {
    if (!affects(box, y)) continue
    const nx = Math.max(box.min[0], Math.min(pos.x, box.max[0]))
    const nz = Math.max(box.min[2], Math.min(pos.z, box.max[2]))
    const dx = pos.x - nx
    const dz = pos.z - nz
    const dist2 = dx * dx + dz * dz
    if (dist2 >= radius * radius) continue
    moved = true
    if (dist2 > 1e-10) {
      const dist = Math.sqrt(dist2)
      const push = radius - dist + EPS
      pos.x += (dx / dist) * push
      pos.z += (dz / dist) * push
    } else {
      // 圓心在方塊內:往最近的一面推出
      const exits = [
        [pos.x - box.min[0] + radius, -1, 0],
        [box.max[0] - pos.x + radius, 1, 0],
        [pos.z - box.min[2] + radius, 0, -1],
        [box.max[2] - pos.z + radius, 0, 1],
      ].sort((a, b) => a[0] - b[0])[0]
      pos.x += exits[1] * (exits[0] + EPS)
      pos.z += exits[2] * (exits[0] + EPS)
    }
  }
  return moved
}

export const moveCircle = (x, z, dx, dz, radius = PLAYER.radius, y = 0) => {
  const pos = { x: x + dx, z: z + dz }
  for (let i = 0; i < 6 && pushOut(pos, radius, y); i++);
  // 推不出可行位置(極端夾角)就維持原地,避免穿牆
  return isBlocked(pos.x, pos.z, radius, y) ? { x, z } : pos
}

// 起身落點:以椅子中心為基準,依序試 後 0.7、右 0.6、左 0.6、後 1.0、前 0.6;都被擋回 null。
export const standUpSpot = (seatId) => {
  const s = seatSpot(seatId)
  if (!s) return null
  const fx = -Math.sin(s.yaw)
  const fz = -Math.cos(s.yaw)
  const rx = Math.cos(s.yaw)
  const rz = -Math.sin(s.yaw)
  // [前, 右] 係數
  const cands = [[-0.7, 0], [0, 0.6], [0, -0.6], [-1.0, 0], [0.6, 0]]
  for (const [f, r] of cands) {
    const x = s.x + fx * f + rx * r
    const z = s.z + fz * f + rz * r
    if (!isBlocked(x, z, PLAYER.radius)) return { x, z }
  }
  return null
}
