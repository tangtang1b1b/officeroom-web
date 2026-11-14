import { describe, it, expect } from 'vitest'
import {
  PROP_RESTORE_MS,
  SHOOTABLE_PROPS,
  propById,
  isShootableProp,
  monitorPropId,
  createPropsState,
  isKnocked,
  knockProp,
  restoreProps,
  expireProps,
  nextExpiry,
  seatPropIds,
  restoreSeatProps,
  propsOverlay,
  propsSnapshot,
  pushPlayersOutOfProps,
  FIXTURE_PROP_IDS,
  propBox,
} from '../shared/props.js'
import { isBlocked, moveCircle, groundHeight } from '../shared/collision.js'
import { isShootOriginValid, evaluateMove, createMoveBucket, pickSpawnPoint } from '../worker/rules.js'
import { CHAIRS, DESKS, COLLIDERS, FIXTURES, PLAYER, SEATS } from '../shared/layout.js'

const expectSameBox = (a, b) => {
  for (let i = 0; i < 3; i++) {
    expect(a.min[i]).toBeCloseTo(b.min[i], 9)
    expect(a.max[i]).toBeCloseTo(b.max[i], 9)
  }
}
const center = (b) => ({ x: (b.min[0] + b.max[0]) / 2, z: (b.min[2] + b.max[2]) / 2 })
const chair = CHAIRS[0]
const chairBox = COLLIDERS.find((b) => b.id === chair.id)
const desk = DESKS[0]
const monId = monitorPropId(desk.id)
const monBox = COLLIDERS.find((b) => b.id === monId)

describe('shootable props list', () => {
  it('contains every office chair, every desk monitor and the reception chairs / round table, with their colliders', () => {
    expect(SHOOTABLE_PROPS).toHaveLength(CHAIRS.length + DESKS.length + 4)
    for (const c of CHAIRS) expect(propById(c.id)).toMatchObject({ kind: 'chair', box: { id: c.id } })
    for (const d of DESKS) expect(propById(`${d.id}-monitor`)).toMatchObject({ kind: 'monitor', box: { id: `${d.id}-monitor` } })
    expect(FIXTURE_PROP_IDS.sort()).toEqual(['reception-chair-e', 'reception-chair-s', 'reception-chair-w', 'round-table'])
    for (const id of ['reception-chair-w', 'reception-chair-e', 'reception-chair-s']) {
      const f = FIXTURES.find((x) => x.id === id)
      expect(propById(id)).toMatchObject({ kind: 'chair', box: { id }, home: { yaw: f.yaw } })
      // 尺寸與原位盒相同(射中瞬間不長大)
      expectSameBox(propBox(knockProp({}, id, [1, 0, 0], 0).entry), COLLIDERS.find((b) => b.id === id))
    }
    expect(propById('round-table')).toMatchObject({ kind: 'table', box: { id: 'round-table', standable: true } })
    const tb = propBox(knockProp({}, 'round-table', [1, 0, 0], 0).entry)
    expectSameBox(tb, COLLIDERS.find((b) => b.id === 'round-table'))
    expect(tb.standable).toBe(false)
  })

  it('excludes other fixtures (meeting table, sofas, shelf, cupboard), partitions and desks', () => {
    for (const f of FIXTURES) expect(isShootableProp(f.id)).toBe(FIXTURE_PROP_IDS.includes(f.id))
    for (const id of ['meeting-table', 'shelf-a', 'cupboard', 'lounge-0']) expect(isShootableProp(id)).toBe(false)
    expect(isShootableProp(desk.id)).toBe(false)
    expect(isShootableProp(`${desk.id}-partition`)).toBe(false)
    expect(propById('nope')).toBeNull()
  })

  it('restore times: chair 20s, monitor 30s, table 30s', () => {
    expect(PROP_RESTORE_MS).toEqual({ chair: 20000, monitor: 30000, table: 30000 })
    expect(knockProp({}, 'reception-chair-w', [1, 0, 0], 0).entry.until).toBe(20000)
    expect(knockProp({}, 'round-table', [1, 0, 0], 0).entry).toMatchObject({ kind: 'table', until: 30000 })
  })
})

describe('knock / expire / restore', () => {
  it('knocks a chair with normalized horizontal direction and correct expiry', () => {
    const { state, entry } = knockProp(createPropsState(), chair.id, [3, 5, 4], 1000)
    expect(entry).toMatchObject({ id: chair.id, kind: 'chair', knockedAt: 1000, until: 21000 })
    expect(entry.dir[0]).toBeCloseTo(0.6)
    expect(entry.dir[1]).toBeCloseTo(0.8)
    expect(isKnocked(state, chair.id)).toBe(true)
    expect(propsOverlay(state).has(chair.id)).toBe(true)
  })

  it('accepts 2D direction and zero direction', () => {
    expect(knockProp({}, monId, [0, -2], 0).entry).toMatchObject({ kind: 'monitor', until: 30000, dir: [0, -1] })
    expect(knockProp({}, monId, [0, 1, 0], 0).entry.dir).toEqual([0, 0])
  })

  it('ignores unknown ids; re-knocking an already-knocked prop restarts the timer without mutating', () => {
    const s0 = createPropsState()
    expect(knockProp(s0, 'wall-a', [1, 0, 0], 0)).toEqual({ state: s0, entry: null })
    const { state: s1 } = knockProp(s0, chair.id, [1, 0, 0], 0)
    expect(s0).toEqual({})
    const again = knockProp(s1, chair.id, [0, 0, 1], 500)
    expect(again.entry).toMatchObject({ knockedAt: 500, until: 20500, dir: [0, 1], moving: true })
    expect(again.state).not.toBe(s1)
    expect(s1[chair.id].until).toBe(20000)
    expect(s1[chair.id].vz).toBe(0)
  })

  it('expires exactly at until, and nextExpiry reports the earliest', () => {
    let s = knockProp({}, chair.id, [1, 0, 0], 0).state
    s = knockProp(s, monId, [1, 0, 0], 0).state
    expect(nextExpiry(s)).toBe(20000)
    expect(expireProps(s, 19999).restored).toEqual([])
    const r = expireProps(s, 20000)
    expect(r.restored).toEqual([chair.id])
    expect(isKnocked(r.state, chair.id)).toBe(false)
    expect(isKnocked(s, chair.id)).toBe(true) // 原 state 不變
    expect(nextExpiry(r.state)).toBe(30000)
    expect(nextExpiry(expireProps(r.state, 30000).state)).toBeNull()
  })

  it('restoreProps ignores ids that are not knocked', () => {
    const s = knockProp({}, chair.id, [1, 0, 0], 0).state
    const r = restoreProps(s, ['x', chair.id, chair.id])
    expect(r.restored).toEqual([chair.id])
    expect(r.state).toEqual({})
    const none = restoreProps(r.state, ['x'])
    expect(none.state).toBe(r.state)
  })

  it('seat-based forced restore: chair + monitor, or chair only when sitting', () => {
    const seat = SEATS[0]
    expect(seatPropIds(seat.id)).toEqual([seat.chairId, `${seat.deskId}-monitor`])
    expect(seatPropIds('nope')).toEqual([])
    for (const id of seatPropIds(seat.id)) expect(isShootableProp(id)).toBe(true)
    let s = knockProp({}, seat.chairId, [1, 0, 0], 0).state
    s = knockProp(s, `${seat.deskId}-monitor`, [1, 0, 0], 0).state
    s = knockProp(s, chair.id === seat.chairId ? CHAIRS[1].id : chair.id, [1, 0, 0], 0).state
    const sit = restoreSeatProps(s, seat.id, { chairOnly: true })
    expect(sit.restored).toEqual([seat.chairId])
    const owner = restoreSeatProps(s, seat.id)
    expect(owner.restored.sort()).toEqual([seat.chairId, `${seat.deskId}-monitor`].sort())
    expect(Object.keys(owner.state)).toHaveLength(1)
  })

  it('propsSnapshot reports position, pose and remaining time', () => {
    const s = knockProp({}, chair.id, [1, 0, 0], 1000).state
    const e = s[chair.id]
    expect(propsSnapshot(s, 6000)).toEqual([
      { id: chair.id, kind: 'chair', pos: [e.x, e.y, e.z], yaw: e.yaw, tilt: e.tilt, moving: true, remainingMs: 15000 },
    ])
    expect(propsSnapshot(s, 99999)[0].remainingMs).toBe(0)
  })
})

describe('disabled collider ids in collision queries', () => {
  const c = center(chairBox)
  it('a knocked chair no longer blocks movement (Set or array)', () => {
    expect(isBlocked(c.x, c.z)).toBe(true)
    expect(isBlocked(c.x, c.z, PLAYER.radius, 0, new Set([chair.id]))).toBe(false)
    expect(isBlocked(c.x, c.z, PLAYER.radius, 0, [chair.id])).toBe(false)
    expect(isBlocked(c.x, c.z, 0.05)).toBe(true)
    expect(isBlocked(c.x, c.z, 0.05, 0, [chair.id])).toBe(false)
  })

  it('moveCircle passes through a knocked chair but not a present one', () => {
    const start = { x: chairBox.max[0] + 0.05 + 0.06, z: c.z }
    const dx = chairBox.max[0] - 0.1 - start.x // 終點在椅子碰撞盒內 0.1
    const r1 = moveCircle(start.x, start.z, dx, 0, 0.05, 0)
    expect(r1.x).toBeGreaterThan(chairBox.max[0])
    const r2 = moveCircle(start.x, start.z, dx, 0, 0.05, 0, new Set([chair.id]))
    expect(r2.x).toBeCloseTo(start.x + dx)
  })

  it('evaluateMove honors disabled ids', () => {
    const p = { pos: [c.x + 0.4, 0, c.z], pose: 'stand', move: createMoveBucket(0) }
    const target = [c.x, 0, c.z]
    const blocked = evaluateMove({ ...p, move: createMoveBucket(0) }, target, 1000)
    expect(blocked.ok).toBe(false)
    expect(evaluateMove(p, target, 1000, new Set([chair.id])).ok).toBe(true)
  })

  it('a knocked monitor no longer blocks the shoot origin or a player on the desk', () => {
    const m = center(monBox)
    const mid = [m.x, (monBox.min[1] + monBox.max[1]) / 2, m.z]
    expect(isShootOriginValid(mid, [m.x, 0, m.z])).toBe(false)
    expect(isShootOriginValid(mid, [m.x, 0, m.z], false, new Set([monId]))).toBe(true)
    expect(isShootOriginValid(mid, [m.x, 0, m.z], false, [monId])).toBe(true)
    expect(isBlocked(m.x, m.z, 0.05, desk.h)).toBe(true)
    expect(isBlocked(m.x, m.z, 0.05, desk.h, [monId])).toBe(false)
  })

  it('omitting / passing null / empty set keeps behavior identical', () => {
    const pts = [[c.x, c.z], [-6, 2.65], [0, 0], [-5.2, -3.9]]
    for (const [x, z] of pts) {
      for (const y of [0, 0.75]) {
        const base = isBlocked(x, z, PLAYER.radius, y)
        expect(isBlocked(x, z, PLAYER.radius, y, null)).toBe(base)
        expect(isBlocked(x, z, PLAYER.radius, y, new Set())).toBe(base)
        expect(groundHeight(x, z, y, null)).toBe(groundHeight(x, z, y))
      }
    }
    const sp = [{ x: c.x, z: c.z }, { x: -6, z: 2.65 }]
    expect(pickSpawnPoint(sp, [], null)).toEqual(pickSpawnPoint(sp, []))
  })
})

describe('pushPlayersOutOfProps', () => {
  const c = center(chairBox)
  it('pushes a player standing where the chair returns to a free spot', () => {
    const players = [
      { id: 'a', pos: [c.x, 0, c.z], pose: 'stand' },
      { id: 'b', pos: [-6, 0, 2.65], pose: 'stand' }, // 遠處,不動
    ]
    const out = pushPlayersOutOfProps([chair.id], players)
    expect(out).toHaveLength(1)
    expect(out[0].id).toBe('a')
    const [x, y, z] = out[0].pos
    expect(isBlocked(x, z, PLAYER.radius, y)).toBe(false)
    expect(Math.hypot(x - c.x, z - c.z)).toBeLessThan(2)
  })

  it('pushes a player overlapping the chair edge only a little', () => {
    const out = pushPlayersOutOfProps([chair.id], [{ id: 'a', pos: [chairBox.max[0] + PLAYER.radius - 0.05, 0, c.z] }])
    expect(out).toHaveLength(1)
    expect(isBlocked(out[0].pos[0], out[0].pos[2], PLAYER.radius, out[0].pos[1])).toBe(false)
  })

  it('skips seated players and players not overlapping', () => {
    expect(pushPlayersOutOfProps([chair.id], [{ id: 'a', pos: [c.x, 0, c.z], pose: 'sit' }])).toEqual([])
    expect(pushPlayersOutOfProps([chair.id], [{ id: 'a', pos: [c.x, 0, c.z + 5], pose: 'stand' }])).toEqual([])
    // 高於椅背(1.15m)不算重疊
    expect(pushPlayersOutOfProps([chair.id], [{ id: 'a', pos: [c.x, 1.2, c.z], pose: 'stand' }])).toEqual([])
    expect(pushPlayersOutOfProps([], [{ id: 'a', pos: [c.x, 0, c.z] }])).toEqual([])
    expect(pushPlayersOutOfProps(['bogus'], [{ id: 'a', pos: [c.x, 0, c.z] }])).toEqual([])
  })

  it('a monitor only pushes players standing on the desk, not on the floor beside it', () => {
    const m = center(monBox)
    // 站在地上、桌邊的人碰不到螢幕
    const fp = COLLIDERS.find((b) => b.id === desk.id)
    expect(pushPlayersOutOfProps([monId], [{ id: 'a', pos: [fp.max[0] + PLAYER.radius + 0.01, 0, m.z] }])).toEqual([])
    const out = pushPlayersOutOfProps([monId], [{ id: 'a', pos: [m.x, desk.h, m.z] }])
    expect(out).toHaveLength(1)
    const [x, y, z] = out[0].pos
    expect(isBlocked(x, z, PLAYER.radius, y)).toBe(false)
    expect(y).toBeLessThanOrEqual(desk.h)
  })

  it('treats still-knocked props as absent when finding the pushed position', () => {
    const other = CHAIRS.find((ch) => ch.id !== chair.id)
    const out = pushPlayersOutOfProps([chair.id], [{ id: 'a', pos: [c.x, 0, c.z] }], new Set([other.id]))
    expect(out).toHaveLength(1)
    expect(isBlocked(out[0].pos[0], out[0].pos[2], PLAYER.radius, out[0].pos[1], [other.id])).toBe(false)
  })
})
