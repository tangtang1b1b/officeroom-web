// 辦公室格局資料(前端渲染、碰撞與伺服器射線檢測共用,純資料不依賴任何框架)
// 座標:x 向右、y 向上、z 向前(角色與相機 yaw=0 時朝 -z),單位公尺。
// 依使用者手繪草圖概估(尺寸為估計值,日後依實際尺寸微調)。草圖為直式梯形,
// 這裡轉 90° 使長邊沿 x、桌子方向與桌子模型一致,並以外接矩形近似斜牆。
// 房間為梯形:x -10~10,+z 牆在 7.5,-z 牆斜(窄端 -x、寬端 +x)。草圖轉 90°:草圖上方 = -x、草圖左側 = +z。
// z>3.4 的一帶是隔間:會議室(x<0.4)、會客室(0.4<x<5.2)、入口區(x>5.2,玻璃門在 +x 牆);
// z<3.4 是開放辦公區:Will/Yuhua 靠 -x 牆面向其他人,四組背對背桌組,中間一排矮書櫃。


export const ROOM = {
  minX: -10,
  maxX: 5.5, // 長度 15.5m:會議室壓縮後,會客室與入口(大小不變)整塊往會議室方向移
  minZ: -8.2, // 外接框;-z 側牆是斜的,實際界線見 WALL_SLANT / minZAt
  maxZ: 7.5,
  height: 3,
}

// 梯形平面:-z 側的牆從窄端 (-10, -5.1) 斜到寬端 (5.5, -8.2)(草圖由窄變寬,與手繪梯形一致)
export const WALL_SLANT = { x0: -10, z0: -5.1, x1: 5.5, z1: -8.2 }
export const minZAt = (x) => WALL_SLANT.z0 + ((WALL_SLANT.z1 - WALL_SLANT.z0) * (x - WALL_SLANT.x0)) / (WALL_SLANT.x1 - WALL_SLANT.x0)

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

// 桌子可旋轉 yaw(0 或 ±π/2):w、d 是桌子自己的長寬(局部座標),碰撞用 footprint 換算成世界方向。
const rotated = (yaw) => Math.abs(Math.sin(yaw || 0)) > 0.5
export const footprint = (obj, w, d) => (rotated(obj.yaw) ? { w: d, d: w } : { w, d })
const localToWorld = (obj, lx, lz) => {
  const c = Math.cos(obj.yaw || 0)
  const s = Math.sin(obj.yaw || 0)
  return { x: obj.x + lx * c + lz * s, z: obj.z - lx * s + lz * c }
}

export const DESKS = []
export const CHAIRS = []

// 4 張一組:兩排背對背桌子(椅子在 ±z 兩側),兩排沿 x 首尾相接 → 共兩組 8 張。
// 每「排」是一個 cluster:組 A 為 cluster 0、1,組 B 為 cluster 2、3(組 B 略往後退)。
const CLUSTER_CENTERS = [
  { x: -5.2, z: -3.9 },
  { x: -3.5, z: -3.9 },
  { x: 0.6, z: -4.7 },
  { x: 2.3, z: -4.7 },
]
export const clusterGroup = (id) => (/\d/.test(id) ? (Number(id.split('-')[1]) < 2 ? 'A' : 'B') : 'wall-row')
CLUSTER_CENTERS.forEach((center, index) => {
  ;[-1, 1].forEach((side) => {
    DESKS.push({ id: `desk-${index}-${side}`, x: center.x, z: center.z + side * (DESK.d / 2 + 0.02), side, yaw: 0, ...DESK })
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

// Will、Yuhua:靠 -x 牆的兩張桌子,椅子在牆側、面向 +x(其他同事的方向)。
// 桌子旋轉 π/2、side=-1:椅子在局部 -z = 世界 -x。
;[
  { name: 'will', z: -1.4 },
  { name: 'yuhua', z: -3.2 },
].forEach(({ name, z }) => {
  DESKS.push({ id: `desk-${name}`, x: -8.3, z, side: -1, yaw: Math.PI / 2, ...DESK })
  CHAIRS.push({ id: `chair-${name}`, x: -9.6, z, side: -1, yaw: -Math.PI / 2, ...CHAIR })
})

// 座位表:name 為 null 表示尚未指定員工(三個空位,不需要有人)。
export const SEATS = [
  { id: 'seat-will', name: 'Will', deskId: 'desk-will', chairId: 'chair-will' },
  { id: 'seat-yuhua', name: 'Yuhua', deskId: 'desk-yuhua', chairId: 'chair-yuhua' },
  { id: 'seat-1', name: null, deskId: 'desk-0-1', chairId: 'chair-0-1' },
  { id: 'seat-2', name: null, deskId: 'desk-0--1', chairId: 'chair-0--1' },
  { id: 'seat-3', name: 'Amin', deskId: 'desk-1-1', chairId: 'chair-1-1' },
  { id: 'seat-4', name: 'Kai', deskId: 'desk-1--1', chairId: 'chair-1--1' },
  { id: 'seat-5', name: null, deskId: 'desk-2-1', chairId: 'chair-2-1' },
  { id: 'seat-6', name: 'Sean', deskId: 'desk-2--1', chairId: 'chair-2--1' },
  { id: 'seat-7', name: 'Eric', deskId: 'desk-3-1', chairId: 'chair-3-1' },
  { id: 'seat-8', name: 'Sandy', deskId: 'desk-3--1', chairId: 'chair-3--1' },
]

const WALL_T = 0.2
// 室內隔牆(會議室、會客室),門口留缺口。{ id, x, z, w, d }:中心與尺寸
const wallX = (id, x0, x1, z) => ({ id, x: (x0 + x1) / 2, z, w: x1 - x0, d: WALL_T })
const wallZ = (id, x, z0, z1) => ({ id, x, z: (z0 + z1) / 2, w: WALL_T, d: z1 - z0 })
export const WALLS = [
  wallX('wall-a', -10, -8.4, 3.4), // 會議室門在 x -8.4 ~ -7.2
  wallX('wall-b', -7.2, -0.1, 3.4), // 會客室門在 x -0.1 ~ 1.1
  wallX('wall-c', 1.1, 2.6, 3.4), // 止於 wall-e 的牆面,避免兩道牆重疊
  wallZ('wall-d', -2.1, 3.4, 7.5), // 會議室與會客室之間
  wallZ('wall-e', 2.7, 3.4, 7.5), // 會客室底牆
  wallX('wall-f', -10, -8.3, 0.0), // 左上角的短牆:擋在 Will、Yuhua 座位與走廊之間,小櫃子靠在它的 +z 面
]

// 外牆的窗戶與門(只供渲染;窗戶在 +z 牆的會議室、會客室段,玻璃門在 +x 牆的入口區)
export const WINDOWS = [
  { wall: 'z', from: -8.6, to: -2.7 }, // 會議室
  { wall: 'z', from: -1.5, to: 1.7 }, // 會客室
]
// -x 端牆(Will、Yuhua 後方)的窗戶:z 範圍、窗台與窗頂高度
export const END_WINDOW = { z0: -4.3, z1: -0.6, sill: 1.1, head: 2.4 }
export const ENTRANCE_DOOR = { wall: 'x', z: 5.4, w: 1.6, h: 2.3 }

// 固定家具:{ id, kind, x, z, w, d, h, yaw? },kind 決定外觀。
// 兩組桌子中間、書櫃另一側(靠隔牆)是三張懶人沙發排成扇形(整排寬度與書櫃相當);
// 只有一個胸口高(約 1.25m)的矮書櫃。會客室只有一張圓桌和三張一般椅子。
const LOUNGE = { w: 1.0, d: 1.0, h: 0.8 }
const LOUNGE_CENTER = { x: -2.0, z: 2.95 } // 靠近書櫃(椅背朝書櫃),弧度放寬一些
const fan = (angleDeg) => {
  const a = (angleDeg * Math.PI) / 180
  return {
    x: LOUNGE_CENTER.x + Math.sin(a) * 2.2,
    z: LOUNGE_CENTER.z - Math.cos(a) * 2.2,
    yaw: Math.PI - a, // 面向圓心
  }
}
const chairAround = (id, x, z, yaw) => ({ id, kind: 'chair', x, z, w: 0.45, d: 0.45, h: 0.9, yaw })
export const FIXTURES = [
  { id: 'meeting-table', kind: 'table', x: -5.5, z: 5.6, w: 3.4, d: 1.2, h: 0.75 },
  { id: 'shelf-a', kind: 'shelf', x: -2.0, z: -0.3, w: 4.8, d: 0.45, h: 1.25 }, // 穿透式格子櫃
  { id: 'round-table', kind: 'roundtable', x: 0.3, z: 5.6, w: 1.2, d: 1.2, h: 0.75 },
  chairAround('reception-chair-w', -0.8, 5.6, -Math.PI / 2),
  chairAround('reception-chair-e', 1.4, 5.6, Math.PI / 2),
  chairAround('reception-chair-s', 0.3, 6.7, 0),
  // 白色小櫃子(有門):背靠 -x 端牆、門朝 +x,在 wall-f 與會議室牆之間
  { id: 'cupboard', kind: 'locker', x: -9.75, z: 2.0, w: 1.6, d: 0.5, h: 0.9, yaw: Math.PI / 2, color: 0xf0eee8, top: 0xffffff, face: 0xe6e3dc },
  { id: 'lounge-0', kind: 'loungechair', ...fan(-40), ...LOUNGE, color: 0xc2623a },
  { id: 'lounge-1', kind: 'loungechair', ...fan(0), ...LOUNGE, color: 0xb5532f },
  { id: 'lounge-2', kind: 'loungechair', ...fan(40), ...LOUNGE, color: 0xd07a45 },
]

// 會議室面向開放區的隔牆是落地玻璃(x ≤ 0.4 的部分),門口缺口有玻璃門
export const GLASS_WALL = { z: 3.4, x0: -7.2, x1: -2.1, door: { x0: -8.4, x1: -7.2 } }
// 入口區:水泥色地板;正對玻璃門的牆(wall-e)是深色背牆,掛公司名稱
export const ENTRANCE_ZONE = { x0: 2.7, x1: 5.5, z0: 3.4, z1: 7.5 }

// 桌面上的隔板與螢幕:尺寸與位置(相對桌子中心,局部座標)同時供渲染與碰撞使用
export const PARTITION = { w: 1.6, h: 0.3, d: 0.02 }
export const MONITOR = { w: 0.55, h: 0.32, d: 0.03, y: 0.3, zOffset: 0.1 }

// 局部 z(桌子 side>0 時椅子在 +z、隔板與螢幕在 -z 側)
export const partitionLocalZ = (desk) => (desk.side > 0 ? -desk.d / 2 + 0.01 : desk.d / 2 - 0.01)
export const monitorLocalZ = (desk) => (desk.side > 0 ? -MONITOR.zOffset : MONITOR.zOffset)

export const partitionOf = (desk) => ({
  ...localToWorld(desk, 0, partitionLocalZ(desk)),
  ...footprint(desk, PARTITION.w, PARTITION.d),
  h: PARTITION.h,
})
export const monitorOf = (desk) => ({
  ...localToWorld(desk, 0, monitorLocalZ(desk)),
  ...footprint(desk, MONITOR.w, MONITOR.d),
  h: MONITOR.h,
  y: MONITOR.y,
})

const box = (id, x, z, w, d, minY, maxY) => ({
  id,
  min: [x - w / 2, minY, z - d / 2],
  max: [x + w / 2, maxY, z + d / 2],
})

// 所有實心碰撞方塊;外牆以 ROOM 邊界處理。渲染看得到的東西都要在這裡。
export const COLLIDERS = [
  ...WALLS.map((w) => box(w.id, w.x, w.z, w.w, w.d, 0, ROOM.height)),
  ...FIXTURES.map((f) => {
    const fp = footprint(f, f.w, f.d)
    return box(f.id, f.x, f.z, fp.w, fp.d, 0, f.h)
  }),
  ...DESKS.flatMap((desk) => {
    const fp = footprint(desk, desk.w, desk.d)
    const part = partitionOf(desk)
    const mon = monitorOf(desk)
    return [
      box(desk.id, desk.x, desk.z, fp.w, fp.d, 0, desk.h),
      box(`${desk.id}-partition`, part.x, part.z, part.w, part.d, desk.h, desk.h + part.h),
      box(`${desk.id}-monitor`, mon.x, mon.z, mon.w, mon.d, desk.h + mon.y - mon.h / 2, desk.h + mon.y + mon.h / 2),
    ]
  }),
  // 椅子:固定靜態方塊
  ...CHAIRS.map((c) => box(c.id, c.x, c.z, CHAIR_COLLIDER.w, CHAIR_COLLIDER.d, 0, CHAIR_COLLIDER_HEIGHT)),
]

export const SPAWN_POINTS = [
  { x: -8, z: 2.4 },
  { x: -6, z: 1.9 },
  { x: 4, z: 2.2 },
  { x: 4.6, z: 0.5 },
  { x: 4.6, z: 5.2 },
  { x: 0.3, z: 4.2 },
]
