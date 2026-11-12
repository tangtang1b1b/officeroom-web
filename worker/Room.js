// 單一房間 Durable Object。
// 採用「一般 accept」而非 Hibernation API:房間狀態(位置、冷卻、20Hz 廣播計時器)都在記憶體,
// 遊戲連線期間本來就需要持續運作,Hibernation 會在閒置時清空記憶體且需另外序列化 attachment,徒增複雜度。
// 規則判斷都在 rules.js(純函式)。
import { DurableObject } from 'cloudflare:workers'
import { SPAWN_POINTS, COLLIDERS, SEATS, seatById, seatSpot } from '../shared/layout.js'
import { standUpSpot } from '../shared/collision.js'
import { MAX_PLAYERS, MAX_HP, PLAYER_COLORS, C2S, S2C, parseClientMessage, encode } from '../shared/protocol.js'
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
  evaluateStateChange,
  isNameReserved,
  isShootOriginValid,
  spawnYaw,
  pickSpawnPoint,
  applyHit,
  reviveIfReady,
  isDowned,
  downRemaining,
  sanitizeJumpY,
  limitAirTime,
  DOWN_RECONNECT_KEEP_MS,
} from './rules.js'

const COLORS = PLAYER_COLORS
const BROADCAST_MS = 50
const CORRECT_MIN_INTERVAL_MS = 100
const MAX_SHOT_DIST = 25
const STALE_HOLDER_MS = 2000

export class Room extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env)
    this.players = new Map() // id -> player(含 ws)
    this.sessions = new Set() // 所有連線(含未 join)
    this.nextId = 1
    this.timer = null
    this.idleTimer = null
    this.downRecords = new Map() // recordKey -> { hp, downedUntil }
  }

  // 取出(並刪除)重連者先前的倒地紀錄;過期的不還原
  takeDownRecord(key) {
    const rec = this.downRecords.get(key)
    this.downRecords.delete(key)
    if (!rec || rec.downedUntil <= Date.now()) return {}
    return rec
  }

  async fetch(request) {
    // 登入頁用:目前被人佔用(上班中)的座位 id
    if (new URL(request.url).pathname === '/seats') {
      const seats = [...this.players.values()].map((p) => p.seatId).filter(Boolean)
      return Response.json({ seats })
    }
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
    let seat = null
    if (msg.seatId !== undefined) {
      seat = seatById(msg.seatId)
      let err = null
      if (!seat || seat.name === null || !seatSpot(seat.id)) err = 'bad seat'
      else {
        const holder = [...this.players.values()].find((p) => p.seatId === seat.id)
        // 斷線重連時舊連線可能還沒被清掉:對方超過 STALE_HOLDER_MS 沒有任何訊息(正常連線每 50ms 送狀態)就讓新連線接手
        if (holder && Date.now() - holder.lastMessageAt > STALE_HOLDER_MS) this.drop(holder, 1001, 'replaced')
        else if (holder) err = 'seat taken'
      }
      if (err) return this.reject(session, err)
    } else if (isNameReserved(msg.name)) {
      return this.reject(session, 'name reserved')
    }
    const used = new Set([...this.players.values()].map((p) => p.color))
    const color = COLORS.find((c) => !used.has(c)) ?? COLORS[0]
    // 連線後一律站著:有座位的人出生在自己椅子旁(面向桌子);坐著只用在離線時的人偶
    const seatFacing = seat ? seatSpot(seat.id) : null
    const spot = seat ? standUpSpot(seat.id) : null
    const spawn = spot ?? this.pickSpawn()
    const now = Date.now()
    Object.assign(session, {
      joined: true,
      name: seat ? seat.name : msg.name,
      color,
      pos: [spawn.x, 0, spawn.z],
      yaw: spot && seatFacing ? seatFacing.yaw : spawnYaw(spawn.x, spawn.z),
      pitch: 0,
      pose: 'stand',
      seatId: seat ? seat.id : null,
      move: createMoveBucket(now),
      hp: MAX_HP,
      downedUntil: 0,
      airSince: 0,
      ...this.takeDownRecord(seat ? `seat:${seat.id}` : `guest:${session.ip}:${msg.name}`),
    })
    session.recordKey = seat ? `seat:${seat.id}` : `guest:${session.ip}:${msg.name}`
    clearTimeout(session.joinTimer)
    this.players.set(session.id, session)
    this.send(session.ws, {
      type: S2C.WELCOME,
      id: session.id,
      you: { pos: session.pos, yaw: session.yaw, pose: session.pose, seatId: session.seatId, hp: session.hp },
      players: [...this.players.values()].map((q) => publicPlayer(q)),
    })
    this.broadcast({ type: S2C.PLAYER_JOIN, player: publicPlayer(session) }, session.id)
    this.startTimer()
  }

  reject(session, error) {
    this.send(session.ws, { type: S2C.ERROR, error })
    this.drop(session, 1008, error)
  }

  // 選離現有玩家最遠、且不在固定障礙內的出生點
  pickSpawn() {
    return pickSpawnPoint(SPAWN_POINTS, [...this.players.values()].map((p) => p.pos))
  }

  onState(p, msg, now) {
    if (!rateAllow(p.stateLimiter, now, STATE_MAX_PER_SEC)) return
    const r = evaluateStateChange(p, msg, now)
    p.lastStateAt = now
    p.pos = [r.pos[0], limitAirTime(p, sanitizeJumpY(msg.pos[1], r.pose, isDowned(p, now)), now), r.pos[2]]
    if (r.correct && now - p.lastCorrect >= CORRECT_MIN_INTERVAL_MS) {
      p.lastCorrect = now
      this.send(p.ws, { type: S2C.CORRECT, pos: p.pos, pose: r.pose })
    }
    p.yaw = r.yaw
    p.pitch = r.pitch
    p.pose = r.pose
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
    if (isDowned(p, now)) return // 倒地不能射擊
    if (!isShootOriginValid(msg.origin, p.pos)) return
    // 坐著的人身體在椅子碰撞盒內:射線不被自己那張椅子擋住,否則坐下就等於無敵
    const seatedChairs = new Set(
      [...this.players.values()].filter((q) => q.pose === 'sit' && q.seatId).map((q) => seatById(q.seatId)?.chairId),
    )
    // 離線同事:沒人在線的有名字座位上坐著人偶,也可以被打(id 與前端 IDLE_PREFIX 相同)
    const online = new Set([...this.players.values()].map((q) => q.seatId).filter(Boolean))
    const idleDolls = []
    for (const seat of SEATS) {
      if (!seat.name || online.has(seat.id)) continue
      const spot = seatSpot(seat.id)
      if (!spot) continue
      idleDolls.push({ id: `idle:${seat.id}`, pos: [spot.x, 0, spot.z], yaw: spot.yaw, pose: 'sit' })
      seatedChairs.add(seat.chairId)
    }
    const hit = raycastWorld(msg.origin, msg.dir, {
      players: [...this.players.values(), ...idleDolls],
      boxes: COLLIDERS.filter((box) => !seatedChairs.has(box.id)),
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
    // 真人才有血量(離線人偶只會被噴漆);倒地中被打不扣血、不影響復活時間
    const target = this.players.get(hit.targetId)
    // 倒地狀態由快照(hp/down)通知,不送 CORRECT,避免把畫面拉回落後的伺服器位置
    if (target) applyHit(target, now)
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
    // 倒地中離開:記下狀態,短時間內重連要延續倒地,不能靠重連回滿血
    if (session.joined && session.downedUntil > Date.now()) {
      this.downRecords.set(session.recordKey, { hp: session.hp, downedUntil: session.downedUntil })
    }
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
      const now = Date.now()
      for (const p of this.players.values()) reviveIfReady(p, now)
      this.broadcast({
        type: S2C.SNAPSHOT,
        players: [...this.players.values()].map((p) => publicPlayer(p, now)),
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

function publicPlayer(p, now = Date.now()) {
  return {
    id: p.id,
    name: p.name,
    color: p.color,
    pos: p.pos,
    yaw: p.yaw,
    pitch: p.pitch,
    pose: p.pose,
    seatId: p.seatId ?? null,
    hp: p.hp,
    down: downRemaining(p, now),
  }
}
