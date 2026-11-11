<script setup>
import * as THREE from 'three'
import { createRemotePlayers } from '~/utils/office/remotePlayers.js'
import { createPaint } from '~/utils/office/paint.js'
import { useAllStore } from '~/store/all.js'
import { ROOM, PLAYER, DESKS, CHAIRS, CRATES, PARTITION, MONITOR, partitionOf, monitorOf } from '~/shared/layout.js'

const props = defineProps({
  nickname: { type: String, default: '' },
})

const store = useAllStore()
const host = ref(null)
const chatBox = ref(null)
const locked = ref(false)
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
let animationFrame
let resizeObserver
let clock
let disposed = false
let eyeHeight = PLAYER.eyeHeight.stand
const disposables = []

const COLOR = {
  floor: 0xd8c3a0,
  wall: 0xf4f2ee,
  ceiling: 0xe9e7e2,
  beam: 0xdedbd5,
  deskTop: 0xf7f6f2,
  yellow: 0xf2b705,
  chair: 0x9ea4aa,
  frame: 0x1c1c1c,
  glass: 0x9fd1e8,
  box: 0xc49a6c,
}

const addBox = (parent, size, position, color, extra = {}) => {
  const geometry = new THREE.BoxGeometry(...size)
  const material = new THREE.MeshLambertMaterial({ color, ...extra })
  const mesh = new THREE.Mesh(geometry, material)
  mesh.position.set(...position)
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
  addBox(scene, [width, 0.1, depth], [cx, ROOM.height + 0.05, cz], COLOR.ceiling)

  // 天花板樑
  for (let x = ROOM.minX + 3.5; x < ROOM.maxX; x += 7) {
    addBox(scene, [0.5, 0.4, depth], [x, ROOM.height - 0.2, cz], COLOR.beam)
  }
  // 軌道燈
  for (const z of [-2, 2]) {
    addBox(scene, [width - 1, 0.04, 0.04], [cx, ROOM.height - 0.45, z], 0xffffff, {
      emissive: 0xffffff,
      emissiveIntensity: 0.6,
    })
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
}

const buildFurniture = () => {
  for (const desk of DESKS) {
    const group = new THREE.Group()
    group.position.set(desk.x, 0, desk.z)
    addBox(group, [desk.w, 0.04, desk.d], [0, desk.h - 0.02, 0], COLOR.deskTop)
    for (const sx of [-1, 1]) {
      addBox(group, [0.05, desk.h - 0.04, desk.d - 0.1], [sx * (desk.w / 2 - 0.08), (desk.h - 0.04) / 2, 0], COLOR.yellow)
    }
    // 黃色隔板與螢幕:位置由 layout 計算,與碰撞資料一致
    const part = partitionOf(desk)
    addBox(group, [PARTITION.w, PARTITION.h, PARTITION.d], [0, desk.h + PARTITION.h / 2, part.z - desk.z], COLOR.yellow)
    const mon = monitorOf(desk)
    addBox(group, [MONITOR.w, MONITOR.h, MONITOR.d], [0, desk.h + MONITOR.y, mon.z - desk.z], 0x111111)
    scene.add(group)
  }
  for (const chair of CHAIRS) {
    const group = new THREE.Group()
    group.position.set(chair.x, 0, chair.z)
    const facing = chair.z > 0 ? -1 : 1 // 面向桌子
    addBox(group, [0.5, 0.08, 0.5], [0, 0.48, 0], COLOR.chair)
    addBox(group, [0.5, 0.55, 0.06], [0, 0.78, -facing * 0.22], COLOR.chair)
    addBox(group, [0.3, 0.16, 0.08], [0, 1.15, -facing * 0.22], COLOR.chair)
    addBox(group, [0.06, 0.45, 0.06], [0, 0.22, 0], 0x555555)
    addBox(group, [0.5, 0.04, 0.5], [0, 0.03, 0], 0x555555)
    scene.add(group)
  }
  // 紙箱(搬家感)
  for (const crate of CRATES) addBox(scene, [crate.w, crate.h, crate.d], [crate.x, crate.h / 2, crate.z], COLOR.box)
}

const buildViewmodel = () => {
  // 第一人稱手上的漆彈槍
  gun = new THREE.Group()
  addBox(gun, [0.06, 0.08, 0.38], [0, 0, -0.1], 0x2b2b2b)
  addBox(gun, [0.04, 0.04, 0.14], [0, 0.02, -0.34], 0xf2b705)
  addBox(gun, [0.05, 0.12, 0.05], [0, -0.09, 0.02], 0x2b2b2b)
  gun.scale.setScalar(0.6)
  gun.position.set(0.2, -0.2, -0.5)
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

const shoot = () => {
  const { state } = controls
  const dir = new THREE.Vector3()
  camera.getWorldDirection(dir)
  // 起點用姿勢對應的標準眼高(伺服器以此驗證),不用平滑中的相機高度
  network.sendShoot([state.x, PLAYER.eyeHeight[state.pose], state.z], [dir.x, dir.y, dir.z])
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

  fireTimer -= dt
  if (firing && controls.locked.value && fireTimer <= 0) {
    fireTimer = FIRE_INTERVAL
    shoot()
  }
  recoil = Math.max(0, recoil - dt * 8)
  gun.position.z = -0.5 + recoil * 0.08
  gun.rotation.x = recoil * 0.12

  remotes.update(dt)
  paint.update(dt)
  renderer.render(scene, camera)
}

const onMouseDown = (event) => {
  if (event.button === 0 && controls.locked.value) firing = true
}
const onMouseUp = (event) => {
  if (event.button === 0) firing = false
}

const onChatSend = (text) => network.sendChat(text)
const onChatClose = () => controls.requestLock()

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
  buildViewmodel()

  remotes = createRemotePlayers(scene)
  paint = createPaint(scene, (id) => remotes.getGroup(id))

  controls = usePlayerControls(renderer.domElement)
  if (import.meta.dev) window.__office = { controls, remotes }
  const stop = watch(controls.locked, (value) => (locked.value = value))
  disposables.push({ dispose: stop })
  renderer.domElement.addEventListener('click', controls.requestLock)
  window.addEventListener('mousedown', onMouseDown)
  window.addEventListener('mouseup', onMouseUp)

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
      if (msg.targetId !== store.myId) paint.addSplat(msg)
      if (msg.origin) paint.addTracer(msg.origin, msg.pos, msg.color)
      if (msg.targetId && msg.targetId === store.myId) {
        hitFlash.value = { key: hitFlash.value.key + 1, color: colorCss(msg.color) }
      }
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
  window.removeEventListener('mousedown', onMouseDown)
  window.removeEventListener('mouseup', onMouseUp)
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
    <div ref="host" class="absolute inset-0"></div>

    <div v-if="locked" class="pointer-events-none absolute left-1/2 top-1/2 h-3 w-3 -translate-x-1/2 -translate-y-1/2">
      <div class="absolute left-1/2 top-0 h-full w-px -translate-x-1/2 bg-white/90"></div>
      <div class="absolute left-0 top-1/2 h-px w-full -translate-y-1/2 bg-white/90"></div>
    </div>

    <div
      :key="hitFlash.key"
      class="hit-flash pointer-events-none absolute inset-0"
      :style="{ '--hit-color': hitFlash.color }"
      v-show="hitFlash.key > 0"
    ></div>

    <div class="pointer-events-none absolute left-4 top-4 rounded bg-black/50 px-3 py-2 text-sm text-white">
      <p>{{ nickname }}・{{ poseLabel }}</p>
      <p class="mt-1 text-xs text-white/70">
        WASD 移動 ・ 滑鼠視角 ・ 左鍵射擊 ・ C 蹲 ・ Z 趴 ・ Enter 聊天 ・ Esc 釋放滑鼠
      </p>
    </div>

    <div class="pointer-events-none absolute right-4 top-4 min-w-32 rounded bg-black/50 px-3 py-2 text-sm text-white">
      <p class="mb-1 text-xs text-white/70">線上 {{ store.roster.length }} / 10</p>
      <p v-for="player in store.roster" :key="player.id" class="flex items-center gap-2">
        <span class="inline-block h-2.5 w-2.5 rounded-full" :style="{ background: colorCss(player.color) }"></span>
        {{ player.name }}<span v-if="player.id === store.myId" class="text-white/50">(你)</span>
      </p>
    </div>

    <p
      v-if="statusText"
      class="pointer-events-none absolute left-1/2 top-4 -translate-x-1/2 rounded bg-red-600/80 px-3 py-1 text-sm text-white"
    >
      {{ statusText }}
    </p>

    <OfficeChatBox ref="chatBox" :messages="store.chat" @send="onChatSend" @close="onChatClose" />

    <div
      v-if="!locked && !chatBox?.isOpen"
      class="pointer-events-none absolute inset-0 flex items-center justify-center bg-black/30"
    >
      <p class="rounded bg-black/60 px-4 py-2 text-white">點擊畫面開始操控</p>
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
