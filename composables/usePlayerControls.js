import { PLAYER, SPAWN_POINTS } from '~/shared/layout.js'
import { moveCircle } from '~/shared/collision.js'

const MOUSE_SENSITIVITY = 0.0035
const MAX_PITCH = 1.45
// 跳躍只是垂直位移:碰撞是 2D(俯視圓形 vs 方塊),不看高度,所以跳起來既不會卡進模型,也跳不上桌子
const JUMP_SPEED = 3.6 // m/s,最高約 0.59m(伺服器上限 0.8)
const GRAVITY = 11

const isTyping = (target) =>
  target instanceof HTMLElement &&
  (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)

// 第一人稱操控:點畫面後滑鼠鎖定,移動滑鼠即轉視角,準心在畫面中央;WASD 移動、C 蹲 / Z 趴。
// Esc(瀏覽器規定會解除鎖定)只是讓游標出現以便點按鈕,WASD 仍可移動,遊戲不暫停;點畫面再鎖定。
export const usePlayerControls = (element) => {
  const spawn = SPAWN_POINTS[Math.floor(Math.random() * SPAWN_POINTS.length)]
  const state = {
    x: spawn.x,
    z: spawn.z,
    yaw: spawn.x > 0 ? Math.PI / 2 : -Math.PI / 2,
    pitch: 0,
    pose: 'stand',
    speed: 0,
    y: 0, // 跳躍高度(腳離地)
    vy: 0,
    downed: false, // 血量歸零倒地:只能趴著爬,由伺服器通知
  }
  const locked = ref(false)
  const keys = new Set()

  const onKeyDown = (event) => {
    if (isTyping(event.target)) return
    keys.add(event.code)
    if (event.code === 'Space') event.preventDefault() // 避免捲動頁面或觸發聚焦中的按鈕
    if (event.repeat) return
    if (state.downed) return // 倒地中不能換姿勢或跳
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
  }

  window.addEventListener('keydown', onKeyDown)
  window.addEventListener('keyup', onKeyUp)
  window.addEventListener('blur', onBlur)
  document.addEventListener('mousemove', onMouseMove)
  document.addEventListener('pointerlockchange', onLockChange)

  const update = (dt) => {
    if (state.downed) state.pose = 'prone'
    // 跳躍:站著、貼地、按住空白鍵(落地後仍按著會連續跳)
    if (keys.has('Space') && state.pose === 'stand' && state.y === 0 && !state.downed) state.vy = JUMP_SPEED
    if (state.vy !== 0 || state.y > 0) {
      state.vy -= GRAVITY * dt
      state.y += state.vy * dt
      if (state.y <= 0) {
        state.y = 0
        state.vy = 0
      }
    }
    if (state.pose !== 'stand' && state.y > 0) {
      state.y = 0
      state.vy = 0
    }
    let forward = 0
    let strafe = 0
    if (keys.has('KeyW') || keys.has('ArrowUp')) forward += 1
    if (keys.has('KeyS') || keys.has('ArrowDown')) forward -= 1
    if (keys.has('KeyD') || keys.has('ArrowRight')) strafe += 1
    if (keys.has('KeyA') || keys.has('ArrowLeft')) strafe -= 1
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
    // 圓形碰撞:被擋時沿障礙物表面滑動(含斜牆與方塊轉角)
    const next = moveCircle(state.x, state.z, dx, dz)
    state.x = next.x
    state.z = next.z
    state.speed = speed
  }

  return {
    state,
    locked,
    requestLock: () => {
      try {
        element.requestPointerLock?.()?.catch?.(() => {}) // Esc 後立刻再鎖會被瀏覽器拒絕,忽略
      } catch {
        // 忽略
      }
    },
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
