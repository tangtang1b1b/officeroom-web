import * as THREE from 'three'
import { ghostPlan } from '~/shared/workload.js'

// 小幽靈:一張未完成的 ClickUp 卡片 = 一隻,繞著那位同事飄。逾期的卡片是紅色幽靈。
// 卡片越多,人被包圍得越緊(軌道半徑縮小、轉得更快),很多隻時整個人就被幽靈圍住。
// 方塊風格(跟人偶、小白狗同一套);所有幽靈共用幾何與材質,只有位置不同。
const WHITE = 0xf4f7ff
const RED = 0xff6b6b
const DARK = 0x1a1a22

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
    normal: mat(WHITE, { transparent: true, opacity: 0.88 }),
    overdue: mat(RED, { transparent: true, opacity: 0.92 }),
  }

  const build = (kind) => {
    const m = styles[kind]
    const group = new THREE.Group()
    const add = (geometry, material, x, y, z) => {
      const mesh = new THREE.Mesh(geometry, material)
      mesh.position.set(x, y, z)
      group.add(mesh)
      return mesh
    }
    add(bodyGeo, m, 0, 0.12, 0)
    // 下擺的三角鋸齒
    add(skirtGeo, m, -0.065, 0.0, 0)
    add(skirtGeo, m, 0.065, 0.0, 0)
    add(skirtGeo, m, 0, -0.02, 0)
    add(armGeo, m, -0.13, 0.1, 0)
    add(armGeo, m, 0.13, 0.1, 0)
    // 臉朝 -z(group 朝向移動方向)
    add(eyeGeo, eyeMat, -0.045, 0.16, -0.105)
    add(eyeGeo, eyeMat, 0.045, 0.16, -0.105)
    add(eyeGeo, eyeMat, 0, 0.08, -0.105).scale.set(1.6, 0.5, 1) // 嘴
    scene.add(group)
    return group
  }

  // seatId → { ghosts: [{ group, kind, seed }], anchor: {x,y,z} }
  const swarms = new Map()
  let time = 0

  const resize = (swarm, plan) => {
    const want = [...Array(plan.overdue).fill('overdue'), ...Array(plan.normal).fill('normal')]
    // 種類或數量變了才重建對應的幽靈
    while (swarm.ghosts.length > want.length) {
      const g = swarm.ghosts.pop()
      scene.remove(g.group)
    }
    want.forEach((kind, i) => {
      const cur = swarm.ghosts[i]
      if (cur && cur.kind === kind) return
      if (cur) scene.remove(cur.group)
      swarm.ghosts[i] = { group: build(kind), kind, seed: i * 1.7, placed: false }
    })
  }

  return {
    // seats: { [seatId]: { open, overdue } }
    setCounts(seats) {
      const known = new Set(Object.keys(seats || {}))
      for (const [seatId, swarm] of swarms) {
        if (!known.has(seatId)) {
          resize(swarm, { normal: 0, overdue: 0 })
          swarms.delete(seatId)
        }
      }
      for (const [seatId, c] of Object.entries(seats || {})) {
        let swarm = swarms.get(seatId)
        if (!swarm) {
          swarm = { ghosts: [] }
          swarms.set(seatId, swarm)
        }
        resize(swarm, ghostPlan(c.open, c.overdue))
      }
    },
    // anchorFor(seatId) → { x, y, z, height } | null(人不在場景裡就先不畫)
    update(dt, anchorFor) {
      time += dt
      const k = 1 - Math.exp(-6 * dt)
      for (const [seatId, swarm] of swarms) {
        const anchor = anchorFor(seatId)
        const n = swarm.ghosts.length
        for (let i = 0; i < n; i++) {
          const g = swarm.ghosts[i]
          g.group.visible = !!anchor
          if (!anchor) continue
          // 越多隻:軌道越小、轉得越快,看起來越被「壓」著
          const crowd = Math.min(1, n / 12)
          const radius = 0.95 - 0.3 * crowd + (i % 3) * 0.16 + (anchor.spread ?? 0)
          const speed = 0.7 + 0.9 * crowd
          const angle = time * speed * (i % 2 ? 1 : -1) + (i * Math.PI * 2) / Math.max(n, 1)
          const baseY = anchor.y + 0.35 + (anchor.height ?? 1.75) * 0.35
          const tx = anchor.x + Math.cos(angle) * radius
          const tz = anchor.z + Math.sin(angle) * radius
          let ty = baseY + 0.3 * Math.sin(time * 1.4 + g.seed) + (i % 4) * 0.16
          if (anchor.ceilY !== undefined) ty = Math.min(ty, anchor.ceilY) // 自己的幽靈不飄到眼睛高度以上,才不會擋視線
          if (!g.placed) {
            g.group.position.set(tx, ty, tz)
            g.placed = true
          } else {
            g.group.position.x += (tx - g.group.position.x) * k
            g.group.position.y += (ty - g.group.position.y) * k
            g.group.position.z += (tz - g.group.position.z) * k
          }
          // 臉朝移動方向(軌道切線)
          // 切線速度 = s·(-sin a, cos a);臉朝 -z,所以 rotation.y = atan2(-vx, -vz)
          const s = i % 2 ? 1 : -1
          g.group.rotation.y = Math.atan2(s * Math.sin(angle), -s * Math.cos(angle))
        }
      }
    },
    dispose() {
      for (const swarm of swarms.values()) for (const g of swarm.ghosts) scene.remove(g.group)
      swarms.clear()
      geometries.forEach((g) => g.dispose())
      materials.forEach((m) => m.dispose())
    },
  }
}
