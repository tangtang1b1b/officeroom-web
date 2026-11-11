import * as THREE from 'three'
import { PARTITION, MONITOR, partitionOf, monitorOf } from '../../shared/layout.js'

// 辦公室家具建模(純 Three.js,低多邊形方塊/圓柱組合,不載入外部模型)。
// 幾何與材質由 kit 快取共用並統一釋放:用 createFurnitureKit() 建立,不用時呼叫 kit.dispose()。

export const FURNITURE_COLOR = {
  deskTop: 0xf7f6f2,
  yellow: 0xf2b705,
  oak: 0xd9c4a0,
  oakDark: 0xb89c72,
  steel: 0x8d9399,
  steelDark: 0x4a4f55,
}

export const createFurnitureKit = ({ paintable = false } = {}) => {
  const geometries = new Map()
  const materials = new Map()
  const cached = (map, key, make) => {
    let item = map.get(key)
    if (!item) {
      item = make()
      map.set(key, item)
    }
    return item
  }
  const mat = (color, extra) => {
    const key = `${color}|${extra ? JSON.stringify(extra) : ''}`
    return cached(materials, key, () => new THREE.MeshLambertMaterial({ color, ...extra }))
  }
  const place = (mesh, parent, [x, y, z], opts) => {
    mesh.position.set(x, y, z)
    if (paintable) mesh.userData.paintable = true // 靜態家具讓漆彈貼花;可動物件另有宿主機制
    if (opts.rotX) mesh.rotation.x = opts.rotX
    if (opts.rotY) mesh.rotation.y = opts.rotY
    if (opts.rotZ) mesh.rotation.z = opts.rotZ
    parent.add(mesh)
    return mesh
  }
  return {
    mat,
    box(parent, [w, h, d], position, color, opts = {}) {
      const geometry = cached(geometries, `b${w},${h},${d}`, () => new THREE.BoxGeometry(w, h, d))
      return place(new THREE.Mesh(geometry, mat(color, opts.extra)), parent, position, opts)
    },
    cyl(parent, [rTop, rBottom, h, seg = 10], position, color, opts = {}) {
      const geometry = cached(geometries, `c${rTop},${rBottom},${h},${seg}`, () => new THREE.CylinderGeometry(rTop, rBottom, h, seg))
      return place(new THREE.Mesh(geometry, mat(color, opts.extra)), parent, position, opts)
    },
    dispose() {
      geometries.forEach((g) => g.dispose())
      materials.forEach((m) => m.dispose())
      geometries.clear()
      materials.clear()
    },
  }
}

// 以字串為種子的決定性亂數,讓書本顏色、桌上擺設每次一致
const seeded = (text) => {
  let h = 2166136261
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619)
  return () => {
    h = Math.imul(h ^ (h >>> 15), 2246822507)
    h = Math.imul(h ^ (h >>> 13), 3266489909)
    h ^= h >>> 16
    return (h >>> 0) / 4294967296
  }
}

const CHAIR_COLOR = {
  seat: 0x2f3338,
  frame: 0x25282c,
  mesh: 0x3d444b,
  base: 0x1d1f22,
  caster: 0x0f1012,
  chrome: 0x8d9399,
  arm: 0x2a2d31,
}

// 辦公室轉椅:局部座標 yaw=0 時面向 -z(椅背在 +z),座高 0.48、總高約 1.12、腳印半徑約 0.3。
// materials 為 createFurnitureKit() 的回傳值。
export const buildOfficeChair = (parent, { materials: k }) => {
  const C = CHAIR_COLOR
  // 五爪星形底座 + 腳輪
  for (let i = 0; i < 5; i++) {
    const a = Math.PI / 2 + (i * Math.PI * 2) / 5
    const cos = Math.cos(a)
    const sin = Math.sin(a)
    k.box(parent, [0.3, 0.035, 0.05], [cos * 0.15, 0.095, sin * 0.15], C.base, { rotY: -a })
    k.cyl(parent, [0.025, 0.025, 0.08, 8], [cos * 0.27, 0.04, sin * 0.27], C.caster)
  }
  k.cyl(parent, [0.055, 0.06, 0.05, 10], [0, 0.1, 0], C.base)
  // 氣壓桿與護套
  k.cyl(parent, [0.025, 0.025, 0.28, 8], [0, 0.26, 0], C.chrome)
  k.cyl(parent, [0.04, 0.04, 0.1, 8], [0, 0.34, 0], C.base)
  // 坐墊:底板 + 主墊 + 前緣圓角感
  k.box(parent, [0.26, 0.03, 0.26], [0, 0.405, 0], C.base)
  k.box(parent, [0.46, 0.07, 0.44], [0, 0.445, 0], C.seat)
  k.box(parent, [0.4, 0.05, 0.04], [0, 0.435, -0.23], C.seat)
  k.box(parent, [0.4, 0.015, 0.4], [0, 0.4825, -0.01], C.mesh)
  // 椅背:支架、外框、網面、頭枕
  k.box(parent, [0.05, 0.3, 0.04], [0, 0.6, 0.2], C.base)
  k.box(parent, [0.48, 0.48, 0.035], [0, 0.78, 0.235], C.frame)
  k.box(parent, [0.4, 0.38, 0.045], [0, 0.78, 0.235], C.mesh)
  k.box(parent, [0.05, 0.06, 0.03], [0, 1.03, 0.235], C.base)
  k.box(parent, [0.26, 0.1, 0.05], [0, 1.07, 0.24], C.seat)
  // 扶手
  for (const sx of [-1, 1]) {
    k.box(parent, [0.035, 0.2, 0.035], [sx * 0.27, 0.58, 0.02], C.arm)
    k.box(parent, [0.06, 0.03, 0.26], [sx * 0.27, 0.695, -0.02], C.frame)
  }
}

// 辦公桌:group 已放在桌子中心(desk.x, 0, desk.z)。桌面尺寸與碰撞方塊一致,桌上物品不超出桌面。
// 桌子 side>0 時椅子在 +z、隔板在 -z 側(見 shared/layout.js 的 partitionOf / monitorOf)。
export const buildDesk = (group, desk, k) => {
  const { w, d, h, side } = desk
  const rand = seeded(desk.id)
  const outer = side // 朝椅子的方向(z 正負)
  const inner = -side // 朝隔板的方向

  // 白色桌面
  k.box(group, [w, 0.04, d], [0, h - 0.02, 0], FURNITURE_COLOR.deskTop)
  // 黃色側板(U 型桌架的兩側)
  for (const sx of [-1, 1]) {
    k.box(group, [0.04, h - 0.04, d - 0.1], [sx * (w / 2 - 0.06), (h - 0.04) / 2, 0], FURNITURE_COLOR.yellow)
  }
  // 後側擋板(隔板那一側的橫擋)
  k.box(group, [w - 0.16, 0.3, 0.02], [0, h - 0.04 - 0.17, inner * (d / 2 - 0.1)], FURNITURE_COLOR.yellow)
  // 抽屜櫃:靠其中一側,三層抽屜與把手
  const pedW = 0.4
  const pedD = d - 0.16
  const pedH = h - 0.08
  const pedX = (side > 0 ? 1 : -1) * (w / 2 - 0.08 - pedW / 2)
  const pedZ = outer * 0.01
  k.box(group, [pedW, pedH, pedD], [pedX, 0.04 + pedH / 2, pedZ], 0xe9e7e0)
  const frontZ = pedZ + outer * (pedD / 2 + 0.002)
  for (let i = 0; i < 3; i++) {
    const y = 0.04 + (pedH / 3) * (i + 0.5)
    k.box(group, [pedW - 0.04, pedH / 3 - 0.03, 0.004], [pedX, y, frontZ], 0xf5f3ec)
    k.box(group, [0.16, 0.014, 0.014], [pedX, y + 0.04, frontZ + outer * 0.009], FURNITURE_COLOR.steelDark)
  }

  // 黃色隔板與螢幕:位置由 layout 計算,與碰撞資料一致
  const part = partitionOf(desk)
  k.box(group, [PARTITION.w, PARTITION.h, PARTITION.d], [0, h + PARTITION.h / 2, part.z - desk.z], FURNITURE_COLOR.yellow)
  const mon = monitorOf(desk)
  const monZ = mon.z - desk.z
  const monY = h + MONITOR.y
  k.box(group, [MONITOR.w, MONITOR.h, MONITOR.d], [0, monY, monZ], 0x111111)
  k.box(group, [MONITOR.w - 0.04, MONITOR.h - 0.04, 0.004], [0, monY, monZ + outer * (MONITOR.d / 2 + 0.002)], 0x1b3550, {
    extra: { emissive: 0x2a5b8a, emissiveIntensity: 0.5 },
  })
  const neckH = monY - MONITOR.h / 2 - h
  k.box(group, [0.06, neckH, 0.03], [0, h + neckH / 2, monZ], FURNITURE_COLOR.steelDark)
  k.box(group, [0.24, 0.012, 0.16], [0, h + 0.006, monZ], FURNITURE_COLOR.steelDark)

  // 鍵盤與滑鼠
  k.box(group, [0.42, 0.02, 0.14], [0, h + 0.01, outer * 0.2], 0x2b2d31)
  k.box(group, [0.38, 0.004, 0.1], [0, h + 0.022, outer * 0.2], 0x3b3f45)
  k.box(group, [0.06, 0.025, 0.1], [0.34, h + 0.0125, outer * 0.2], 0x2b2d31)

  // 小擺設:盆栽或杯子(靠隔板那一側,不超出桌面)
  const pick = rand()
  if (pick < 0.4) {
    k.cyl(group, [0.05, 0.04, 0.08, 8], [-w / 2 + 0.15, h + 0.04, inner * 0.22], 0xd8d2c4)
    k.box(group, [0.09, 0.09, 0.09], [-w / 2 + 0.15, h + 0.125, inner * 0.22], 0x6e9a5b)
  } else if (pick < 0.8) {
    k.cyl(group, [0.035, 0.03, 0.09, 8], [w / 2 - 0.15, h + 0.045, inner * 0.2], 0xf2f2ee)
  }
}

const BOOK_COLORS = [0xb5483a, 0x3f6e9c, 0xd8b25a, 0x5d8a5b, 0x7b5a99, 0xe8e2d0, 0x2f3a4a, 0xc77d3c]

const buildTable = (g, f, k) => {
  const { w, d, h } = f
  const topT = 0.05
  k.box(g, [w, topT, d], [0, h - topT / 2, 0], FURNITURE_COLOR.oak)
  k.box(g, [w - 0.1, 0.012, d - 0.1], [0, h - topT - 0.006, 0], FURNITURE_COLOR.oakDark) // 桌面下緣
  const inset = Math.min(0.12, w / 6)
  const legT = Math.min(0.08, d / 6)
  const legH = h - topT
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      k.box(g, [legT, legH, legT], [sx * (w / 2 - inset), legH / 2, sz * (d / 2 - inset)], FURNITURE_COLOR.steel)
    }
  }
  // 兩側橫擋
  for (const sz of [-1, 1]) {
    k.box(g, [w - 2 * inset, 0.05, 0.03], [0, h - topT - 0.06, sz * (d / 2 - inset)], FURNITURE_COLOR.steelDark)
  }
}

// 沙發:椅背在 +z、正面朝 -z。整體高度 = f.h(含靠背),與碰撞方塊一致
const buildSofa = (g, f, k) => {
  const { w, d, h } = f
  const armW = 0.2
  const backT = 0.22
  const baseH = 0.16
  const seatTop = 0.46
  const cloth = 0x4d6a8a
  const clothDark = 0x3f5a78
  k.box(g, [w - 0.1, baseH, d - 0.08], [0, baseH / 2 + 0.02, 0], 0x2f3338)
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) k.box(g, [0.06, 0.04, 0.06], [sx * (w / 2 - 0.1), 0.02, sz * (d / 2 - 0.1)], 0x1d1f22)
  }
  // 扶手
  for (const sx of [-1, 1]) {
    k.box(g, [armW, 0.58 - baseH, d], [sx * (w / 2 - armW / 2), baseH + (0.58 - baseH) / 2, 0], clothDark)
  }
  // 靠背
  k.box(g, [w - 2 * armW, h - baseH, backT], [0, baseH + (h - baseH) / 2, d / 2 - backT / 2], cloth)
  // 坐墊(兩塊)與靠墊
  const cushionW = (w - 2 * armW) / 2
  for (const sx of [-1, 1]) {
    k.box(g, [cushionW - 0.02, seatTop - baseH, d - backT - 0.03], [sx * (cushionW / 2), baseH + (seatTop - baseH) / 2, -backT / 2], cloth)
    k.box(g, [cushionW - 0.06, 0.3, 0.1], [sx * (cushionW / 2), seatTop + 0.15, d / 2 - backT - 0.05], 0x5d7b9c)
  }
}

// 書櫃:正面朝 -z,有側板、背板、層板與書本色塊
const buildShelf = (g, f, k) => {
  const { w, d, h, id } = f
  const rand = seeded(id)
  const t = 0.03
  const body = 0xe8e4da
  const front = -1
  k.box(g, [w, h, 0.02], [0, h / 2, -front * (d / 2 - 0.01)], 0xd2cdbf) // 背板
  for (const sx of [-1, 1]) k.box(g, [t, h, d], [sx * (w / 2 - t / 2), h / 2, 0], body)
  // 中間直板
  const bays = Math.max(1, Math.round(w / 0.8))
  const bayW = (w - 2 * t) / bays
  for (let i = 1; i < bays; i++) k.box(g, [t, h - t, d - 0.02], [-w / 2 + t + bayW * i, h / 2, 0], body)
  const rows = Math.max(2, Math.round(h / 0.38))
  const rowH = (h - t) / rows
  k.box(g, [w, t, d], [0, h - t / 2, 0], body) // 頂板
  k.box(g, [w, 0.04, d], [0, 0.02, 0], 0xcfc9ba) // 底座
  for (let r = 0; r < rows; r++) {
    const y0 = r === 0 ? 0.04 : r * rowH
    if (r > 0) k.box(g, [w - 2 * t, t, d - 0.02], [0, y0, 0], body)
    const shelfTop = y0 + (r > 0 ? t / 2 : 0)
    const clearH = (r + 1) * rowH - shelfTop - t / 2
    for (let b = 0; b < bays; b++) {
      const bx0 = -w / 2 + t + bayW * b + t / 2
      const bx1 = -w / 2 + t + bayW * (b + 1) - t / 2
      let x = bx0 + 0.02
      const fill = 0.45 + rand() * 0.4
      const limit = bx0 + (bx1 - bx0) * fill
      while (x < limit - 0.08) {
        const bw = 0.06 + rand() * 0.14
        const bh = Math.min(clearH - 0.04, 0.18 + rand() * 0.16)
        const bd = Math.min(d - 0.12, 0.22 + rand() * 0.1)
        if (x + bw > limit) break
        k.box(g, [bw, bh, bd], [x + bw / 2, shelfTop + bh / 2, front * (d / 2 - 0.02 - bd / 2)], BOOK_COLORS[Math.floor(rand() * BOOK_COLORS.length)])
        x += bw + 0.005
      }
    }
  }
}

// 矮櫃:正面朝 +z,兩層抽屜/櫃門與把手;最外緣不超出碰撞方塊
const buildLocker = (g, f, k) => {
  const { w, d, h } = f
  const front = 1
  const lip = 0.03
  const bodyColor = 0x8a9096
  k.box(g, [w, h - 0.04, d - lip], [0, (h - 0.04) / 2, -front * lip / 2], bodyColor) // 頂面留給桌板,避免共面閃爍
  k.box(g, [w, 0.04, d - lip], [0, h - 0.02, -front * lip / 2], 0xb9bec3) // 桌板
  k.box(g, [w - 0.04, 0.05, d - lip - 0.02], [0, 0.025, -front * lip / 2], 0x5a5f65) // 踢腳
  const faceZ = front * (d / 2 - lip + 0.0075)
  const cols = Math.max(1, Math.round(w / 0.5))
  const colW = w / cols
  const rowsN = 2
  const bodyH = h - 0.1
  const rowH = bodyH / rowsN
  for (let c = 0; c < cols; c++) {
    for (let r = 0; r < rowsN; r++) {
      const x = -w / 2 + colW * (c + 0.5)
      const y = 0.05 + rowH * (r + 0.5)
      k.box(g, [colW - 0.03, rowH - 0.03, 0.015], [x, y, faceZ], 0xa3a9af)
      k.box(g, [0.14, 0.018, 0.015], [x, y + rowH / 2 - 0.07, front * (d / 2 - 0.0075)], FURNITURE_COLOR.steelDark)
    }
  }
}

const FIXTURE_BUILDERS = { table: buildTable, sofa: buildSofa, shelf: buildShelf, locker: buildLocker }

// 固定家具(layout.js 的 FIXTURES):在 parent 下建立一個放在 (f.x, 0, f.z) 的 group 並回傳
export const buildFixture = (parent, f, k) => {
  const group = new THREE.Group()
  group.position.set(f.x, 0, f.z)
  const build = FIXTURE_BUILDERS[f.kind] ?? buildTable
  build(group, f, k)
  parent.add(group)
  return group
}
