import * as THREE from 'three'
import { propById, propBox, propDims, propHitBox, homeHitBox } from '~/shared/props.js'

// 被射走的椅子與螢幕:位置、朝向、倒下角度全由伺服器快照驅動(狀態權威在伺服器),
// 這裡只負責把它們畫在場上並平順插值(做法與其他玩家相同),以及回復時滑回原位的動畫。
// 物品被射走後一直留在場上(不隱藏),可再被瞄準;回復時從目前位置平順滑回原位。
const SMOOTH_RATE = 14 // 視覺位置追上伺服器位置的速率(1/s;越大越貼近快照)
const SNAP_EPS = 1e-3
const RESTORE_SEC = 0.7 // 回復時滑回原位的時間
const RESTORE_HOP = 0.12 // 回復滑行時的小弧線高度(公尺)
const MIN_DIR_MOVE = 0.02 // 位移超過此值才更新倒下方向(公尺)

const clamp01 = (t) => Math.max(0, Math.min(1, t))
const easeInOut = (t) => (t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2)
const angleDiff = (a, b) => {
  let d = (a - b) % (Math.PI * 2)
  if (d > Math.PI) d -= Math.PI * 2
  if (d < -Math.PI) d += Math.PI * 2
  return d
}

export const createProps = () => {
  const items = new Map() // id → { id, kind, obj, meshes, home, homeWorld, parentInv, knocked, target, vis, fall, restoring }

  // 碰撞疊加層(格式同 shared/props.js 的 propsOverlay):以「伺服器目前位置」組成,移動預測與伺服器一致。
  // 物件本身不換(usePlayerControls 持有參考),boxes 內容在狀態變動時更新。
  let boxes = []
  const rebuildBoxes = () => {
    boxes = []
    for (const item of items.values()) {
      if (item.knocked) boxes.push(propBox({ id: item.id, kind: item.kind, ...item.target }))
      syncProxy(item)
    }
  }
  const disabled = {
    has: (id) => !!items.get(id)?.knocked,
    get boxes() {
      return boxes
    },
  }

  const tmpM = new THREE.Matrix4()
  const tmpTilt = new THREE.Matrix4()
  const tmpYaw = new THREE.Matrix4()
  const tmpPivot = new THREE.Matrix4()
  const tmpAxis = new THREE.Vector3()

  // 把物品擺到 s = { x, y, z, yaw, tilt }:世界矩陣 = 平移 × 倒下(繞水平軸)× 轉向 × 以原位底面中心為原點的原位矩陣
  const place = (item, s) => {
    const { home, obj } = item
    const sinT = Math.sin(Math.min(s.tilt, Math.PI / 2))
    const P = propDims(item)
    const lift = sinT * P.boxHalf // 躺下時抬高半個厚度,不陷進地板
    // 圓桌繞底面中心倒下時整個會偏到倒下方向一側(高度 0.75),往回拉半個高度,讓側躺的桌子大致落在伺服器的盒內
    const back = item.kind === 'table' ? sinT * (P.uprightHeight / 2) : 0
    tmpAxis.set(item.fall[1], 0, -item.fall[0]) // 繞它轉會往 fall 方向倒
    tmpM.makeTranslation(s.x - item.fall[0] * back, s.y + lift, s.z - item.fall[1] * back)
    tmpM.multiply(tmpTilt.makeRotationAxis(tmpAxis, s.tilt))
    tmpM.multiply(tmpYaw.makeRotationY(s.yaw - home.yaw))
    tmpM.multiply(tmpPivot.makeTranslation(-home.x, -home.y, -home.z))
    tmpM.multiply(item.homeWorld)
    if (item.parentInv) tmpM.premultiply(item.parentInv)
    tmpM.decompose(obj.position, obj.quaternion, obj.scale)
  }

  const setHome = (item) => {
    item.obj.position.copy(item.local.position)
    item.obj.quaternion.copy(item.local.quaternion)
    item.obj.scale.copy(item.local.scale)
  }

  const homePose = (item) => ({ x: item.home.x, y: item.home.y, z: item.home.z, yaw: item.home.yaw, tilt: 0 })

  const register = (id, kind, obj) => {
    const prop = propById(id)
    if (!prop) return
    const meshes = []
    obj.traverse((o) => {
      if (o.isMesh) {
        o.userData.propId = id // 讓場景把它從一般靜態遮蔽物中分出來,改由 hoverMeshes() 管理
        meshes.push(o)
      }
    })
    obj.updateWorldMatrix(true, false)
    // 螢幕:加看不見的放大瞄準代理(世界座標軸向方盒,與伺服器射線盒一致;不隨螢幕旋轉,放在場景根下)
    let proxy = null
    if (kind === 'monitor') {
      let root = obj
      while (root.parent) root = root.parent
      proxy = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial())
      proxy.visible = false // raycaster 不看 visible,仍可被射到;不會渲染也不進靜態遮蔽物
      proxy.userData.propId = id
      proxy.userData.paintable = false
      root.add(proxy)
      meshes.push(proxy)
    }
    items.set(id, {
      proxy,
      id,
      kind,
      obj,
      meshes,
      home: prop.home,
      homeWorld: obj.matrixWorld.clone(),
      parentInv: obj.parent ? obj.parent.matrixWorld.clone().invert() : null,
      local: { position: obj.position.clone(), quaternion: obj.quaternion.clone(), scale: obj.scale.clone() },
      knocked: false,
      target: homePose({ home: prop.home }),
      vis: homePose({ home: prop.home }),
      fall: [0, 1],
      restoring: null,
    })
    syncProxy(items.get(id))
  }

  // 瞄準代理對齊伺服器的射線盒:被射走用目前伺服器位置,否則(含回復動畫中)用原位
  const syncProxy = (item) => {
    if (!item.proxy) return
    const b = item.knocked ? propHitBox({ id: item.id, kind: item.kind, ...item.target }) : homeHitBox(item.id)
    if (!b) return
    item.proxy.scale.set(b.max[0] - b.min[0], b.max[1] - b.min[1], b.max[2] - b.min[2])
    item.proxy.position.set((b.min[0] + b.max[0]) / 2, (b.min[1] + b.max[1]) / 2, (b.min[2] + b.max[2]) / 2)
    item.proxy.updateMatrixWorld(true)
  }

  // 套用伺服器的一筆 PropState(射中或快照):更新目標位置;第一次看到時從原位(或 instant 直接就位)開始
  const upsert = (p, { instant = false } = {}) => {
    const item = items.get(p?.id)
    if (!item || !Array.isArray(p.pos)) return
    const t = { x: p.pos[0], y: p.pos[1], z: p.pos[2], yaw: p.yaw || 0, tilt: p.tilt || 0 }
    if (!item.knocked) {
      item.knocked = true
      if (item.restoring) item.restoring = null // 回復途中又被射:從目前畫面位置接續(item.vis 已是目前位置)
      else item.vis = homePose(item)
      item.target = t
      // 倒下方向:原位到目前位置的位移方向(沒有位移時往朝向前方)
      setFall(item, t.x - item.home.x, t.z - item.home.z)
    } else {
      setFall(item, t.x - item.target.x, t.z - item.target.z, MIN_DIR_MOVE)
      item.target = t
    }
    if (instant) item.vis = { ...t }
    place(item, item.vis)
  }

  const setFall = (item, dx, dz, min = 1e-4) => {
    const len = Math.hypot(dx, dz)
    if (len > min) item.fall = [dx / len, dz / len]
  }

  const knock = (prop, opts) => {
    upsert(prop, opts)
    rebuildBoxes()
  }

  const restoreOne = (id, instant) => {
    const item = items.get(id)
    if (!item || !item.knocked) return
    item.knocked = false
    if (instant) {
      item.restoring = null
      item.vis = homePose(item)
      setHome(item)
    } else {
      item.restoring = { t: 0, from: { ...item.vis } }
    }
  }
  const restore = (ids, { instant = false } = {}) => {
    for (const id of ids || []) restoreOne(id, instant)
    rebuildBoxes()
  }

  // 以伺服器清單為準(冪等):清單裡的更新目標位置(不重播);本地有、清單沒有 → 回復
  const apply = (list, { instant = false } = {}) => {
    const wanted = new Map((list || []).map((p) => [p.id, p]))
    for (const item of items.values()) if (item.knocked && !wanted.has(item.id)) restoreOne(item.id, instant)
    for (const p of wanted.values()) upsert(p, { instant })
    rebuildBoxes()
  }

  const update = (dt) => {
    const k = 1 - Math.exp(-SMOOTH_RATE * dt)
    for (const item of items.values()) {
      if (item.knocked) {
        const v = item.vis
        const t = item.target
        const yawD = angleDiff(t.yaw, v.yaw)
        if (Math.abs(t.x - v.x) + Math.abs(t.y - v.y) + Math.abs(t.z - v.z) + Math.abs(yawD) + Math.abs(t.tilt - v.tilt) < SNAP_EPS) continue
        v.x += (t.x - v.x) * k
        v.y += (t.y - v.y) * k
        v.z += (t.z - v.z) * k
        v.yaw += yawD * k
        v.tilt += (t.tilt - v.tilt) * k
        place(item, v)
      } else if (item.restoring) {
        const r = item.restoring
        r.t += dt
        if (r.t >= RESTORE_SEC) {
          item.restoring = null
          item.vis = homePose(item)
          setHome(item)
          continue
        }
        const e = easeInOut(clamp01(r.t / RESTORE_SEC))
        const h = item.home
        const s = {
          x: r.from.x + (h.x - r.from.x) * e,
          y: r.from.y + (h.y - r.from.y) * e + Math.sin(e * Math.PI) * RESTORE_HOP,
          z: r.from.z + (h.z - r.from.z) * e,
          yaw: r.from.yaw + angleDiff(h.yaw, r.from.yaw) * e,
          tilt: r.from.tilt * (1 - e),
        }
        item.vis = s
        place(item, s)
      }
    }
  }

  return {
    disabled, // 碰撞疊加層 { has, boxes }:傳給 usePlayerControls 等碰撞函式
    addChair: (id, obj) => register(id, 'chair', obj),
    addMonitor: (id, obj) => register(id, 'monitor', obj),
    addTable: (id, obj) => register(id, 'table', obj),
    knock,
    restore,
    apply,
    update,
    // 可被瞄準的物品 mesh:[{ mesh, id }](含被打飛、停在場上的);excludeIds:不可瞄準的 id(有人坐的椅子)
    hoverMeshes(excludeIds = null) {
      const out = []
      for (const item of items.values()) {
        if (excludeIds?.has(item.id)) continue
        for (const mesh of item.meshes) out.push({ mesh, id: item.id })
      }
      return out
    },
    dispose() {
      for (const item of items.values()) {
        if (!item.proxy) continue
        item.proxy.removeFromParent()
        item.proxy.geometry.dispose()
        item.proxy.material.dispose()
      }
      items.clear()
      boxes = []
    },
  }
}
