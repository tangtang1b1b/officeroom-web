import { describe, it, expect } from 'vitest'
import {
  applyHit,
  reviveIfReady,
  isDowned,
  downRemaining,
  sanitizeJumpY,
  evaluateStateChange,
  createMoveBucket,
  limitAirTime,
  JUMP_MAX_AIR_MS,
  HIT_DAMAGE,
  DOWN_DURATION_MS,
  JUMP_MAX_Y,
} from '../worker/rules.js'
import { MAX_HP } from '../shared/protocol.js'
import { isBlocked, moveCircle } from '../shared/collision.js'
import { COLLIDERS } from '../shared/layout.js'

const mk = (over = {}) => ({ pos: [-6, 0, -1.2], pose: 'stand', hp: MAX_HP, downedUntil: 0, move: createMoveBucket(0), ...over })

describe('hit / down / revive', () => {
  it('hit reduces hp but does not down until zero', () => {
    const p = mk()
    expect(applyHit(p, 0)).toEqual({ damaged: true, downed: false })
    expect(p.hp).toBe(MAX_HP - HIT_DAMAGE)
    expect(isDowned(p, 0)).toBe(false)
  })

  it('reaching zero hp downs the player prone for the duration', () => {
    const p = mk()
    let r
    for (let i = 0; i < MAX_HP / HIT_DAMAGE; i++) r = applyHit(p, 1000)
    expect(r.downed).toBe(true)
    expect(p.hp).toBe(0)
    expect(p.pose).toBe('prone')
    expect(isDowned(p, 1000)).toBe(true)
    expect(downRemaining(p, 1000)).toBe(DOWN_DURATION_MS)
  })

  it('shots while downed do nothing and do not extend the timer', () => {
    const p = mk({ hp: 0, downedUntil: 11_000, pose: 'prone' })
    expect(applyHit(p, 5000)).toEqual({ damaged: false, downed: false })
    expect(p.downedUntil).toBe(11_000)
  })

  it('revives with full hp only after the time is up', () => {
    const p = mk({ hp: 0, downedUntil: 11_000, pose: 'prone' })
    expect(reviveIfReady(p, 10_999)).toBe(false)
    expect(reviveIfReady(p, 11_000)).toBe(true)
    expect(p.hp).toBe(MAX_HP)
    expect(isDowned(p, 11_000)).toBe(false)
  })

  it('a hit right after the timer expires revives first instead of re-downing', () => {
    const p = mk({ hp: 0, downedUntil: 1000, pose: 'prone' })
    const r = applyHit(p, 1001)
    expect(r.downed).toBe(false)
    expect(p.hp).toBe(MAX_HP - HIT_DAMAGE)
  })

  it('downed players are forced prone and cannot stand up', () => {
    const p = mk({ hp: 0, downedUntil: 11_000, pose: 'prone' })
    const r = evaluateStateChange(p, { pos: [-6, 0, -1.2], yaw: 0, pitch: 0, pose: 'stand' }, 5000)
    expect(r.pose).toBe('prone')
  })

  it('after revive the player can stand again', () => {
    const p = mk({ pose: 'prone' })
    const r = evaluateStateChange(p, { pos: [-6, 0, -1.2], yaw: 0, pitch: 0, pose: 'stand' }, 100)
    expect(r.pose).toBe('stand')
  })
})

describe('jump', () => {
  it('only standing players can be airborne, clamped to the max height', () => {
    expect(sanitizeJumpY(0.5, 'stand', false)).toBe(0.5)
    expect(sanitizeJumpY(5, 'stand', false)).toBe(JUMP_MAX_Y)
    expect(sanitizeJumpY(-1, 'stand', false)).toBe(0)
    expect(sanitizeJumpY(0.5, 'crouch', false)).toBe(0)
    expect(sanitizeJumpY(0.5, 'stand', true)).toBe(0)
    expect(sanitizeJumpY(NaN, 'stand', false)).toBe(0)
  })

  it('cannot hover: air time is limited until the player lands', () => {
    const p = mk()
    const T0 = 1000
    expect(limitAirTime(p, 0.5, T0)).toBe(0.5)
    expect(limitAirTime(p, 0.5, T0 + JUMP_MAX_AIR_MS - 1)).toBe(0.5)
    expect(limitAirTime(p, 0.5, T0 + JUMP_MAX_AIR_MS + 1)).toBe(0)
    expect(limitAirTime(p, 0, T0 + JUMP_MAX_AIR_MS + 2)).toBe(0) // 落地後重置
    expect(limitAirTime(p, 0.5, T0 + JUMP_MAX_AIR_MS + 3)).toBe(0.5)
  })

  it('collision ignores height: every collider still blocks at its own xz regardless of y', () => {
    // 碰撞只看 xz,跳躍不會讓人穿進或卡進任何方塊
    for (const box of COLLIDERS) {
      const cx = (box.min[0] + box.max[0]) / 2
      const cz = (box.min[2] + box.max[2]) / 2
      expect(isBlocked(cx, cz)).toBe(true)
    }
    const out = moveCircle(0, 0, 0, 0)
    expect(Number.isFinite(out.x)).toBe(true)
  })
})
