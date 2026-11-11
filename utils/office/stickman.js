import * as THREE from 'three'

// 火柴人:角色朝向 -z(與 Three.js 相機 yaw=0 的朝向一致),腳底在 group 原點。
// 各姿勢的關節參數;切換時在 update() 內平滑插值。
const POSES = {
  stand: { hipY: 0.9, thigh: 0, lean: 0, rootPitch: 0, rootY: 0, arm: 1.35 },
  crouch: { hipY: 0.5, thigh: 1.5, lean: 0.35, rootPitch: 0, rootY: 0, arm: 1.3 },
  prone: { hipY: 0.9, thigh: 0, lean: 0, rootPitch: -Math.PI / 2, rootY: 0.13, arm: 2.9 },
}

const THIGH = 0.45
const SHIN = 0.45
const TORSO = 0.6
const LIMB_RADIUS = 0.04

export const createStickman = (color = 0x2d9cdb) => {
  // 只釋放自己建立的 geometry:身上可能附著共用的斑點與名牌,不能用 traverse 全部釋放
  const geometries = []
  const track = (geometry) => {
    geometries.push(geometry)
    return geometry
  }
  const limb = (length, radius, material) => {
    const mesh = new THREE.Mesh(track(new THREE.CylinderGeometry(radius, radius, length, 8)), material)
    mesh.position.y = -length / 2
    return mesh
  }
  const material = new THREE.MeshLambertMaterial({ color })
  const darkMaterial = new THREE.MeshLambertMaterial({ color: 0x333333 })
  const root = new THREE.Group()
  const body = new THREE.Group() // 以腳底為原點,做 prone 旋轉
  root.add(body)

  const hip = new THREE.Group()
  body.add(hip)

  // 腿:大腿與小腿各一個 pivot
  const makeLeg = (x) => {
    const thigh = new THREE.Group()
    thigh.position.set(x, 0, 0)
    thigh.add(limb(THIGH, LIMB_RADIUS, material))
    const shin = new THREE.Group()
    shin.position.y = -THIGH
    shin.add(limb(SHIN, LIMB_RADIUS, material))
    thigh.add(shin)
    hip.add(thigh)
    return { thigh, shin }
  }
  const legL = makeLeg(-0.1)
  const legR = makeLeg(0.1)

  // 軀幹、頭與手臂
  const torso = new THREE.Group()
  hip.add(torso)
  const torsoMesh = new THREE.Mesh(track(new THREE.CylinderGeometry(0.05, 0.05, TORSO, 8)), material)
  torsoMesh.position.y = TORSO / 2
  torso.add(torsoMesh)
  const head = new THREE.Mesh(track(new THREE.SphereGeometry(0.13, 16, 12)), material)
  head.position.y = TORSO + 0.13
  torso.add(head)

  const makeArm = (x) => {
    const arm = new THREE.Group()
    arm.position.set(x, TORSO - 0.05, 0)
    arm.add(limb(0.55, LIMB_RADIUS, material))
    torso.add(arm)
    return arm
  }
  const armL = makeArm(-0.14)
  const armR = makeArm(0.14)

  // 漆彈槍接在右手末端,沿手臂方向向前
  const gun = new THREE.Group()
  gun.position.y = -0.55
  const gunBody = new THREE.Mesh(track(new THREE.BoxGeometry(0.07, 0.3, 0.07)), darkMaterial)
  gunBody.position.y = -0.1
  gun.add(gunBody)
  armR.add(gun)

  const current = { ...POSES.stand }
  let target = POSES.stand
  let pose = 'stand'
  let walkPhase = 0

  const apply = (swing) => {
    hip.position.y = current.hipY
    body.rotation.x = current.rootPitch
    body.position.y = current.rootY
    torso.rotation.x = -current.lean
    legL.thigh.rotation.x = current.thigh + swing
    legL.shin.rotation.x = -current.thigh
    legR.thigh.rotation.x = current.thigh - swing
    legR.shin.rotation.x = -current.thigh
    armL.rotation.x = current.arm
    armR.rotation.x = current.arm
    armL.rotation.z = 0.12
    armR.rotation.z = -0.12
  }
  apply(0)

  return {
    group: root,
    get pose() {
      return pose
    },
    setPose(next) {
      if (!POSES[next]) return
      pose = next
      target = POSES[next]
    },
    // speed:水平移動速度(m/s),用於走路擺腿
    update(dt, speed = 0) {
      const k = 1 - Math.exp(-12 * dt)
      for (const key of Object.keys(target)) {
        current[key] += (target[key] - current[key]) * k
      }
      let swing = 0
      if (speed > 0.1 && pose === 'stand') {
        walkPhase += dt * speed * 3
        swing = Math.sin(walkPhase) * 0.6
      }
      apply(swing)
    },
    dispose() {
      geometries.forEach((geometry) => geometry.dispose())
      material.dispose()
      darkMaterial.dispose()
    },
  }
}
