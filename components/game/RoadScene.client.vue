<script setup>
import * as THREE from 'three'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'

const props = defineProps({
  session: { type: Object, required: true },
})

const emit = defineEmits(['frame'])
const host = ref(null)
let renderer
let scene
let camera
let animationFrame
let resizeObserver
let leadCar
let oncomingCar
let cockpit
let motorcycle
let motorcycleLeanPivot
let motorcycleBody
let motorcycleLoaded = false
let steeringLean = 0
let steeringYaw = 0
let roadTexture
let roadNormalTexture
let fallbackCanvas
let fallbackContext
let disposed = false

const roadX = (distance) => {
  const bend = Math.min(1, Math.max(0, (distance - 24) / 145))
  const exit = Math.min(1, Math.max(0, (distance - 300) / 165))
  return 18 * bend * bend * (3 - 2 * bend) - 13 * exit * exit * (3 - 2 * exit)
}

const roadCurvature = (distance) => {
  const sample = 4
  const before = roadX(distance - sample)
  const center = roadX(distance)
  const after = roadX(distance + sample)
  const slope = (after - before) / (2 * sample)
  const bend = (after - 2 * center + before) / (sample * sample)
  return bend / Math.pow(1 + slope * slope, 1.5)
}

const createStrip = (start, end, width, offset, y, color, materialOverrides = {}) => {
  const segments = Math.ceil((end - start) / 3)
  const positions = []
  const uvs = []
  const indices = []
  for (let index = 0; index <= segments; index++) {
    const distance = start + ((end - start) * index) / segments
    const center = roadX(distance) + offset
    const z = -distance
    positions.push(center - width / 2, y, z, center + width / 2, y, z)
    const textureV = distance * 0.25
    uvs.push(0, textureV, width * 0.25, textureV)
    if (index < segments) {
      const vertex = index * 2
      indices.push(vertex, vertex + 2, vertex + 1, vertex + 1, vertex + 2, vertex + 3)
    }
  }
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2))
  geometry.setIndex(indices)
  geometry.computeVertexNormals()
  const material = new THREE.MeshStandardMaterial({ color, roughness: 0.94, side: THREE.DoubleSide, ...materialOverrides })
  const mesh = new THREE.Mesh(geometry, material)
  mesh.receiveShadow = true
  scene.add(mesh)
  return mesh
}

const createCar = (color) => {
  const group = new THREE.Group()
  const bodyMaterial = new THREE.MeshStandardMaterial({ color, roughness: 0.56, metalness: 0.12 })
  const glassMaterial = new THREE.MeshStandardMaterial({ color: 0x273d4b, roughness: 0.2, metalness: 0.18 })
  const tireMaterial = new THREE.MeshStandardMaterial({ color: 0x171a1b, roughness: 0.88 })
  const lampMaterial = new THREE.MeshStandardMaterial({ color: 0xfff0b2, emissive: 0x8f6d28, roughness: 0.35 })

  const body = new THREE.Mesh(new THREE.BoxGeometry(1.86, 0.72, 4.15), bodyMaterial)
  body.position.y = 0.65
  group.add(body)
  const hood = new THREE.Mesh(new THREE.BoxGeometry(1.78, 0.3, 1.08), bodyMaterial)
  hood.position.set(0, 0.94, -1.4)
  group.add(hood)
  const cabin = new THREE.Mesh(new THREE.BoxGeometry(1.48, 0.76, 1.84), glassMaterial)
  cabin.position.set(0, 1.23, 0.24)
  group.add(cabin)
  const roof = new THREE.Mesh(new THREE.BoxGeometry(1.28, 0.09, 1.12), bodyMaterial)
  roof.position.set(0, 1.65, 0.18)
  group.add(roof)
  const wheelGeometry = new THREE.CylinderGeometry(0.39, 0.39, 0.22, 12)
  for (const x of [-0.94, 0.94]) {
    for (const z of [-1.34, 1.36]) {
      const wheel = new THREE.Mesh(wheelGeometry, tireMaterial)
      wheel.rotation.z = Math.PI / 2
      wheel.position.set(x, 0.4, z)
      group.add(wheel)
    }
  }
  for (const x of [-0.58, 0.58]) {
    const lamp = new THREE.Mesh(new THREE.BoxGeometry(0.36, 0.13, 0.08), lampMaterial)
    lamp.position.set(x, 0.82, -2.1)
    group.add(lamp)
  }
  return group
}

const createBoxTruck = () => {
  const group = new THREE.Group()
  const cargo = new THREE.Mesh(new THREE.BoxGeometry(2.45, 2.55, 4.1), new THREE.MeshStandardMaterial({ color: 0x7e9caf, roughness: 0.78 }))
  cargo.position.set(0, 1.85, 0.65)
  group.add(cargo)
  const cab = new THREE.Mesh(new THREE.BoxGeometry(2.3, 1.75, 1.6), new THREE.MeshStandardMaterial({ color: 0x7894a5, roughness: 0.55 }))
  cab.position.set(0, 1.28, -2.15)
  group.add(cab)
  const glass = new THREE.Mesh(new THREE.BoxGeometry(1.8, 0.72, 0.08), new THREE.MeshStandardMaterial({ color: 0x293f4b, roughness: 0.22 }))
  glass.position.set(0, 1.58, -2.97)
  group.add(glass)
  const wheels = new THREE.CylinderGeometry(0.48, 0.48, 0.26, 10)
  const rubber = new THREE.MeshStandardMaterial({ color: 0x171a1b, roughness: 0.9 })
  for (const x of [-1.22, 1.22]) for (const z of [-2.1, 1.9]) {
    const wheel = new THREE.Mesh(wheels, rubber)
    wheel.rotation.z = Math.PI / 2
    wheel.position.set(x, 0.48, z)
    group.add(wheel)
  }
  return group
}

const addRoadside = () => {
  const postGeometry = new THREE.BoxGeometry(0.12, 0.75, 0.14)
  const postMaterial = new THREE.MeshStandardMaterial({ color: 0xc8d0cf, metalness: 0.58, roughness: 0.48 })
  const posts = new THREE.InstancedMesh(postGeometry, postMaterial, 300)
  const matrix = new THREE.Matrix4()
  let index = 0
  for (let distance = 4; distance < 1180; distance += 8) {
    for (const side of [-1, 1]) {
      matrix.makeTranslation(roadX(distance) + side * 5.55, 0.48, -distance)
      posts.setMatrixAt(index++, matrix)
    }
  }
  posts.count = index
  scene.add(posts)
  createStrip(-10, 1180, 0.14, -5.55, 0.82, 0xb7c2c2, { metalness: 0.52, roughness: 0.5 })
  createStrip(-10, 1180, 0.12, -5.55, 1.12, 0xd0d8d6, { metalness: 0.52, roughness: 0.5 })
  createStrip(-10, 1180, 0.14, 5.55, 0.82, 0xb7c2c2, { metalness: 0.52, roughness: 0.5 })
  createStrip(-10, 1180, 0.12, 5.55, 1.12, 0xd0d8d6, { metalness: 0.52, roughness: 0.5 })
}

const addTrees = () => {
  const count = 260
  const trunkGeometry = new THREE.CylinderGeometry(0.24, 0.38, 3.3, 6)
  const crownGeometry = new THREE.ConeGeometry(2.4, 7.5, 6)
  const trunkMesh = new THREE.InstancedMesh(trunkGeometry, new THREE.MeshStandardMaterial({ color: 0x594938, roughness: 1 }), count)
  const crownMesh = new THREE.InstancedMesh(crownGeometry, new THREE.MeshStandardMaterial({ color: 0x315848, roughness: 0.96 }), count)
  const random = createTreeRandom()
  const matrix = new THREE.Matrix4()
  const position = new THREE.Vector3()
  const rotation = new THREE.Quaternion()
  const scale = new THREE.Vector3()
  for (let index = 0; index < count; index++) {
    const distance = 10 + random() * 1140
    const side = random() > 0.5 ? 1 : -1
    const x = roadX(distance) + side * (10 + random() * 32)
    const height = 0.7 + random() * 0.8
    position.set(x, 1.55 * height, -distance)
    scale.set(height, height, height)
    matrix.compose(position, rotation, scale)
    trunkMesh.setMatrixAt(index, matrix)
    position.y = 5.5 * height
    scale.set(height, height, height)
    matrix.compose(position, rotation, scale)
    crownMesh.setMatrixAt(index, matrix)
  }
  scene.add(trunkMesh, crownMesh)

  const rockGeometry = new THREE.DodecahedronGeometry(1, 0)
  const rocks = new THREE.InstancedMesh(rockGeometry, new THREE.MeshStandardMaterial({ color: 0x697268, roughness: 1, flatShading: true }), 72)
  for (let index = 0; index < 72; index++) {
    const distance = 74 + random() * 205
    const size = 2 + random() * 6
    position.set(roadX(distance) + 10 + random() * 8, size * 0.55, -distance)
    scale.set(size * 1.5, size, size)
    matrix.compose(position, rotation, scale)
    rocks.setMatrixAt(index, matrix)
  }
  scene.add(rocks)
}

const createTreeRandom = () => {
  let value = 54021
  return () => {
    value = (value * 1664525 + 1013904223) >>> 0
    return value / 4294967296
  }
}

const addCockpit = () => {
  cockpit = new THREE.Group()
  const dark = new THREE.MeshStandardMaterial({ color: 0x171a1b, metalness: 0.5, roughness: 0.42 })
  const display = new THREE.MeshStandardMaterial({ color: 0x1c2830, emissive: 0x14232a, roughness: 0.35 })
  const rubber = new THREE.MeshStandardMaterial({ color: 0x101112, roughness: 0.95 })

  const bar = new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.055, 1.65, 10), dark)
  bar.rotation.z = Math.PI / 2
  bar.position.set(0, -0.55, -1.15)
  cockpit.add(bar)
  for (const side of [-1, 1]) {
    const grip = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.09, 0.48, 10), rubber)
    grip.rotation.z = Math.PI / 2
    grip.position.set(side * 0.82, -0.55, -1.15)
    cockpit.add(grip)
  }
  const dash = new THREE.Mesh(new THREE.BoxGeometry(0.74, 0.42, 0.25), dark)
  dash.position.set(0, -0.42, -0.93)
  dash.rotation.x = -0.22
  cockpit.add(dash)
  const screen = new THREE.Mesh(new THREE.BoxGeometry(0.46, 0.23, 0.03), display)
  screen.position.set(0, -0.38, -0.79)
  cockpit.add(screen)
  camera.add(cockpit)
}

const loadMotorcycle = () => {
  motorcycle = new THREE.Group()
  motorcycleLeanPivot = new THREE.Group()
  motorcycleBody = new THREE.Group()
  motorcycleBody.position.y = -1.05
  motorcycleLeanPivot.add(motorcycleBody)
  motorcycle.add(motorcycleLeanPivot, camera)
  scene.add(motorcycle)
  new GLTFLoader().load('/models/motorcycle/scene.gltf', (gltf) => {
    const model = gltf.scene
    model.updateMatrixWorld(true)
    const bounds = new THREE.Box3().setFromObject(model)
    const size = bounds.getSize(new THREE.Vector3())
    const center = bounds.getCenter(new THREE.Vector3())
    const modelScale = 2.15 / Math.max(size.x, size.z)
    model.scale.setScalar(modelScale)
    model.position.set(-center.x * modelScale, -bounds.min.y * modelScale, -center.z * modelScale)
    model.traverse((object) => {
      if (object.isMesh) object.castShadow = true
    })
    motorcycleBody.add(model)
    motorcycleBody.rotation.y = (size.x > size.z ? Math.PI / 2 : 0) + Math.PI
    motorcycleLoaded = true
  }, undefined, (error) => console.error('Motorcycle model failed to load.', error))
}

const loadTruckModel = (vehicle, url, length, heading = 0) => {
  new GLTFLoader().load(url, (gltf) => {
    const model = gltf.scene
    model.updateMatrixWorld(true)
    let bounds = new THREE.Box3().setFromObject(model)
    const size = bounds.getSize(new THREE.Vector3())
    model.rotation.y = (size.x > size.z ? Math.PI / 2 : 0) + heading
    model.updateMatrixWorld(true)
    bounds = new THREE.Box3().setFromObject(model)
    const center = bounds.getCenter(new THREE.Vector3())
    const modelScale = length / Math.max(size.x, size.z)
    model.scale.setScalar(modelScale)
    model.position.set(-center.x * modelScale, -bounds.min.y * modelScale, -center.z * modelScale)
    model.traverse((object) => {
      if (object.isMesh) object.castShadow = true
    })
    vehicle.clear()
    vehicle.add(model)
  }, undefined, (error) => console.error(`Truck model failed to load: ${url}`, error))
}

const initScene = () => {
  scene = new THREE.Scene()
  scene.background = new THREE.Color(0xaebbc0)
  scene.fog = new THREE.Fog(0xaebbc0, 88, 390)
  camera = new THREE.PerspectiveCamera(76, 1, 0.1, 900)
  camera.position.set(0, 0.3, 0.28)

  renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' })
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5))
  renderer.outputColorSpace = THREE.SRGBColorSpace
  renderer.toneMapping = THREE.ACESFilmicToneMapping
  renderer.toneMappingExposure = 1.06
  renderer.shadowMap.enabled = true
  renderer.shadowMap.type = THREE.PCFSoftShadowMap
  host.value.appendChild(renderer.domElement)

  scene.add(new THREE.HemisphereLight(0xdce5e9, 0x4e584e, 1.8))
  const sunlight = new THREE.DirectionalLight(0xd8e0e2, 1.25)
  sunlight.position.set(-42, 75, 24)
  sunlight.castShadow = false
  scene.add(sunlight)

  createStrip(-20, 1180, 100, 0, -0.16, 0x53684d)
  const roadSurface = createStrip(-20, 1180, 10, 0, -0.04, 0xffffff)
  roadTexture = new THREE.TextureLoader().load('/textures/asphalt-01-1k.jpg', (texture) => {
    texture.colorSpace = THREE.SRGBColorSpace
    texture.wrapS = THREE.RepeatWrapping
    texture.wrapT = THREE.RepeatWrapping
    roadSurface.material.map = texture
    roadSurface.material.needsUpdate = true
  })
  roadNormalTexture = new THREE.TextureLoader().load('/textures/road/asphalt_01_nor_gl_1k.jpg', (texture) => {
    texture.wrapS = THREE.RepeatWrapping
    texture.wrapT = THREE.RepeatWrapping
    roadSurface.material.normalMap = texture
    roadSurface.material.normalScale.set(0.65, 0.65)
    roadSurface.material.needsUpdate = true
  })
  createStrip(-20, 1180, 0.11, -0.14, 0.005, 0xf0c544)
  createStrip(-20, 1180, 0.11, 0.14, 0.005, 0xf0c544)
  createStrip(-20, 1180, 0.09, -4.82, 0.006, 0xd8dfd9)
  createStrip(-20, 1180, 0.09, 4.82, 0.006, 0xd8dfd9)
  addRoadside()
  addTrees()

  leadCar = createCar(0x82949a)
  oncomingCar = createBoxTruck()
  oncomingCar.rotation.y = Math.PI
  loadTruckModel(leadCar, '/models/box-truck/model.glb', 4.8, Math.PI)
  loadTruckModel(oncomingCar, '/models/oncoming-truck/scene.gltf', 4.8, Math.PI)
  scene.add(leadCar, oncomingCar)
  addCockpit()
  loadMotorcycle()
  resizeObserver = new ResizeObserver(resize)
  resizeObserver.observe(host.value)
  resize()
  render()
}

const resize = () => {
  if (!host.value) return
  const { width, height } = host.value.getBoundingClientRect()
  if (width < 1 || height < 1) return
  if (renderer && camera) {
    renderer.setSize(width, height, false)
    camera.aspect = width / height
    camera.updateProjectionMatrix()
  }
  if (fallbackCanvas) {
    const ratio = Math.min(window.devicePixelRatio || 1, 1.5)
    fallbackCanvas.width = Math.round(width * ratio)
    fallbackCanvas.height = Math.round(height * ratio)
    fallbackCanvas.style.width = `${width}px`
    fallbackCanvas.style.height = `${height}px`
    fallbackContext = fallbackCanvas.getContext('2d')
    fallbackContext?.setTransform(ratio, 0, 0, ratio, 0, 0)
  }
}

let previousTime = 0
const render = (time = 0) => {
  if (disposed) return
  animationFrame = requestAnimationFrame(render)
  const delta = previousTime ? Math.min((time - previousTime) / 1000, 0.1) : 0
  previousTime = time
  emit('frame', delta)

  if (fallbackContext) {
    drawFallback()
    return
  }

  const distance = props.session.distance
  let frame = props.session
  // Replay renders a sampled copy; live session metrics remain unchanged.
  if (props.session.replay.viewing && props.session.trajectory.length) {
    const points = props.session.trajectory
    let index = points.findIndex((point) => point.time >= props.session.replay.time)
    if (index < 1) index = Math.min(1, points.length - 1)
    const from = points[Math.max(0, index - 1)]
    const to = points[index]
    const mix = to.time === from.time ? 0 : THREE.MathUtils.clamp((props.session.replay.time - from.time) / (to.time - from.time), 0, 1)
    frame = { ...from }
    for (const key of ['distance', 'lateral', 'speed', 'leadS', 'oncomingDistance']) frame[key] = THREE.MathUtils.lerp(from[key], to[key], mix)
    frame.oncomingSeen = mix < 0.5 ? from.oncomingSeen : to.oncomingSeen
  }
  const replaying = props.session.replay.viewing
  cockpit.visible = !replaying && !motorcycleLoaded
  if (motorcycle) motorcycle.visible = motorcycleLoaded
  const steer = props.session.phase === 'playing' ? props.session.currentSteer : 0
  steeringLean = steer
    ? THREE.MathUtils.clamp(steeringLean - steer * 0.55 * delta, -0.2, 0.2)
    : THREE.MathUtils.damp(steeringLean, 0, 2.8, delta)
  steeringYaw = THREE.MathUtils.damp(steeringYaw, steer * -0.08, 5, delta)
  // Match the view to the collision lane before adding restrained rider motion.
  if (props.session.phase === 'crashing') {
    const progress = Math.min(1, props.session.crashElapsed / 2.2)
    motorcycle.position.set(roadX(frame.distance) + frame.lateral, 1.05, -frame.distance)
    camera.position.set(props.session.crashLateral * progress * 1.4, 0.47 - progress * 0.72, 0.28 + progress * 3)
    camera.lookAt(roadX(frame.distance + 24) + frame.lateral, 1.35 - progress * 0.55, -(frame.distance + 24))
    camera.rotateZ(Math.sin(props.session.crashElapsed * 18) * 0.075 * (1 - progress * 0.6))
  } else {
    const curveLean = props.session.phase === 'playing'
      ? -Math.atan((props.session.speed ** 2 * roadCurvature(frame.distance)) / 9.81)
      : 0
    const lean = props.session.phase === 'playing' ? THREE.MathUtils.clamp(curveLean + steeringLean, -0.3, 0.3) : 0
    motorcycle.position.set(roadX(frame.distance) + frame.lateral, 1.05, -frame.distance)
    const pitch = props.session.phase === 'playing' ? Math.min(0.07, props.session.braking ? 0.045 : 0) : 0
    camera.position.set(replaying ? -10 : 0, replaying ? 7.45 : 0.38 + (props.session.phase === 'playing' ? Math.sin(frame.distance * 1.7) * 0.012 : 0), replaying ? 17 : 0.28)
    camera.lookAt(roadX(frame.distance + (replaying ? 15 : 24)) + frame.lateral, replaying ? 0.9 : 1.55 - pitch, -(frame.distance + (replaying ? 15 : 24)))
    if (replaying) {
      const replayLean = THREE.MathUtils.clamp(-Math.atan((frame.speed ** 2 * roadCurvature(frame.distance)) / 9.81), -0.3, 0.3)
      motorcycleLeanPivot.rotation.z = replayLean
    } else {
      motorcycleLeanPivot.rotation.z = lean
      camera.rotateY(steeringYaw)
    }
  }
  cockpit.position.x = props.session.phase === 'playing' ? -props.session.currentSteer * 0.035 : 0
  cockpit.position.y = props.session.phase === 'playing' && props.session.braking ? -0.035 : 0
  cockpit.rotation.z = props.session.phase === 'playing' ? props.session.currentSteer * 0.025 : 0
  leadCar.position.set(roadX(frame.leadS) + 2.35, 0, -frame.leadS)
  leadCar.visible = frame.leadS - frame.distance > -8
  if (motorcycle) {
    const bikeDistance = frame.distance
    motorcycle.scale.setScalar(1)
    motorcycle.position.set(roadX(bikeDistance) + frame.lateral, 1.05, -bikeDistance)
  }

  const oncomingDistance = frame.oncomingDistance
  oncomingCar.visible = (replaying ? frame.oncomingSeen : props.session.oncomingSeen) && oncomingDistance > -8 && oncomingDistance < 220
  if (oncomingCar.visible) {
    const carS = frame.distance + Math.max(-15, oncomingDistance)
    oncomingCar.position.set(roadX(carS) - 2.35, 0, -carS)
  }
  renderer?.render(scene, camera)
}

const drawFallback = () => {
  if (!fallbackContext || !fallbackCanvas) return
  const ctx = fallbackContext
  const width = fallbackCanvas.width / Math.min(window.devicePixelRatio || 1, 1.5)
  const height = fallbackCanvas.height / Math.min(window.devicePixelRatio || 1, 1.5)
  const sky = ctx.createLinearGradient(0, 0, 0, height * 0.66)
  sky.addColorStop(0, '#9db8b0')
  sky.addColorStop(1, '#d2d6bf')
  ctx.fillStyle = sky
  ctx.fillRect(0, 0, width, height)
  ctx.fillStyle = '#5f765d'
  ctx.beginPath()
  ctx.moveTo(0, height * 0.46)
  ctx.lineTo(width * 0.17, height * 0.34)
  ctx.lineTo(width * 0.33, height * 0.45)
  ctx.lineTo(width * 0.58, height * 0.31)
  ctx.lineTo(width * 0.79, height * 0.45)
  ctx.lineTo(width, height * 0.33)
  ctx.lineTo(width, height * 0.7)
  ctx.lineTo(0, height * 0.7)
  ctx.closePath()
  ctx.fill()
  ctx.fillStyle = '#496044'
  for (let index = 0; index < 48; index++) {
    const x = ((index * 83 + 29) % Math.max(1, Math.round(width)))
    const y = height * (0.37 + ((index * 31) % 14) / 100)
    const size = 9 + ((index * 7) % 18)
    ctx.beginPath()
    ctx.moveTo(x, y - size * 1.5)
    ctx.lineTo(x - size, y + size)
    ctx.lineTo(x + size, y + size)
    ctx.closePath()
    ctx.fill()
  }

  ctx.fillStyle = '#6b7859'
  ctx.fillRect(0, height * 0.52, width, height * 0.48)
  ctx.fillStyle = '#464b49'
  ctx.beginPath()
  ctx.moveTo(width * 0.47, height * 0.43)
  ctx.lineTo(width * 0.53, height * 0.43)
  ctx.lineTo(width * 0.91, height)
  ctx.lineTo(width * 0.09, height)
  ctx.closePath()
  ctx.fill()
  ctx.strokeStyle = '#e6c44d'
  ctx.lineWidth = Math.max(2, width * 0.003)
  for (const offset of [-0.004, 0.004]) {
    ctx.beginPath()
    ctx.moveTo(width * (0.5 + offset), height * 0.44)
    ctx.lineTo(width * (0.5 + offset * 18), height)
    ctx.stroke()
  }
  ctx.strokeStyle = '#d9e0d6'
  ctx.lineWidth = 3
  for (const side of [-1, 1]) {
    ctx.beginPath()
    ctx.moveTo(width * 0.5 + side * width * 0.03, height * 0.44)
    ctx.lineTo(width * (0.5 + side * 0.39), height)
    ctx.stroke()
  }

  const drawCar = (x, y, scale, color) => {
    ctx.fillStyle = color
    ctx.fillRect(x - 24 * scale, y - 24 * scale, 48 * scale, 30 * scale)
    ctx.fillStyle = '#263a41'
    ctx.fillRect(x - 15 * scale, y - 39 * scale, 30 * scale, 19 * scale)
    ctx.fillStyle = '#e8d5a3'
    ctx.fillRect(x - 19 * scale, y + 1 * scale, 7 * scale, 4 * scale)
    ctx.fillRect(x + 12 * scale, y + 1 * scale, 7 * scale, 4 * scale)
  }
  const leadX = width * 0.53
  drawCar(leadX, height * 0.67, 0.76, '#778b91')
  if (props.session.oncomingSeen && props.session.oncomingDistance > 0 && props.session.oncomingDistance < 180) {
    const relative = 1 - props.session.oncomingDistance / 190
    drawCar(width * 0.47 - relative * width * 0.03, height * (0.48 + relative * 0.2), 0.25 + relative * 0.55, '#b8543f')
  }
  ctx.strokeStyle = '#171a19'
  ctx.lineWidth = 13
  ctx.beginPath()
  ctx.moveTo(width * 0.28, height * 0.96)
  ctx.quadraticCurveTo(width * 0.5, height * 0.89, width * 0.72, height * 0.96)
  ctx.stroke()
  ctx.fillStyle = '#202523'
  ctx.fillRect(width * 0.44, height * 0.93, width * 0.12, height * 0.06)
}

const initFallback = (error) => {
  console.error('3D road scene unavailable; using canvas fallback.', error)
  if (renderer) {
    renderer.dispose()
    renderer.domElement.remove()
    renderer = null
  }
  fallbackCanvas = document.createElement('canvas')
  fallbackCanvas.setAttribute('aria-label', '山路場景備援畫面')
  host.value.replaceChildren(fallbackCanvas)
  resize()
  drawFallback()
  if (!resizeObserver) {
    resizeObserver = new ResizeObserver(resize)
    resizeObserver.observe(host.value)
  }
}

const mountScene = () => {
  try {
    initScene()
  } catch (error) {
    initFallback(error)
    render()
  }
}

const disposeScene = () => {
  disposed = true
  cancelAnimationFrame(animationFrame)
  resizeObserver?.disconnect()
  if (scene) {
    scene.traverse((object) => {
      object.geometry?.dispose()
      if (Array.isArray(object.material)) object.material.forEach((material) => material.dispose())
      else object.material?.dispose()
    })
  }
  renderer?.dispose()
  renderer?.domElement.remove()
  roadTexture?.dispose()
  roadNormalTexture?.dispose()
  fallbackCanvas?.remove()
}

onMounted(mountScene)
onBeforeUnmount(disposeScene)
</script>

<template>
  <div ref="host" class="road-scene" aria-label="第一人稱山路遊戲場景"></div>
</template>

<style scoped>
.road-scene {
  position: absolute;
  inset: 0;
  overflow: hidden;
  background: linear-gradient(#aebfba, #789087 58%, #3f4a42);
}

.road-scene :deep(canvas) {
  display: block;
  width: 100%;
  height: 100%;
}
</style>
