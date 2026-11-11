import * as THREE from 'three'

const MAX_SPLATS = 150
const TRACER_LIFE = 0.12
const FORWARD = new THREE.Vector3(0, 0, 1)

// 漆彈斑點(貼在牆、家具或玩家身上)與彈道
export const createPaint = (scene, getPlayerGroup) => {
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

  const addSplat = ({ pos, normal, color, targetId }) => {
    const material = materialFor(color)
    const group = new THREE.Group()
    const main = new THREE.Mesh(splatGeometry, material)
    main.scale.setScalar(0.1 + Math.random() * 0.07)
    group.add(main)
    for (let i = 0; i < 3; i++) {
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

    const host = targetId ? getPlayerGroup(targetId) : null
    scene.add(group)
    if (host) host.attach(group) // 保留世界座標,之後跟著玩家移動

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

  const update = (dt) => {
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

  return {
    addSplat,
    addTracer,
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
