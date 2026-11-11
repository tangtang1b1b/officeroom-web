import * as THREE from 'three'
import { DecalGeometry } from 'three/examples/jsm/geometries/DecalGeometry.js'

const MAX_SPLATS = 150
const TRACER_LIFE = 0.12
const FORWARD = new THREE.Vector3(0, 0, 1)

// 漆彈斑點(貼在牆、家具或玩家身上)與彈道
// getHost(msg):回傳斑點要附著的群組(被打中的玩家或可動物件),沒有則為 null
export const createPaint = (scene, getHost) => {
  const materials = new Map()
  const splats = []
  const tracers = []

  const materialFor = (color) => {
    const key = new THREE.Color(color).getHexString()
    if (!materials.has(key)) {
      materials.set(
        key,
        new THREE.MeshBasicMaterial({
          color: new THREE.Color(color),
          side: THREE.DoubleSide,
          polygonOffset: true,
          polygonOffsetFactor: -2,
          polygonOffsetUnits: -2,
        }),
      )
    }
    return materials.get(key)
  }

  const removeSplat = (decals) => {
    for (const d of decals) {
      d.parent?.remove(d)
      d.geometry.dispose()
    }
  }

  // 命中玩家時,找出真正被打中的身體方塊與表面點:
  // 先從射擊起點朝命中點對實際模型做射線(最準);因網路插值模型可能稍有落差而打空時,
  // 改選同名部位中離命中點最近的方塊,把點吸附到方塊表面。
  const raycaster = new THREE.Raycaster()
  const locateOnBody = (msg, group) => {
    const meshes = group.userData.bodyMeshes
    if (!meshes?.length) return null
    group.updateMatrixWorld(true)
    const target = new THREE.Vector3(...msg.pos)
    if (msg.origin) {
      const origin = new THREE.Vector3(...msg.origin)
      const dir = target.clone().sub(origin)
      const dist = dir.length()
      if (dist < 1e-6) return null // 起點與命中點重合,方向無定義
      raycaster.set(origin, dir.normalize())
      raycaster.far = dist + 0.5
      const hit = raycaster.intersectObjects(meshes, false)[0]
      if (hit?.face) {
        const normal = hit.face.normal.clone().transformDirection(hit.object.matrixWorld)
        return { mesh: hit.object, point: hit.point, normal }
      }
    }
    const pool = msg.part ? meshes.filter((m) => m.userData.part === msg.part) : meshes
    // 在方塊「局部座標」夾到表面(世界 AABB 會在旋轉後變大,點會落在方塊外)
    let best = null
    for (const mesh of pool.length ? pool : meshes) {
      if (!mesh.geometry.boundingBox) mesh.geometry.computeBoundingBox()
      const local = mesh.worldToLocal(target.clone())
      const surface = mesh.geometry.boundingBox.clampPoint(local, new THREE.Vector3())
      const d = surface.distanceToSquared(local)
      if (!best || d < best.d) best = { mesh, local, surface, d }
    }
    if (!best) return null
    const normal = best.local.clone().sub(best.surface)
    if (normal.lengthSq() < 1e-6) normal.set(...msg.normal).transformDirection(best.mesh.matrixWorld.clone().invert())
    normal.transformDirection(best.mesh.matrixWorld)
    return { mesh: best.mesh, point: best.mesh.localToWorld(best.surface.clone()), normal }
  }

  // 貼花:把被投影盒切出的三角形貼合在目標網格表面(轉角會沿兩面彎折)
  const dummy = new THREE.Object3D()
  const box = new THREE.Box3()
  const meshBox = new THREE.Box3()
  const sizeVec = new THREE.Vector3()
  const makeDecal = (mesh, center, quaternion, size) => {
    mesh.updateMatrixWorld(true)
    box.setFromCenterAndSize(center, sizeVec.set(size * 1.8, size * 1.8, size * 1.8))
    if (!meshBox.setFromObject(mesh).intersectsBox(box)) return null
    let geometry
    try {
      // 薄物(隔板、螢幕等,任一邊 < 8cm)縮小投影深度,避免貼花穿透到背面
      const thin = Math.min(...meshBox.getSize(sizeVec).toArray()) < 0.08
      geometry = new DecalGeometry(mesh, center, new THREE.Euler().setFromQuaternion(quaternion), new THREE.Vector3(size, size, thin ? 0.04 : size))
    } catch {
      return null
    }
    if (!geometry.getAttribute('position')?.count) {
      geometry.dispose()
      return null
    }
    return geometry
  }

  // 產生一個斑點(主斑 + 小水滴)貼到 targets;attach=true 時頂點轉成各網格局部座標並掛在該網格下
  const buildSplat = (targets, pos, n, material, sizes, attach) => {
    const decals = []
    const center = new THREE.Vector3(...pos)
    const base = new THREE.Quaternion().setFromUnitVectors(FORWARD, n)
    const tangent = new THREE.Vector3()
    sizes.forEach((size, i) => {
      const spin = new THREE.Quaternion().setFromAxisAngle(FORWARD, Math.random() * Math.PI * 2)
      dummy.quaternion.copy(base).multiply(spin)
      const c = center.clone()
      if (i > 0) { // 小水滴散在主斑周圍
        const angle = Math.random() * Math.PI * 2
        const dist = sizes[0] * (0.7 + Math.random() * 0.5)
        tangent.set(Math.cos(angle) * dist, Math.sin(angle) * dist, 0).applyQuaternion(base)
        c.add(tangent)
      }
      for (const target of targets) {
        const geometry = makeDecal(target, c, dummy.quaternion, size)
        if (!geometry) continue
        const decal = new THREE.Mesh(geometry, material)
        decal.userData.isSplat = true
        if (attach) {
          geometry.applyMatrix4(target.matrixWorld.clone().invert())
          target.add(decal)
        } else {
          scene.add(decal)
        }
        decals.push(decal)
      }
    })
    return decals
  }

  const meshesOf = (root) => {
    const list = []
    root.traverse((o) => {
      if (o.isMesh && !o.userData.isSplat) list.push(o)
    })
    return list
  }

  const addSplat = (msg) => {
    const host = getHost(msg)
    const onBody = msg.targetId && host ? locateOnBody(msg, host) : null
    const pos = onBody ? onBody.point.toArray() : msg.pos
    const normal = onBody ? onBody.normal.toArray() : msg.normal
    const material = materialFor(msg.color)
    const n = new THREE.Vector3(...normal).normalize()
    // 往外推一點,讓投影盒中心落在表面外側而非剛好貼面
    const p = [pos[0] + n.x * 0.005, pos[1] + n.y * 0.005, pos[2] + n.z * 0.005]

    // 身體方塊較小,斑點縮小
    const scale = onBody ? (onBody.mesh.userData.part === 'torso' ? 0.7 : 0.45) : 1
    const main = (0.12 + Math.random() * 0.08) * scale
    const sizes = [main]
    const drops = onBody ? 2 : 3
    for (let i = 0; i < drops; i++) sizes.push((0.03 + Math.random() * 0.03) * scale)

    let targets
    let attach = true
    if (onBody) {
      targets = host.userData.bodyMeshes
    } else if (host) {
      targets = meshesOf(host)
    } else {
      targets = []
      attach = false
      scene.traverse((o) => {
        if (o.isMesh && o.userData.paintable === true) targets.push(o)
      })
    }
    const decals = buildSplat(targets, p, n, material, sizes, attach)
    if (!decals.length) return

    splats.push(decals)
    if (splats.length > MAX_SPLATS) removeSplat(splats.shift())
  }

  const addTracer = (origin, end, color) => {
    const geometry = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(...origin), new THREE.Vector3(...end)])
    const material = new THREE.LineBasicMaterial({ color: new THREE.Color(color), transparent: true })
    const line = new THREE.Line(geometry, material)
    scene.add(line)
    tracers.push({ line, life: TRACER_LIFE })
  }

  const inScene = (object) => {
    let node = object
    while (node.parent) node = node.parent
    return node === scene
  }

  const update = (dt) => {
    // 宿主(離開的玩家、被移除的物件)已不在場景:斑點一併丟棄,避免撐住已釋放的物件樹並佔用名額
    for (let i = splats.length - 1; i >= 0; i--) {
      if (!inScene(splats[i][0])) {
        removeSplat(splats[i])
        splats.splice(i, 1)
      }
    }
    for (let i = tracers.length - 1; i >= 0; i--) {
      const tracer = tracers[i]
      tracer.life -= dt
      tracer.line.material.opacity = Math.max(0, tracer.life / TRACER_LIFE)
      if (tracer.life <= 0) {
        scene.remove(tracer.line)
        tracer.line.geometry.dispose()
        tracer.line.material.dispose()
        tracers.splice(i, 1)
      }
    }
  }

  // 重連時房間可能已重置,清掉所有斑點(牆、家具、玩家與物件上的)
  const clear = () => {
    splats.forEach(removeSplat)
    splats.length = 0
  }

  return {
    addSplat,
    addTracer,
    clear,
    update,
    dispose() {
      splats.forEach(removeSplat)
      splats.length = 0
      tracers.forEach((t) => {
        scene.remove(t.line)
        t.line.geometry.dispose()
        t.line.material.dispose()
      })
      tracers.length = 0
      materials.forEach((m) => m.dispose())
    },
  }
}
