// 辦公室裡的小白狗:伺服器模擬,所有人看到同一隻、同一個位置。純函式,方便單元測試。
// 狗的行為:發呆一下 → 挑附近一個沒被擋住的點 → 走過去 → 再發呆。走不到(被擋/太久)就放棄換一個。
import { isBlocked, moveCircle } from '../shared/collision.js'

export const DOG_RADIUS = 0.18
export const DOG_SPEED = 0.9 // m/s
export const DOG_START = { x: 4, z: 2.2 }
const IDLE_MS = [1500, 5000] // 發呆時間範圍
const WALK_TIMEOUT_MS = 8000
const WANDER_RANGE = [1.5, 4] // 每次走的距離範圍

export const createDog = (now = 0, start = DOG_START) => ({
  x: start.x,
  z: start.z,
  yaw: 0,
  moving: false,
  tx: start.x,
  tz: start.z,
  until: now + 1000, // idle 結束 / walk 逾時的時間
})

const randRange = (rand, [lo, hi]) => lo + (hi - lo) * rand()

// 在目前位置附近挑一個沒被擋住的目標點;挑不到回 null
export function pickTarget(dog, rand = Math.random) {
  for (let i = 0; i < 12; i++) {
    const angle = rand() * Math.PI * 2
    const dist = randRange(rand, WANDER_RANGE)
    const tx = dog.x + Math.sin(angle) * dist
    const tz = dog.z + Math.cos(angle) * dist
    if (!isBlocked(tx, tz, DOG_RADIUS)) return { tx, tz }
  }
  return null
}

// 前進一步(dtMs 毫秒)。回傳同一個 dog 物件(原地更新)。
export function stepDog(dog, now, dtMs, rand = Math.random) {
  if (!dog.moving) {
    if (now < dog.until) return dog
    const target = pickTarget(dog, rand)
    if (!target) {
      dog.until = now + randRange(rand, IDLE_MS)
      return dog
    }
    Object.assign(dog, target, { moving: true, until: now + WALK_TIMEOUT_MS })
  }

  const dx = dog.tx - dog.x
  const dz = dog.tz - dog.z
  const dist = Math.hypot(dx, dz)
  const step = (DOG_SPEED * dtMs) / 1000
  if (dist < 0.08 || now >= dog.until) {
    dog.moving = false
    dog.until = now + randRange(rand, IDLE_MS)
    return dog
  }
  // yaw=0 面向 -z(與人偶一致)
  dog.yaw = Math.atan2(-dx, -dz)
  const move = Math.min(step, dist)
  const next = moveCircle(dog.x, dog.z, (dx / dist) * move, (dz / dist) * move, DOG_RADIUS)
  const moved = Math.hypot(next.x - dog.x, next.z - dog.z)
  dog.x = next.x
  dog.z = next.z
  // 幾乎沒動 = 頂到牆或家具:放棄這個目標
  if (moved < move * 0.2) {
    dog.moving = false
    dog.until = now + randRange(rand, IDLE_MS)
  }
  return dog
}

// 廣播用的公開格式
export const publicDog = (dog) => ({ x: +dog.x.toFixed(3), z: +dog.z.toFixed(3), yaw: +dog.yaw.toFixed(3), moving: dog.moving })
