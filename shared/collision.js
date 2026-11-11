// 2D 碰撞(俯視 xz)。前後端共用:圓形玩家 vs ROOM 邊界與 COLLIDERS 的 AABB。
import { ROOM, PLAYER, COLLIDERS, minZAt } from './layout.js'

const circleHitsBox = (x, z, radius, box) => {
  const nearestX = Math.max(box.min[0], Math.min(x, box.max[0]))
  const nearestZ = Math.max(box.min[2], Math.min(z, box.max[2]))
  const dx = x - nearestX
  const dz = z - nearestZ
  return dx * dx + dz * dz < radius * radius
}

export const isBlocked = (x, z, radius = PLAYER.radius) => {
  if (x - radius < ROOM.minX || x + radius > ROOM.maxX) return true
  if (z + radius > ROOM.maxZ) return true
  // -z 側是斜牆:以圓心 x 處的牆線為準,斜率約 0.2,距離換算乘上 1/cos
  if (z - radius * 1.02 < minZAt(x)) return true
  return COLLIDERS.some((box) => circleHitsBox(x, z, radius, box))
}
