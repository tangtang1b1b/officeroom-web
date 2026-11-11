<script setup>
import * as THREE from 'three'
import { createStickman } from '~/utils/office/stickman.js'
import { ROOM, PLAYER, DESKS, CHAIRS } from '~/shared/layout.js'

const props = defineProps({
  nickname: { type: String, default: '' },
})

const host = ref(null)
const locked = ref(false)
const poseLabel = ref('站立')
const POSE_LABELS = { stand: '站立', crouch: '蹲下', prone: '趴下' }

let renderer
let scene
let camera
let controls
let animationFrame
let resizeObserver
let clock
let disposed = false
let eyeHeight = PLAYER.eyeHeight.stand
const stickmen = []
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
    // 黃色隔板放在兩張背對背桌子中間側
    addBox(group, [desk.w, 0.3, 0.02], [0, desk.h + 0.15, desk.z > 0 ? -desk.d / 2 + 0.01 : desk.d / 2 - 0.01], COLOR.yellow)
    // 螢幕
    addBox(group, [0.55, 0.32, 0.03], [0, desk.h + 0.3, desk.z > 0 ? -0.1 : 0.1], 0x111111)
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
  addBox(scene, [0.7, 0.45, 0.5], [-6.2, 0.225, -4.2], COLOR.box)
  addBox(scene, [0.6, 0.4, 0.5], [-5.4, 0.2, -4.4], COLOR.box)
}

const buildDummies = () => {
  // 階段 1 的展示用火柴人,之後換成連線進來的玩家
  const dummies = [
    { x: 0, z: 0, color: 0xe74c3c, pose: 'stand' },
    { x: 1.6, z: 0, color: 0x2ecc71, pose: 'crouch' },
    { x: -1.6, z: 0, color: 0x9b59b6, pose: 'prone' },
  ]
  for (const item of dummies) {
    const man = createStickman(item.color)
    man.group.position.set(item.x, 0, item.z)
    man.group.rotation.y = Math.PI
    man.setPose(item.pose)
    scene.add(man.group)
    stickmen.push(man)
  }
}

const buildViewmodel = () => {
  // 第一人稱手上的漆彈槍
  const gun = new THREE.Group()
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

  for (const man of stickmen) man.update(dt, 0)
  renderer.render(scene, camera)
}

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
  buildDummies()
  buildViewmodel()

  controls = usePlayerControls(renderer.domElement)
  if (import.meta.dev) window.__office = { controls }
  const stop = watch(controls.locked, (value) => (locked.value = value))
  disposables.push({ dispose: stop })
  renderer.domElement.addEventListener('click', controls.requestLock)

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
  controls?.dispose()
  stickmen.forEach((man) => man.dispose())
  disposables.forEach((item) => item.dispose())
  renderer?.dispose()
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

    <div class="pointer-events-none absolute left-4 top-4 rounded bg-black/50 px-3 py-2 text-sm text-white">
      <p>{{ nickname }}・{{ poseLabel }}</p>
      <p class="mt-1 text-xs text-white/70">WASD 移動 ・ 滑鼠視角 ・ C 蹲 ・ Z 趴 ・ Esc 釋放滑鼠</p>
    </div>

    <div v-if="!locked" class="pointer-events-none absolute inset-0 flex items-center justify-center bg-black/30">
      <p class="rounded bg-black/60 px-4 py-2 text-white">點擊畫面開始操控</p>
    </div>
  </div>
</template>
