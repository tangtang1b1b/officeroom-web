import * as THREE from 'three'
import { BODY } from '~/shared/layout.js'

// 方塊小人:角色朝向 -z(與 Three.js 相機 yaw=0 的朝向一致),腳底在 group 原點。
// 各部位尺寸取自 shared/layout.js 的 BODY(與命中判定共用)。
// 各姿勢的關節參數;切換時在 update() 內平滑插值。
const LEG = BODY.thigh + BODY.shin
const POSES = {
  stand: { hipY: LEG, thigh: 0, lean: 0, rootPitch: 0, rootY: 0, arm: 1.35 },
  // 手臂掛在前傾的軀幹上,實際角度 = arm - lean,所以 arm 補上 lean 才會維持幾乎水平向前
  crouch: { hipY: BODY.shin + 0.02, thigh: 1.5, lean: 0.35, rootPitch: 0, rootY: 0, arm: 1.65 },
  prone: { hipY: LEG, thigh: 0, lean: 0, rootPitch: -Math.PI / 2, rootY: BODY.headS / 2, arm: 2.9 },
}

const HAIRS = [0x2a2118, 0x6b4a2b, 0xc9a24a, 0x1c1c1c, 0x8a3b2a]
const SKINS = [0xf1c8a0, 0xe0ac7f, 0xc68c5e, 0xf6d7b8]
const PANTS = [0x2f3b52, 0x3a3a3a, 0x5b4a3a, 0x24314a]

const SLEEVE = 0.4 // 手臂上段(袖子)長度,其餘為手

// 外型依玩家顏色決定(同一個人在所有人畫面上長得一樣),也可用 appearance 覆寫
const pickAppearance = (color, override = {}) => {
  const hex = new THREE.Color(color).getHex()
  return {
    shirt: color,
    skin: SKINS[hex % SKINS.length],
    hair: HAIRS[(hex >> 3) % HAIRS.length],
    pants: PANTS[(hex >> 5) % PANTS.length],
    glasses: ((hex >> 7) & 1) === 1,
    ...override,
  }
}

export const createStickman = (color = 0x2d9cdb, appearance) => {
  const look = pickAppearance(color, appearance)
  // 只釋放自己建立的 geometry:身上可能附著共用的斑點與名牌,不能用 traverse 全部釋放
  const geometries = []
  const materials = []
  const meshes = [] // 可被漆彈附著的身體方塊(userData.part = 部位名)
  const material = (c) => {
    const m = new THREE.MeshLambertMaterial({ color: c })
    materials.push(m)
    return m
  }
  const shirtMat = material(look.shirt)
  const skinMat = material(look.skin)
  const hairMat = material(look.hair)
  const pantsMat = material(look.pants)
  const shoeMat = material(0x2b2b2b)
  const darkMat = material(0x333333)
  const eyeMat = new THREE.MeshBasicMaterial({ color: 0x111111 })
  materials.push(eyeMat)

  // 方塊:以底面中心為原點向上(offsetY 為中心高度),part 為部位名時登記為可附著
  const block = (w, h, d, mat, parent, position, part) => {
    const geometry = new THREE.BoxGeometry(w, h, d)
    geometries.push(geometry)
    const mesh = new THREE.Mesh(geometry, mat)
    mesh.position.set(...position)
    parent.add(mesh)
    if (part) {
      mesh.userData.part = part
      meshes.push(mesh)
    }
    return mesh
  }

  const root = new THREE.Group()
  const body = new THREE.Group() // 以腳底為原點,做 prone 旋轉
  root.add(body)
  const hip = new THREE.Group()
  body.add(hip)

  // 腿:大腿與小腿各一個 pivot,腳尖朝 -z
  const makeLeg = (side, part) => {
    const thigh = new THREE.Group()
    thigh.position.set(side * BODY.legX, 0, 0)
    block(BODY.legW, BODY.thigh, BODY.legD, pantsMat, thigh, [0, -BODY.thigh / 2, 0], part)
    const shin = new THREE.Group()
    shin.position.y = -BODY.thigh
    block(BODY.legW, BODY.shin - 0.07, BODY.legD, pantsMat, shin, [0, -(BODY.shin - 0.07) / 2, 0], part)
    block(BODY.legW + 0.01, 0.07, BODY.legD + 0.08, shoeMat, shin, [0, -BODY.shin + 0.035, -0.04], part)
    thigh.add(shin)
    hip.add(thigh)
    return { thigh, shin }
  }
  const legL = makeLeg(-1, 'legL')
  const legR = makeLeg(1, 'legR')

  // 軀幹、頭與手臂
  const torso = new THREE.Group()
  hip.add(torso)
  block(BODY.torsoW, BODY.torsoH, BODY.torsoD, shirtMat, torso, [0, BODY.torsoH / 2, 0], 'torso')

  // 頭以脖子為轉軸,可隨視線上下轉動;臉朝 -z
  const neck = new THREE.Group()
  neck.position.y = BODY.torsoH
  torso.add(neck)
  const s = BODY.headS
  const headY = BODY.headGap + s / 2
  block(s, s, s, skinMat, neck, [0, headY, 0], 'head')
  block(s + 0.02, 0.09, s + 0.02, hairMat, neck, [0, headY + s / 2 - 0.035, 0.005], 'head') // 瀏海與頭頂
  block(s + 0.02, s * 0.6, 0.06, hairMat, neck, [0, headY + 0.02, s / 2 - 0.01], 'head') // 後腦
  for (const x of [-0.06, 0.06]) block(0.04, 0.045, 0.012, eyeMat, neck, [x, headY + 0.02, -s / 2 - 0.004])
  if (look.glasses) {
    for (const x of [-0.06, 0.06]) block(0.08, 0.06, 0.012, darkMat, neck, [x, headY + 0.02, -s / 2 - 0.012])
    block(0.04, 0.012, 0.012, darkMat, neck, [0, headY + 0.03, -s / 2 - 0.012])
  }

  const makeArm = (side, part) => {
    const arm = new THREE.Group()
    arm.position.set(side * BODY.armX, BODY.torsoH - BODY.shoulderDrop, 0)
    block(BODY.armW, SLEEVE, BODY.armW, shirtMat, arm, [0, -SLEEVE / 2, 0], part)
    block(BODY.armW - 0.01, BODY.armLen - SLEEVE, BODY.armW - 0.01, skinMat, arm, [0, -(SLEEVE + BODY.armLen) / 2, 0], part)
    torso.add(arm)
    return arm
  }
  const armL = makeArm(-1, 'armL')
  const armR = makeArm(1, 'armR')

  // 漆彈槍接在右手末端,沿手臂方向向前
  const gun = new THREE.Group()
  gun.position.y = -BODY.armLen
  block(0.07, 0.3, 0.07, darkMat, gun, [0, -0.1, 0])
  armR.add(gun)

  const current = { ...POSES.stand }
  let target = POSES.stand
  let pose = 'stand'
  let walkPhase = 0
  let lookTarget = 0 // 視線上下角度(rad,正為抬頭)
  let lookAngle = 0

  const apply = (swing) => {
    hip.position.y = current.hipY
    body.rotation.x = current.rootPitch
    body.position.y = current.rootY
    torso.rotation.x = -current.lean
    legL.thigh.rotation.x = current.thigh + swing
    legL.shin.rotation.x = -current.thigh
    legR.thigh.rotation.x = current.thigh - swing
    legR.shin.rotation.x = -current.thigh
    neck.rotation.x = lookAngle * 0.8
    armL.rotation.x = current.arm // 左手自然下垂,只有持槍的右手跟著視線上下
    armR.rotation.x = current.arm + lookAngle
    armL.rotation.z = 0.04
    armR.rotation.z = -0.04
  }
  apply(0)

  return {
    group: root,
    // 可被漆彈附著的方塊(userData.part 為部位名),供 paint.js 做射線與附著
    meshes,
    get pose() {
      return pose
    },
    setPose(next) {
      if (!POSES[next]) return
      pose = next
      target = POSES[next]
    },
    // pitch:視線上下角度(rad,正為抬頭);趴姿範圍較小,避免手臂穿進地板
    setLook(pitch) {
      // 趴姿不能低頭(手臂會穿進地板)
      const limit = pose === 'prone' ? 0.5 : 1.2
      const floor = pose === 'prone' ? 0 : -limit
      lookTarget = Math.max(floor, Math.min(limit, pitch))
    },
    // speed:水平移動速度(m/s),用於走路擺腿
    update(dt, speed = 0) {
      const k = 1 - Math.exp(-12 * dt)
      for (const key of Object.keys(target)) {
        current[key] += (target[key] - current[key]) * k
      }
      lookAngle += (lookTarget - lookAngle) * (1 - Math.exp(-14 * dt))
      let swing = 0
      if (speed > 0.1 && pose === 'stand') {
        walkPhase += dt * speed * 3
        swing = Math.sin(walkPhase) * 0.6
      }
      apply(swing)
    },
    dispose() {
      geometries.forEach((geometry) => geometry.dispose())
      materials.forEach((m) => m.dispose())
    },
  }
}
