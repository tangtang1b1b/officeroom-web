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

const angleDiff = (a, b) => Math.atan2(Math.sin(b - a), Math.cos(b - a))
const LABEL_HEIGHT = { stand: 2.05, crouch: 1.6, prone: 0.7 }

// 其他玩家的火柴人:收到快照後朝目標平滑插值
export const createRemotePlayers = (scene) => {
  const players = new Map()

  const add = (info) => {
    if (players.has(info.id)) return players.get(info.id)
    const man = createStickman(info.color)
    const label = makeLabel(info.name || '')
    label.sprite.position.y = LABEL_HEIGHT.stand
    man.group.add(label.sprite)
    scene.add(man.group)
    const entry = {
      id: info.id,
      man,
      label,
      pose: 'stand',
      target: { x: 0, z: 0, yaw: 0, pose: 'stand' },
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
    entry.target = { x, z, yaw: info.yaw, pose: info.pose }
    if (!entry.placed) {
      entry.placed = true
      entry.man.group.position.set(x, 0, z)
      entry.man.group.rotation.y = info.yaw
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
    dispose() {
      for (const id of [...players.keys()]) remove(id)
    },
  }
}
