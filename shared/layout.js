// 辦公室格局資料(前端渲染、碰撞與伺服器射線檢測共用,純資料不依賴任何框架)
// 座標:x 向右、y 向上、z 向前(角色與相機 yaw=0 時朝 -z),單位公尺。
// 依使用者手繪草圖概估(尺寸為估計值,日後依實際尺寸微調)。草圖為直式梯形,
// 這裡轉 90° 使長邊沿 x、桌子方向與桌子模型一致,並以外接矩形近似斜牆。
// 區域:x<5.2 且 z>3.4 為會議室(x<0.4)與會客室(0.4<x<5.2);其餘為開放辦公區。
// 房間 20×15,桌組間通道約 1.5m、桌組與牆至少 1.2m。

export const ROOM = {
  minX: -10,
  maxX: 10,
  minZ: -7.5,
  maxZ: 7.5,
  height: 3,
}

export const PLAYER = {
  radius: 0.2, // 碰撞圓半徑(比肩寬小,過走道與門不易卡住)
  // 各姿勢的身體高度與眼睛高度(須與 utils/office/stickman.js 的模型一致)
  bodyHeight: { stand: 1.75, crouch: 1.3, prone: 0.3 },
  eyeHeight: { stand: 1.6, crouch: 1.15, prone: 0.4 },
  walkSpeed: { stand: 3.2, crouch: 1.6, prone: 0.8 },
  // 趴下時身體從腳底沿面向(-z 旋轉 yaw)平躺的長度
  proneLength: 1.75,
}

// 方塊小人各部位尺寸(公尺)。模型(utils/office/stickman.js)與命中判定共用同一份,
// 局部座標:原點在腳底中心,x 向右、y 向上,角色朝 -z。站姿總高 = 腿 + 軀幹 + 頸縫 + 頭 ≈ 1.75。
export const BODY = {
  thigh: 0.43,
  shin: 0.43,
  legW: 0.15,
  legD: 0.16,
  legX: 0.1, // 左右腿中心離中線
  torsoW: 0.42,
  torsoD: 0.24,
  torsoH: 0.6,
  headS: 0.28,
  headGap: 0.01,
  armLen: 0.55,
  armW: 0.11,
  armX: 0.265, // 手臂中心離中線(貼著軀幹側面)
  shoulderDrop: 0.07, // 肩膀低於軀幹頂端
}

// 命中部位盒(AABB),由 BODY 推導。座標為局部 (右, 上, 前),原點在腳底中心;
// 前 = (-sin yaw, 0, -cos yaw)、右 = (cos yaw, 0, -sin yaw)。L = 右座標為負側。
// 站/蹲/趴三種姿勢共用;趴姿沿「前」方向平躺,手臂省略。皆為近似盒,非精確模型。
function buildHitParts() {
  const B = BODY
  const box = (r0, r1, u0, u1, f0, f1) => ({ min: [r0, u0, f0], max: [r1, u1, f1] })
  const sym = (name, cx, halfW, u0, u1, f0, f1) => ({
    [name + 'L']: box(-cx - halfW, -cx + halfW, u0, u1, f0, f1),
    [name + 'R']: box(cx - halfW, cx + halfW, u0, u1, f0, f1),
  })
  const legH = B.thigh + B.shin // 0.86
  const torsoTop = legH + B.torsoH // 1.46
  const headHalf = B.headS / 2
  const tw = B.torsoW / 2
  const td = B.torsoD / 2
  const ld = B.legD / 2
  const lw = B.legW / 2

  // 站姿:手臂幾乎水平向前平舉(旋轉約 1.35rad,末端略低於肩)
  const shoulderY = torsoTop - B.shoulderDrop
  const stand = {
    head: box(-headHalf, headHalf, torsoTop + B.headGap, torsoTop + B.headGap + B.headS, -headHalf, headHalf),
    torso: box(-tw, tw, legH, torsoTop, -td, td),
    ...sym('arm', B.armX, B.armW / 2, shoulderY - 0.14, shoulderY + B.armW / 2, -B.armW / 2, B.armLen + 0.05),
    ...sym('leg', B.legX, lw, 0, legH, -ld, ld),
  }

  // 蹲姿:髖高 0.5、大腿水平向前、軀幹前傾 0.35rad,總高約 1.3
  const hip = 0.5
  const lean = 0.35
  const torsoTopC = hip + B.torsoH * Math.cos(lean) // ~1.06
  const torsoFwdC = B.torsoH * Math.sin(lean) // ~0.21
  const headBottomC = torsoTopC - 0.04
  const crouch = {
    head: box(-headHalf, headHalf, headBottomC, headBottomC + B.headS, torsoFwdC - headHalf + 0.02, torsoFwdC + headHalf + 0.02),
    torso: box(-tw, tw, hip, torsoTopC, -td, torsoFwdC + td),
    ...sym('arm', B.armX, B.armW / 2, torsoTopC - 0.2, torsoTopC - 0.03, torsoFwdC - 0.06, torsoFwdC + B.armLen),
    ...sym('leg', B.legX, lw, 0, hip + 0.05, -ld, B.thigh + 0.07),
  }

  // 趴姿:沿「前」從腳底延伸,腿 0~0.86、軀幹 0.86~1.46、頭 1.47~1.75
  const pH = PLAYER.bodyHeight.prone
  const prone = {
    head: box(-headHalf, headHalf, 0, pH, torsoTop + B.headGap, torsoTop + B.headGap + B.headS),
    torso: box(-tw, tw, 0, pH, legH, torsoTop),
    ...sym('leg', B.legX, lw, 0, B.legD, 0, legH),
  }
  return { stand, crouch, prone }
}

export const HIT_PARTS = buildHitParts()

const DESK = { w: 1.6, d: 0.75, h: 0.75 }
const CHAIR = { w: 0.55, d: 0.55, h: 0.9 }
const CHAIR_COLLIDER = { w: 0.5, d: 0.5 }
const CHAIR_COLLIDER_HEIGHT = 1.15 // 含椅背與頭枕(轉椅總高約 1.12)

// 桌組:每組兩張桌子背對背,椅子在兩側;位置對應草圖中黃色桌組由左上往右下排列
const CLUSTER_CENTERS = [
  { x: -7.75, z: -1.9 },
  { x: -4.65, z: -2.5 },
  { x: -1.55, z: -3.1 },
  { x: 1.55, z: -3.7 },
  { x: 4.65, z: -4.3 },
  { x: 7.75, z: -4.9 },
]

export const DESKS = []
export const CHAIRS = []

CLUSTER_CENTERS.forEach((center, index) => {
  ;[-1, 1].forEach((side) => {
    DESKS.push({
      id: `desk-${index}-${side}`,
      x: center.x,
      z: center.z + side * (DESK.d / 2 + 0.02),
      side,
      ...DESK,
    })
    CHAIRS.push({
      id: `chair-${index}-${side}`,
      x: center.x,
      z: center.z + side * (DESK.d + 0.55),
      side,
      yaw: side > 0 ? 0 : Math.PI,
      ...CHAIR,
    })
  })
})

// 紙箱(搬家感)
export const CRATES = [
  { id: 'crate-0', x: 8.6, z: 5.8, w: 0.7, d: 0.5, h: 0.45 },
  { id: 'crate-1', x: 7.8, z: 6.1, w: 0.6, d: 0.5, h: 0.4 },
]

const WALL_T = 0.2
// 室內隔牆(會議室、會客室),門口留缺口。{ id, x, z, w, d }:中心與尺寸
const wallX = (id, x0, x1, z) => ({ id, x: (x0 + x1) / 2, z, w: x1 - x0, d: WALL_T })
const wallZ = (id, x, z0, z1) => ({ id, x, z: (z0 + z1) / 2, w: WALL_T, d: z1 - z0 })
export const WALLS = [
  wallX('wall-a', -10, -6, 3.4), // 會議室門在 x -6 ~ -4.8
  wallX('wall-b', -4.8, 2.4, 3.4), // 會客室門在 x 2.4 ~ 3.6
  wallX('wall-c', 3.6, 5.3, 3.4),
  wallZ('wall-d', 0.4, 3.4, 7.5), // 會議室與會客室之間
  wallZ('wall-e', 5.2, 3.4, 7.5), // 會客室底牆
]

// 固定家具(桌、櫃、沙發):{ id, kind, x, z, w, d, h },kind 決定外觀
export const FIXTURES = [
  { id: 'meeting-table', kind: 'table', x: -3.2, z: 5.6, w: 3.4, d: 1.2, h: 0.75 },
  { id: 'table-a', kind: 'table', x: -9.5, z: 0.6, w: 0.9, d: 1.0, h: 0.75 },
  { id: 'table-b', kind: 'table', x: -9.5, z: 1.8, w: 0.9, d: 1.0, h: 0.75 },
  { id: 'sofa', kind: 'sofa', x: 2.8, z: 7.05, w: 2.4, d: 0.8, h: 0.85 },
  { id: 'coffee-table', kind: 'table', x: 2.8, z: 5.4, w: 1.2, d: 0.6, h: 0.45 },
  // 草圖藍色長條:高書櫃(中間留 x -0.8 ~ 0.8 走道)與矮櫃
  { id: 'shelf-a', kind: 'shelf', x: -2.2, z: 1.0, w: 2.8, d: 0.54, h: 1.9 },
  { id: 'shelf-b', kind: 'shelf', x: 2.0, z: 1.0, w: 2.4, d: 0.54, h: 1.9 },
  { id: 'locker-a', kind: 'locker', x: -2.45, z: 1.65, w: 3.1, d: 0.66, h: 0.9 },
  { id: 'locker-b', kind: 'locker', x: 2.05, z: 1.65, w: 2.3, d: 0.66, h: 0.9 },
]

// 桌面上的隔板與螢幕:尺寸與位置(相對桌子中心)同時供渲染與碰撞使用
export const PARTITION = { w: 1.6, h: 0.3, d: 0.02 }
export const MONITOR = { w: 0.55, h: 0.32, d: 0.03, y: 0.3, zOffset: 0.1 }

export const partitionOf = (desk) => ({
  x: desk.x,
  z: desk.z + (desk.side > 0 ? -desk.d / 2 + 0.01 : desk.d / 2 - 0.01),
  ...PARTITION,
})
export const monitorOf = (desk) => ({
  x: desk.x,
  z: desk.z + (desk.side > 0 ? -MONITOR.zOffset : MONITOR.zOffset),
  ...MONITOR,
})

const box = (id, x, z, w, d, minY, maxY) => ({
  id,
  min: [x - w / 2, minY, z - d / 2],
  max: [x + w / 2, maxY, z + d / 2],
})

// 所有實心碰撞方塊;外牆以 ROOM 邊界處理。渲染看得到的東西都要在這裡。
export const COLLIDERS = [
  ...WALLS.map((w) => box(w.id, w.x, w.z, w.w, w.d, 0, ROOM.height)),
  ...FIXTURES.map((f) => box(f.id, f.x, f.z, f.w, f.d, 0, f.h)),
  ...DESKS.flatMap((desk) => {
    const part = partitionOf(desk)
    const mon = monitorOf(desk)
    return [
      box(desk.id, desk.x, desk.z, desk.w, desk.d, 0, desk.h),
      box(`${desk.id}-partition`, part.x, part.z, part.w, part.d, desk.h, desk.h + part.h),
      box(`${desk.id}-monitor`, mon.x, mon.z, mon.w, mon.d, desk.h + mon.y - mon.h / 2, desk.h + mon.y + mon.h / 2),
    ]
  }),
  // 椅子與紙箱:固定靜態方塊(椅子 yaw=0 面向 -z,side>0 → 0、side<0 → π)
  ...CHAIRS.map((c) => box(c.id, c.x, c.z, CHAIR_COLLIDER.w, CHAIR_COLLIDER.d, 0, CHAIR_COLLIDER_HEIGHT)),
  ...CRATES.map((c) => box(c.id, c.x, c.z, c.w, c.d, 0, c.h)),
]

export const SPAWN_POINTS = [
  { x: -8, z: 1.5 },
  { x: -6.2, z: 1.8 },
  { x: 4.2, z: 1.0 },
  { x: 8.5, z: 0.5 },
  { x: 8.5, z: 2.5 },
  { x: 0, z: 2.6 },
]
