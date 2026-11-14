// 單一房間 Durable Object。
// 採用「一般 accept」而非 Hibernation API:房間狀態(位置、冷卻、20Hz 廣播計時器)都在記憶體,
// 遊戲連線期間本來就需要持續運作,Hibernation 會在閒置時清空記憶體且需另外序列化 attachment,徒增複雜度。
// 規則判斷都在 rules.js(純函式)。
import { DurableObject } from 'cloudflare:workers'
import { SPAWN_POINTS, SEATS, seatById, seatSpot } from '../shared/layout.js'
import { standUpSpot } from '../shared/collision.js'
import { MAX_PLAYERS, MAX_HP, PLAYER_COLORS, PAINT_COLORS, C2S, S2C, parseClientMessage, encode } from '../shared/protocol.js'
import { raycastWorld } from '../shared/raycast.js'
import { createDog, stepDog, nudgeDog, publicDog } from './dog.js'
import {
  createPropsState,
  isShootableProp,
  knockProp,
  stepProps,
  hasMovingProps,
  expireProps,
  restoreSeatProps,
  propsOverlay,
  propsRaycastBoxes,
  propsSnapshot,
  pushPlayersOutOfProps,
  dropPlayersOffProp,
  propById,
} from '../shared/props.js'

const WORKLOAD_KEY = 'workload'
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
  evaluateHeight,
  isStaleDropState,
  setDropGuard,
  DOWN_RECONNECT_KEEP_MS,
} from './rules.js'

const COLORS = PLAYER_COLORS
const BROADCAST_MS = 50
const CORRECT_MIN_INTERVAL_MS = 100
const MAX_SHOT_DIST = 25
const STALE_HOLDER_MS = 2000
const PROPS_MAX_DT_MS = 200 // 物品模擬單次最多前進的時間(計時器延遲時不一次追太多)

export class Room extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env)
    this.players = new Map() // id -> player(含 ws)
    this.sessions = new Set() // 所有連線(含未 join)
    this.nextId = 1
    this.timer = null
    this.idleTimer = null
    this.downRecords = new Map() // recordKey -> { hp, downedUntil }
    this.workload = null // { updatedAt, seats } 最近一次成功從 ClickUp 抓到的卡片數
    ctx.blockConcurrencyWhile(async () => {
      this.workload = (await ctx.storage.get(WORKLOAD_KEY)) ?? null
    })
    this.dog = createDog(Date.now())
    this.dogAt = Date.now()
    // 被射走的椅子/螢幕(shared/props.js 的 PropsState,不可變:每次變動都換新物件);
    // 物理模擬與到期回復在 20Hz 廣播計時器裡做
    this.props = createPropsState()
    this.propsAt = Date.now()
    this.overlayCache = null // { state, overlay }
  }

  // 目前的碰撞疊加層(原位停用、移動後的盒擋人;傳給所有碰撞 / 高度 / 出生點 / 射出點 / 狗的檢查)。
  // this.props 不可變,以物件身分快取,同一狀態不重算。
  overlay() {
    if (this.overlayCache?.state !== this.props) this.overlayCache = { state: this.props, overlay: propsOverlay(this.props) }
    return this.overlayCache.overlay
  }

  // 套用回復結果(restoreProps / expireProps / restoreSeatProps 的回傳值):
  // 更新狀態、廣播回復事件,並把站在回復物品上的玩家推開(用 CORRECT 同步,不受節流限制)。
  applyRestore(result, now = Date.now()) {
    this.props = result.state
    if (result.restored.length === 0) return
    this.broadcast({ type: S2C.PROP_RESTORE, ids: result.restored })
    const players = [...this.players.values()].filter((p) => p.pos)
    // 找推出位置用「回復後」的疊加層:仍被射走的物品原位視同不存在、移動後的盒照樣擋人
    const pushes = pushPlayersOutOfProps(result.restored, players, this.overlay())
    for (const { id, pos } of pushes) {
      const p = this.players.get(id)
      if (!p) continue
      p.pos = pos
      p.lastCorrect = now
      this.send(p.ws, { type: S2C.CORRECT, pos: p.pos, pose: p.pose })
    }
  }

  // 取出(並刪除)重連者先前的倒地紀錄;過期的不還原
  takeDownRecord(key) {
    const rec = this.downRecords.get(key)
    this.downRecords.delete(key)
    if (!rec || rec.downedUntil <= Date.now()) return {}
    return rec
  }

  // 由排程(worker/index.js 的 scheduled)以 RPC 呼叫:存下新數字並通知所有人。
  async setWorkload(workload) {
    this.workload = workload
    await this.ctx.storage.put(WORKLOAD_KEY, workload)
    this.broadcast({ type: S2C.WORKLOAD, workload })
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
    // 座位主人上線:該座位的椅子與螢幕立刻回原位(在算出生點之前,出生點會在椅子旁)
    if (seat) this.applyRestore(restoreSeatProps(this.props, seat.id))
    const used = new Set([...this.players.values()].map((p) => p.color))
    const color = COLORS.find((c) => !used.has(c)) ?? COLORS[0]
    // 連線後一律站著:有座位的人出生在自己椅子旁(面向桌子);坐著只用在離線時的人偶
    const seatFacing = seat ? seatSpot(seat.id) : null
    const spot = seat ? standUpSpot(seat.id, this.overlay()) : null
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
      dog: publicDog(this.dog),
      workload: this.workload,
      props: publicProps(this.props, now),
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
    return pickSpawnPoint(SPAWN_POINTS, [...this.players.values()].map((p) => p.pos), this.overlay())
  }

  onState(p, msg, now) {
    if (!rateAllow(p.stateLimiter, now, STATE_MAX_PER_SEC)) return
    // 剛被移下圓桌:收到 CORRECT 前的舊 state(還在桌上)直接忽略
    if (isStaleDropState(p, msg, now)) return
    // 先決定伺服器採用的腳底高度(支撐面 + 姿勢 + 滯空限制),碰撞也用這個高度判定,不用客戶端的原始值
    const disabled = this.overlay()
    const h = evaluateHeight(p, msg, now, disabled)
    const wasSitting = p.pose === 'sit'
    const r = evaluateStateChange(p, { ...msg, pos: [msg.pos[0], h.y, msg.pos[2]] }, now, disabled)
    p.lastStateAt = now
    p.pos = [r.pos[0], r.correct ? h.prevY : h.y, r.pos[2]] // 移動被拒:留在原位也沿用原高度
    if (r.correct && now - p.lastCorrect >= CORRECT_MIN_INTERVAL_MS) {
      p.lastCorrect = now
      this.send(p.ws, { type: S2C.CORRECT, pos: p.pos, pose: r.pose })
    }
    p.yaw = r.yaw
    p.pitch = r.pitch
    p.pose = r.pose
    // 坐下:自己座位的椅子立刻回原位(螢幕不動)
    if (!wasSitting && p.pose === 'sit' && p.seatId) this.applyRestore(restoreSeatProps(this.props, p.seatId, { chairOnly: true }), now)
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
    const disabled = this.overlay()
    if (!isShootOriginValid(msg.origin, p.pos, p.airSince > 0, disabled)) return
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
      // 狗也可以被打(id 'dog',不在 this.players,所以只噴漆、不扣血)
      players: [...this.players.values(), ...idleDolls, { id: 'dog', pos: [this.dog.x, 0, this.dog.z], pose: 'dog', yaw: this.dog.yaw }],
      // 被射走的物品:原位不擋、移動後的位置擋(可以再射);有人坐的椅子不擋(坐著的椅子一定在原位)
      // 起點在螢幕放大盒內(但不在真實盒內)時該螢幕用真實盒,避免距離 0 的命中搶走所有射擊
      boxes: propsRaycastBoxes(disabled, undefined, msg.origin).filter((box) => !seatedChairs.has(box.id)),
      ignoreId: p.id,
      maxDist: MAX_SHOT_DIST,
    })
    // 射中椅子/螢幕(原位或已被打飛的):給一次衝量並重新計時(有人坐著的椅子已從 boxes 排除,這裡再擋一次);不產生斑點
    if (hit && hit.kind === 'box' && isShootableProp(hit.boxId) && !seatedChairs.has(hit.boxId)) {
      const prev = this.props
      const { state, entry } = knockProp(prev, hit.boxId, msg.dir, now, hit.point)
      if (!entry) return
      this.props = state
      const [prop] = publicProps({ [entry.id]: entry }, now)
      this.broadcast({ type: S2C.PROP_KNOCK, from: p.id, prop })
      // 站在圓桌上的人:桌子一離開原位就失去支撐,移到旁邊地板(否則會掉進移動中的桌子盒裡卡住)
      const players = [...this.players.values()].filter((q) => q.pos)
      for (const { id, pos } of dropPlayersOffProp(prev, entry.id, players, this.overlay())) {
        const q = this.players.get(id)
        if (!q) continue
        q.pos = pos
        q.airSince = 0
        q.lastCorrect = now
        setDropGuard(q, propById(entry.id).box, now)
        this.send(q.ws, { type: S2C.CORRECT, pos: q.pos, pose: q.pose })
      }
      return
    }
    // 漆彈只能打人:打到牆或家具不產生斑點
    if (!hit || hit.kind !== 'player') return
    const paint = {
      type: S2C.PAINT,
      from: p.id,
      origin: msg.origin,
      pos: hit.point,
      normal: hit.normal,
      color: msg.color ?? PAINT_COLORS[0],
    }
    paint.targetId = hit.targetId
    if (hit.part) paint.part = hit.part
    this.broadcast(paint)
    // 真人才有血量(離線人偶只會被噴漆);倒地中被打不扣血、不影響復活時間
    const target = this.players.get(hit.targetId)
    // 倒地狀態由快照(hp/down)通知,不送 CORRECT,避免把畫面拉回落後的伺服器位置
    if (target) applyHit(target, now)
    else if (hit.targetId === 'dog') nudgeDog(this.dog, msg.dir, now, disabled) // 狗只被推一下,不扣血
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
    // 座位主人離線:座位上會出現坐著的人偶,椅子與螢幕立刻回原位
    if (session.seatId) this.applyRestore(restoreSeatProps(this.props, session.seatId))
    if (this.players.size === 0) {
      this.stopTimer()
      // 沒人時不留被射走的物品(也沒有計時器在跑),下一個進來的人看到全部在原位
      this.props = createPropsState()
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
    this.propsAt = Date.now()
    this.timer = setInterval(() => {
      const now = Date.now()
      for (const p of this.players.values()) reviveIfReady(p, now)
      this.stepPropsTick(now)
      this.applyRestore(expireProps(this.props, now), now)
      stepDog(this.dog, now, Math.min(now - this.dogAt, 200), Math.random, this.overlay())
      this.dogAt = now
      this.broadcast({
        type: S2C.SNAPSHOT,
        players: [...this.players.values()].map((p) => publicPlayer(p, now)),
        dog: publicDog(this.dog),
        props: publicProps(this.props, now),
      })
    }, BROADCAST_MS)
  }

  // 模擬移動中的物品(沒有移動中的物品時不做事);dt 取實際間隔並設上限。移動中的物品碰到玩家就停住(不推人)。
  stepPropsTick(now) {
    const dt = Math.min(Math.max(0, now - this.propsAt), PROPS_MAX_DT_MS)
    this.propsAt = now
    if (!hasMovingProps(this.props)) return
    const players = [...this.players.values()].filter((p) => p.pos).map((p) => ({ pos: p.pos }))
    this.props = stepProps(this.props, dt, players)
  }

  stopTimer() {
    clearInterval(this.timer)
    this.timer = null
    this.dogAt = Date.now() // 沒人時狗暫停,下次有人再從現在開始算
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

// 物品狀態的下發格式(propsSnapshot,數值取到小數 3 位以減少流量)
const round3 = (n) => Math.round(n * 1000) / 1000
function publicProps(state, now) {
  return propsSnapshot(state, now).map((e) => ({ ...e, pos: e.pos.map(round3), yaw: round3(e.yaw), tilt: round3(e.tilt) }))
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
