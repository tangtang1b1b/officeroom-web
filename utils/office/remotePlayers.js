import * as THREE from 'three'
import { createStickman } from './stickman.js'

const makeLabel = (name) => {
  const canvas = document.createElement('canvas')
  canvas.width = 256
  canvas.height = 64
  const context = canvas.getContext('2d')
  context.font = 'bold 30px sans-serif'
  context.textAlign = 'center'
  context.textBaseline = 'middle'
  context.lineWidth = 6
  context.strokeStyle = 'rgba(0,0,0,0.7)'
  context.strokeText(name, 128, 32)
  context.fillStyle = '#ffffff'
  context.fillText(name, 128, 32)
  const texture = new THREE.CanvasTexture(canvas)
  const material = new THREE.SpriteMaterial({ map: texture, depthTest: false, transparent: true })
  const sprite = new THREE.Sprite(material)
  sprite.scale.set(1.2, 0.3, 1)
  sprite.renderOrder = 10
  return { sprite, texture, material }
}

// 離線同事坐在位子上的人偶,id 以此前綴區分(只在前端存在)
export const IDLE_PREFIX = 'idle:'

const angleDiff =(a, b) => Math.atan2(Math.sin(b - a), Math.cos(b - a))
const LABEL_HEIGHT = { stand: 2.05, crouch: 1.6, prone: 0.7, sit: 1.6 }

// 其他玩家的火柴人:收到快照後朝目標平滑插值
export const createRemotePlayers = (scene) => {
  const players = new Map()

  const add = (info) => {
    if (players.has(info.id)) return players.get(info.id)
    const man = createStickman(info.color)
    const label = makeLabel(info.name || '')
    man.group.userData.bodyMeshes = man.meshes // paint.js 依此把漆彈貼到被打中的身體方塊
    label.sprite.position.y = LABEL_HEIGHT.stand
    man.group.add(label.sprite)
    scene.add(man.group)
    const entry = {
      id: info.id,
      man,
      label,
      pose: 'stand',
      target: { x: 0, z: 0, yaw: 0, pitch: 0, pose: 'stand' },
      placed: false,
    }
    players.set(info.id, entry)
    return entry
  }

  const remove = (id) => {
    const entry = players.get(id)
    if (!entry) return
    scene.remove(entry.man.group)
    entry.man.dispose()
    entry.label.texture.dispose()
    entry.label.material.dispose()
    players.delete(id)
  }

  const applyState = (info) => {
    const entry = players.get(info.id) || add(info)
    const [x, , z] = info.pos
    entry.target = { x, z, yaw: info.yaw, pitch: info.pitch ?? 0, pose: info.pose }
    if (!entry.placed) {
      entry.placed = true
      entry.man.group.position.set(x, 0, z)
      entry.man.group.rotation.y = info.yaw
      // 第一次出現就直接是該姿勢(例如坐著),不要先站著再慢慢坐下
      entry.pose = info.pose
      entry.man.setPose(info.pose)
      entry.man.snapPose?.()
      entry.label.sprite.position.y = LABEL_HEIGHT[info.pose] ?? LABEL_HEIGHT.stand
    }
  }

  const update = (dt) => {
    const k = 1 - Math.exp(-14 * dt)
    for (const entry of players.values()) {
      const group = entry.man.group
      const dx = entry.target.x - group.position.x
      const dz = entry.target.z - group.position.z
      group.position.x += dx * k
      group.position.z += dz * k
      group.rotation.y += angleDiff(group.rotation.y, entry.target.yaw) * k
      if (entry.pose !== entry.target.pose) {
        entry.pose = entry.target.pose
        entry.man.setPose(entry.pose)
        entry.label.sprite.position.y = LABEL_HEIGHT[entry.pose]
      }
      entry.man.setLook(entry.target.pitch)
      entry.man.update(dt, dt > 0 ? (Math.hypot(dx, dz) * k) / dt : 0)
    }
  }

  return {
    add,
    remove,
    applyState,
    update,
    has: (id) => players.has(id),
    getGroup: (id) => players.get(id)?.man.group,
    ids: () => [...players.keys()],
    // 可被瞄準的玩家(含離線的座位人偶,伺服器也會判定它們)
    liveIds: () => [...players.keys()],
    idleIds: () => [...players.keys()].filter((id) => id.startsWith(IDLE_PREFIX)),
    dispose() {
      for (const id of [...players.keys()]) remove(id)
    },
  }
}
