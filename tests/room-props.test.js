// Room 整合測試:椅子 / 螢幕被射飛(伺服器物理)、再射、到期回復、座位強制回復、推開玩家、快照與 welcome 帶狀態、狗避開物品。
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

vi.mock('cloudflare:workers', () => ({
  DurableObject: class {
    constructor(ctx, env) {
      this.ctx = ctx
      this.env = env
    }
  },
}))

const { Room } = await import('../worker/Room.js')
const { S2C, parseServerMessage } = await import('../shared/protocol.js')
const { COLLIDERS, PLAYER, seatById, seatSpot } = await import('../shared/layout.js')
const { standUpSpot, isBlocked } = await import('../shared/collision.js')
const { knockProp, monitorPropId, propById, propBox, propsOverlay, propsRaycastBoxes, PROP_PHYSICS } = await import('../shared/props.js')
const { raycastWorld } = await import('../shared/raycast.js')
const { DOG_RADIUS } = await import('../worker/dog.js')
const { createLimiter, isStaleDropState, setDropGuard, DROP_GUARD_MS } = await import('../worker/rules.js')

const boxById = (id) => COLLIDERS.find((b) => b.id === id)
const center = (b) => [(b.min[0] + b.max[0]) / 2, (b.min[1] + b.max[1]) / 2, (b.min[2] + b.max[2]) / 2]

const makeRoom = () =>
  new Room(
    {
      blockConcurrencyWhile: (fn) => fn(),
      storage: { get: async () => null, put: async () => {} },
    },
    {},
  )

let nextSid = 1
const makeSession = () => {
  const sent = []
  return {
    id: `s${nextSid++}`,
    ws: { sent, send: (d) => sent.push(JSON.parse(d)), close: () => {} },
    ip: '1.2.3.4',
    joined: false,
    lastMessageAt: Date.now(),
    chatTimes: [],
    lastShoot: 0,
    lastCorrect: 0,
    msgLimiter: createLimiter(),
    stateLimiter: createLimiter(),
    joinTimer: null,
  }
}

const join = (room, msg) => {
  const s = makeSession()
  room.sessions.add(s)
  room.onJoin(s, msg)
  return s
}
const ofType = (s, type) => s.ws.sent.filter((m) => m.type === type)

// 從 from([x,z])的站姿眼高射向 target([x,y,z])
const shootAt = (room, p, target) => {
  const origin = [p.pos[0], (p.pos[1] || 0) + PLAYER.eyeHeight.stand, p.pos[2]]
  const dir = target.map((v, i) => v - origin[i])
  const len = Math.hypot(...dir)
  room.onShoot(p, { origin, dir: dir.map((v) => v / len) }, Date.now())
  p.lastShoot = 0 // 測試中不受冷卻影響
}

const PROP_KEYS = ['id', 'kind', 'pos', 'yaw', 'tilt', 'moving', 'remainingMs']

// seat-1:沒有名字的座位(不會有離線人偶坐在椅子上)
const SEAT = seatById('seat-1')
const CHAIR = SEAT.chairId
const MONITOR = monitorPropId(SEAT.deskId)

describe('Room shootable props', () => {
  let room
  beforeEach(() => {
    vi.useFakeTimers({ now: 1_000_000 })
    room = makeRoom()
  })
  afterEach(() => {
    room.stopTimer()
    vi.useRealTimers()
  })

  const guestNear = (seatId, name = 'Guest') => {
    const g = join(room, { type: 'join', name })
    const spot = standUpSpot(seatId)
    g.pos = [spot.x, 0, spot.z]
    return g
  }

  // 站在 seat-1 椅子側面的走道,讓椅子沿走道滑出去而不是直接撞桌子
  const sideShooter = (name = 'A') => {
    const g = join(room, { type: 'join', name })
    const c = center(boxById(CHAIR))
    g.pos = [c[0] + 0.85, 0, c[2] + 0.35]
    return g
  }

  // 把玩家移到能直接射中 target 的位置(射線第一個命中的就是椅子);找不到回 false
  const placeWithClearShot = (p, target) => {
    const ov = propsOverlay(room.props)
    for (const dist of [1.2, 1.6, 2.0]) {
      for (let i = 0; i < 16; i++) {
        const ang = (i / 16) * Math.PI * 2
        const x = target[0] + Math.cos(ang) * dist
        const z = target[2] + Math.sin(ang) * dist
        if (isBlocked(x, z, PLAYER.radius, 0, ov)) continue
        const origin = [x, PLAYER.eyeHeight.stand, z]
        const d = target.map((v, k) => v - origin[k])
        const len = Math.hypot(...d)
        const hit = raycastWorld(origin, d.map((v) => v / len), { boxes: propsRaycastBoxes(ov), maxDist: 25 })
        if (hit?.kind === 'box' && hit.boxId === CHAIR) {
          p.pos = [x, 0, z]
          return true
        }
      }
    }
    return false
  }

  it('shooting a chair knocks it and every client receives prop_knock', () => {
    const a = guestNear(SEAT.id, 'A')
    const b = join(room, { type: 'join', name: 'B' })
    shootAt(room, a, center(boxById(CHAIR)))
    for (const s of [a, b]) {
      const [ev] = ofType(s, S2C.PROP_KNOCK)
      expect(ev).toMatchObject({ from: a.id, prop: { id: CHAIR, kind: 'chair', remainingMs: 20000, moving: true, tilt: 0 } })
      expect(Object.keys(ev.prop).sort()).toEqual([...PROP_KEYS].sort())
      const h = propById(CHAIR).home
      expect(ev.prop.pos).toEqual([h.x, h.y, h.z].map((v) => Math.round(v * 1000) / 1000))
      expect(parseServerMessage(JSON.stringify(ev)).ok).toBe(true)
    }
    expect(Object.keys(room.props)).toEqual([CHAIR])
    // 不產生漆彈斑點
    expect(ofType(b, S2C.PAINT)).toHaveLength(0)
  })

  it('the chair slides, settles away from home and the snapshots follow it', () => {
    const a = sideShooter()
    shootAt(room, a, center(boxById(CHAIR)))
    vi.advanceTimersByTime(100)
    const moving = ofType(a, S2C.SNAPSHOT).at(-1).props
    expect(moving).toHaveLength(1)
    expect(moving[0].moving).toBe(true)
    vi.advanceTimersByTime(5000)
    const [p] = ofType(a, S2C.SNAPSHOT).at(-1).props
    const h = propById(CHAIR).home
    expect(p.moving).toBe(false)
    expect(p.tilt).toBeCloseTo(PROP_PHYSICS.chair.fallenTilt, 2)
    expect(Math.hypot(p.pos[0] - h.x, p.pos[2] - h.z)).toBeGreaterThan(0.3)
    expect(p.pos[0]).toBeCloseTo(room.props[CHAIR].x, 2)
    // 停下後不再模擬:狀態物件不變
    const s = room.props
    vi.advanceTimersByTime(500)
    expect(room.props).toBe(s)
  })

  it('a settled chair blocks rays at its new spot and can be shot again (resets the timer)', () => {
    const a = sideShooter()
    shootAt(room, a, center(boxById(CHAIR)))
    vi.advanceTimersByTime(5000)
    const before = { ...room.props[CHAIR] }
    // 原位已空:往原位射不會再射中
    shootAt(room, a, center(boxById(CHAIR)))
    expect(ofType(a, S2C.PROP_KNOCK)).toHaveLength(1)
    // 射新位置:再動一次並重新計時
    const target = center(propBox(room.props[CHAIR]))
    expect(placeWithClearShot(a, target)).toBe(true)
    shootAt(room, a, target)
    const knocks = ofType(a, S2C.PROP_KNOCK)
    expect(knocks).toHaveLength(2)
    expect(knocks[1].prop).toMatchObject({ id: CHAIR, moving: true, remainingMs: 20000 })
    expect(room.props[CHAIR].until).toBe(Date.now() + 20000)
    vi.advanceTimersByTime(3500)
    const after = room.props[CHAIR]
    expect(after.moving).toBe(false)
    expect(Math.hypot(after.x - before.x, after.z - before.z)).toBeGreaterThan(0.1)
    // 從第二次射中算 20 秒才回復
    vi.advanceTimersByTime(16_400)
    expect(room.props[CHAIR]).toBeTruthy()
    vi.advanceTimersByTime(200)
    expect(room.props[CHAIR]).toBeUndefined()
  })

  it('a settled chair blocks players walking into it', () => {
    const a = sideShooter()
    shootAt(room, a, center(boxById(CHAIR)))
    vi.advanceTimersByTime(5000)
    const e = room.props[CHAIR]
    // 站在倒下椅子旁邊、再往椅子中心走
    const r = PROP_PHYSICS.chair.boxHalf + PLAYER.radius + 0.05
    const start = [[r, 0], [-r, 0], [0, r], [0, -r]]
      .map(([dx, dz]) => [e.x + dx, 0, e.z + dz])
      .find((p) => !isBlocked(p[0], p[2], PLAYER.radius, 0, propsOverlay(room.props)))
    expect(start).toBeTruthy()
    a.pos = start
    vi.advanceTimersByTime(100)
    room.onState(a, { type: 'state', pos: [e.x, 0, e.z], yaw: 0, pitch: 0, pose: 'stand' }, Date.now())
    expect(a.pos).toEqual(start)
    expect(ofType(a, S2C.CORRECT)).toHaveLength(1)
  })

  it('a moving chair stops at a player instead of passing through', () => {
    const a = sideShooter()
    const c = center(boxById(CHAIR))
    a.pos = [c[0] + 1.0, 0, c[2]] // 沿走道往 -x 射
    const dir = [c[0] - a.pos[0], c[2] - a.pos[2]]
    const len = Math.hypot(...dir)
    const b = join(room, { type: 'join', name: 'B' })
    // B 站在椅子後方 0.9m(射線方向),在椅子之後不擋射線
    b.pos = [c[0] + (dir[0] / len) * 0.9, 0, c[2] + (dir[1] / len) * 0.9]
    expect(isBlocked(b.pos[0], b.pos[2], PLAYER.radius, 0)).toBe(false)
    shootAt(room, a, c)
    expect(ofType(a, S2C.PROP_KNOCK)).toHaveLength(1)
    vi.advanceTimersByTime(5000)
    const e = room.props[CHAIR]
    expect(e.moving).toBe(false)
    expect(isBlocked(b.pos[0], b.pos[2], PLAYER.radius - 0.02, 0, propsOverlay(room.props))).toBe(false)
  })

  it('monitor can be knocked and comes back after 30s; chair after 20s', () => {
    const a = guestNear(SEAT.id, 'A')
    shootAt(room, a, center(boxById(MONITOR)))
    expect(ofType(a, S2C.PROP_KNOCK)[0].prop).toMatchObject({ id: MONITOR, kind: 'monitor', remainingMs: 30000 })
    shootAt(room, a, center(boxById(CHAIR)))
    expect(Object.keys(room.props).sort()).toEqual([CHAIR, MONITOR].sort())

    vi.advanceTimersByTime(19_900)
    expect(ofType(a, S2C.PROP_RESTORE)).toHaveLength(0)
    vi.advanceTimersByTime(200)
    expect(ofType(a, S2C.PROP_RESTORE).map((m) => m.ids)).toEqual([[CHAIR]])
    vi.advanceTimersByTime(9_800)
    expect(ofType(a, S2C.PROP_RESTORE)).toHaveLength(1)
    vi.advanceTimersByTime(200)
    expect(ofType(a, S2C.PROP_RESTORE).map((m) => m.ids)).toEqual([[CHAIR], [MONITOR]])
    expect(room.props).toEqual({})
  })

  it('a chair with someone (or an offline doll) sitting on it cannot be knocked', () => {
    // seat-will 的主人不在線 → 椅子上有人偶
    const willSeat = seatById('seat-will')
    const a = guestNear(willSeat.id, 'A')
    shootAt(room, a, center(boxById(willSeat.chairId)))
    expect(ofType(a, S2C.PROP_KNOCK)).toHaveLength(0)
    expect(room.props).toEqual({})
  })

  it('a chair with an online player sitting on it cannot be knocked', () => {
    const will = seatById('seat-will')
    const owner = join(room, { type: 'join', name: 'x', seatId: will.id })
    const s = seatSpot(will.id)
    vi.advanceTimersByTime(100)
    room.onState(owner, { type: 'state', pos: [s.x, 0, s.z], yaw: s.yaw, pitch: 0, pose: 'sit' }, Date.now())
    expect(owner.pose).toBe('sit')
    const a = guestNear(will.id, 'A')
    const b = boxById(will.chairId)
    shootAt(room, a, [center(b)[0], b.min[1] + 0.2, center(b)[2]])
    expect(ofType(a, S2C.PROP_KNOCK)).toHaveLength(0)
    expect(room.props).toEqual({})
  })

  it('snapshots and welcome carry the full prop state for late joiners', () => {
    const a = sideShooter()
    shootAt(room, a, center(boxById(CHAIR)))
    vi.advanceTimersByTime(5000)
    const snap = ofType(a, S2C.SNAPSHOT).at(-1)
    expect(snap.props).toEqual([expect.objectContaining({ id: CHAIR, kind: 'chair', moving: false })])
    expect(snap.props[0].remainingMs).toBeLessThanOrEqual(15000)
    expect(parseServerMessage(JSON.stringify(snap)).msg.props).toEqual(snap.props)
    const late = join(room, { type: 'join', name: 'Late' })
    const [welcome] = ofType(late, S2C.WELCOME)
    const e = room.props[CHAIR]
    expect(welcome.props).toHaveLength(1)
    expect(welcome.props[0]).toMatchObject({ id: CHAIR, kind: 'chair', moving: false, remainingMs: 15000 })
    welcome.props[0].pos.forEach((v, i) => expect(v).toBeCloseTo([e.x, e.y, e.z][i], 3))
    expect(welcome.props[0].yaw).toBeCloseTo(e.yaw, 3)
    expect(welcome.props[0].tilt).toBeCloseTo(e.tilt, 3)
  })

  it('players can walk into the home spot of a knocked chair (no correction)', () => {
    const a = sideShooter()
    shootAt(room, a, center(boxById(CHAIR)))
    const c = center(boxById(CHAIR))
    vi.advanceTimersByTime(5000)
    expect(isBlocked(c[0], c[2], PLAYER.radius, 0, propsOverlay(room.props))).toBe(false)
    room.onState(a, { type: 'state', pos: [c[0], 0, c[2]], yaw: 0, pitch: 0, pose: 'stand' }, Date.now())
    expect(a.pos[0]).toBeCloseTo(c[0])
    expect(a.pos[2]).toBeCloseTo(c[2])
    expect(ofType(a, S2C.CORRECT)).toHaveLength(0)
  })

  it('on restore, a player standing in the chair spot is pushed out and corrected', () => {
    const a = guestNear(SEAT.id, 'A')
    shootAt(room, a, center(boxById(CHAIR)))
    const c = center(boxById(CHAIR))
    a.pos = [c[0], 0, c[2]]
    vi.advanceTimersByTime(20_100)
    const [corr] = ofType(a, S2C.CORRECT)
    expect(corr).toBeTruthy()
    expect(corr.pos).toEqual(a.pos)
    expect(isBlocked(a.pos[0], a.pos[2], PLAYER.radius, a.pos[1])).toBe(false)
  })

  it('seat owner joining restores their chair and monitor immediately', () => {
    const will = seatById('seat-will')
    const other = join(room, { type: 'join', name: 'Other' })
    room.props = knockProp(knockProp({}, will.chairId, [1, 0, 0], Date.now()).state, monitorPropId(will.deskId), [1, 0, 0], Date.now()).state
    const w = join(room, { type: 'join', name: 'x', seatId: will.id })
    expect(room.props).toEqual({})
    expect(ofType(other, S2C.PROP_RESTORE)[0].ids.sort()).toEqual([will.chairId, monitorPropId(will.deskId)].sort())
    expect(ofType(w, S2C.WELCOME)[0].props).toEqual([])
  })

  it('seat owner leaving restores their chair and monitor immediately', () => {
    const will = seatById('seat-will')
    const w = join(room, { type: 'join', name: 'x', seatId: will.id })
    const other = join(room, { type: 'join', name: 'Other' })
    // 主人在線且站著:他的椅子可以被射
    const spot = standUpSpot(will.id)
    other.pos = [spot.x, 0, spot.z]
    w.pos = [spot.x + 3, 0, spot.z + 3] // 主人走開,不擋射線
    shootAt(room, other, center(boxById(will.chairId)))
    expect(Object.keys(room.props)).toEqual([will.chairId])
    room.onLeave(w)
    expect(room.props).toEqual({})
    expect(ofType(other, S2C.PROP_RESTORE).at(-1).ids).toEqual([will.chairId])
  })

  it('sitting down restores only the chair, not the monitor', () => {
    const will = seatById('seat-will')
    const w = join(room, { type: 'join', name: 'x', seatId: will.id })
    const mon = monitorPropId(will.deskId)
    room.props = knockProp(knockProp({}, will.chairId, [1, 0, 0], Date.now()).state, mon, [1, 0, 0], Date.now()).state
    const s = seatSpot(will.id)
    vi.advanceTimersByTime(100)
    room.onState(w, { type: 'state', pos: [s.x, 0, s.z], yaw: s.yaw, pitch: 0, pose: 'sit' }, Date.now())
    expect(w.pose).toBe('sit')
    expect(Object.keys(room.props)).toEqual([mon])
    expect(ofType(w, S2C.PROP_RESTORE).at(-1).ids).toEqual([will.chairId])
    // 坐下的人本身不會被推開
    expect(ofType(w, S2C.CORRECT)).toHaveLength(0)
  })

  it('the dog is pushed out of / does not walk through a knocked prop', () => {
    const a = join(room, { type: 'join', name: 'A' })
    a.pos = [0, 0, 6] // 不擋路
    // 把一張倒下的椅子直接放在狗身上
    const base = knockProp({}, CHAIR, [1, 0, 0], Date.now()).state
    const e = { ...base[CHAIR], x: room.dog.x, z: room.dog.z, y: 0, vx: 0, vz: 0, vy: 0, spin: 0, moving: false, tilt: PROP_PHYSICS.chair.fallenTilt }
    room.props = { [CHAIR]: e }
    for (let i = 0; i < 100; i++) {
      vi.advanceTimersByTime(50)
      expect(isBlocked(room.dog.x, room.dog.z, DOG_RADIUS - 0.01, 0, propsOverlay(room.props))).toBe(false)
    }
  })

  it('a monitor is knocked by a shot that grazes past its edge (enlarged hit box)', () => {
    const a = guestNear(SEAT.id, 'A')
    const mb = boxById(MONITOR)
    const c = center(mb)
    // 瞄準螢幕右緣外 8 公分(原本的碰撞盒射不中)
    const target = [mb.max[0] + 0.08, c[1], c[2]]
    const origin = [a.pos[0], PLAYER.eyeHeight.stand, a.pos[2]]
    const d = target.map((v, i) => v - origin[i])
    const len = Math.hypot(...d)
    expect(raycastWorld(origin, d.map((v) => v / len), { boxes: COLLIDERS, maxDist: 25 })?.boxId).not.toBe(MONITOR)
    shootAt(room, a, target)
    expect(ofType(a, S2C.PROP_KNOCK)[0]?.prop).toMatchObject({ id: MONITOR, kind: 'monitor' })
  })

  it('reception chairs can be knocked (no seat), slide, fall and come back after 20s', () => {
    const id = 'reception-chair-w'
    const a = join(room, { type: 'join', name: 'A' })
    const c = center(boxById(id))
    a.pos = [c[0], 0, 4.3]
    shootAt(room, a, c)
    const [ev] = ofType(a, S2C.PROP_KNOCK)
    expect(ev.prop).toMatchObject({ id, kind: 'chair', remainingMs: 20000, moving: true })
    expect(parseServerMessage(JSON.stringify(ev)).ok).toBe(true)
    vi.advanceTimersByTime(5000)
    const e = room.props[id]
    expect(e.moving).toBe(false)
    expect(e.tilt).toBe(PROP_PHYSICS.chair.fallenTilt)
    expect(e.z).toBeGreaterThan(c[2] + 0.05)
    vi.advanceTimersByTime(15_100)
    expect(room.props[id]).toBeUndefined()
    expect(ofType(a, S2C.PROP_RESTORE).at(-1).ids).toEqual([id])
  })

  it('the round table is knocked as kind table, slides a little, lies on its side and restores after 30s, pushing players out', () => {
    const id = 'round-table'
    const tb = boxById(id)
    const c = center(tb)
    const a = join(room, { type: 'join', name: 'A' })
    const b = join(room, { type: 'join', name: 'B' })
    a.pos = [c[0], 0, 4.2]
    b.pos = [4, 0, 1] // 遠處
    shootAt(room, a, [c[0], 0.3, tb.min[2]])
    const [ev] = ofType(b, S2C.PROP_KNOCK)
    expect(ev.prop).toMatchObject({ id, kind: 'table', remainingMs: 30000, moving: true, tilt: 0 })
    expect(parseServerMessage(JSON.stringify(ev)).ok).toBe(true)
    vi.advanceTimersByTime(5000)
    const e = room.props[id]
    expect(e.moving).toBe(false)
    expect(e.tilt).toBe(PROP_PHYSICS.table.fallenTilt)
    const moved = Math.hypot(e.x - c[0], e.z - c[2])
    expect(moved).toBeGreaterThan(0.1)
    expect(moved).toBeLessThan(1.0)
    const snap = ofType(b, S2C.SNAPSHOT).at(-1)
    expect(snap.props).toEqual([expect.objectContaining({ id, kind: 'table', moving: false })])
    expect(parseServerMessage(JSON.stringify(snap)).msg.props).toEqual(snap.props)
    // B 站在桌子原位範圍內的地板上(桌子回復時要被推開)
    b.pos = [c[0] - 0.35, 0, c[2] - 0.35]
    expect(isBlocked(b.pos[0], b.pos[2], PLAYER.radius, 0)).toBe(true)
    vi.advanceTimersByTime(24_900)
    expect(room.props[id]).toBeTruthy() // 30 秒才回復
    vi.advanceTimersByTime(200)
    expect(room.props[id]).toBeUndefined()
    expect(ofType(b, S2C.PROP_RESTORE).at(-1).ids).toEqual([id])
    const [corr] = ofType(b, S2C.CORRECT)
    expect(corr.pos).toEqual(b.pos)
    expect(isBlocked(b.pos[0], b.pos[2], PLAYER.radius, b.pos[1] || 0)).toBe(false)
  })

  it('a player standing on the round table drops to the floor when it is shot, and is not stuck', () => {
    const id = 'round-table'
    const tb = boxById(id)
    const c = center(tb)
    const a = join(room, { type: 'join', name: 'A' })
    const b = join(room, { type: 'join', name: 'B' })
    a.pos = [c[0], 0, 4.2]
    b.pos = [c[0] + 0.1, tb.max[1], c[2] + 0.2] // 站在桌面上
    shootAt(room, a, [c[0], 0.3, tb.min[2]])
    expect(ofType(a, S2C.PROP_KNOCK)).toHaveLength(1)
    const [corr] = ofType(b, S2C.CORRECT)
    expect(corr).toBeTruthy()
    expect(corr.pos[1]).toBe(0)
    expect(b.pos).toEqual(corr.pos)
    expect(ofType(a, S2C.CORRECT)).toHaveLength(0) // 站在地上的射擊者不動
    // 落點不在桌子(移動中的盒)裡,桌子模擬期間也不會撞進 B
    for (let i = 0; i < 60; i++) {
      vi.advanceTimersByTime(50)
      expect(isBlocked(b.pos[0], b.pos[2], PLAYER.radius - 0.02, 0, propsOverlay(room.props))).toBe(false)
    }
    expect(room.props[id].moving).toBe(false)
    // 可以正常走動(伺服器接受,不被拉回)
    const before = ofType(b, S2C.CORRECT).length
    const dir = [b.pos[0] - room.props[id].x, b.pos[2] - room.props[id].z]
    const len = Math.hypot(...dir)
    const next = [b.pos[0] + (dir[0] / len) * 0.3, 0, b.pos[2] + (dir[1] / len) * 0.3]
    expect(isBlocked(next[0], next[2], PLAYER.radius, 0, propsOverlay(room.props))).toBe(false)
    room.onState(b, { type: 'state', pos: next, yaw: 0, pitch: 0, pose: 'stand' }, Date.now())
    expect(b.pos).toEqual(next)
    expect(ofType(b, S2C.CORRECT)).toHaveLength(before)
  })

  it('after being dropped off the table, stale on-table states are ignored for DROP_GUARD_MS (no CORRECT spam)', () => {
    const id = 'round-table'
    const tb = boxById(id)
    const c = center(tb)
    const a = join(room, { type: 'join', name: 'A' })
    const b = join(room, { type: 'join', name: 'B' })
    a.pos = [c[0], 0, 4.2]
    const onTable = [c[0] + 0.1, tb.max[1], c[2] + 0.2]
    b.pos = [...onTable]
    shootAt(room, a, [c[0], 0.3, tb.min[2]])
    const dropped = [...b.pos]
    expect(dropped[1]).toBe(0)
    const corrections = ofType(b, S2C.CORRECT).length
    const t0 = Date.now()
    // 客戶端收到 CORRECT 前送的舊 state(還在桌上):忽略,不送 CORRECT
    vi.advanceTimersByTime(20)
    room.onState(b, { type: 'state', pos: onTable, yaw: 0, pitch: 0, pose: 'stand' }, t0 + 20)
    room.onState(b, { type: 'state', pos: [onTable[0] + 0.05, tb.max[1] + 0.3, onTable[2]], yaw: 0, pitch: 0, pose: 'stand' }, t0 + 120)
    expect(b.pos).toEqual(dropped)
    expect(ofType(b, S2C.CORRECT)).toHaveLength(corrections)
    // 桌子不會因為 B 被放回桌上而提早停
    expect(room.props[id].moving).toBe(true)
    // 保護期內在地板上的 state(收到 CORRECT 之後)照常接受
    const floor = [dropped[0], 0, dropped[2]]
    room.onState(b, { type: 'state', pos: floor, yaw: 0, pitch: 0, pose: 'stand' }, t0 + 150)
    expect(b.pos).toEqual(floor)
    // 保護期過後不再忽略(走一般規則)
    expect(isStaleDropState(b, { pos: onTable }, t0 + DROP_GUARD_MS)).toBe(false)
    expect(b.dropGuard).toBeNull()
  })

  it('isStaleDropState only rejects y > 0 positions over the dropped prop', () => {
    const tb = boxById('round-table')
    const p = {}
    expect(isStaleDropState(p, { pos: [0, 1, 0] }, 0)).toBe(false) // 沒有保護期
    setDropGuard(p, tb, 1000)
    const c = center(tb)
    expect(isStaleDropState(p, { pos: [c[0], tb.max[1], c[2]] }, 1100)).toBe(true)
    expect(isStaleDropState(p, { pos: [tb.max[0] + PLAYER.radius - 0.01, 0.5, c[2]] }, 1100)).toBe(true) // 邊緣(含玩家半徑)
    expect(isStaleDropState(p, { pos: [c[0], 0, c[2]] }, 1100)).toBe(false) // 地板
    expect(isStaleDropState(p, { pos: [tb.max[0] + PLAYER.radius + 0.05, 0.75, c[2]] }, 1100)).toBe(false) // 範圍外
    expect(isStaleDropState(p, { pos: [c[0], tb.max[1], c[2]] }, 1000 + DROP_GUARD_MS)).toBe(false) // 過期
    expect(p.dropGuard).toBeNull()
  })

  it('a shot fired with the muzzle inside an enlarged monitor box (but not the monitor) is not swallowed by it', () => {
    const mb = boxById(MONITOR)
    const mc = center(mb)
    const a = join(room, { type: 'join', name: 'A' })
    const b = join(room, { type: 'join', name: 'B' })
    // A 趴在桌前,槍口在螢幕前方 6 公分(放大盒內、真實螢幕外);B 站在椅子後方走道,A 回頭射 B 的頭(越過椅背)
    a.pos = [mc[0], 0, mb.max[2] + 0.45]
    const origin = [mc[0], mc[1], mb.max[2] + 0.06]
    expect(origin[2]).toBeLessThan(mb.max[2] + 0.12)
    b.pos = [mc[0], 0, -1.5]
    const target = [mc[0], 1.6, -1.5]
    const d = target.map((v, i) => v - origin[i])
    const len = Math.hypot(...d)
    room.onShoot(a, { origin, dir: d.map((v) => v / len) }, Date.now())
    expect(room.props[MONITOR]).toBeUndefined()
    const [paint] = ofType(b, S2C.PAINT)
    expect(paint).toMatchObject({ from: a.id, targetId: b.id })
  })

  it('room emptying clears knocked props', () => {
    const a = guestNear(SEAT.id, 'A')
    shootAt(room, a, center(boxById(CHAIR)))
    room.onLeave(a)
    expect(room.props).toEqual({})
  })
})

describe('protocol: prop messages', () => {
  const parse = (o) => parseServerMessage(JSON.stringify(o))
  const prop = { id: 'chair-will', kind: 'chair', pos: [1, 0, 2], yaw: 0.5, tilt: 1.2, moving: false, remainingMs: 1000 }
  it('accepts well-formed prop_knock / prop_restore', () => {
    expect(parse({ type: S2C.PROP_KNOCK, from: '1', prop }).ok).toBe(true)
    expect(parse({ type: S2C.PROP_KNOCK, from: '1', prop: { ...prop, id: 'round-table', kind: 'table' } }).ok).toBe(true)
    expect(parse({ type: S2C.SNAPSHOT, players: [], props: [{ ...prop, id: 'round-table', kind: 'table' }] }).msg.props).toHaveLength(1)
    expect(parse({ type: S2C.PROP_RESTORE, ids: ['chair-will'] }).ok).toBe(true)
  })
  it('rejects malformed prop messages', () => {
    const bad = [
      { ...prop, kind: 'sofa' },
      { ...prop, id: '' },
      { ...prop, id: 'x'.repeat(65) },
      { ...prop, pos: [1, 0] },
      { ...prop, pos: [1, 0, 1e9] },
      { ...prop, pos: [1, 'a', 0] },
      { ...prop, yaw: null },
      { ...prop, tilt: 10 },
      { ...prop, moving: 'yes' },
      { ...prop, remainingMs: -1 },
      { ...prop, remainingMs: undefined },
      [prop],
      null,
    ]
    for (const p of bad) expect(parse({ type: S2C.PROP_KNOCK, from: '1', prop: p }).ok).toBe(false)
    expect(parse({ type: S2C.PROP_RESTORE, ids: [1] }).ok).toBe(false)
  })
  it('drops a malformed props field from snapshots without rejecting them', () => {
    const r = parse({ type: S2C.SNAPSHOT, players: [], props: [{ id: 3 }] })
    expect(r.ok).toBe(true)
    expect(r.msg.props).toBeUndefined()
    expect(parse({ type: S2C.SNAPSHOT, players: [], props: [prop] }).msg.props).toEqual([prop])
    // 舊格式(dir)也只丟掉 props
    const old = parse({ type: S2C.WELCOME, id: '1', players: [], props: [{ id: 'chair-will', kind: 'chair', remainingMs: 1, dir: [1, 0] }] })
    expect(old.ok).toBe(true)
    expect(old.msg.props).toBeUndefined()
    // 過長的清單整個丟掉
    const many = parse({ type: S2C.SNAPSHOT, players: [], props: Array.from({ length: 300 }, () => prop) })
    expect(many.msg.props).toBeUndefined()
  })
})
