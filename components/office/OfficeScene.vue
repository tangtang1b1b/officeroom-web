<script setup>
import * as THREE from 'three'
import { createRemotePlayers } from '~/utils/office/remotePlayers.js'
import { createPaint } from '~/utils/office/paint.js'
import { useAllStore } from '~/store/all.js'
import { createFurnitureKit, buildDesk, buildFixture, buildOfficeChair } from '~/utils/office/furniture.js'
import { ROOM, PLAYER, DESKS, WALLS, FIXTURES, CHAIRS, CRATES } from '~/shared/layout.js'

const props = defineProps({
  nickname: { type: String, default: '' },
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
const POSE_LABELS = { stand: '站立', crouch: '蹲下', prone: '趴下' }
const STATUS_TEXT = {
  connecting: '連線中…',
  reconnecting: '連線中斷,重新連線中…',
  full: '辦公室已滿(最多 10 人),會自動重試…',
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

const buildRoom = () => {
  const width = ROOM.maxX - ROOM.minX
  const depth = ROOM.maxZ - ROOM.minZ
  const cx = (ROOM.minX + ROOM.maxX) / 2
  const cz = (ROOM.minZ + ROOM.maxZ) / 2
  const t = 0.2 // 牆厚

  addBox(scene, [width, 0.1, depth], [cx, -0.05, cz], COLOR.floor)
  addBox(scene, [90, 0.1, 90], [cx, -0.06, cz], 0x8fa383) // 窗外地面,避免樹與磚牆懸空
  addBox(scene, [width, 0.1, depth], [cx, ROOM.height + 0.05, cz], COLOR.ceiling)

  // 天花板樑
  for (let x = ROOM.minX + 3.5; x < ROOM.maxX; x += 7) {
    addBox(scene, [0.5, 0.4, depth], [x, ROOM.height - 0.2, cz], COLOR.beam)
  }
  // 軌道燈
  for (const z of [-4, 0, 4]) {
    addBox(scene, [width - 1, 0.04, 0.04], [cx, ROOM.height - 0.45, z], 0xffffff, {
      emissive: 0xffffff,
      emissiveIntensity: 0.6,
    })
  }
  // 白色方管:沿 x 方向,貼天花板下方
  for (const z of [-5.5, 5.5]) {
    addBox(scene, [width - 1, 0.14, 0.14], [cx, ROOM.height - 0.1, z], COLOR.tube)
  }

  // 帶狀窗:下牆、上牆、玻璃與窗框
  const sill = 0.9
  const head = 2.65
  const wallWithWindow = (length, center, axis, fixed) => {
    const place = (size, y, color, extra) => {
      const pos = axis === 'x' ? [center, y, fixed] : [fixed, y, center]
      const dims = axis === 'x' ? [length, size, t] : [t, size, length]
      return addBox(scene, dims, pos, color, extra)
    }
    place(sill, sill / 2, COLOR.wall)
    place(ROOM.height - head, (head + ROOM.height) / 2, COLOR.wall)
    place(head - sill, (sill + head) / 2, COLOR.glass, {
      transparent: true,
      opacity: 0.55,
      emissive: 0x6fb7d6,
      emissiveIntensity: 0.35,
    })
    for (let offset = -length / 2; offset <= length / 2 + 0.01; offset += length / 6) {
      const pos = axis === 'x' ? [center + offset, (sill + head) / 2, fixed] : [fixed, (sill + head) / 2, center + offset]
      const dims = axis === 'x' ? [0.08, head - sill, t + 0.02] : [t + 0.02, head - sill, 0.08]
      addBox(scene, dims, pos, COLOR.frame)
    }
  }
  wallWithWindow(width, cx, 'x', ROOM.minZ - t / 2) // 後牆
  wallWithWindow(depth, cz, 'z', ROOM.minX - t / 2) // 左牆

  // 實心牆
  addBox(scene, [width, ROOM.height, t], [cx, ROOM.height / 2, ROOM.maxZ + t / 2], COLOR.wall)
  addBox(scene, [t, ROOM.height, depth], [ROOM.maxX + t / 2, ROOM.height / 2, cz], COLOR.wall)

  // 窗外風景(純視覺,不加碰撞):後牆外 z < minZ、左牆外 x < minX,距離約 4~8 公尺
  const tree = (x, z, trunkH, crown) => {
    addBox(scene, [0.3, trunkH, 0.3], [x, trunkH / 2, z], COLOR.bark)
    addBox(scene, [crown, crown, crown], [x, trunkH + crown / 2 - 0.2, z], COLOR.leaf)
  }
  // 紅磚立面:axis 'z' 表示位於 z=fixed(後牆外),'x' 表示位於 x=fixed(左牆外)
  const brickFacade = (axis, fixed, span) => {
    const isZ = axis === 'z'
    addBox(scene, isZ ? [span, 7, 0.4] : [0.4, 7, span], isZ ? [cx, 3.5, fixed] : [fixed, 3.5, cz], COLOR.brick)
    // 朝向房間的那一面上的深色小方塊當窗
    for (const along of [-12, -6, 0, 6, 12]) {
      for (const y of [2.5, 4.5]) {
        const dims = isZ ? [1.2, 1.5, 0.05] : [0.05, 1.5, 1.2]
        const pos = isZ ? [cx + along, y, fixed + 0.21] : [fixed + 0.21, y, cz + along]
        addBox(scene, dims, pos, COLOR.facadeWindow)
      }
    }
  }
  // 房間 20×15:立面離外牆約 6 公尺、長度比房間各邊多出 8 公尺以上,轉角處互相銜接不穿幫
  brickFacade('z', ROOM.minZ - 6.5, width + 16)
  tree(-9, -10.5, 1.0, 1.6)
  tree(-4, -11.2, 1.3, 2.0)
  tree(1, -10.2, 0.9, 1.4)
  tree(6, -11, 1.2, 1.8)
  tree(9.5, -10.6, 1.0, 1.6)

  brickFacade('x', ROOM.minX - 6.5, depth + 16)
  tree(-11.6, -5, 1.0, 1.7)
  tree(-11.9, -1, 1.3, 2.0)
  tree(-11.6, 2.5, 0.9, 1.4)
  tree(-12, 5.5, 1.1, 1.8)
}

const buildFurniture = () => {
  // 會議室、會客室隔牆
  for (const w of WALLS) addBox(scene, [w.w, ROOM.height, w.d], [w.x, ROOM.height / 2, w.z], COLOR.wall)
  // 桌椅與固定家具的建模在 utils/office/furniture.js;尺寸與碰撞方塊一致,資源由 kit 統一釋放
  const kit = createFurnitureKit({ paintable: true })
  disposables.push(kit)
  for (const f of FIXTURES) buildFixture(scene, f, kit)
  // 椅子與紙箱:固定擺設(不被推動、不會倒),碰撞方塊在 shared/layout.js
  for (const chair of CHAIRS) {
    const group = new THREE.Group()
    group.position.set(chair.x, 0, chair.z)
    group.rotation.y = chair.side > 0 ? 0 : Math.PI // 椅子面向桌子
    buildOfficeChair(group, { materials: kit })
    scene.add(group)
  }
  for (const crate of CRATES) {
    addBox(scene, [crate.w, crate.h, crate.d], [crate.x, crate.h / 2, crate.z], 0xc49a6c)
    addBox(scene, [crate.w + 0.01, 0.01, 0.08], [crate.x, crate.h + 0.002, crate.z], 0xe3c79a)
  }
  for (const desk of DESKS) {
    const group = new THREE.Group()
    group.position.set(desk.x, 0, desk.z)
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
  for (const id of remotes.ids()) {
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

const shoot = () => {
  if (!hoverHit) return
  const { state } = controls
  // 起點用姿勢對應的標準眼高(伺服器以此驗證),方向指向游標點到的位置
  const origin = new THREE.Vector3(state.x, PLAYER.eyeHeight[state.pose], state.z)
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
  camera.position.set(state.x, eyeHeight, state.z)
  camera.rotation.set(state.pitch, state.yaw, 0, 'YXZ')
  poseLabel.value = POSE_LABELS[state.pose]

  sendTimer += dt
  if (sendTimer >= SEND_INTERVAL) {
    sendTimer = 0
    network.sendState([state.x, 0, state.z], state.yaw, state.pitch, state.pose)
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

// 瀏覽器規定 Esc 一定會解除滑鼠鎖定,無法攔截;所以在聊天面板沒開時隱藏游標,並讓任何移動鍵立刻重新鎖定
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
  // 斑點附著的宿主:被打中的玩家
  paint = createPaint(scene, (msg) => {
    if (msg.targetId) return remotes.getGroup(msg.targetId)
    return null
  })

  controls = usePlayerControls(renderer.domElement)
  if (import.meta.dev) window.__office = { controls, remotes }
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
      }
      // 重連或伺服器重啟後 id 可能重新編號,先清掉舊的遠端玩家再重建
      remotes.dispose()
      for (const player of msg.players || []) {
        if (player.id !== store.myId && player.pos) remotes.applyState(player)
      }
      paint.clear()
    },
    playerJoin: (player) => {
      if (player.id === store.myId || !player.pos) return
      remotes.remove(player.id) // 同 id 的舊資料(名字、顏色)不能沿用
      remotes.applyState(player)
    },
    playerLeave: (id) => remotes.remove(id),
    snapshot: (players) => {
      const present = new Set()
      for (const player of players) {
        if (player.id === store.myId || !player.pos) continue
        present.add(player.id)
        remotes.applyState(player)
      }
      // 快照中已不存在的玩家(例如斷線期間離開)移除
      for (const id of remotes.ids()) {
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
        else hitFlash.value = { key: hitFlash.value.key + 1, color: colorCss(msg.color) }
      }
      if (origin) paint.addProjectile(origin, msg.pos, msg.color, onHit)
      else onHit()
    },
    correct: (pos) => {
      controls.state.x = pos[0]
      controls.state.z = pos[2]
    },
  })
  network.connect(props.nickname)

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
    <div ref="host" class="absolute inset-0" :class="!locked && !chatBox?.isOpen ? 'cursor-none' : hovering ? 'cursor-pointer' : ''"></div>

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
      <template v-else>🎯 漆彈對戰 · 線上 {{ store.roster.length }}/10 · {{ poseLabel }}</template>
    </p>

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
      <p class="pointer-events-none rounded-full bg-white/90 px-4 py-2 shadow">
        🎯 準心對準同事並點擊開槍(按住連射) · 點畫面鎖定滑鼠 · WASD 移動 · C 蹲 · Z 趴 · Enter 開啟聊天並使用滑鼠
      </p>
      <button class="rounded-full bg-yellow-400 px-5 py-2 text-sm font-bold text-black shadow-lg ring-2 ring-white hover:bg-yellow-300" @click="chatBox?.isOpen ? chatBox.close() : chatBox?.open()">
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
