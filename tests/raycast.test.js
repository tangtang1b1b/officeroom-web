import { describe, it, expect } from 'vitest'
import { raycastBoxes, raycastPlayer, raycastRoom, raycastWorld } from '../shared/raycast.js'
import { COLLIDERS, ROOM } from '../shared/layout.js'

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
    expect(hit.box.id).toMatch(/^chair/)
    expect(hit.normal).toEqual([0, 0, -1])
  })

  it('respects maxDist', () => {
    expect(raycastBoxes([0, 0.5, -4.5], [0, 0, 1], COLLIDERS, 0.5)).toBeNull()
  })

  it('misses when pointing away', () => {
    expect(raycastBoxes([0, 0.5, -4.5], [0, 0, -1], COLLIDERS, 20)).toBeNull()
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
    close(hit.distance, 5 - 1.7)
    expect(hit.normal).toEqual([0, 1, 0])
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
