import * as THREE from 'three'
import { ghostPlan, fanAngle, fanSlot } from '~/shared/workload.js'

// 小幽靈:固定飄在那位同事「身後的扇形範圍」(左後、正後、右後),只做上下飄動。
// 卡片 3 張以內各一隻白色;超過 3 張就每 3 張融合成 1 隻紅色(例:7 張 = 2 紅 + 1 白)。
// 大小依 ClickUp 卡片的優先度:越急越大隻,最急的排在正後方(規則見 shared/workload.js 的 ghostPlan)。
// 方塊風格(跟人偶、小白狗同一套);所有幽靈共用幾何與材質,只有位置、大小不同。
const WHITE = 0xf4f7ff
const RED = 0xff5a5a
const DARK = 0x1a1a22

const ROW_RADIUS = 0.45 // 第 0 排離人的距離(背後靈:幾乎貼著背)
const ROW_GAP = 0.22 // 每往外一排多出的距離
const ANGLE_SQUEEZE = 0.6 // 扇形收窄,才會擠在背後而不是飄到身側
const BOB = 0.13 // 上下飄動的幅度(公尺)

export const createGhosts = (scene) => {
  const geometries = []
  const materials = []
  const geo = (w, h, d) => {
    const g = new THREE.BoxGeometry(w, h, d)
    geometries.push(g)
    return g
  }
  const mat = (color, extra = {}) => {
    const m = new THREE.MeshLambertMaterial({ color, emissive: color, emissiveIntensity: 0.35, ...extra })
    materials.push(m)
    return m
  }
  const bodyGeo = geo(0.2, 0.22, 0.2)
  const skirtGeo = geo(0.07, 0.07, 0.2)
  const eyeGeo = geo(0.035, 0.05, 0.02)
  const armGeo = geo(0.05, 0.05, 0.05)
  const eyeMat = new THREE.MeshBasicMaterial({ color: DARK })
  materials.push(eyeMat)
  const styles = {
    white: mat(WHITE, { transparent: true, opacity: 0.88 }),
    red: mat(RED, { transparent: true, opacity: 0.92 }),
  }

  const build = (red) => {
    const m = red ? styles.red : styles.white
    const group = new THREE.Group()
    const add = (geometry, material, x, y, z) => {
      const mesh = new THREE.Mesh(geometry, material)
      mesh.position.set(x, y, z)
      group.add(mesh)
      return mesh
    }
    add(bodyGeo, m, 0, 0.12, 0)
    // 下擺的鋸齒
    add(skirtGeo, m, -0.065, 0.0, 0)
    add(skirtGeo, m, 0.065, 0.0, 0)
    add(skirtGeo, m, 0, -0.02, 0)
    add(armGeo, m, -0.13, 0.1, 0)
    add(armGeo, m, 0.13, 0.1, 0)
    // 臉朝 -z(group 朝向跟角色一樣,所以幽靈是「看著角色的背」)
    add(eyeGeo, eyeMat, -0.045, 0.16, -0.105)
    add(eyeGeo, eyeMat, 0.045, 0.16, -0.105)
    add(eyeGeo, eyeMat, 0, 0.08, -0.105).scale.set(1.6, 0.5, 1) // 嘴
    scene.add(group)
    return group
  }

  // seatId → { maxScale, ghosts: [{ group, red, scale, seed, placed }] }
  const swarms = new Map()
  let time = 0

  const clear = (swarm) => {
    for (const g of swarm.ghosts) scene.remove(g.group)
    swarm.ghosts = []
  }

  // plan: [{ red, scale }](由 ghostPlan 排好,第 0 隻最急);顏色變了就重建那一隻,數量變了只增減
  const resize = (swarm, plan) => {
    while (swarm.ghosts.length > plan.length) scene.remove(swarm.ghosts.pop().group)
    plan.forEach((want, i) => {
      const cur = swarm.ghosts[i]
      if (cur && cur.red === want.red) {
        cur.scale = want.scale
        return
      }
      if (cur) scene.remove(cur.group)
      swarm.ghosts[i] = { group: build(want.red), red: want.red, scale: want.scale, seed: i * 1.9, placed: false }
    })
    swarm.maxScale = plan.reduce((m, g) => Math.max(m, g.scale), 1)
  }

  return {
    // seats: { [seatId]: { open, overdue } }
    setCounts(seats) {
      const known = new Set(Object.keys(seats || {}))
      for (const [seatId, swarm] of swarms) {
        if (!known.has(seatId)) {
          clear(swarm)
          swarms.delete(seatId)
        }
      }
      for (const [seatId, c] of Object.entries(seats || {})) {
        let swarm = swarms.get(seatId)
        if (!swarm) {
          swarm = { maxScale: 1, ghosts: [] }
          swarms.set(seatId, swarm)
        }
        resize(swarm, ghostPlan(c))
      }
    },
    // anchorFor(seatId) → { x, y, z, yaw, height } | null(人不在場景裡就先不畫)。yaw=0 面向 -z。
    update(dt, anchorFor) {
      time += dt
      const k = 1 - Math.exp(-5 * dt)
      for (const [seatId, swarm] of swarms) {
        const anchor = anchorFor(seatId)
        const n = swarm.ghosts.length
        for (let i = 0; i < n; i++) {
          const g = swarm.ghosts[i]
          g.group.visible = !!anchor
          if (!anchor) continue
          const { row } = fanSlot(i)
          const yaw = anchor.yaw ?? 0
          // 身後方向 = (sin yaw, cos yaw);再往左 / 右轉 angle 度
          const a = (fanAngle(i, n) * ANGLE_SQUEEZE * Math.PI) / 180
          const bx = Math.sin(yaw)
          const bz = Math.cos(yaw)
          const dx = bx * Math.cos(a) - bz * Math.sin(a)
          const dz = bx * Math.sin(a) + bz * Math.cos(a)
          // 越大隻離遠一點,才不會擠在一起
          const radius = (ROW_RADIUS + row * ROW_GAP) * (1 + 0.2 * (swarm.maxScale - 1))
          const tx = anchor.x + dx * radius
          const tz = anchor.z + dz * radius
          // 高度:大約在肩膀到頭的高度,往外的排稍微高一點;只有上下飄動
          const ty = anchor.y + (anchor.height ?? 1.75) * 0.6 + row * 0.15 + 0.1 * g.scale + BOB * Math.sin(time * 1.6 + g.seed)
          g.group.scale.setScalar(g.scale)
          g.group.rotation.y = yaw // 臉朝角色(跟角色面向同一方向)
          if (!g.placed) {
            g.group.position.set(tx, ty, tz)
            g.placed = true
          } else {
            g.group.position.x += (tx - g.group.position.x) * k
            g.group.position.y += (ty - g.group.position.y) * k
            g.group.position.z += (tz - g.group.position.z) * k
          }
        }
      }
    },
    dispose() {
      for (const swarm of swarms.values()) clear(swarm)
      swarms.clear()
      geometries.forEach((g) => g.dispose())
      materials.forEach((m) => m.dispose())
    },
  }
}
