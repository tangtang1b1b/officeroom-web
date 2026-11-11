import { describe, it, expect } from 'vitest'
import { raycastBoxes, raycastPlayer, raycastRoom, raycastWorld } from '../shared/raycast.js'
import { COLLIDERS, ROOM } from '../shared/layout.js'
import { createObjects } from '../shared/physics.js'

const close = (a, b) => expect(a).toBeCloseTo(b, 5)

describe('raycastBoxes', () => {
  it('hits desk top from above', () => {
    const hit = raycastBoxes([0, 2, -2.4], [0, -1, 0], COLLIDERS, 10)
    expect(hit).not.toBeNull()
    close(hit.distance, 1.25)
    expect(hit.normal).toEqual([0, 1, 0])
    close(hit.point[1], 0.75)
  })

  it('returns nearest box and side normal', () => {
    const hit = raycastBoxes([0, 0.5, -4.5], [0, 0, 1], COLLIDERS, 20)
    expect(hit.box.id).toMatch(/^desk/)
    expect(hit.normal).toEqual([0, 0, -1])
  })

  it('respects maxDist', () => {
    expect(raycastBoxes([0, 0.5, -4.5], [0, 0, 1], COLLIDERS, 0.5)).toBeNull()
  })

  it('misses when pointing away', () => {
    expect(raycastBoxes([0, 0.5, -4.5], [0, 0, -1], COLLIDERS, 20)).toBeNull()
  })

  it('origin inside box returns distance 0 hit', () => {
    const box = { min: [0, 0, 0], max: [2, 2, 2] }
    const hit = raycastBoxes([1, 1, 1], [0, 0, 1], [box], 10)
    expect(hit.distance).toBe(0)
    expect(hit.point).toEqual([1, 1, 1])
    expect(hit.normal).toEqual([0, 0, -1])
  })
  it('handles axis-parallel ray outside slab', () => {
    const box = { min: [0, 0, 0], max: [1, 1, 1] }
    expect(raycastBoxes([5, 0.5, -1], [0, 0, 1], [box], 10)).toBeNull()
  })
})

describe('raycastRoom', () => {
  it('hits side wall', () => {
    const hit = raycastRoom([0, 1.6, 0], [1, 0, 0])
    close(hit.distance, ROOM.maxX)
    expect(hit.normal).toEqual([-1, 0, 0])
  })
  it('hits ceiling and floor', () => {
    const up = raycastRoom([2, 1.6, 0], [0, 1, 0])
    close(up.point[1], ROOM.height)
    expect(up.normal).toEqual([0, -1, 0])
    const down = raycastRoom([2, 1.6, 0], [0, -1, 0])
    close(down.point[1], 0)
    expect(down.normal).toEqual([0, 1, 0])
  })
  it('respects maxDist', () => {
    expect(raycastRoom([0, 1.6, 0], [1, 0, 0], 3)).toBeNull()
  })
})

describe('raycastPlayer', () => {
  it('hits standing player on side', () => {
    const hit = raycastPlayer([2, 1.6, 0], [0, 0, 1], [2, 0, 3], 'stand', 50)
    close(hit.distance, 2.7)
    close(hit.normal[2], -1)
  })
  it('passes over prone player', () => {
    expect(raycastPlayer([2, 1.6, 0], [0, 0, 1], [2, 0, 3], 'prone', 50)).toBeNull()
  })
  it('hits head cap from above', () => {
    const hit = raycastPlayer([2, 5, 3], [0, -1, 0], [2, 0, 3], 'stand', 50)
    close(hit.distance, 5 - 1.75)
    expect(hit.normal).toEqual([0, 1, 0])
  })
  it('prone player lies along facing (yaw=0 toward -z)', () => {
    // 腳底在 (2,0,3),身體延伸到 z=1.25
    const hit = raycastPlayer([2, 0.15, 0], [0, 0, 1], [2, 0, 3], 'prone', 50, 0)
    close(hit.distance, 1.25)
    expect(hit.normal).toEqual([0, 0, -1])
    // 腳底後方(+z)沒有身體
    expect(raycastPlayer([2, 0.15, 6], [0, 0, -1], [2, 0, 3], 'prone', 50, 0).distance).toBeCloseTo(3)
    expect(raycastPlayer([2, 0.15, 0], [0, 0, 1], [2, 0, 3], 'prone', 1, 0)).toBeNull()
  })
  it('prone player rotated by yaw', () => {
    // yaw=π/2: 方向 (-1,0,0),身體延伸到 x=1.25 (腳在 x=3)
    const hit = raycastPlayer([0, 0.15, 3], [1, 0, 0], [3, 0, 3], 'prone', 50, Math.PI / 2)
    close(hit.distance, 3 - 1.75)
    close(hit.normal[0], -1)
    // 從腳後方(x>3)打來,先碰到腳底端面
    close(raycastPlayer([6, 0.15, 3.0], [-1, 0, 0], [3, 0, 3], 'prone', 50, Math.PI / 2).distance, 3)
    expect(raycastPlayer([0, 0.15, 3.5], [1, 0, 0], [3, 0, 3], 'prone', 50, Math.PI / 2)).toBeNull()
  })
  it('prone player is hit from above only below 0.3m', () => {
    const hit = raycastPlayer([2, 2, 2.5], [0, -1, 0], [2, 0, 3], 'prone', 50, 0)
    close(hit.distance, 1.7)
    expect(hit.normal[1]).toBe(1)
  })
  it('raycastWorld passes yaw for prone', () => {
    const hit = raycastWorld([2, 0.15, 0], [0, 0, 1], { players: [{ id: 'b', pos: [2, 0, 3], pose: 'prone', yaw: 0 }] })
    expect(hit.kind).toBe('player')
    const miss = raycastWorld([2, 0.15, 0], [0, 0, 1], { players: [{ id: 'b', pos: [2, 0, 3], pose: 'prone', yaw: Math.PI }] })
    // yaw=π: 身體向 +z 延伸(z 3~4.75),從 z=0 先碰到腳底端面
    expect(miss.kind).toBe('player')
    close(miss.distance, 3)
  })
  it('misses when off to the side', () => {
    expect(raycastPlayer([2.5, 1.6, 0], [0, 0, 1], [2, 0, 3], 'stand', 50)).toBeNull()
  })
})

describe('raycastWorld', () => {
  it('hits wall', () => {
    const hit = raycastWorld([2, 1.6, 0], [0, 0, 1])
    expect(hit.kind).toBe('wall')
    close(hit.distance, 5)
  })
  it('hits desk', () => {
    const hit = raycastWorld([0, 2, -2.4], [0, -1, 0])
    expect(hit.kind).toBe('box')
  })
  it('hits player with targetId', () => {
    const hit = raycastWorld([2, 1.6, 0], [0, 0, 1], { players: [{ id: 'b', pos: [2, 0, 3], pose: 'stand' }] })
    expect(hit.kind).toBe('player')
    expect(hit.targetId).toBe('b')
  })
  it('ignores shooter', () => {
    const hit = raycastWorld([2, 1.6, 0], [0, 0, 1], {
      players: [{ id: 'a', pos: [2, 0, 0.1], pose: 'stand' }],
      ignoreId: 'a',
    })
    expect(hit.kind).toBe('wall')
  })
  it('player behind a desk/chair is blocked', () => {
    const hit = raycastWorld([0, 0.6, -4.5], [0, 0, 1], { players: [{ id: 'b', pos: [0, 0, -1], pose: 'stand' }] })
    expect(hit.kind).toBe('box')
  })
})

describe('raycastWorld with objects', () => {
  const objects = createObjects([
    { id: 'o1', kind: 'chair', x: 5.5, z: 0, yaw: 0, radius: 0.3, height: 1.25, mass: 1, canFall: true },
  ])
  it('hits an object and reports objectId', () => {
    const hit = raycastWorld([4, 0.6, 0], [1, 0, 0], { objects })
    expect(hit.kind).toBe('object')
    expect(hit.objectId).toBe('o1')
    close(hit.distance, 1.2)
    expect(hit.normal).toEqual([-1, 0, 0])
  })
  it('fallen object is low: high shot passes over, low shot hits', () => {
    objects[0].state = 'down'
    expect(raycastWorld([4, 1.0, 0], [1, 0, 0], { objects }).kind).toBe('wall')
    expect(raycastWorld([4, 0.3, 0], [1, 0, 0], { objects }).kind).toBe('object')
    objects[0].state = 'up'
  })
  it('nearer player wins over object', () => {
    const hit = raycastWorld([4, 1, 0], [1, 0, 0], { objects, players: [{ id: 'p', pos: [4.6, 0, 0], pose: 'stand' }] })
    expect(hit.kind).toBe('player')
  })
})
