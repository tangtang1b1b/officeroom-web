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
// height:受測物體(由腳底 y 往上)的高度;預設為玩家站姿身高。物品模擬時傳物品自己的高度。
const affects = (box, y, height = BODY_HEIGHT) => box.max[1] > y + STEP_HEIGHT && box.min[1] < y + height

// disabled:可選的「碰撞疊加層」,接受以下任一種(不傳或 null 時所有方塊都有效,行為與原本完全相同):
// - id 陣列或有 has() 的 Set:被停用的 COLLIDERS id(例如被射走的椅子、螢幕的原位盒)
// - 疊加物件 { has(id), boxes: [{ id, min, max, standable? }] }:has() 停用原位盒,boxes 為額外加入的碰撞盒
//   (被打飛後移動到新位置的物品,見 shared/props.js 的 propsOverlay)。額外盒不受 has() 影響。
const NO_BOXES = []
const toDisabled = (disabled) => (!disabled ? null : Array.isArray(disabled) ? new Set(disabled) : disabled)
const enabled = (box, disabled) => !disabled || !disabled.has(box.id)
const extraBoxes = (off) => (off && Array.isArray(off.boxes) ? off.boxes : NO_BOXES)

// 依疊加層列出目前有效的所有碰撞盒(COLLIDERS 去掉停用的,再加上額外盒)。給射線檢測(raycastWorld 的 boxes)等用。
export const activeColliders = (disabled = null, base = COLLIDERS) => {
  const off = toDisabled(disabled)
  if (!off) return base
  return [...base.filter((box) => enabled(box, off)), ...extraBoxes(off)]
}

// 單一方塊是否擋住腳底 y、圓心 (x, z)、半徑 radius 的角色(高度與水平都重疊)。height 預設玩家站姿身高。
export const circleBlockedByBox = (x, z, radius, y, box, height = BODY_HEIGHT) =>
  affects(box, y, height) && circleHitsBox(x, z, radius, box)

// 腳底在 y、圓心在 (x, z) 時,腳下的支撐高度:圓心在可站立方塊(桌子、沙發)範圍內且頂面不高於 y + STEP 的最高頂面;否則 0。
export const groundHeight = (x, z, y = 0, disabled = null) => {
  const off = toDisabled(disabled)
  let g = 0
  const check = (box) => {
    if (!box.standable) return
    if (x < box.min[0] || x > box.max[0] || z < box.min[2] || z > box.max[2]) return
    const top = box.max[1]
    if (top <= y + STEP_HEIGHT && top > g) g = top
  }
  for (const box of COLLIDERS) if (enabled(box, off)) check(box)
  for (const box of extraBoxes(off)) check(box)
  return g
}

// height:受測物體高度(預設玩家站姿身高),物品模擬用
export const isBlocked = (x, z, radius = PLAYER.radius, y = 0, disabled = null, height = BODY_HEIGHT) => {
  const off = toDisabled(disabled)
  if (x - radius < ROOM.minX || x + radius > ROOM.maxX) return true
  if (z + radius > ROOM.maxZ) return true
  // -z 側是斜牆:以圓心 x 處的牆線為準,斜率約 0.2,距離換算乘上 1/cos
  if (z - radius * 1.02 < minZAt(x)) return true
  const hits = (box) => affects(box, y, height) && circleHitsBox(x, z, radius, box)
  return COLLIDERS.some((box) => enabled(box, off) && hits(box)) || extraBoxes(off).some(hits)
}

// 圓形角色的移動:先走完整位移,若被擋則把圓心從重疊的障礙物「推出」(沿最近點法線),
// 讓角色能沿牆、沿斜牆與方塊轉角順暢滑動,不會像逐軸判斷那樣卡在斜牆或轉角上。
const SLANT_NORM = Math.sqrt(1 + ((WALL_SLANT.z1 - WALL_SLANT.z0) / (WALL_SLANT.x1 - WALL_SLANT.x0)) ** 2)
const SLANT_SLOPE = (WALL_SLANT.z1 - WALL_SLANT.z0) / (WALL_SLANT.x1 - WALL_SLANT.x0)
const EPS = 0.002

const pushOut = (pos, radius, y = 0, off = null, height = BODY_HEIGHT) => {
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
  const extras = extraBoxes(off)
  for (let i = 0; i < COLLIDERS.length + extras.length; i++) {
    const box = i < COLLIDERS.length ? COLLIDERS[i] : extras[i - COLLIDERS.length]
    if ((i < COLLIDERS.length && !enabled(box, off)) || !affects(box, y, height)) continue
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

export const moveCircle = (x, z, dx, dz, radius = PLAYER.radius, y = 0, disabled = null, height = BODY_HEIGHT) => {
  const off = toDisabled(disabled)
  const pos = { x: x + dx, z: z + dz }
  for (let i = 0; i < 6 && pushOut(pos, radius, y, off, height); i++);
  // 推不出可行位置(極端夾角)就維持原地,避免穿牆
  return isBlocked(pos.x, pos.z, radius, y, off, height) ? { x, z } : pos
}

// 起身落點:以椅子中心為基準,依序試 後 0.7、右 0.6、左 0.6、後 1.0、前 0.6;都被擋回 null。
export const standUpSpot = (seatId, disabled = null) => {
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
    if (!isBlocked(x, z, PLAYER.radius, 0, disabled)) return { x, z }
  }
  return null
}
