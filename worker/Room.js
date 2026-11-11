// 單一房間 Durable Object。
// 採用「一般 accept」而非 Hibernation API:房間狀態(位置、冷卻、20Hz 廣播計時器)都在記憶體,
// 遊戲連線期間本來就需要持續運作,Hibernation 會在閒置時清空記憶體且需另外序列化 attachment,徒增複雜度。
// 規則判斷都在 rules.js(純函式)。
import { DurableObject } from 'cloudflare:workers'
import { SPAWN_POINTS } from '../shared/layout.js'
import { MAX_PLAYERS, C2S, S2C, parseClientMessage, encode } from '../shared/protocol.js'
import { raycastWorld } from '../shared/raycast.js'
import {
  checkAdmission,
  isIdle,
  IDLE_CHECK_MS,
  JOIN_TIMEOUT_MS,
  MESSAGE_MAX_PER_SEC,
  STATE_MAX_PER_SEC,
  SHOOT_COOLDOWN_MS,
  CHAT_WINDOW_MS,
  CHAT_MAX_PER_WINDOW,
  createLimiter,
  rateAllow,
  cooldownReady,
  createMoveBucket,
  evaluateMove,
  isShootOriginValid,
  spawnYaw,
  pickSpawnPoint,
} from './rules.js'

const COLORS = ['#e6194b', '#3cb44b', '#4363d8', '#f58231', '#911eb4', '#42d4f4', '#f032e6', '#bfef45', '#fabed4', '#469990']
const BROADCAST_MS = 50
const CORRECT_MIN_INTERVAL_MS = 100
const MAX_SHOT_DIST = 25

export class Room extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env)
    this.players = new Map() // id -> player(含 ws)
    this.sessions = new Set() // 所有連線(含未 join)
    this.nextId = 1
    this.timer = null
    this.idleTimer = null
  }

  async fetch(request) {
    if (request.headers.get('Upgrade') !== 'websocket') {
      return new Response('Expected WebSocket', { status: 426 })
    }
    const ip = request.headers.get('cf-connecting-ip') || 'unknown'
    if (checkAdmission(this.sessions, ip)) return new Response('Too Many Requests', { status: 429 })
    const pair = new WebSocketPair()
    const [client, server] = Object.values(pair)
    server.accept()

    if (this.players.size >= MAX_PLAYERS) {
      server.send(encode({ type: S2C.ERROR, error: 'room full' }))
      server.close(1013, 'room full')
      return new Response(null, { status: 101, webSocket: client })
    }

    const id = String(this.nextId++)
    const session = {
      id,
      ws: server,
      ip,
      joined: false,
      lastMessageAt: Date.now(),
      chatTimes: [],
      lastShoot: 0,
      lastCorrect: 0,
      msgLimiter: createLimiter(),
      stateLimiter: createLimiter(),
      joinTimer: null,
    }
    this.sessions.add(session)
    session.joinTimer = setTimeout(() => {
      if (!session.joined) this.drop(session, 1008, 'join timeout')
    }, JOIN_TIMEOUT_MS)
    server.addEventListener('message', (e) => this.onMessage(session, e.data))
    server.addEventListener('close', () => this.onLeave(session))
    server.addEventListener('error', () => this.onLeave(session))
    return new Response(null, { status: 101, webSocket: client })
  }

  onMessage(session, raw) {
    const now = Date.now()
    session.lastMessageAt = now
    if (!rateAllow(session.msgLimiter, now, MESSAGE_MAX_PER_SEC)) {
      this.drop(session, 1008, 'rate limit')
      return
    }
    const parsed = parseClientMessage(raw)
    if (!parsed.ok) return
    const msg = parsed.msg
    if (msg.type === C2S.JOIN) return this.onJoin(session, msg)
    if (!session.joined) return
    if (msg.type === C2S.STATE) return this.onState(session, msg, now)
    if (msg.type === C2S.CHAT) return this.onChat(session, msg, now)
    if (msg.type === C2S.SHOOT) return this.onShoot(session, msg, now)
  }

  onJoin(session, msg) {
    if (session.joined) return
    if (this.players.size >= MAX_PLAYERS) {
      this.send(session.ws, { type: S2C.ERROR, error: 'room full' })
      this.drop(session, 1013, 'room full')
      return
    }
    const used = new Set([...this.players.values()].map((p) => p.color))
    const color = COLORS.find((c) => !used.has(c)) ?? COLORS[0]
    const spawn = this.pickSpawn()
    const now = Date.now()
    Object.assign(session, {
      joined: true,
      name: msg.name,
      color,
      pos: [spawn.x, 0, spawn.z],
      yaw: spawnYaw(spawn.x, spawn.z),
      pitch: 0,
      pose: 'stand',
      move: createMoveBucket(now),
    })
    clearTimeout(session.joinTimer)
    this.players.set(session.id, session)
    this.send(session.ws, {
      type: S2C.WELCOME,
      id: session.id,
      you: { pos: session.pos, yaw: session.yaw },
      players: [...this.players.values()].map(publicPlayer),
    })
    this.broadcast({ type: S2C.PLAYER_JOIN, player: publicPlayer(session) }, session.id)
    this.startTimer()
  }

  // 選離現有玩家最遠、且不在固定障礙內的出生點
  pickSpawn() {
    return pickSpawnPoint(SPAWN_POINTS, [...this.players.values()].map((p) => p.pos))
  }

  onState(p, msg, now) {
    if (!rateAllow(p.stateLimiter, now, STATE_MAX_PER_SEC)) return
    const result = evaluateMove(p, msg.pos, now)
    p.lastStateAt = now
    if (result.ok) {
      p.pos = result.pos
    } else if (now - p.lastCorrect >= CORRECT_MIN_INTERVAL_MS) {
      p.lastCorrect = now
      this.send(p.ws, { type: S2C.CORRECT, pos: p.pos })
    }
    p.yaw = msg.yaw
    p.pitch = msg.pitch
    p.pose = msg.pose
  }

  onChat(p, msg, now) {
    p.chatTimes = p.chatTimes.filter((t) => now - t < CHAT_WINDOW_MS)
    if (p.chatTimes.length >= CHAT_MAX_PER_WINDOW) {
      this.send(p.ws, { type: S2C.ERROR, error: 'chat rate limited' })
      return
    }
    p.chatTimes.push(now)
    this.broadcast({ type: S2C.CHAT, from: p.name, text: msg.text })
  }

  onShoot(p, msg, now) {
    if (!cooldownReady(p, 'lastShoot', now, SHOOT_COOLDOWN_MS)) return
    if (!isShootOriginValid(msg.origin, p.pos)) return
    const hit = raycastWorld(msg.origin, msg.dir, {
      players: [...this.players.values()],
      ignoreId: p.id,
      maxDist: MAX_SHOT_DIST,
    })
    // 漆彈只能打人:打到牆或家具不產生斑點
    if (!hit || hit.kind !== 'player') return
    const paint = {
      type: S2C.PAINT,
      from: p.id,
      origin: msg.origin,
      pos: hit.point,
      normal: hit.normal,
      color: p.color,
    }
    paint.targetId = hit.targetId
    if (hit.part) paint.part = hit.part
    this.broadcast(paint)
  }

  drop(session, code, reason) {
    try {
      session.ws.close(code, reason)
    } catch {}
    this.onLeave(session)
  }

  onLeave(session) {
    clearTimeout(session.joinTimer)
    this.sessions.delete(session)
    if (!this.players.delete(session.id)) return
    this.broadcast({ type: S2C.PLAYER_LEAVE, id: session.id })
    try {
      session.ws.close()
    } catch {}
    if (this.players.size === 0) {
      this.stopTimer()
    }
  }

  startTimer() {
    if (!this.idleTimer) {
      this.idleTimer = setInterval(() => {
        const now = Date.now()
        for (const s of [...this.sessions]) {
          if (isIdle(s.lastMessageAt, now)) this.drop(s, 1001, 'idle timeout')
        }
      }, IDLE_CHECK_MS)
    }
    if (this.timer) return
    this.timer = setInterval(() => {
      this.broadcast({
        type: S2C.SNAPSHOT,
        players: [...this.players.values()].map(publicPlayer),
      })
    }, BROADCAST_MS)
  }

  stopTimer() {
    clearInterval(this.timer)
    this.timer = null
    clearInterval(this.idleTimer)
    this.idleTimer = null
  }

  send(ws, obj) {
    try {
      ws.send(encode(obj))
    } catch {}
  }

  broadcast(obj, exceptId = null) {
    const data = encode(obj)
    for (const p of this.players.values()) {
      if (p.id === exceptId) continue
      try {
        p.ws.send(data)
      } catch {}
    }
  }
}

function publicPlayer(p) {
  return { id: p.id, name: p.name, color: p.color, pos: p.pos, yaw: p.yaw, pitch: p.pitch, pose: p.pose }
}
