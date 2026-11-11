// 辦公室格局資料(前端渲染、碰撞與伺服器射線檢測共用,純資料不依賴任何框架)
// 座標:x 向右、y 向上、z 向前,單位公尺。暫時版格局,日後依實際照片與尺寸調整。

export const ROOM = {
  minX: -7,
  maxX: 7,
  minZ: -5,
  maxZ: 5,
  height: 3,
}

export const PLAYER = {
  radius: 0.3,
  // 各姿勢的身體高度與眼睛高度
  bodyHeight: { stand: 1.7, crouch: 1.1, prone: 0.5 },
  eyeHeight: { stand: 1.6, crouch: 1.0, prone: 0.4 },
  walkSpeed: { stand: 3.2, crouch: 1.6, prone: 0.8 },
}

const DESK = { w: 1.6, d: 0.75, h: 0.75 }
const CHAIR = { w: 0.55, d: 0.55, h: 0.9 }

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
      ...DESK,
    })
    CHAIRS.push({
      id: `chair-${index}-${side}`,
      x: center.x,
      z: center.z + side * (DESK.d + 0.55),
      ...CHAIR,
    })
  })
})

const toBox = (item) => ({
  id: item.id,
  min: [item.x - item.w / 2, 0, item.z - item.d / 2],
  max: [item.x + item.w / 2, item.h, item.z + item.d / 2],
})

// 所有實心碰撞方塊(桌、椅);牆以 ROOM 邊界處理
export const COLLIDERS = [...DESKS, ...CHAIRS].map(toBox)

export const SPAWN_POINTS = [
  { x: -6, z: 0 },
  { x: 6, z: 0 },
  { x: 0, z: -4.2 },
  { x: 0, z: 4.2 },
  { x: -6, z: 4 },
  { x: 6, z: -4 },
]
