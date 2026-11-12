<script setup>
import * as THREE from 'three'
import { createRemotePlayers, IDLE_PREFIX } from '~/utils/office/remotePlayers.js'
import { PLAYER_COLORS, MAX_PLAYERS, MAX_HP } from '~/shared/protocol.js'
import { createPaint, PAINT_RED } from '~/utils/office/paint.js'
import { createDog } from '~/utils/office/dog.js'
import { createGhosts } from '~/utils/office/ghosts.js'
import { useAllStore } from '~/store/all.js'
import { createFurnitureKit, buildDesk, buildFixture, buildOfficeChair } from '~/utils/office/furniture.js'
import { ROOM, PLAYER, DESKS, WALLS, FIXTURES, CHAIRS, WINDOWS, ENTRANCE_DOOR, WALL_SLANT, minZAt, GLASS_WALL, ENTRANCE_ZONE, END_WINDOW, DOOR_LEAF, SEATS, seatSpot } from '~/shared/layout.js'

const props = defineProps({
  nickname: { type: String, default: '' },
  seatId: { type: String, default: '' }, // 選名字登入時的座位;訪客為空
})
const emit = defineEmits(['logout'])

const store = useAllStore()
const host = ref(null)
const chatBox = ref(null)
const locked = ref(false)
const hovering = ref(false) // 游標是否正指著別的玩家
const cursor = ref({ x: 0, y: 0 })
const poseLabel = ref('站立')
const hitFlash = ref({ key: 0, color: '#ffffff' })
const hp = ref(MAX_HP)
const downSec = ref(0) // 倒地剩餘秒數(0 = 沒倒地)
const hpColor = computed(() => (hp.value > MAX_HP * 0.5 ? '#3ddc84' : hp.value > MAX_HP * 0.25 ? '#ffc107' : '#ff4d4f'))
// 伺服器通知自己的血量與倒地狀態(welcome 與每次快照)
const applySelf = (player) => {
  if (typeof player.hp !== 'number') return
  hp.value = player.hp
  const down = player.down ?? 0
  downSec.value = Math.ceil(down / 1000)
  const downed = down > 0
  if (downed && !controls.state.downed) controls.state.pose = 'prone'
  controls.state.downed = downed
}
const POSE_LABELS = { stand: '站立', crouch: '蹲下', prone: '趴下', sit: '坐著' }
const STATUS_TEXT = {
  seat_taken: '這個座位已有人上線,請按右上角「登出」後改選別的名字',
  bad_seat: '找不到這個座位,請按右上角「登出」後重新選擇',
  name_reserved: '這個名稱屬於座位上的同事,請「登出」後從名單選自己的名字',
  connecting: '連線中…',
  reconnecting: '連線中斷,重新連線中…',
  full: `辦公室已滿(最多 ${MAX_PLAYERS} 人),會自動重試…`,
  failed: '無法連線到伺服器,請重新整理頁面',
}
const statusText = computed(() => STATUS_TEXT[store.netStatus] || '')
const colorCss = (color) => (typeof color === 'number' ? `#${color.toString(16).padStart(6, '0')}` : color)

const SEND_INTERVAL = 0.05
const FIRE_INTERVAL = 0.18
const MAX_AIM_DIST = 20 // 超過這個距離不能射擊(須小於伺服器 MAX_SHOT_DIST)

let renderer
let scene
let camera
let controls
let network
let remotes
let dog
let ghosts
let paint
let gun
let recoil = 0
let sendTimer = 0
let fireTimer = 0
let firing = false
let hoverHit = null // { point, id }
let staticMeshes = []
const raycaster = new THREE.Raycaster()
const pointer = new THREE.Vector2()
const owners = new Map()
const candidates = []
let pointerInside = false
let animationFrame
let resizeObserver
let clock
let disposed = false
let eyeHeight = PLAYER.eyeHeight.stand
const disposables = []

const COLOR = {
  floor: 0xc9b79c,
  wall: 0xf7f5f0,
  ceiling: 0xeeeae0,
  beam: 0xe6e2d8,
  tube: 0xf2f2ee,
  deskTop: 0xf7f6f2,
  yellow: 0xf2b705,
  chair: 0x9ea4aa,
  frame: 0x1c1c1c,
  glass: 0x9fd1e8,
  box: 0xc49a6c,
  brick: 0x9c4a3c,
  facadeWindow: 0x2b2f36,
  leaf: 0x6e9a5b,
  bark: 0x6b4a2e,
}

const addBox = (parent, size, position, color, extra = {}) => {
  const geometry = new THREE.BoxGeometry(...size)
  const material = new THREE.MeshLambertMaterial({ color, ...extra })
  const mesh = new THREE.Mesh(geometry, material)
  mesh.position.set(...position)
  mesh.userData.paintable = true
  parent.add(mesh)
  disposables.push(geometry, material)
  return mesh
}

// 超耐磨木紋地板:長邊沿 x 的直向木板(程式繪製貼圖;UV 為公尺座標,一張貼圖 3m×3m)
const makeFloorTexture = () => {
  const size = 512
  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  const ctx = canvas.getContext('2d')
  ctx.fillStyle = '#b99468'
  ctx.fillRect(0, 0, size, size)
  const plankW = 32
  const plankL = 256
  const rand = (() => {
    let v = 11
    return () => ((v = (v * 16807) % 2147483647) / 2147483647)
  })()
  for (let row = 0; row < size / plankW; row++) {
    const offset = Math.floor(rand() * 4) * 64 // 每排錯開,貼圖左右可無縫銜接
    for (let col = -1; col <= size / plankL; col++) {
      const shade = 176 + Math.floor(rand() * 36)
      ctx.fillStyle = `rgb(${shade + 28}, ${shade}, ${shade - 36})`
      ctx.fillRect(col * plankL + offset, row * plankW, plankL - 2, plankW - 2) // 板與板之間留 2px 縫
    }
  }
  const texture = new THREE.CanvasTexture(canvas)
  texture.wrapS = THREE.RepeatWrapping
  texture.wrapT = THREE.RepeatWrapping
  texture.colorSpace = THREE.SRGBColorSpace
  texture.repeat.set(1 / 3, 1 / 3)
  disposables.push(texture)
  return texture
}

// 深色背牆上的公司標誌(圖示 + 名稱,背光):畫在 canvas,圖示載入後重畫
const makeLogoTexture = () => {
  const canvas = document.createElement('canvas')
  canvas.width = 1024
  canvas.height = 384
  const ctx = canvas.getContext('2d')
  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.SRGBColorSpace
  const draw = (image) => {
    ctx.clearRect(0, 0, canvas.width, canvas.height)
    ctx.shadowColor = 'rgba(255, 190, 110, 0.9)'
    ctx.shadowBlur = 28
    ctx.fillStyle = '#f4ede4'
    ctx.font = 'bold 150px sans-serif'
    ctx.textBaseline = 'middle'
    const text = '叁角辦公室'
    const textWidth = ctx.measureText(text).width
    const iconSize = image ? 190 : 0
    const startX = (canvas.width - textWidth - iconSize - (image ? 40 : 0)) / 2
    if (image) ctx.drawImage(image, startX, (canvas.height - iconSize) / 2, iconSize, iconSize)
    ctx.fillText(text, startX + iconSize + (image ? 40 : 0), canvas.height / 2 + 6)
    texture.needsUpdate = true
  }
  draw(null)
  const image = new Image()
  image.onload = () => draw(image)
  image.src = '/favicon.png'
  disposables.push(texture)
  return texture
}

const buildRoom = () => {
  const width = ROOM.maxX - ROOM.minX
  const depth = ROOM.maxZ - ROOM.minZ
  const cx = (ROOM.minX + ROOM.maxX) / 2
  const cz = (ROOM.minZ + ROOM.maxZ) / 2
  const t = 0.2 // 牆厚

  // 梯形地板與天花板(-z 側是斜牆)。Shape 的 y 對應世界 -z。
  const shape = new THREE.Shape()
  shape.moveTo(ROOM.minX, -WALL_SLANT.z0)
  shape.lineTo(ROOM.maxX, -WALL_SLANT.z1)
  shape.lineTo(ROOM.maxX, -ROOM.maxZ)
  shape.lineTo(ROOM.minX, -ROOM.maxZ)
  shape.closePath()
  const polygon = (y, material) => {
    const geometry = new THREE.ShapeGeometry(shape)
    const mesh = new THREE.Mesh(geometry, material)
    mesh.rotation.x = -Math.PI / 2
    mesh.position.y = y
    mesh.userData.paintable = true
    scene.add(mesh)
    disposables.push(geometry, material)
  }
  polygon(0, new THREE.MeshLambertMaterial({ color: 0xffffff, map: makeFloorTexture() }))
  polygon(ROOM.height, new THREE.MeshLambertMaterial({ color: COLOR.ceiling, side: THREE.DoubleSide }))
  // 入口區水泥地板(略高於木地板,避免共面)
  const ez = ENTRANCE_ZONE
  addBox(scene, [ez.x1 - ez.x0, 0.02, ez.z1 - ez.z0], [(ez.x0 + ez.x1) / 2, 0.01, (ez.z0 + ez.z1) / 2], 0x9b9a97)
  addBox(scene, [90, 0.1, 90], [cx, -0.06, cz], 0x8fa383) // 窗外地面,避免樹與磚牆懸空

  // 天花板樑(長度隨斜牆縮短)
  for (let x = ROOM.minX + 3.5; x < ROOM.maxX; x += 7) {
    const z0 = minZAt(x)
    addBox(scene, [0.5, 0.4, ROOM.maxZ - z0], [x, ROOM.height - 0.2, (z0 + ROOM.maxZ) / 2], COLOR.beam)
  }
  // 軌道燈
  for (const z of [-3.5, 0, 3.5]) {
    addBox(scene, [width - 1, 0.04, 0.04], [cx, ROOM.height - 0.45, z], 0xffffff, {
      emissive: 0xffffff,
      emissiveIntensity: 0.6,
    })
  }
  // 白色方管:沿 x 方向,貼天花板下方
  for (const z of [-3.5, 3.5]) {
    addBox(scene, [width - 1, 0.14, 0.14], [cx, ROOM.height - 0.1, z], COLOR.tube)
  }

  // 外牆:+z 牆只在會議室、會客室段開窗(WINDOWS);+x 牆在入口區有玻璃門;其餘是實心牆
  const sill = 0.9
  const head = 2.65
  const solid = (dims, pos) => addBox(scene, dims, pos, COLOR.wall)
  // +z 牆(z=maxZ):依 WINDOWS 切成實心段與窗段
  const zWallZ = ROOM.maxZ + t / 2
  const cuts = [...WINDOWS.filter((w) => w.wall === 'z')].sort((p, q) => p.from - q.from)
  let cursor = ROOM.minX
  const solidSegment = (x0, x1) => {
    if (x1 - x0 > 0.01) solid([x1 - x0, ROOM.height, t], [(x0 + x1) / 2, ROOM.height / 2, zWallZ])
  }
  for (const win of cuts) {
    solidSegment(cursor, win.from)
    const len = win.to - win.from
    const mid = (win.from + win.to) / 2
    solid([len, sill, t], [mid, sill / 2, zWallZ])
    solid([len, ROOM.height - head, t], [mid, (head + ROOM.height) / 2, zWallZ])
    addBox(scene, [len, head - sill, t], [mid, (sill + head) / 2, zWallZ], COLOR.glass, {
      transparent: true,
      opacity: 0.55,
      emissive: 0x6fb7d6,
      emissiveIntensity: 0.35,
    })
    const panes = Math.max(2, Math.round(len / 1.4))
    for (let i = 0; i <= panes; i++) {
      addBox(scene, [0.08, head - sill, t + 0.02], [win.from + (len * i) / panes, (sill + head) / 2, zWallZ], COLOR.frame)
    }
    cursor = win.to
  }
  solidSegment(cursor, ROOM.maxX)
  // 其餘三面實心牆
  // -z 側斜牆:沿 (x0,z0)→(x1,z1) 放一塊長牆,向外(-z)偏移半個牆厚
  const slantLen = Math.hypot(WALL_SLANT.x1 - WALL_SLANT.x0, WALL_SLANT.z1 - WALL_SLANT.z0)
  // 斜牆開一條落地窗帶(窗台 0.9m~2.65m),兩端各留 1m 實牆,窗帶內有兩根窗框
  const slant = new THREE.Group()
  slant.position.set(cx, 0, (WALL_SLANT.z0 + WALL_SLANT.z1) / 2 - t / 2)
  slant.rotation.y = Math.atan2(WALL_SLANT.z0 - WALL_SLANT.z1, WALL_SLANT.x1 - WALL_SLANT.x0)
  scene.add(slant)
  const L = slantLen + 0.4
  addBox(slant, [L, sill, t], [0, sill / 2, 0], COLOR.wall)
  addBox(slant, [L, ROOM.height - head, t], [0, (head + ROOM.height) / 2, 0], COLOR.wall)
  for (const side of [-1, 1]) addBox(slant, [1.0, head - sill, t], [side * (L / 2 - 0.5), (sill + head) / 2, 0], COLOR.wall)
  const winLen = L - 2.0
  addBox(slant, [winLen, head - sill, t], [0, (sill + head) / 2, 0], COLOR.glass, {
    transparent: true,
    opacity: 0.55,
    emissive: 0x6fb7d6,
    emissiveIntensity: 0.35,
  })
  for (let i = 0; i <= 3; i++) addBox(slant, [0.08, head - sill, t + 0.02], [-winLen / 2 + (winLen * i) / 3, (sill + head) / 2, 0], COLOR.frame)
  // -x 牆(窄端)
  // -x 牆:Will、Yuhua 後方開一扇窗(中間一根窗框)
  const ew = END_WINDOW
  const ex = ROOM.minX - t / 2
  const wallZ = (z0, z1, y0, y1, color = COLOR.wall, extra = undefined) =>
    addBox(scene, [t, y1 - y0, z1 - z0], [ex, (y0 + y1) / 2, (z0 + z1) / 2], color, extra)
  wallZ(WALL_SLANT.z0, ew.z0, 0, ROOM.height)
  wallZ(ew.z1, ROOM.maxZ, 0, ROOM.height)
  wallZ(ew.z0, ew.z1, 0, ew.sill)
  wallZ(ew.z0, ew.z1, ew.head, ROOM.height)
  wallZ(ew.z0, ew.z1, ew.sill, ew.head, COLOR.glass, { transparent: true, opacity: 0.55, emissive: 0x6fb7d6, emissiveIntensity: 0.35 })
  for (const z of [ew.z0, (ew.z0 + ew.z1) / 2, ew.z1]) addBox(scene, [t + 0.02, ew.head - ew.sill, 0.08], [ex, (ew.sill + ew.head) / 2, z], COLOR.frame)
  // +x 牆:玻璃門(入口)左右兩段實心,門上方有門楣
  const door = ENTRANCE_DOOR
  const xWallX = ROOM.maxX + t / 2
  const d0 = door.z - door.w / 2
  const d1 = door.z + door.w / 2
  solid([t, ROOM.height, d0 - WALL_SLANT.z1], [xWallX, ROOM.height / 2, (WALL_SLANT.z1 + d0) / 2])
  solid([t, ROOM.height, ROOM.maxZ - d1], [xWallX, ROOM.height / 2, (d1 + ROOM.maxZ) / 2])
  solid([t, ROOM.height - door.h, door.w], [xWallX, (door.h + ROOM.height) / 2, door.z])
  addBox(scene, [0.04, door.h, door.w], [xWallX, door.h / 2, door.z], COLOR.glass, { transparent: true, opacity: 0.4, emissive: 0x6fb7d6, emissiveIntensity: 0.3 })
  for (const dz of [-door.w / 2, 0, door.w / 2]) addBox(scene, [0.08, door.h, 0.05], [xWallX, door.h / 2, door.z + dz], COLOR.frame)
  addBox(scene, [0.08, 0.05, door.w], [xWallX, 1.05, door.z], COLOR.frame) // 橫桿
  addBox(scene, [0.1, 0.5, 0.04], [xWallX - 0.06, 1.0, door.z + 0.1], 0x8d9399) // 把手
  // 門外走廊地面
  addBox(scene, [3, 0.1, 6], [ROOM.maxX + 1.6, -0.04, door.z], 0xbfc0c2)

  // 窗外風景(純視覺,不加碰撞):+z 牆外,距離約 4~8 公尺
  const tree = (x, z, trunkH, crown) => {
    addBox(scene, [0.3, trunkH, 0.3], [x, trunkH / 2, z], COLOR.bark)
    addBox(scene, [crown, crown, crown], [x, trunkH + crown / 2 - 0.2, z], COLOR.leaf)
  }
  const facadeZ = ROOM.maxZ + 6.5
  addBox(scene, [width + 16, 7, 0.4], [cx, 3.5, facadeZ], COLOR.brick)
  for (const along of [-12, -6, 0, 6, 12]) {
    for (const y of [2.5, 4.5]) addBox(scene, [1.2, 1.5, 0.05], [cx + along, y, facadeZ - 0.21], COLOR.facadeWindow)
  }
  tree(-8, ROOM.maxZ + 3.5, 1.0, 1.6)
  tree(-3, ROOM.maxZ + 4.2, 1.3, 2.0)
  tree(2, ROOM.maxZ + 3.2, 0.9, 1.4)
  tree(6, ROOM.maxZ + 4.0, 1.2, 1.8)
}

// 隔牆:會議室面向開放區的牆是落地玻璃(含玻璃門),正對入口的 wall-e 是深色背牆掛公司標誌,其餘白牆
const buildPartitions = () => {
  const H = ROOM.height
  const glassExtra = { transparent: true, opacity: 0.35, emissive: 0x6fb7d6, emissiveIntensity: 0.25 }
  const glass = (x0, x1) => {
    const len = x1 - x0
    if (len < 0.05) return
    const mid = (x0 + x1) / 2
    addBox(scene, [len, H, 0.03], [mid, H / 2, GLASS_WALL.z], COLOR.glass, glassExtra) // 無邊框落地玻璃
  }
  for (const w of WALLS) {
    if (w.id === 'wall-e') {
      addBox(scene, [w.w, H, w.d], [w.x, H / 2, w.z], 0x34312e)
      const face = w.x + w.w / 2 + 0.01
      const logo = new THREE.Mesh(
        new THREE.PlaneGeometry(2.8, 1.05),
        new THREE.MeshBasicMaterial({ map: makeLogoTexture(), transparent: true }),
      )
      logo.rotation.y = Math.PI / 2 // 面向 +x(入口側)
      logo.position.set(face, 1.7, w.z)
      scene.add(logo)
      disposables.push(logo.geometry, logo.material)
      // 背光:牆頂暖色光帶
      addBox(scene, [0.03, 0.04, w.d - 0.3], [face, H - 0.2, w.z], 0xffd9a0, { emissive: 0xffc27a, emissiveIntensity: 1 })
    } else if (w.d < w.w && Math.abs(w.z - GLASS_WALL.z) < 0.01) {
      // 會議室這段:門左邊(x < x0)是白牆,門到 x1 之間是無邊框玻璃,x1 之後是白牆
      const a = w.x - w.w / 2
      const b = w.x + w.w / 2
      const wallPart = (p, q) => {
        if (q - p > 0.01) addBox(scene, [q - p, H, w.d], [(p + q) / 2, H / 2, w.z], COLOR.wall)
      }
      wallPart(a, Math.min(b, GLASS_WALL.x0))
      if (b > GLASS_WALL.x0 && a < GLASS_WALL.x1) glass(Math.max(a, GLASS_WALL.x0), Math.min(b, GLASS_WALL.x1))
      wallPart(Math.max(a, GLASS_WALL.x1), b)
    } else {
      addBox(scene, [w.w, H, w.d], [w.x, H / 2, w.z], COLOR.wall)
    }
  }
  // 玻璃門:門框 + 微開的玻璃門扇(門扇靠鉸鏈側,不擋通道)
  const door = GLASS_WALL.door
  addBox(scene, [door.x1 - door.x0, H - 2.3, 0.05], [(door.x0 + door.x1) / 2, (2.3 + H) / 2, GLASS_WALL.z], COLOR.glass, glassExtra)
  const leaf = new THREE.Group()
  leaf.position.set(door.x0 + 0.02, 0, GLASS_WALL.z)
  leaf.rotation.y = -Math.PI / 2 // 門扇開 90°,貼著門框朝 +z(會議室內)
  addBox(leaf, [DOOR_LEAF.d, DOOR_LEAF.h, 0.03], [DOOR_LEAF.d / 2, DOOR_LEAF.h / 2, 0], COLOR.glass, glassExtra)
  addBox(leaf, [0.05, 0.4, 0.07], [1.05, 1.0, 0], 0x8d9399) // 把手
  scene.add(leaf)
}

const buildFurniture = () => {
  // 會議室、會客室隔牆
  buildPartitions()
  // 桌椅與固定家具的建模在 utils/office/furniture.js;尺寸與碰撞方塊一致,資源由 kit 統一釋放
  const kit = createFurnitureKit({ paintable: true })
  disposables.push(kit)
  for (const f of FIXTURES) buildFixture(scene, f, kit)
  // 椅子與紙箱:固定擺設(不被推動、不會倒),碰撞方塊在 shared/layout.js
  for (const chair of CHAIRS) {
    const group = new THREE.Group()
    group.position.set(chair.x, 0, chair.z)
    group.rotation.y = chair.yaw // 椅子面向桌子
    buildOfficeChair(group, { materials: kit })
    scene.add(group)
  }
  for (const desk of DESKS) {
    const group = new THREE.Group()
    group.position.set(desk.x, 0, desk.z)
    group.rotation.y = desk.yaw || 0
    buildDesk(group, desk, kit)
    scene.add(group)
  }
}

const buildViewmodel = () => {
  // 第一人稱手上的漆彈槍
  gun = new THREE.Group()
  const cyl = (r, len, pos, color, rotX = Math.PI / 2) => {
    const geometry = new THREE.CylinderGeometry(r, r, len, 12)
    const material = new THREE.MeshLambertMaterial({ color })
    const mesh = new THREE.Mesh(geometry, material)
    mesh.position.set(...pos)
    mesh.rotation.x = rotX
    gun.add(mesh)
    disposables.push(geometry, material)
  }
  addBox(gun, [0.07, 0.1, 0.24], [0, 0, 0], 0x2b2b2b) // 機身
  addBox(gun, [0.05, 0.13, 0.06], [0, -0.1, 0.07], 0x1c1c1c) // 握把
  addBox(gun, [0.03, 0.04, 0.05], [0, -0.05, -0.02], 0x1c1c1c) // 扳機護圈
  cyl(0.022, 0.42, [0, 0.02, -0.3], 0x3a3a3a) // 槍管
  cyl(0.03, 0.05, [0, 0.02, -0.5], 0xf2b705) // 槍口環
  cyl(0.035, 0.22, [0, -0.07, -0.18], 0x9aa0a6) // 壓縮空氣瓶
  const hopperGeometry = new THREE.SphereGeometry(0.075, 14, 10)
  const hopperMaterial = new THREE.MeshLambertMaterial({ color: 0xe8453c, transparent: true, opacity: 0.9 })
  const hopper = new THREE.Mesh(hopperGeometry, hopperMaterial) // 彈鬥(裝漆彈的圓罐)
  hopper.position.set(0, 0.13, -0.02)
  gun.add(hopper)
  disposables.push(hopperGeometry, hopperMaterial)
  addBox(gun, [0.02, 0.03, 0.08], [0, 0.07, -0.12], 0x1c1c1c) // 瞄具
  gun.scale.setScalar(0.75)
  gun.position.set(0.22, -0.22, -0.55)
  gun.traverse((o) => {
    if (o.isMesh) o.userData.paintable = false // 槍是相機的一部分,不能被貼花
  })
  camera.add(gun)
  scene.add(camera)
}

const resize = () => {
  if (!host.value || !renderer) return
  const { clientWidth, clientHeight } = host.value
  renderer.setSize(clientWidth, clientHeight)
  camera.aspect = clientWidth / clientHeight
  camera.updateProjectionMatrix()
}

// 從游標位置射出射線,找出最前面的玩家(被牆或家具擋住就算沒指到)
const updateHover = () => {
  hoverHit = null
  if (controls.locked.value) {
    // 滑鼠鎖定時準心在畫面中央
    pointer.set(0, 0)
    pointerInside = true
    cursor.value = { x: host.value.clientWidth / 2, y: host.value.clientHeight / 2 }
  }
  if (!pointerInside || !remotes) return
  owners.clear()
  candidates.length = 0
  for (const id of remotes.liveIds()) {
    for (const mesh of remotes.getGroup(id)?.userData.bodyMeshes || []) {
      owners.set(mesh, id)
      candidates.push(mesh)
    }
  }
  if (candidates.length) {
    for (const mesh of staticMeshes) candidates.push(mesh)
    raycaster.setFromCamera(pointer, camera)
    raycaster.far = 60
    const hit = raycaster.intersectObjects(candidates, false)[0]
    if (hit && hit.distance <= MAX_AIM_DIST && owners.has(hit.object)) hoverHit = { point: hit.point.clone(), id: owners.get(hit.object) }
  }
  if (hovering.value !== !!hoverHit) hovering.value = !!hoverHit
}

// 離線同事:沒有人在線的座位(SEATS 有名字者)上,畫一個坐著的人偶。
// 在線名單(roster)的 seatId 對得上就移除人偶,對不上就補上。
const syncIdleSeats = () => {
  if (!remotes) return
  const online = new Set(store.roster.map((r) => r.seatId).filter(Boolean))
  SEATS.forEach((seat, index) => {
    if (!seat.name) return
    const id = IDLE_PREFIX + seat.id
    if (online.has(seat.id)) {
      remotes.remove(id)
      return
    }
    if (remotes.has(id)) return
    const spot = seatSpot(seat.id)
    if (!spot) return
    remotes.applyState({
      id,
      name: seat.name,
      color: PLAYER_COLORS[index % PLAYER_COLORS.length],
      pos: [spot.x, 0, spot.z],
      yaw: spot.yaw,
      pitch: 0,
      pose: 'sit',
    })
  })
}

// 小幽靈要繞著誰飄:自己 → 控制器位置;在線的同事 → 他的人偶;離線的同事 → 座位上坐著的人偶。找不到就先不畫。
const BODY_HEIGHT = { stand: 1.75, crouch: 1.3, prone: 0.4, sit: 1.3 }
const anchorFor = (seatId) => {
  if (seatId === props.seatId) {
    const { x, y, z, pose } = controls.state
    // 自己的幽靈拉開一點、且只飄在眼睛下方,不要擋住準心與視線
    return { x, y, z, height: BODY_HEIGHT[pose], spread: 0.5, ceilY: y + PLAYER.eyeHeight[pose] - 0.45 }
  }
  const online = store.roster.find((r) => r.seatId === seatId)
  const group = remotes.getGroup(online ? online.id : IDLE_PREFIX + seatId)
  if (!group) return null
  return { x: group.position.x, y: group.position.y, z: group.position.z, height: 1.5 }
}

const shoot = () => {
  if (!hoverHit || controls.state.downed) return
  const { state } = controls
  // 起點用姿勢對應的標準眼高加上腳底高度(跳起來 / 站在桌上;伺服器以此驗證),方向指向游標點到的位置
  const origin = new THREE.Vector3(state.x, state.y + PLAYER.eyeHeight[state.pose], state.z)
  const dir = hoverHit.point.clone().sub(origin)
  if (dir.lengthSq() < 1e-6) return
  dir.normalize()
  network.sendShoot([origin.x, origin.y, origin.z], [dir.x, dir.y, dir.z])
  recoil = 1
}

const tick = () => {
  if (disposed) return
  animationFrame = requestAnimationFrame(tick)
  const dt = Math.min(clock.getDelta(), 0.1)
  controls.update(dt)

  const { state } = controls
  eyeHeight += (PLAYER.eyeHeight[state.pose] - eyeHeight) * (1 - Math.exp(-14 * dt))
  camera.position.set(state.x, eyeHeight + state.y, state.z)
  camera.rotation.set(state.pitch, state.yaw, 0, 'YXZ')
  poseLabel.value = POSE_LABELS[state.pose]

  sendTimer += dt
  if (sendTimer >= SEND_INTERVAL) {
    sendTimer = 0
    network.sendState([state.x, state.y, state.z], state.yaw, state.pitch, state.pose)
  }

  updateHover()
  fireTimer -= dt
  if (firing && hoverHit && fireTimer <= 0) {
    fireTimer = FIRE_INTERVAL
    shoot()
  }
  recoil = Math.max(0, recoil - dt * 8)
  gun.position.z = -0.55 + recoil * 0.08
  gun.rotation.x = recoil * 0.12

  remotes.update(dt)
  dog?.update(dt)
  ghosts?.update(dt, anchorFor)
  paint.update(dt)
  renderer.render(scene, camera)
}

const syncPointer = (event) => {
  if (controls.locked.value) return
  const rect = renderer.domElement.getBoundingClientRect()
  cursor.value = { x: event.clientX - rect.left, y: event.clientY - rect.top }
  pointer.set((cursor.value.x / rect.width) * 2 - 1, -(cursor.value.y / rect.height) * 2 + 1)
  pointerInside = true
}
const onMouseMove = (event) => {
  if (event.target === renderer.domElement) syncPointer(event)
  else pointerInside = false // 游標在 HUD 或聊天面板上
}
const onCanvasDown = (event) => {
  if (event.button !== 0) return
  event.preventDefault() // 拖曳時不選取文字
  syncPointer(event)
  updateHover()
  if (hoverHit) firing = true // 指著人:開槍(按住連射)
  else if (!controls.locked.value) controls.requestLock() // 點空白處:鎖定滑鼠進入視角操控
}
const onMouseUp = (event) => {
  if (event.button === 0) firing = false
}
// 離開視窗或切走時,清掉滑鼠狀態,避免卡在連射或停留在舊位置
const resetPointer = () => {
  firing = false
  pointerInside = false
}

// 瀏覽器規定 Esc 一定會解除滑鼠鎖定,無法攔截;游標照常顯示,並讓任何移動鍵立刻重新鎖定
const MOVE_KEYS = new Set(['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'])
const onKeyRelock = (event) => {
  if (controls.locked.value || chatBox.value?.isOpen) return
  if (event.target instanceof HTMLElement && event.target.tagName === 'INPUT') return
  if (MOVE_KEYS.has(event.code)) controls.requestLock()
}
const onChatSend = (text) => network.sendChat(text)
const onChatClose = () => controls.requestLock() // 關閉聊天後回到準心

onMounted(() => {
  scene = new THREE.Scene()
  scene.background = new THREE.Color(0xcfe6f2)
  camera = new THREE.PerspectiveCamera(75, 1, 0.05, 80)

  renderer = new THREE.WebGLRenderer({ antialias: true })
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
  host.value.appendChild(renderer.domElement)

  scene.add(new THREE.HemisphereLight(0xffffff, 0xe6dcc8, 2.6))
  const sun = new THREE.DirectionalLight(0xffffff, 1.2)
  sun.position.set(-6, 8, -4)
  scene.add(sun)

  buildRoom()
  buildFurniture()
  staticMeshes = []
  scene.traverse((o) => {
    if (o.isMesh && o.userData.paintable === true) staticMeshes.push(o)
  })
  buildViewmodel()

  remotes = createRemotePlayers(scene)
  dog = createDog(scene)
  ghosts = createGhosts(scene)
  disposables.push({ dispose: () => ghosts.dispose() })
  disposables.push({ dispose: () => dog.dispose() })
  // 斑點附著的宿主:被打中的玩家
  paint = createPaint(scene, (msg) => {
    if (msg.targetId) return remotes.getGroup(msg.targetId)
    return null
  })

  controls = usePlayerControls(renderer.domElement)
  if (import.meta.dev) window.__office = { controls, remotes, get dog() { return dog }, get ghosts() { return ghosts }, get scene() { return scene } }
  disposables.push({ dispose: watch(controls.locked, (value) => (locked.value = value)) })
  renderer.domElement.addEventListener('mousedown', onCanvasDown)
  window.addEventListener('mousemove', onMouseMove)
  window.addEventListener('keydown', onKeyRelock)
  window.addEventListener('mouseup', onMouseUp)
  window.addEventListener('blur', resetPointer)
  document.addEventListener('mouseleave', resetPointer)

  store.resetOffice()
  network = useNetwork({
    welcome: (msg) => {
      // 採用伺服器指定的出生點與朝向
      if (msg.you?.pos) {
        controls.state.x = msg.you.pos[0]
        controls.state.z = msg.you.pos[2]
        controls.state.yaw = msg.you.yaw ?? controls.state.yaw
        controls.state.pose = msg.you.pose ?? 'stand'
        controls.state.pitch = 0
      }
      // 重連或伺服器重啟後 id 可能重新編號,先清掉舊的遠端玩家再重建
      remotes.dispose()
      dog.apply(msg.dog)
      if (msg.you) applySelf({ hp: msg.you.hp, down: 0 })
      for (const player of msg.players || []) {
        if (player.id !== store.myId && player.pos) remotes.applyState(player)
      }
      syncIdleSeats()
      paint.clear()
    },
    playerJoin: (player) => {
      if (player.id === store.myId || !player.pos) return
      remotes.remove(player.id) // 同 id 的舊資料(名字、顏色)不能沿用
      remotes.applyState(player)
      syncIdleSeats()
    },
    workload: (workload) => ghosts.setCounts(workload?.seats),
    playerLeave: (id) => {
      remotes.remove(id)
      syncIdleSeats()
    },
    snapshot: (players, dogState) => {
      dog.apply(dogState)
      const present = new Set()
      for (const player of players) {
        if (player.id === store.myId) applySelf(player)
        if (player.id === store.myId || !player.pos) continue
        present.add(player.id)
        remotes.applyState(player)
      }
      // 快照中已不存在的玩家(例如斷線期間離開)移除
      for (const id of remotes.liveIds()) {
        if (id.startsWith(IDLE_PREFIX)) continue // 離線人偶由 syncIdleSeats 管理
        if (!present.has(id)) remotes.remove(id)
      }
    },
    paint: (msg) => {
      // 自己被打中時沒有可附著的身體,只顯示畫面閃光,不在世界座標留斑點
      // 漆彈真的飛過去,抵達後才留下斑點(自己的彈從槍口出發)
      let origin = msg.origin
      if (msg.from === store.myId) {
        camera.updateMatrixWorld(true)
        origin = gun.localToWorld(new THREE.Vector3(0, 0.02, -0.4)).toArray()
      }
      const onHit = () => {
        if (disposed) return
        if (msg.targetId !== store.myId) paint.addSplat(msg)
        else hitFlash.value = { key: hitFlash.value.key + 1, color: colorCss(PAINT_RED) }
      }
      if (origin) paint.addProjectile(origin, msg.pos, msg.color, onHit)
      else onHit()
    },
    correct: (pos, pose) => {
      controls.state.x = pos[0]
      controls.state.z = pos[2]
      // 高度一併同步,否則會在地面高度被塞進桌子裡
      controls.state.y = pos[1] || 0
      controls.state.vy = 0
      if (pose) controls.state.pose = pose // 起身被拒要回到坐姿、坐下被拒要回到站姿
    },
    rejected: () => syncIdleSeats(),
  })
  syncIdleSeats() // 還沒連上(或連線中)時,所有有名字的座位先顯示坐著的人偶
  network.connect(props.nickname, props.seatId || null)

  resize()
  resizeObserver = new ResizeObserver(resize)
  resizeObserver.observe(host.value)
  clock = new THREE.Clock()
  tick()
})

onBeforeUnmount(() => {
  disposed = true
  cancelAnimationFrame(animationFrame)
  resizeObserver?.disconnect()
  renderer?.domElement.removeEventListener('mousedown', onCanvasDown)
  window.removeEventListener('mousemove', onMouseMove)
  window.removeEventListener('keydown', onKeyRelock)
  window.removeEventListener('mouseup', onMouseUp)
  window.removeEventListener('blur', resetPointer)
  document.removeEventListener('mouseleave', resetPointer)
  network?.disconnect()
  controls?.dispose()
  remotes?.dispose()
  paint?.dispose()
  disposables.forEach((item) => item.dispose())
  if (import.meta.dev) delete window.__office
  renderer?.dispose()
  renderer?.forceContextLoss()
  renderer?.domElement.remove()
})
</script>

<template>
  <div class="relative h-screen w-screen overflow-hidden bg-black">
    <div ref="host" class="absolute inset-0" :class="hovering ? 'cursor-pointer' : ''"></div>

    <div v-if="locked && !hovering" class="pointer-events-none absolute left-1/2 top-1/2 h-2 w-2 -translate-x-1/2 -translate-y-1/2 rounded-full bg-white shadow-[0_0_0_1px_rgba(0,0,0,0.5)]"></div>
    <!-- 準心或游標指到別的玩家時,在游標位置顯示瞄準圈 -->
    <div
      v-show="hovering"
      class="pointer-events-none absolute h-12 w-12 -translate-x-1/2 -translate-y-1/2 rounded-full border-[3px] border-red-500 shadow-[0_0_0_2px_rgba(255,255,255,0.8)]"
      :style="{ left: cursor.x + 'px', top: cursor.y + 'px' }"
    ></div>

    <div
      :key="hitFlash.key"
      class="hit-flash pointer-events-none absolute inset-0"
      :style="{ '--hit-color': hitFlash.color }"
      v-show="hitFlash.key > 0"
    ></div>

    <!-- 左上:場景名稱 -->
    <div class="pointer-events-none absolute left-4 top-4 rounded-2xl bg-white/90 px-5 py-3 text-lg font-bold text-neutral-800 shadow">
      叁角辦公室
    </div>

    <!-- 上方中央:連線狀態與目前姿勢 -->
    <p
      class="pointer-events-none absolute left-1/2 top-4 -translate-x-1/2 rounded-full px-4 py-2 text-sm shadow"
      :class="statusText ? 'bg-red-600/90 text-white' : 'bg-white/90 text-neutral-700'"
    >
      <template v-if="statusText">{{ statusText }}</template>
      <template v-else>🎯 漆彈對戰 · 線上 {{ store.roster.length }}/{{ MAX_PLAYERS }} · {{ poseLabel }}</template>
    </p>

    <!-- 左上下方:自己的血量;倒地時顯示復活倒數 -->
    <div class="pointer-events-none absolute left-4 top-20 w-40 rounded-xl bg-white/90 px-3 py-2 text-xs text-neutral-700 shadow">
      <div class="mb-1 flex justify-between"><span>❤ 血量</span><b>{{ hp }}</b></div>
      <div class="h-2 overflow-hidden rounded-full bg-neutral-200">
        <div class="h-full rounded-full transition-all" :style="{ width: (hp / MAX_HP) * 100 + '%', background: hpColor }"></div>
      </div>
      <p class="mt-1 text-[11px] text-neutral-500">👻 = 未完成卡片(紅色 = 逾期)</p>
      <p v-if="downSec > 0" class="mt-1 font-bold text-red-600">倒地中,只能爬行 · {{ downSec }} 秒後可起身</p>
    </div>

    <!-- 右上:連線、人數、暱稱、登出 -->
    <div class="absolute right-4 top-4 flex items-center gap-2 rounded-full bg-white/90 py-1.5 pl-4 pr-1.5 text-sm text-neutral-700 shadow">
      <span class="flex items-center gap-1.5">
        <span class="inline-block h-2.5 w-2.5 rounded-full" :class="store.netStatus === 'online' ? 'bg-green-500' : 'bg-amber-400'"></span>
        {{ store.netStatus === 'online' ? '已連線' : '連線中' }}
      </span>
      <button class="rounded-full bg-neutral-100 px-3 py-1 hover:bg-neutral-200" @click="chatBox?.isOpen ? chatBox.close() : chatBox?.open()">
        👥 {{ store.roster.length }}
      </button>
      <span class="px-1">你是 <b>{{ nickname }}</b></span>
      <button class="rounded-full bg-neutral-800 px-4 py-1 font-bold text-white hover:bg-neutral-600" @click="emit('logout')">登出</button>
    </div>

    <OfficeChatBox
      ref="chatBox"
      :messages="store.chat"
      :roster="store.roster"
      :my-id="store.myId"
      @send="onChatSend"
      @close="onChatClose"
        />

    <!-- 下方:操作提示 -->
    <div class="absolute bottom-4 left-1/2 flex -translate-x-1/2 items-center gap-2 text-xs text-neutral-700">
      <p class="pointer-events-none whitespace-nowrap rounded-full bg-white/90 px-4 py-2 shadow">
        🎯 點擊開槍 · WASD 移動 · 空白 跳 · C 蹲 · Z 趴
      </p>
      <button class="whitespace-nowrap rounded-full bg-yellow-400 px-5 py-2 text-sm font-bold text-black shadow-lg ring-2 ring-white hover:bg-yellow-300" @click="chatBox?.isOpen ? chatBox.close() : chatBox?.open()">
        ⏎ Enter 聊天
      </button>
    </div>

  </div>
</template>

<style scoped>
.hit-flash {
  background: radial-gradient(circle, transparent 40%, var(--hit-color) 130%);
  animation: hit-fade 0.6s ease-out forwards;
}
@keyframes hit-fade {
  from {
    opacity: 0.85;
  }
  to {
    opacity: 0;
  }
}
</style>
