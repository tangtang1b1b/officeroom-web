import * as THREE from 'three'

const MAX_SPLATS = 150
const TRACER_LIFE = 0.12
const FORWARD = new THREE.Vector3(0, 0, 1)

// 漆彈斑點(貼在牆、家具或玩家身上)與彈道
// getHost(msg):回傳斑點要附著的群組(被打中的玩家或可動物件),沒有則為 null
export const createPaint = (scene, getHost) => {
  const splatGeometry = new THREE.CircleGeometry(1, 20)
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

  const removeSplat = (group) => group.parent?.remove(group)

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

  const addSplat = (msg) => {
    const host = getHost(msg)
    const onBody = msg.targetId && host ? locateOnBody(msg, host) : null
    const pos = onBody ? onBody.point.toArray() : msg.pos
    const normal = onBody ? onBody.normal.toArray() : msg.normal
    const { color } = msg
    const material = materialFor(color)
    const group = new THREE.Group()
    const main = new THREE.Mesh(splatGeometry, material)
    main.scale.setScalar(0.1 + Math.random() * 0.07)
    group.add(main)
    for (let i = 0; i < (onBody ? 0 : 3); i++) { // 身體方塊太小,外圍小點會懸空,不畫
      const drop = new THREE.Mesh(splatGeometry, material)
      const angle = Math.random() * Math.PI * 2
      const dist = 0.12 + Math.random() * 0.1
      drop.scale.setScalar(0.02 + Math.random() * 0.03)
      drop.position.set(Math.cos(angle) * dist, Math.sin(angle) * dist, 0)
      group.add(drop)
    }
    const n = new THREE.Vector3(...normal).normalize()
    group.position.set(pos[0] + n.x * 0.012, pos[1] + n.y * 0.012, pos[2] + n.z * 0.012)
    group.quaternion.setFromUnitVectors(FORWARD, n)
    group.rotateZ(Math.random() * Math.PI * 2)
    // 身體方塊較小,斑點縮小以免大半懸在邊緣外
    if (onBody) group.scale.setScalar(onBody.mesh.userData.part === 'torso' ? 0.7 : 0.45)

    scene.add(group)
    // 保留世界座標,之後跟著被打中的方塊(身體部位)或物件移動
    ;(onBody ? onBody.mesh : host)?.attach(group)

    splats.push(group)
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
      if (!inScene(splats[i])) splats.splice(i, 1)
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
      splatGeometry.dispose()
      materials.forEach((m) => m.dispose())
    },
  }
}
