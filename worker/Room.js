// 單一房間 Durable Object。
// 採用「一般 accept」而非 Hibernation API:房間狀態(位置、冷卻、20Hz 廣播計時器)都在記憶體,
// 遊戲連線期間本來就需要持續運作,Hibernation 會在閒置時清空記憶體且需另外序列化 attachment,徒增複雜度。
import { DurableObject } from 'cloudflare:workers'
import { ROOM, PLAYER, SPAWN_POINTS } from '../shared/layout.js'
import { MAX_PLAYERS, C2S, S2C, parseClientMessage, encode } from '../shared/protocol.js'
import { raycastWorld } from '../shared/raycast.js'

const COLORS = ['#e6194b', '#3cb44b', '#4363d8', '#f58231', '#911eb4', '#42d4f4', '#f032e6', '#bfef45', '#fabed4', '#469990']
const BROADCAST_MS = 50
const SHOOT_COOLDOWN_MS = 150
const CHAT_WINDOW_MS = 1000
const CHAT_MAX_PER_WINDOW = 3
const SPEED_TOLERANCE = 1.5
const SPEED_SLACK = 0.5 // 公尺,容許網路抖動
const MAX_SHOOT_ORIGIN_OFFSET = 2.5
const MAX_SHOT_DIST = 100

export class Room extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env)
    this.players = new Map() // id -> player(含 ws)
    this.nextId = 1
    this.timer = null
  }

  async fetch(request) {
    if (request.headers.get('Upgrade') !== 'websocket') {
      return new Response('Expected WebSocket', { status: 426 })
    }
    const pair = new WebSocketPair()
    const [client, server] = Object.values(pair)
    server.accept()

    if (this.players.size >= MAX_PLAYERS) {
      server.send(encode({ type: 'error', error: 'room full' }))
      server.close(1013, 'room full')
      return new Response(null, { status: 101, webSocket: client })
    }

    const id = String(this.nextId++)
    const session = { id, ws: server, joined: false, chatTimes: [], lastShoot: 0 }
    server.addEventListener('message', (e) => this.onMessage(session, e.data))
    server.addEventListener('close', () => this.onLeave(session))
    server.addEventListener('error', () => this.onLeave(session))
    return new Response(null, { status: 101, webSocket: client })
  }

  onMessage(session, raw) {
    const parsed = parseClientMessage(raw)
    if (!parsed.ok) return
    const msg = parsed.msg
    if (msg.type === C2S.JOIN) return this.onJoin(session, msg)
    if (!session.joined) return
    if (msg.type === C2S.STATE) return this.onState(session, msg)
    if (msg.type === C2S.CHAT) return this.onChat(session, msg)
    if (msg.type === C2S.SHOOT) return this.onShoot(session, msg)
  }

  onJoin(session, msg) {
    if (session.joined) return
    if (this.players.size >= MAX_PLAYERS) {
      session.ws.close(1013, 'room full')
      return
    }
    const used = new Set([...this.players.values()].map((p) => p.color))
    const color = COLORS.find((c) => !used.has(c)) ?? COLORS[0]
    const spawn = this.pickSpawn()
    Object.assign(session, {
      joined: true,
      name: msg.name,
      color,
      pos: [spawn.x, 0, spawn.z],
      yaw: 0,
      pitch: 0,
      pose: 'stand',
      lastStateAt: Date.now(),
    })
    this.players.set(session.id, session)
    this.send(session.ws, {
      type: S2C.WELCOME,
      id: session.id,
      players: [...this.players.values()].map(publicPlayer),
    })
    this.broadcast({ type: S2C.PLAYER_JOIN, player: publicPlayer(session) }, session.id)
    this.startTimer()
  }

  // 選離現有玩家最遠的出生點
  pickSpawn() {
    let best = SPAWN_POINTS[0]
    let bestScore = -1
    for (const sp of SPAWN_POINTS) {
      let score = Infinity
      for (const p of this.players.values()) {
        score = Math.min(score, Math.hypot(p.pos[0] - sp.x, p.pos[2] - sp.z))
      }
      if (score > bestScore) {
        bestScore = score
        best = sp
      }
    }
    return best
  }

  onState(p, msg) {
    const now = Date.now()
    const dt = Math.min((now - p.lastStateAt) / 1000, 1)
    p.lastStateAt = now
    const maxDist = PLAYER.walkSpeed.stand * SPEED_TOLERANCE * dt + SPEED_SLACK
    let [x, , z] = msg.pos
    const dx = x - p.pos[0]
    const dz = z - p.pos[2]
    const dist = Math.hypot(dx, dz)
    if (dist > maxDist) {
      // 超速:拉回上一個合法位置(位置不更新,下次 snapshot 會讓客戶端校正)
      x = p.pos[0]
      z = p.pos[2]
    }
    const r = PLAYER.radius
    x = Math.min(ROOM.maxX - r, Math.max(ROOM.minX + r, x))
    z = Math.min(ROOM.maxZ - r, Math.max(ROOM.minZ + r, z))
    p.pos = [x, 0, z]
    p.yaw = msg.yaw
    p.pitch = msg.pitch
    p.pose = msg.pose
  }

  onChat(p, msg) {
    const now = Date.now()
    p.chatTimes = p.chatTimes.filter((t) => now - t < CHAT_WINDOW_MS)
    if (p.chatTimes.length >= CHAT_MAX_PER_WINDOW) return
    p.chatTimes.push(now)
    this.broadcast({ type: S2C.CHAT, from: p.name, text: msg.text })
  }

  onShoot(p, msg) {
    const now = Date.now()
    if (now - p.lastShoot < SHOOT_COOLDOWN_MS) return
    p.lastShoot = now
    // 起點必須靠近伺服器記錄的玩家位置,防止從任意位置射擊
    const eye = [p.pos[0], PLAYER.eyeHeight[p.pose], p.pos[2]]
    if (Math.hypot(msg.origin[0] - eye[0], msg.origin[1] - eye[1], msg.origin[2] - eye[2]) > MAX_SHOOT_ORIGIN_OFFSET) return
    const hit = raycastWorld(msg.origin, msg.dir, {
      players: [...this.players.values()],
      ignoreId: p.id,
      maxDist: MAX_SHOT_DIST,
    })
    if (!hit) return
    const paint = { type: S2C.PAINT, pos: hit.point, normal: hit.normal, color: p.color }
    if (hit.kind === 'player') paint.targetId = hit.targetId
    this.broadcast(paint)
  }

  onLeave(session) {
    if (!this.players.delete(session.id)) return
    this.broadcast({ type: S2C.PLAYER_LEAVE, id: session.id })
    try {
      session.ws.close()
    } catch {}
    if (this.players.size === 0) this.stopTimer()
  }

  startTimer() {
    if (this.timer) return
    this.timer = setInterval(() => {
      this.broadcast({ type: S2C.SNAPSHOT, players: [...this.players.values()].map(publicPlayer) })
    }, BROADCAST_MS)
  }

  stopTimer() {
    clearInterval(this.timer)
    this.timer = null
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
