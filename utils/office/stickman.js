import * as THREE from 'three'
import { BODY } from '~/shared/layout.js'
import { PLAYER_COLORS } from '~/shared/protocol.js'

// 圓角小人(膠囊身體與四肢、圓頭、髮型、黑褲、各色上衣):角色朝向 -z(與 Three.js 相機 yaw=0 的朝向一致),腳底在 group 原點。
// 各部位尺寸取自 shared/layout.js 的 BODY(與命中判定共用)。
// 各姿勢的關節參數;切換時在 update() 內平滑插值。
const LEG = BODY.thigh + BODY.shin
const POSES = {
  stand: { hipY: LEG, thigh: 0, lean: 0, rootPitch: 0, rootY: 0, arm: 1.35, armL: 0.05 },
  // 手臂掛在前傾的軀幹上,實際角度 = arm - lean,所以 arm 補上 lean 才會維持幾乎水平向前
  crouch: { hipY: BODY.shin + 0.02, thigh: 1.5, lean: 0.35, rootPitch: 0, rootY: 0, arm: 1.65, armL: 0.4 },
  prone: { hipY: LEG, thigh: 0, lean: 0, rootPitch: -Math.PI / 2, rootY: BODY.headS / 2, arm: 2.9, armL: 2.9 },
  // 坐姿:原點在椅子中心(髖在原點正上方 0.45m),大腿水平向前、小腿垂直,手臂前伸放在桌面
  sit: { hipY: BODY.shin + 0.02, thigh: 1.5, lean: 0.05, rootPitch: 0, rootY: 0, arm: 1.2, armL: 1.0 },
}

const HAIRS = [0x2a2118, 0x6b4a2b, 0xc9a24a, 0x1c1c1c, 0x8a3b2a, 0xb4542c]
const SKINS = [0xf1c8a0, 0xe0ac7f, 0xc68c5e, 0xf6d7b8]
const PANTS_BLACK = 0x1b1b1d // 黑褲子
// 上衣顏色:每位玩家由玩家顏色決定的固定色(每個人都不同,但在所有人畫面上一致)
const SHIRTS = [0xe8863a, 0x3aa655, 0xd9473f, 0x3b82c4, 0xf2f2f2, 0xf2c230, 0x8a5cc2, 0xe27ab0, 0x37b3b0, 0x7a8f3a]
const HAIR_STYLES = 4 // 0 短髮、1 長髮、2 丸子頭、3 蓬鬆捲髮

const SLEEVE = 0.4 // 手臂上段(袖子)長度,其餘為手

// 外型依玩家顏色決定(同一個人在所有人畫面上長得一樣),也可用 appearance 覆寫
const pickAppearance = (color, override = {}) => {
  const hex = new THREE.Color(color).getHex()
  // 依伺服器分配的玩家顏色序號決定(在線玩家顏色不重複 → 上衣顏色不重複);不在名單內時退回用色碼
  const found = PLAYER_COLORS.indexOf(String(color))
  const idx = found >= 0 ? found : hex
  return {
    shirt: SHIRTS[idx % SHIRTS.length],
    skin: SKINS[(idx * 3 + 1) % SKINS.length],
    hair: HAIRS[(idx * 5 + 2) % HAIRS.length],
    hairStyle: (idx * 7 + 1) % HAIR_STYLES,
    pants: PANTS_BLACK,
    glasses: idx % 3 === 1,
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

  const register = (mesh, part) => {
    if (part) {
      mesh.userData.part = part
      meshes.push(mesh)
    }
    return mesh
  }
  // 平放用的方塊(眼睛、眼鏡、槍等小零件)
  const block = (w, h, d, mat, parent, position, part) => {
    const geometry = new THREE.BoxGeometry(w, h, d)
    geometries.push(geometry)
    const mesh = new THREE.Mesh(geometry, mat)
    mesh.position.set(...position)
    parent.add(mesh)
    return register(mesh, part)
  }
  // 圓角膠囊(身體、四肢):radius 半徑、length 為「直線段」長度,總高 = length + 2 * radius;scale 可壓成橢圓
  const capsule = (radius, totalLen, mat, parent, position, part, scale) => {
    const geometry = new THREE.CapsuleGeometry(radius, Math.max(0.001, totalLen - 2 * radius), 6, 14)
    geometries.push(geometry)
    const mesh = new THREE.Mesh(geometry, mat)
    mesh.position.set(...position)
    if (scale) mesh.scale.set(...scale)
    parent.add(mesh)
    return register(mesh, part)
  }
  const sphere = (radius, mat, parent, position, part, scale, rotX = 0) => {
    const geometry = new THREE.SphereGeometry(radius, 18, 14)
    geometries.push(geometry)
    const mesh = new THREE.Mesh(geometry, mat)
    mesh.position.set(...position)
    if (scale) mesh.scale.set(...scale)
    mesh.rotation.x = rotX
    parent.add(mesh)
    return register(mesh, part)
  }

  const root = new THREE.Group()
  const body = new THREE.Group() // 以腳底為原點,做 prone 旋轉
  root.add(body)
  const hip = new THREE.Group()
  body.add(hip)

  // 腿:大腿與小腿各一個 pivot,腳尖朝 -z;圓角黑褲 + 圓頭鞋
  const legR0 = BODY.legW / 2 + 0.005
  const makeLeg = (side, part) => {
    const thigh = new THREE.Group()
    thigh.position.set(side * BODY.legX, 0, 0)
    capsule(legR0, BODY.thigh + 0.02, pantsMat, thigh, [0, -BODY.thigh / 2, 0], part)
    const shin = new THREE.Group()
    shin.position.y = -BODY.thigh
    capsule(legR0 - 0.008, BODY.shin - 0.05, pantsMat, shin, [0, -(BODY.shin - 0.05) / 2, 0], part)
    sphere(0.085, shoeMat, shin, [0, -BODY.shin + 0.04, -0.035], part, [0.95, 0.55, 1.5])
    thigh.add(shin)
    hip.add(thigh)
    return { thigh, shin }
  }
  const legL = makeLeg(-1, 'legL')
  const legR = makeLeg(1, 'legR')

  // 軀幹、頭與手臂
  const torso = new THREE.Group()
  hip.add(torso)
  const torsoR = BODY.torsoD / 2
  capsule(torsoR, BODY.torsoH, shirtMat, torso, [0, BODY.torsoH / 2, 0], 'torso', [BODY.torsoW / BODY.torsoD, 1, 1])

  // 頭以脖子為轉軸,可隨視線上下轉動;臉朝 -z。圓頭 + 髮型
  const neck = new THREE.Group()
  neck.position.y = BODY.torsoH
  torso.add(neck)
  const s = BODY.headS
  const headR = s / 2
  const headY = BODY.headGap + headR
  sphere(headR, skinMat, neck, [0, headY, 0], 'head')
  // 髮型:半球蓋住頭頂與後腦,稍微往後傾,露出前額與臉
  const hairCap = (radius, tilt, sx = 1, sy = 1, sz = 1) => {
    const geometry = new THREE.SphereGeometry(radius, 18, 12, 0, Math.PI * 2, 0, Math.PI * 0.58)
    geometries.push(geometry)
    const mesh = new THREE.Mesh(geometry, hairMat)
    mesh.position.set(0, headY, 0.004)
    mesh.rotation.x = tilt
    mesh.scale.set(sx, sy, sz)
    neck.add(mesh)
    return register(mesh, 'head')
  }
  switch (look.hairStyle) {
    case 1: // 長髮:頭蓋 + 披在後面兩側的髮片
      hairCap(headR * 1.08, 0.5)
      sphere(headR * 0.95, hairMat, neck, [0, headY - 0.07, headR * 0.42], 'head', [1.05, 1.25, 0.62])
      break
    case 2: // 丸子頭
      hairCap(headR * 1.07, 0.45)
      sphere(headR * 0.42, hairMat, neck, [0, headY + headR * 0.95, headR * 0.45], 'head')
      break
    case 3: // 蓬鬆捲髮
      hairCap(headR * 1.3, 0.35, 1.05, 1.0, 1.05)
      break
    default: // 短髮
      hairCap(headR * 1.07, 0.55)
  }
  for (const x of [-0.052, 0.052]) sphere(0.019, eyeMat, neck, [x, headY + 0.015, -headR + 0.014])
  if (look.glasses) {
    for (const x of [-0.052, 0.052]) block(0.07, 0.055, 0.01, darkMat, neck, [x, headY + 0.015, -headR + 0.002])
    block(0.04, 0.01, 0.01, darkMat, neck, [0, headY + 0.025, -headR + 0.002])
  }

  const armR0 = BODY.armW / 2 + 0.006
  const makeArm = (side, part) => {
    const arm = new THREE.Group()
    arm.position.set(side * BODY.armX, BODY.torsoH - BODY.shoulderDrop, 0)
    sphere(armR0 * 1.1, shirtMat, arm, [0, 0, 0], part) // 圓肩
    capsule(armR0, SLEEVE, shirtMat, arm, [0, -SLEEVE / 2 + 0.01, 0], part)
    capsule(armR0 - 0.012, BODY.armLen - SLEEVE + 0.03, skinMat, arm, [0, -(SLEEVE + BODY.armLen) / 2 + 0.005, 0], part)
    sphere(armR0 * 1.05, skinMat, arm, [0, -BODY.armLen + 0.01, 0], part) // 圓手
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
    armL.rotation.x = current.armL - swing * 0.5 // 沒拿槍的左手自然下垂,走路時與左腿反向擺動;只有持槍的右手舉著並跟著視線
    armR.rotation.x = current.arm + lookAngle
    armL.rotation.z = 0.06
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
    // 立即套用目前姿勢(不做插值),用於人物第一次出現時
    snapPose() {
      Object.assign(current, target)
      apply(0)
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
