import * as THREE from 'three'
import { CRATES } from '~/shared/layout.js'

const COLOR = { chair: 0x9ea4aa, chairDark: 0x555555, box: 0xc49a6c, tape: 0xe3c79a }
const angleDiff = (a, b) => Math.atan2(Math.sin(b - a), Math.cos(b - a))
const FALL_ANGLE = Math.PI / 2 - 0.12

// 伺服器權威的可動物件(椅子、紙箱):依快照平滑移動,倒下時播放傾倒動畫。
// 物件本地座標:yaw=0 時椅子面向 -z(椅背在 +z)。
export const createDynamicObjects = (scene, defs) => {
  const geometries = []
  const materials = []
  const geo = (geometry) => {
    geometries.push(geometry)
    return geometry
  }
  const mat = (color) => {
    const material = new THREE.MeshLambertMaterial({ color })
    materials.push(material)
    return material
  }
  const chairMat = mat(COLOR.chair)
  const darkMat = mat(COLOR.chairDark)
  const boxMat = mat(COLOR.box)
  const tapeMat = mat(COLOR.tape)
  const chairParts = {
    seat: geo(new THREE.BoxGeometry(0.5, 0.08, 0.5)),
    back: geo(new THREE.BoxGeometry(0.5, 0.55, 0.06)),
    head: geo(new THREE.BoxGeometry(0.3, 0.16, 0.08)),
    pole: geo(new THREE.BoxGeometry(0.06, 0.45, 0.06)),
    base: geo(new THREE.BoxGeometry(0.5, 0.04, 0.5)),
  }

  const addMesh = (parent, geometry, material, x, y, z) => {
    const mesh = new THREE.Mesh(geometry, material)
    mesh.position.set(x, y, z)
    parent.add(mesh)
    return mesh
  }

  const buildChair = (tilt) => {
    addMesh(tilt, chairParts.seat, chairMat, 0, 0.48, 0)
    addMesh(tilt, chairParts.back, chairMat, 0, 0.78, 0.22)
    addMesh(tilt, chairParts.head, chairMat, 0, 1.15, 0.22)
    addMesh(tilt, chairParts.pole, darkMat, 0, 0.22, 0)
    addMesh(tilt, chairParts.base, darkMat, 0, 0.03, 0)
  }

  const buildCrate = (tilt, def) => {
    const source = CRATES.find((c) => c.id === def.id)
    const w = source?.w ?? def.radius * 2
    const d = source?.d ?? def.radius * 2
    const h = source?.h ?? def.height
    addMesh(tilt, geo(new THREE.BoxGeometry(w, h, d)), boxMat, 0, h / 2, 0)
    addMesh(tilt, geo(new THREE.BoxGeometry(w + 0.01, 0.01, 0.08)), tapeMat, 0, h + 0.002, 0)
  }

  const entries = new Map()
  for (const def of defs) {
    const group = new THREE.Group()
    const tilt = new THREE.Group() // 倒下時繞腳底側傾,斑點也附著在這一層
    group.add(tilt)
    if (def.kind === 'chair') buildChair(tilt)
    else buildCrate(tilt, def)
    group.position.set(def.x, 0, def.z)
    group.rotation.y = def.yaw
    scene.add(group)
    entries.set(def.id, {
      def,
      group,
      tilt,
      target: { x: def.x, z: def.z, yaw: def.yaw, state: 'up' },
      fall: 0, // 0 直立 → 1 倒下
    })
  }

  const setTarget = (entry, obj, snap) => {
    // 資料來自伺服器,仍檢查數值,避免 NaN 讓物件消失
    if (![obj.x, obj.z, obj.yaw].every(Number.isFinite)) return
    entry.target = { x: obj.x, z: obj.z, yaw: obj.yaw, state: obj.state }
    if (snap) {
      entry.group.position.set(obj.x, 0, obj.z)
      entry.group.rotation.y = obj.yaw
      entry.fall = obj.state === 'down' ? 1 : 0
    }
  }

  return {
    // welcome:完整清單,直接就位
    applyFull(list) {
      for (const obj of list || []) {
        const entry = entries.get(obj.id)
        if (entry) setTarget(entry, obj, true)
      }
    },
    // snapshot:只含有變動的物件,平滑移動
    applyUpdate(list) {
      for (const obj of list || []) {
        const entry = entries.get(obj.id)
        if (entry) setTarget(entry, obj, false)
      }
    },
    update(dt) {
      const k = 1 - Math.exp(-18 * dt)
      const kFall = 1 - Math.exp(-10 * dt)
      for (const entry of entries.values()) {
        const { group, target } = entry
        group.position.x += (target.x - group.position.x) * k
        group.position.z += (target.z - group.position.z) * k
        group.rotation.y += angleDiff(group.rotation.y, target.yaw) * k
        const goal = target.state === 'down' ? 1 : 0
        entry.fall += (goal - entry.fall) * kFall
        // 椅子倒下:繞本地 z 軸側躺並抬高,使其貼地
        entry.tilt.rotation.z = entry.fall * FALL_ANGLE
        entry.tilt.position.y = entry.fall * 0.26
      }
    },
    // 漆彈斑點附著用
    getGroup: (id) => entries.get(id)?.tilt,
    dispose() {
      for (const entry of entries.values()) scene.remove(entry.group)
      entries.clear()
      geometries.forEach((g) => g.dispose())
      materials.forEach((m) => m.dispose())
    },
  }
}
