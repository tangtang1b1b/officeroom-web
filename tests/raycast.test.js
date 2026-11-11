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
  const P = [2, 0, 3]
  it('hits standing head with part', () => {
    const hit = raycastPlayer([2, 1.6, 0], [0, 0, 1], P, 'stand', 50)
    close(hit.distance, 2.86)
    close(hit.normal[2], -1)
    expect(hit.part).toBe('head')
  })
  it('hits torso and legs with correct part', () => {
    const torso = raycastPlayer([2, 1.1, 0], [0, 0, 1], P, 'stand', 50)
    expect(torso.part).toBe('torso')
    close(torso.distance, 2.88)
    const leg = raycastPlayer([2.1, 0.4, 0], [0, 0, 1], P, 'stand', 50)
    expect(leg.part).toBe('legR')
    close(leg.distance, 2.92)
    expect(raycastPlayer([1.9, 0.4, 0], [0, 0, 1], P, 'stand', 50).part).toBe('legL')
    // 兩腿之間的縫隙沒有身體
    expect(raycastPlayer([2, 0.4, 0], [0, 0, 1], P, 'stand', 50)).toBeNull()
  })
  it('hits forward-extended arm', () => {
    const hit = raycastPlayer([2.265, 1.35, 0], [0, 0, 1], P, 'stand', 50)
    expect(hit.part).toBe('armR')
    close(hit.distance, 2.4)
  })
  it('no longer hits within old cylinder radius but outside body boxes', () => {
    expect(raycastPlayer([2.25, 1.6, 0], [0, 0, 1], P, 'stand', 50)).toBeNull()
    expect(raycastPlayer([2.25, 1.1, 0], [0, 0, 1], P, 'stand', 50)).toBeNull()
  })
  it('passes over prone player', () => {
    expect(raycastPlayer([2, 1.6, 0], [0, 0, 1], P, 'prone', 50)).toBeNull()
  })
  it('hits head cap from above', () => {
    const hit = raycastPlayer([2, 5, 3], [0, -1, 0], P, 'stand', 50)
    close(hit.distance, 5 - 1.75)
    expect(hit.normal).toEqual([0, 1, 0])
    expect(hit.part).toBe('head')
  })
  it('crouch: head, leg, and miss above', () => {
    const head = raycastPlayer([2, 1.15, 0], [0, 0, 1], P, 'crouch', 50)
    expect(head.part).toBe('head')
    expect(head.distance).toBeCloseTo(2.63, 1)
    const leg = raycastPlayer([2.1, 0.2, 0], [0, 0, 1], P, 'crouch', 50)
    expect(leg.part).toBe('legR')
    close(leg.distance, 2.5)
    expect(raycastPlayer([2, 1.5, 0], [0, 0, 1], P, 'crouch', 50)).toBeNull()
  })
  it('prone player lies along facing (yaw=0 toward -z)', () => {
    // 腳底在 (2,0,3),身體延伸到 z=1.25,頭在最前端
    const hit = raycastPlayer([2, 0.15, 0], [0, 0, 1], P, 'prone', 50, 0)
    close(hit.distance, 1.25)
    expect(hit.normal).toEqual([0, 0, -1])
    expect(hit.part).toBe('head')
    // 腳底後方(+z)打腿:先碰到腳底端面
    const feet = raycastPlayer([2.1, 0.1, 6], [0, 0, -1], P, 'prone', 50, 0)
    close(feet.distance, 3)
    expect(feet.part).toBe('legR')
    expect(raycastPlayer([2, 0.15, 0], [0, 0, 1], P, 'prone', 1, 0)).toBeNull()
  })
  it('prone player rotated by yaw', () => {
    // yaw=π/2: 方向 (-1,0,0),身體延伸到 x=1.25 (腳在 x=3)
    const hit = raycastPlayer([0, 0.15, 3], [1, 0, 0], [3, 0, 3], 'prone', 50, Math.PI / 2)
    close(hit.distance, 3 - 1.75)
    close(hit.normal[0], -1)
    expect(hit.part).toBe('head')
    // 此時右 = (0,0,-1);z=2.9 為右側 0.1 → legR,從腳後方打來先碰腳底端面
    const feet = raycastPlayer([6, 0.1, 2.9], [-1, 0, 0], [3, 0, 3], 'prone', 50, Math.PI / 2)
    close(feet.distance, 3)
    expect(feet.part).toBe('legR')
    expect(raycastPlayer([0, 0.15, 3.5], [1, 0, 0], [3, 0, 3], 'prone', 50, Math.PI / 2)).toBeNull()
  })
  it('prone player is hit from above only below 0.3m', () => {
    // z=1.9 → 前 1.1,位於軀幹
    const hit = raycastPlayer([2, 2, 1.9], [0, -1, 0], P, 'prone', 50, 0)
    close(hit.distance, 1.7)
    expect(hit.normal[1]).toBe(1)
    expect(hit.part).toBe('torso')
  })
  it('raycastWorld passes yaw and part for prone', () => {
    const hit = raycastWorld([2, 0.15, 0], [0, 0, 1], { players: [{ id: 'b', pos: P, pose: 'prone', yaw: 0 }] })
    expect(hit.kind).toBe('player')
    expect(hit.part).toBe('head')
    const miss = raycastWorld([2.1, 0.1, 0], [0, 0, 1], { players: [{ id: 'b', pos: P, pose: 'prone', yaw: Math.PI }] })
    // yaw=π: 身體向 +z 延伸(z 3~4.75),從 z=0 先碰到腳底端面
    expect(miss.kind).toBe('player')
    // yaw=π 時右 = -x,x=2.1 在玩家(x=2)的 +x 側 → 是左腿
    expect(miss.part).toBe('legL')
    close(miss.distance, 3)
  })
  it('misses when off to the side', () => {
    expect(raycastPlayer([2.5, 1.6, 0], [0, 0, 1], P, 'stand', 50)).toBeNull()
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
    expect(hit.part).toBe('head')
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
