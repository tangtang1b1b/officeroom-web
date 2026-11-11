// 單一房間 Durable Object。
// 採用「一般 accept」而非 Hibernation API:房間狀態(位置、冷卻、20Hz 廣播計時器)都在記憶體,
// 遊戲連線期間本來就需要持續運作,Hibernation 會在閒置時清空記憶體且需另外序列化 attachment,徒增複雜度。
// 規則判斷都在 rules.js(純函式)。
import { DurableObject } from 'cloudflare:workers'
import { SPAWN_POINTS, DYNAMIC_DEFS, COLLIDERS, ROOM, PLAYER } from '../shared/layout.js'
import { MAX_PLAYERS, C2S, S2C, parseClientMessage, encode } from '../shared/protocol.js'
import { raycastWorld } from '../shared/raycast.js'
import {
  createObjects,
  resetObjects,
  stepObjects,
  tickStanding,
  applyImpulse,
  pushObjectsAround,
  publicObject,
} from '../shared/physics.js'
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
  refundMove,
  pickSpawnPoint,
} from './rules.js'

const COLORS = ['#e6194b', '#3cb44b', '#4363d8', '#f58231', '#911eb4', '#42d4f4', '#f032e6', '#bfef45', '#fabed4', '#469990']
const BROADCAST_MS = 50
const CORRECT_MIN_INTERVAL_MS = 100
const MAX_SHOT_DIST = 100
const SHOT_IMPULSE = 1.6
const PUSH_DT_MIN = 0.016
const PUSH_DT_MAX = 0.2

export class Room extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env)
    this.players = new Map() // id -> player(含 ws)
    this.sessions = new Set() // 所有連線(含未 join)
    this.nextId = 1
    this.timer = null
    this.idleTimer = null
    this.objects = createObjects(DYNAMIC_DEFS)
    this.pendingObjectIds = new Set() // 射擊/玩家推動造成、需在下一次 snapshot 廣播的物件
    this.lastTickAt = 0
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
      objects: this.objects.map(publicObject),
    })
    this.broadcast({ type: S2C.PLAYER_JOIN, player: publicPlayer(session) }, session.id)
    this.startTimer()
  }

  // 選離現有玩家最遠、且不與物件重疊的出生點
  pickSpawn() {
    return pickSpawnPoint(SPAWN_POINTS, [...this.players.values()].map((p) => p.pos), this.objects)
  }

  onState(p, msg, now) {
    if (!rateAllow(p.stateLimiter, now, STATE_MAX_PER_SEC)) return
    const result = evaluateMove(p, msg.pos, now)
    let accepted = result.ok
    if (accepted) {
      const dt = Math.min(PUSH_DT_MAX, Math.max(PUSH_DT_MIN, (now - (p.lastStateAt || now - 50)) / 1000))
      const vel = [(result.pos[0] - p.pos[0]) / dt, (result.pos[2] - p.pos[2]) / dt]
      accepted = this.pushObjects(result.pos, vel, p.pos)
      if (!accepted) refundMove(p.move, result.cost)
    }
    p.lastStateAt = now
    if (accepted) {
      p.pos = result.pos
    } else if (now - p.lastCorrect >= CORRECT_MIN_INTERVAL_MS) {
      p.lastCorrect = now
      this.send(p.ws, { type: S2C.CORRECT, pos: p.pos })
    }
    p.yaw = msg.yaw
    p.pitch = msg.pitch
    p.pose = msg.pose
  }

  // 玩家移到 pos 時推開重疊的物件;任一推不動則回滾並回傳 false
  pushObjects(pos, vel, prevPos) {
    const res = pushObjectsAround(this.objects, pos, vel, prevPos, COLLIDERS, ROOM)
    for (const id of res.moved) this.pendingObjectIds.add(id)
    return res.ok
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
      objects: this.objects,
      maxDist: MAX_SHOT_DIST,
    })
    if (!hit) return
    const paint = {
      type: S2C.PAINT,
      from: p.id,
      origin: msg.origin,
      pos: hit.point,
      normal: hit.normal,
      color: p.color,
    }
    if (hit.kind === 'player') {
      paint.targetId = hit.targetId
      if (hit.part) paint.part = hit.part
    }
    if (hit.kind === 'object') {
      paint.objectId = hit.objectId
      const obj = this.objects.find((o) => o.id === hit.objectId)
      if (obj) {
        applyImpulse(obj, msg.dir, SHOT_IMPULSE, now)
        this.pendingObjectIds.add(obj.id)
      }
    }
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
      resetObjects(this.objects, DYNAMIC_DEFS)
      this.pendingObjectIds.clear()
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
    this.lastTickAt = Date.now()
    this.timer = setInterval(() => {
      const now = Date.now()
      const dt = Math.min(0.2, Math.max(0, (now - this.lastTickAt) / 1000))
      this.lastTickAt = now
      const ids = new Set(this.pendingObjectIds)
      this.pendingObjectIds.clear()
      for (const id of tickStanding(this.objects, now)) ids.add(id)
      for (const id of stepObjects(this.objects, dt, COLLIDERS, ROOM)) ids.add(id)
      this.broadcast({
        type: S2C.SNAPSHOT,
        players: [...this.players.values()].map(publicPlayer),
        objects: this.objects.filter((o) => ids.has(o.id)).map(publicObject),
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
