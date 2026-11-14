import * as THREE from 'three'

// 小白狗(方塊風格,跟人偶同一套低多邊形):朝向 -z,腳底在 group 原點。
// 伺服器廣播 { x, z, yaw, moving },這裡只負責平滑插值、走路時四肢擺動。
const WHITE = 0xf6f3ec
const CREAM = 0xe9dfc9 // 臉與耳朵的淡奶油色
const PINK = 0xe9a9b3
const DARK = 0x1a1a1a
const SCALE = 0.85 // 整體縮小

export const createDog = (scene) => {
  const group = new THREE.Group()
  group.scale.setScalar(SCALE)
  const bodyMeshes = [] // 可被漆彈打到的網格(userData.part = torso|head)
  const geometries = []
  const materials = []
  const mat = (color, basic = false) => {
    const m = basic ? new THREE.MeshBasicMaterial({ color }) : new THREE.MeshLambertMaterial({ color })
    materials.push(m)
    return m
  }
  const box = (parent, [w, h, d], [x, y, z], material, part) => {
    const geometry = new THREE.BoxGeometry(w, h, d)
    geometries.push(geometry)
    const mesh = new THREE.Mesh(geometry, material)
    mesh.position.set(x, y, z)
    parent.add(mesh)
    if (part) {
      mesh.userData.part = part
      bodyMeshes.push(mesh)
    }
    return mesh
  }

  const white = mat(WHITE)
  const cream = mat(CREAM)
  const pink = mat(PINK)
  const dark = mat(DARK, true)

  // 身體(蓬鬆,所以做粗一點)
  const body = new THREE.Group()
  body.position.y = 0.2
  group.add(body)
  box(body, [0.22, 0.2, 0.42], [0, 0.09, 0], white, 'torso')
  box(body, [0.17, 0.17, 0.3], [0, 0.2, 0.02], white) // 背部蓬毛
  // 尾巴:翹起來
  const tail = new THREE.Group()
  tail.position.set(0, 0.2, 0.22)
  body.add(tail)
  box(tail, [0.07, 0.07, 0.16], [0, 0.05, 0.05], white).rotation.x = -0.7

  // 頭
  const head = new THREE.Group()
  head.position.set(0, 0.2, -0.24)
  body.add(head)
  box(head, [0.2, 0.18, 0.2], [0, 0.06, -0.04], white, 'head')
  box(head, [0.15, 0.1, 0.1], [0, 0.02, -0.17], cream) // 鼻吻
  box(head, [0.05, 0.04, 0.04], [0, 0.05, -0.225], dark) // 鼻子
  box(head, [0.025, 0.035, 0.02], [-0.055, 0.1, -0.145], dark) // 眼睛
  box(head, [0.025, 0.035, 0.02], [0.055, 0.1, -0.145], dark)
  box(head, [0.07, 0.16, 0.08], [-0.125, 0.0, -0.03], cream) // 垂耳
  box(head, [0.07, 0.16, 0.08], [0.125, 0.0, -0.03], cream)
  box(head, [0.1, 0.03, 0.03], [0, 0.17, -0.02], pink) // 頭頂的小蝴蝶結

  // 四隻腳:以髖為軸擺動
  const legs = []
  for (const [x, z] of [[-0.07, -0.14], [0.07, -0.14], [-0.07, 0.14], [0.07, 0.14]]) {
    const leg = new THREE.Group()
    leg.position.set(x, 0.2, z)
    box(leg, [0.065, 0.2, 0.065], [0, -0.1, 0], white)
    group.add(leg)
    legs.push(leg)
  }

  group.userData.bodyMeshes = bodyMeshes
  scene.add(group)

  const target = { x: 0, z: 0, yaw: 0, moving: false }
  let placed = false
  let phase = 0

  const angleDiff = (a, b) => Math.atan2(Math.sin(b - a), Math.cos(b - a))

  return {
    group,
    apply(state) {
      if (!state) return
      target.x = state.x
      target.z = state.z
      target.yaw = state.yaw
      target.moving = !!state.moving
      if (!placed) {
        placed = true
        group.position.set(state.x, 0, state.z)
        group.rotation.y = state.yaw
      }
    },
    update(dt) {
      const k = 1 - Math.exp(-10 * dt)
      group.position.x += (target.x - group.position.x) * k
      group.position.z += (target.z - group.position.z) * k
      group.rotation.y += angleDiff(group.rotation.y, target.yaw) * k
      // 走路:對角腳同相擺動,身體微微上下;停下來尾巴輕輕搖
      phase += dt * (target.moving ? 12 : 4)
      const swing = target.moving ? 0.6 : 0
      legs[0].rotation.x = Math.sin(phase) * swing
      legs[3].rotation.x = Math.sin(phase) * swing
      legs[1].rotation.x = -Math.sin(phase) * swing
      legs[2].rotation.x = -Math.sin(phase) * swing
      body.position.y = 0.2 + (target.moving ? Math.abs(Math.sin(phase)) * 0.015 : 0)
      tail.rotation.y = Math.sin(phase * (target.moving ? 1 : 1.5)) * 0.35
    },
    dispose() {
      scene.remove(group)
      geometries.forEach((g) => g.dispose())
      materials.forEach((m) => m.dispose())
    },
  }
}
