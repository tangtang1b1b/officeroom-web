import { describe, it, expect } from 'vitest'
import {
  createLimiter,
  rateAllow,
  cooldownReady,
  createMoveBucket,
  evaluateMove,
  pickSpawnPoint,
  isShootOriginValid,
  spawnYaw,
  isOriginAllowed,
  parseAllowedOrigins,
  STATE_MAX_PER_SEC,
  MESSAGE_MAX_PER_SEC,
  CHAT_MAX_PER_WINDOW,
  SHOOT_COOLDOWN_MS,
  MOVE_BUDGET_CAP,
  checkAdmission,
  isIdle,
  MAX_CONNECTIONS,
  MAX_CONNECTIONS_PER_IP,
  MAX_UNJOINED,
  IDLE_TIMEOUT_MS,
} from '../worker/rules.js'
import { isBlocked } from '../shared/collision.js'
import { COLLIDERS, ROOM, PLAYER, SPAWN_POINTS } from '../shared/layout.js'

const player = (pose = 'stand', pos = [-6, 0, -1.2], t = 0) => ({ pos, pose, move: createMoveBucket(t) })

describe('token bucket movement', () => {
  it('allows legitimate walking speed over time', () => {
    const p = player()
    let t = 0
    for (let i = 0; i < 40; i++) {
      t += 50
      const r = evaluateMove(p, [p.pos[0] + PLAYER.walkSpeed.stand * 0.05, 0, -1.2], t)
      expect(r.ok).toBe(true)
      p.pos = r.pos
    }
  })
  it('rejects teleport beyond budget cap', () => {
    const p = player()
    const r = evaluateMove(p, [-6 + MOVE_BUDGET_CAP + 0.5, 0, -1.2], 1000)
    expect(r).toEqual({ ok: false, reason: 'speed' })
  })
  it('does not allow sustained speeding via many small steps', () => {
    const p = player('stand')
    let t = 0
    let rejected = 0
    for (let i = 0; i < 100; i++) {
      t += 50
      const r = evaluateMove(p, [p.pos[0] + 0.3, 0, -1.2], t) // 6 m/s
      if (r.ok) p.pos = r.pos
      else rejected++
      if (p.pos[0] > 5) break
    }
    expect(rejected).toBeGreaterThan(0)
    // 5 秒內最多 cap + rate*5
    expect(p.pos[0] + 6).toBeLessThanOrEqual(MOVE_BUDGET_CAP + PLAYER.walkSpeed.stand * 1.3 * 5 + 1e-6)
  })
  it('uses current pose speed (prone is slow)', () => {
    const p = player('prone')
    expect(evaluateMove(p, [-6 + MOVE_BUDGET_CAP - 0.1, 0, -1.2], 1000).ok).toBe(true) // 用掉幾乎整個額度
    expect(evaluateMove(p, [-6 + MOVE_BUDGET_CAP - 0.1 + 0.5, 0, -1.2], 1100).ok).toBe(false) // 只補回約 0.1
  })
  it('rejected move does not consume budget', () => {
    const p = player()
    evaluateMove(p, [-3, 0, 2], 0)
    expect(p.move.budget).toBe(MOVE_BUDGET_CAP)
  })
  it('rejects positions inside colliders', () => {
    const desk = COLLIDERS.find((b) => b.id.startsWith('desk'))
    const cx = (desk.min[0] + desk.max[0]) / 2
    const cz = (desk.min[2] + desk.max[2]) / 2
    const p = player('stand', [cx, 0, cz - 1])
    const r = evaluateMove(p, [cx, 0, cz], 1000)
    expect(r.reason).toBe('blocked')
  })
})

describe('rate limiting', () => {
  it('state limiter drops beyond 30/s and resets next window', () => {
    const l = createLimiter()
    let ok = 0
    for (let i = 0; i < 100; i++) if (rateAllow(l, 5000 + i, STATE_MAX_PER_SEC)) ok++
    expect(ok).toBe(STATE_MAX_PER_SEC)
    expect(rateAllow(l, 6200, STATE_MAX_PER_SEC)).toBe(true)
  })
  it('message limiter', () => {
    const l = createLimiter()
    let ok = 0
    for (let i = 0; i < 200; i++) if (rateAllow(l, 1000 + (i % 500), MESSAGE_MAX_PER_SEC)) ok++
    expect(ok).toBe(MESSAGE_MAX_PER_SEC)
  })
  it('chat limiter: 3 per second', () => {
    const l = createLimiter()
    const res = [0, 100, 200, 300].map((t) => rateAllow(l, 1000 + t, CHAT_MAX_PER_WINDOW))
    expect(res).toEqual([true, true, true, false])
  })
  it('shoot cooldown', () => {
    const s = { lastShoot: 0 }
    expect(cooldownReady(s, 'lastShoot', 1000, SHOOT_COOLDOWN_MS)).toBe(true)
    expect(cooldownReady(s, 'lastShoot', 1100, SHOOT_COOLDOWN_MS)).toBe(false)
    expect(cooldownReady(s, 'lastShoot', 1000 + SHOOT_COOLDOWN_MS, SHOOT_COOLDOWN_MS)).toBe(true)
  })
})

describe('shoot origin', () => {
  const pos = [-6, 0, 2]
  it('accepts near position at stand/prone eye heights', () => {
    expect(isShootOriginValid([-6, PLAYER.eyeHeight.stand, 2.2], pos)).toBe(true)
    expect(isShootOriginValid([-6, PLAYER.eyeHeight.prone, 2], pos)).toBe(true)
    expect(isShootOriginValid([-5, PLAYER.eyeHeight.stand, 2], pos)).toBe(true) // 伺服器落後 1m
  })
  it('rejects horizontally too far', () => {
    expect(isShootOriginValid([-4, PLAYER.eyeHeight.stand, 2], pos)).toBe(false)
  })
  it('rejects y out of eye-height range', () => {
    expect(isShootOriginValid([-6, PLAYER.eyeHeight.stand + 0.5, 2], pos)).toBe(false)
    expect(isShootOriginValid([-6, 0.1, 2], pos)).toBe(false)
  })
  it('rejects origin inside a collider', () => {
    const desk = COLLIDERS.find((b) => b.id.startsWith('desk'))
    const c = desk.min.map((v, i) => (v + desk.max[i]) / 2)
    expect(isShootOriginValid(c, c)).toBe(false)
  })
  it('rejects origin outside the room', () => {
    const out = [ROOM.maxX + 0.1, PLAYER.eyeHeight.stand, 0]
    expect(isShootOriginValid(out, out)).toBe(false)
  })
})

describe('admission and idle', () => {
  const mk = (n, joined, ip) => Array.from({ length: n }, () => ({ joined, ip }))
  it('limits per-IP connections', () => {
    expect(checkAdmission(mk(MAX_CONNECTIONS_PER_IP - 1, true, 'a'), 'a')).toBe(null)
    expect(checkAdmission(mk(MAX_CONNECTIONS_PER_IP, true, 'a'), 'a')).toBe('ip limit')
    expect(checkAdmission(mk(MAX_CONNECTIONS_PER_IP, true, 'a'), 'b')).toBe(null)
  })
  it('limits unjoined connections', () => {
    const list = Array.from({ length: MAX_UNJOINED }, (_, i) => ({ joined: false, ip: 'ip' + i }))
    expect(checkAdmission(list, 'new')).toBe('too many unjoined')
    expect(checkAdmission(list.slice(1), 'new')).toBe(null)
  })
  it('limits total connections', () => {
    const list = Array.from({ length: MAX_CONNECTIONS }, (_, i) => ({ joined: true, ip: 'ip' + i }))
    expect(checkAdmission(list, 'new')).toBe('too many connections')
  })
  it('idle detection', () => {
    expect(isIdle(0, IDLE_TIMEOUT_MS)).toBe(false)
    expect(isIdle(0, IDLE_TIMEOUT_MS + 1)).toBe(true)
  })
})

describe('spawn yaw and origin check', () => {
  it('faces room center', () => {
    expect(spawnYaw(6, 0)).toBeCloseTo(Math.PI / 2)
    expect(spawnYaw(-6, 0)).toBeCloseTo(-Math.PI / 2)
    expect(spawnYaw(0, 4.2)).toBeCloseTo(0) // 在 +z,看向 -z
    expect(spawnYaw(0, -4.2)).toBeCloseTo(Math.PI)
  })
  it('origin policy', () => {
    expect(isOriginAllowed(null, 'game.example.com')).toBe(false)
    expect(isOriginAllowed(null, 'localhost:8787')).toBe(true)
    expect(isOriginAllowed('https://game.example.com', 'game.example.com')).toBe(true)
    expect(isOriginAllowed('https://evil.com', 'game.example.com')).toBe(false)
    expect(isOriginAllowed('http://localhost:3000', 'game.example.com')).toBe(false)
    expect(isOriginAllowed('http://127.0.0.1:8787', 'x.com')).toBe(false)
    expect(isOriginAllowed('http://localhost:3000', 'localhost:8787')).toBe(true)
    expect(isOriginAllowed('http://127.0.0.1:3000', '[::1]:8787')).toBe(true)
    expect(isOriginAllowed('https://evil.com', 'localhost:8787')).toBe(false)
    expect(isOriginAllowed('null', 'x.com')).toBe(false)
  })
  it('origin allowlist', () => {
    const list = ['https://my-app.vercel.app']
    const host = 'w.workers.dev'
    expect(isOriginAllowed('https://my-app.vercel.app', host, list)).toBe(true)
    expect(isOriginAllowed('https://evil.vercel.app', host, list)).toBe(false)
    expect(isOriginAllowed('https://x.my-app.vercel.app', host, list)).toBe(false)
    expect(isOriginAllowed('http://my-app.vercel.app', host, list)).toBe(false)
    expect(isOriginAllowed('https://my-app.vercel.app:8443', host, list)).toBe(false)
    expect(isOriginAllowed(null, host, list)).toBe(false)
    expect(isOriginAllowed('null', host, list)).toBe(false)
    // 清單項目含路徑或尾斜線,仍以 origin 比對
    expect(isOriginAllowed('https://my-app.vercel.app', host, ['https://my-app.vercel.app/'])).toBe(true)
    expect(isOriginAllowed('https://my-app.vercel.app', host, ['https://my-app.vercel.app/a/b'])).toBe(true)
    // 請求端 Origin 含路徑
    expect(isOriginAllowed('https://my-app.vercel.app/path/', host, list)).toBe(true)
    // 清單空 / 未提供時與先前一致
    expect(isOriginAllowed('https://my-app.vercel.app', host, [])).toBe(false)
    expect(isOriginAllowed('https://my-app.vercel.app', host)).toBe(false)
    expect(isOriginAllowed('https://w.workers.dev', host, [])).toBe(true)
    expect(isOriginAllowed('http://localhost:3000', 'localhost:8787', [])).toBe(true)
    // 清單中的無效項目不影響
    expect(isOriginAllowed('https://a.com', host, ['garbage', 'https://a.com'])).toBe(true)
  })
  it('parseAllowedOrigins', () => {
    expect(parseAllowedOrigins(undefined)).toEqual([])
    expect(parseAllowedOrigins('')).toEqual([])
    expect(parseAllowedOrigins(' , ,')).toEqual([])
    expect(parseAllowedOrigins('https://a.com')).toEqual(['https://a.com'])
    expect(parseAllowedOrigins(' https://a.com , https://b.com,, ')).toEqual([
      'https://a.com',
      'https://b.com',
    ])
  })
})

describe('collision.isBlocked', () => {
  it('blocks outside room and allows open floor', () => {
    expect(isBlocked(ROOM.maxX, 0)).toBe(true)
    expect(isBlocked(ROOM.minX + PLAYER.radius, -0.6)).toBe(false)
    expect(isBlocked(5, -8.5)).toBe(true) // 斜牆外
    expect(isBlocked(5, -6)).toBe(false) // 寬端仍有空間
    expect(isBlocked(-6, 2.65)).toBe(false)
  })
  it('blocks inside collider, free just outside radius', () => {
    const b = COLLIDERS.find((c) => c.id === 'desk-3--1')
    const cx = (b.min[0] + b.max[0]) / 2
    const cz = (b.min[2] + b.max[2]) / 2
    expect(isBlocked(cx, cz)).toBe(true)
    expect(isBlocked(b.max[0] + PLAYER.radius + 0.01, cz)).toBe(false)
    expect(isBlocked(b.max[0] + PLAYER.radius - 0.01, cz)).toBe(true)
  })
  it('custom radius', () => {
    expect(isBlocked(ROOM.maxX - 0.1, 0, 0.05)).toBe(false)
  })
})

describe('pickSpawnPoint', () => {
  it('skips candidates inside a static collider', () => {
    const b = COLLIDERS.find((c) => c.id === 'chair-0-1')
    const blocked = { x: (b.min[0] + b.max[0]) / 2, z: (b.min[2] + b.max[2]) / 2 }
    expect(pickSpawnPoint([blocked, { x: 0, z: 2.6 }], [[blocked.x, 0, blocked.z]])).toEqual({ x: 0, z: 2.6 })
  })
  it('falls back to all points when every candidate is blocked', () => {
    const b = COLLIDERS.find((c) => c.id === 'chair-0-1')
    const blocked = { x: (b.min[0] + b.max[0]) / 2, z: (b.min[2] + b.max[2]) / 2 }
    expect(pickSpawnPoint([blocked], [])).toEqual(blocked)
  })
  it('real spawn points are all walkable and the pick is the farthest', () => {
    for (const sp of SPAWN_POINTS) expect(isBlocked(sp.x, sp.z)).toBe(false)
    const sp = pickSpawnPoint(SPAWN_POINTS, [[-8, 0, 1.5]])
    expect(sp.x).toBeGreaterThan(0)
  })
})
