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
  JUMP_REACH,
  CLAIM_MAX_Y,
  clampClaimY,
} from '../worker/rules.js'
import { MAX_HP } from '../shared/protocol.js'
import { isBlocked, moveCircle, groundHeight, STEP_HEIGHT } from '../shared/collision.js'
import { COLLIDERS, DESKS, FIXTURES, CHAIRS, PLAYER } from '../shared/layout.js'

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
  it('only standing players can leave the ground, clamped to the reach above the support', () => {
    expect(sanitizeJumpY(0.5, 'stand', false)).toBe(0.5)
    expect(sanitizeJumpY(5, 'stand', false)).toBe(JUMP_REACH)
    expect(sanitizeJumpY(-1, 'stand', false)).toBe(0)
    expect(sanitizeJumpY(0.5, 'crouch', false)).toBe(0)
    expect(sanitizeJumpY(0.5, 'stand', true)).toBe(0)
    expect(sanitizeJumpY(NaN, 'stand', false)).toBe(0)
    // 站在 0.75m 的桌上:下限是桌面,上限是桌面 + 跳躍高度
    expect(sanitizeJumpY(0, 'stand', false, 0.75)).toBe(0.75)
    expect(sanitizeJumpY(9, 'stand', false, 0.75)).toBeCloseTo(0.75 + JUMP_REACH)
    expect(sanitizeJumpY(1, 'crouch', false, 0.75)).toBe(0.75) // 蹲下留在桌面
  })

  it('claimed heights are clamped before collision checks', () => {
    expect(clampClaimY(99)).toBe(CLAIM_MAX_Y)
    expect(clampClaimY(-3)).toBe(0)
    expect(clampClaimY(NaN)).toBe(0)
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

  it('air time is measured from the support surface (standing on a desk is not airborne)', () => {
    const p = mk()
    expect(limitAirTime(p, 0.75, 1000, 0.75)).toBe(0.75)
    expect(limitAirTime(p, 0.75, 1000 + JUMP_MAX_AIR_MS * 5, 0.75)).toBe(0.75)
    expect(p.airSince).toBe(0)
  })
})

const desk = DESKS[0]
const deskBox = COLLIDERS.find((b) => b.id === desk.id)
const cx = (deskBox.min[0] + deskBox.max[0]) / 2
const cz = (deskBox.min[2] + deskBox.max[2]) / 2
const deskTop = deskBox.max[1]

describe('standing on desks and sofas', () => {
  it('only tables, desks and sofas are standable; chairs, partitions, monitors and walls are not', () => {
    for (const b of COLLIDERS) {
      const isDesk = DESKS.some((d) => d.id === b.id)
      const fixture = FIXTURES.find((f) => f.id === b.id)
      const expected = isDesk || (fixture && ['table', 'roundtable', 'loungechair'].includes(fixture.kind))
      expect(!!b.standable, b.id).toBe(!!expected)
    }
    for (const c of CHAIRS) expect(COLLIDERS.find((b) => b.id === c.id).standable).toBe(false)
  })

  it('ground height is the desk top above a desk, 0 elsewhere', () => {
    expect(groundHeight(cx, cz, deskTop)).toBe(deskTop)
    expect(groundHeight(cx, cz, 0)).toBe(0) // 腳在桌面下:不會被吸上去
    expect(groundHeight(cx, cz, deskTop - STEP_HEIGHT - 0.01)).toBe(0)
    expect(groundHeight(cx, cz, deskTop + 0.5)).toBe(deskTop) // 在桌面上方落下時會落在桌面
    expect(groundHeight(-6, 2.65, 0)).toBe(0)
  })

  it('a desk blocks from the floor but not once your feet are at the top', () => {
    const px = deskBox.max[0] - 0.15 // 桌子靠端點、避開中間的螢幕
    expect(isBlocked(px, cz, PLAYER.radius, 0)).toBe(true)
    expect(isBlocked(px, cz, PLAYER.radius, 0.5)).toBe(true) // 還沒跳高到桌面
    expect(isBlocked(px, cz, PLAYER.radius, deskTop)).toBe(false)
    expect(isBlocked(px, cz, PLAYER.radius, deskTop + 0.3)).toBe(false)
  })

  it('on the desk, monitors and partitions still block', () => {
    const mon = COLLIDERS.find((b) => b.id === `${desk.id}-monitor`)
    const mx = (mon.min[0] + mon.max[0]) / 2
    const mz = (mon.min[2] + mon.max[2]) / 2
    expect(isBlocked(mx, mz, PLAYER.radius, deskTop)).toBe(true)
    const part = COLLIDERS.find((b) => b.id === `${desk.id}-partition`)
    expect(isBlocked((part.min[0] + part.max[0]) / 2, (part.min[2] + part.max[2]) / 2, PLAYER.radius, deskTop)).toBe(true)
  })

  it('walls and office chairs block at every reachable height (no flying through them)', () => {
    const wall = COLLIDERS.find((b) => b.id === 'wall-b')
    const wx = (wall.min[0] + wall.max[0]) / 2
    const wz = (wall.min[2] + wall.max[2]) / 2
    for (const y of [0, 0.75, 1.25, 1.9]) expect(isBlocked(wx, wz, PLAYER.radius, y)).toBe(true)
    const chair = COLLIDERS.find((b) => b.id === CHAIRS[0].id)
    const ccx = (chair.min[0] + chair.max[0]) / 2
    const ccz = (chair.min[2] + chair.max[2]) / 2
    expect(isBlocked(ccx, ccz, PLAYER.radius, 0)).toBe(true)
    expect(isBlocked(ccx, ccz, PLAYER.radius, 0.5)).toBe(true) // 椅子高 1.15m:跳 1.0m 還踩不上
  })

  it('a 1.0m jump clears every standable top (0.75m desks/tables, 0.8m sofas)', () => {
    for (const b of COLLIDERS.filter((c) => c.standable)) expect(b.max[1]).toBeLessThan(1.0 - 0.1)
  })

  it('walking from the floor into a desk is still blocked (slides along the side)', () => {
    const startX = deskBox.max[0] + PLAYER.radius + 0.3
    let p = { x: startX, z: cz }
    for (let i = 0; i < 40; i++) p = moveCircle(p.x, p.z, -0.05, 0, PLAYER.radius, 0)
    expect(p.x).toBeGreaterThan(deskBox.max[0])
  })

  it('on top, walking across the desk is not blocked', () => {
    let p = { x: deskBox.max[0] - 0.1, z: cz }
    const x0 = p.x
    for (let i = 0; i < 5; i++) p = moveCircle(p.x, p.z, -0.03, 0, PLAYER.radius, deskTop)
    expect(p.x).toBeLessThan(x0 - 0.1)
  })

  it('collision at the floor is unchanged: every collider blocks its own center', () => {
    for (const box of COLLIDERS) {
      const bx = (box.min[0] + box.max[0]) / 2
      const bz = (box.min[2] + box.max[2]) / 2
      expect(isBlocked(bx, bz), box.id).toBe(true)
    }
  })
})
