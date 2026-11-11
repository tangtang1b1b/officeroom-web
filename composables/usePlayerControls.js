import { ROOM, PLAYER, COLLIDERS, SPAWN_POINTS } from '~/shared/layout.js'

const MOUSE_SENSITIVITY = 0.0022
const MAX_PITCH = 1.45

const isTyping = (target) =>
  target instanceof HTMLElement &&
  (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)

// 圓形(玩家)與 AABB(俯視 xz)是否重疊
const circleHitsBox = (x, z, radius, box) => {
  const nearestX = Math.max(box.min[0], Math.min(x, box.max[0]))
  const nearestZ = Math.max(box.min[2], Math.min(z, box.max[2]))
  const dx = x - nearestX
  const dz = z - nearestZ
  return dx * dx + dz * dz < radius * radius
}

export const isBlocked = (x, z, radius = PLAYER.radius) => {
  if (x - radius < ROOM.minX || x + radius > ROOM.maxX) return true
  if (z - radius < ROOM.minZ || z + radius > ROOM.maxZ) return true
  return COLLIDERS.some((box) => circleHitsBox(x, z, radius, box))
}

// 第一人稱操控:Pointer Lock 視角 + WASD 移動 + C 蹲 / Z 趴(再按一次起身)
export const usePlayerControls = (element) => {
  const spawn = SPAWN_POINTS[Math.floor(Math.random() * SPAWN_POINTS.length)]
  const state = {
    x: spawn.x,
    z: spawn.z,
    yaw: spawn.x > 0 ? Math.PI / 2 : -Math.PI / 2,
    pitch: 0,
    pose: 'stand',
    speed: 0,
  }
  const locked = ref(false)
  const keys = new Set()

  const onKeyDown = (event) => {
    if (isTyping(event.target)) return
    keys.add(event.code)
    if (event.repeat) return
    if (event.code === 'KeyC') state.pose = state.pose === 'crouch' ? 'stand' : 'crouch'
    if (event.code === 'KeyZ') state.pose = state.pose === 'prone' ? 'stand' : 'prone'
  }
  const onKeyUp = (event) => keys.delete(event.code)
  const onBlur = () => keys.clear()

  const onMouseMove = (event) => {
    if (document.pointerLockElement !== element) return
    state.yaw -= event.movementX * MOUSE_SENSITIVITY
    state.pitch -= event.movementY * MOUSE_SENSITIVITY
    state.pitch = Math.max(-MAX_PITCH, Math.min(MAX_PITCH, state.pitch))
  }
  const onLockChange = () => {
    locked.value = document.pointerLockElement === element
    if (!locked.value) keys.clear()
  }

  window.addEventListener('keydown', onKeyDown)
  window.addEventListener('keyup', onKeyUp)
  window.addEventListener('blur', onBlur)
  document.addEventListener('mousemove', onMouseMove)
  document.addEventListener('pointerlockchange', onLockChange)

  const update = (dt) => {
    let forward = 0
    let strafe = 0
    if (locked.value) {
      if (keys.has('KeyW') || keys.has('ArrowUp')) forward += 1
      if (keys.has('KeyS') || keys.has('ArrowDown')) forward -= 1
      if (keys.has('KeyD') || keys.has('ArrowRight')) strafe += 1
      if (keys.has('KeyA') || keys.has('ArrowLeft')) strafe -= 1
    }
    const length = Math.hypot(forward, strafe)
    if (length === 0) {
      state.speed = 0
      return
    }
    const speed = PLAYER.walkSpeed[state.pose]
    // 朝向 yaw=0 時看向 -z
    const sin = Math.sin(state.yaw)
    const cos = Math.cos(state.yaw)
    const dx = ((-sin * forward + cos * strafe) / length) * speed * dt
    const dz = ((-cos * forward - sin * strafe) / length) * speed * dt
    // 軸分離碰撞,貼牆時可沿牆滑動
    if (!isBlocked(state.x + dx, state.z)) state.x += dx
    if (!isBlocked(state.x, state.z + dz)) state.z += dz
    state.speed = speed
  }

  return {
    state,
    locked,
    requestLock: () => element.requestPointerLock?.(),
    update,
    dispose() {
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('keyup', onKeyUp)
      window.removeEventListener('blur', onBlur)
      document.removeEventListener('mousemove', onMouseMove)
      document.removeEventListener('pointerlockchange', onLockChange)
      if (document.pointerLockElement === element) document.exitPointerLock()
    },
  }
}
