// 辦公室格局資料(前端渲染、碰撞與伺服器射線檢測共用,純資料不依賴任何框架)
// 座標:x 向右、y 向上、z 向前(角色與相機 yaw=0 時朝 -z),單位公尺。
// 暫時版格局,日後依實際照片與尺寸調整。

export const ROOM = {
  minX: -7,
  maxX: 7,
  minZ: -5,
  maxZ: 5,
  height: 3,
}

export const PLAYER = {
  radius: 0.3,
  // 各姿勢的身體高度與眼睛高度(須與 utils/office/stickman.js 的模型一致)
  bodyHeight: { stand: 1.75, crouch: 1.3, prone: 0.3 },
  eyeHeight: { stand: 1.6, crouch: 1.15, prone: 0.4 },
  walkSpeed: { stand: 3.2, crouch: 1.6, prone: 0.8 },
  // 趴下時身體從腳底沿面向(-z 旋轉 yaw)平躺的長度
  proneLength: 1.75,
}

const DESK = { w: 1.6, d: 0.75, h: 0.75 }
const CHAIR = { w: 0.55, d: 0.55, h: 0.9 }
const CHAIR_COLLIDER_HEIGHT = 1.25 // 含椅背與頭枕

// 桌組:每組兩張桌子背對背,椅子在兩側
const CLUSTER_CENTERS = [
  { x: -4, z: -2 },
  { x: 0, z: -2 },
  { x: 4, z: -2 },
  { x: -4, z: 2 },
  { x: 0, z: 2 },
  { x: 4, z: 2 },
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
      ...CHAIR,
    })
  })
})

// 紙箱(搬家感)
export const CRATES = [
  { id: 'crate-0', x: -6.2, z: -4.2, w: 0.7, d: 0.5, h: 0.45 },
  { id: 'crate-1', x: -5.4, z: -4.4, w: 0.6, d: 0.5, h: 0.4 },
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

// 所有實心碰撞方塊;牆以 ROOM 邊界處理。渲染看得到的東西都要在這裡。
export const COLLIDERS = [
  ...DESKS.flatMap((desk) => {
    const part = partitionOf(desk)
    const mon = monitorOf(desk)
    return [
      box(desk.id, desk.x, desk.z, desk.w, desk.d, 0, desk.h),
      box(`${desk.id}-partition`, part.x, part.z, part.w, part.d, desk.h, desk.h + part.h),
      box(`${desk.id}-monitor`, mon.x, mon.z, mon.w, mon.d, desk.h + mon.y - mon.h / 2, desk.h + mon.y + mon.h / 2),
    ]
  }),
]

// 可動物件(椅子、紙箱):由伺服器物理模擬,不屬於固定碰撞 COLLIDERS。
// 俯視 2D 圓形剛體;椅子 yaw=0 時面向 -z。
export const DYNAMIC_DEFS = [
  ...CHAIRS.map((chair) => ({
    id: chair.id,
    kind: 'chair',
    x: chair.x,
    z: chair.z,
    yaw: chair.side > 0 ? 0 : Math.PI,
    radius: 0.3,
    height: CHAIR_COLLIDER_HEIGHT,
    mass: 1,
    canFall: true,
  })),
  ...CRATES.map((crate) => ({
    id: crate.id,
    kind: 'crate',
    x: crate.x,
    z: crate.z,
    yaw: 0,
    radius: Math.max(crate.w, crate.d) / 2,
    height: crate.h,
    mass: 1.5,
    canFall: false,
  })),
]

export const SPAWN_POINTS = [
  { x: -6, z: 0 },
  { x: 6, z: 0 },
  { x: 0, z: -4.2 },
  { x: 0, z: 4.2 },
  { x: -6, z: 4 },
  { x: 6, z: -4 },
]
