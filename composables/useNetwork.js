import { C2S, S2C, parseServerMessage, encode } from '~/shared/protocol.js'
import { useAllStore } from '~/store/all.js'

const MAX_RETRIES = 10

// 與 Worker 的 WebSocket 連線:自動重連、訊息分派。
// handlers:welcome(msg) / playerJoin(player) / playerLeave(id) / snapshot(players) / paint(msg) / correct(pos)
export const useNetwork = (handlers = {}) => {
  const store = useAllStore()
  const config = useRuntimeConfig()
  let ws = null
  let name = ''
  let retries = 0
  let retryTimer = null
  let closed = false
  let roomFull = false

  const url = () => {
    // WS_URL 在建置時就固定,只在開發時使用,避免把本機位址打包進正式站
    if (import.meta.dev && config.public.WS_URL) return config.public.WS_URL
    return `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`
  }

  const send = (msg) => {
    if (ws && ws.readyState === WebSocket.OPEN) ws.send(encode(msg))
  }

  const upsertRoster = (player) => {
    const entry = { id: player.id, name: player.name, color: player.color }
    const index = store.roster.findIndex((item) => item.id === player.id)
    if (index >= 0) store.roster[index] = entry
    else store.roster.push(entry)
  }

  const handle = (msg) => {
    switch (msg.type) {
      case S2C.WELCOME:
        store.myId = msg.id
        store.roster = (msg.players || []).map((p) => ({ id: p.id, name: p.name, color: p.color }))
        store.netStatus = 'online'
        retries = 0
        handlers.welcome?.(msg)
        break
      case S2C.PLAYER_JOIN:
        if (!msg.player) break
        upsertRoster(msg.player)
        if (msg.player.id !== store.myId) store.pushChat('', `${msg.player.name} 進入辦公室`, true)
        handlers.playerJoin?.(msg.player)
        break
      case S2C.PLAYER_LEAVE: {
        const left = store.roster.find((item) => item.id === msg.id)
        store.roster = store.roster.filter((item) => item.id !== msg.id)
        if (left) store.pushChat('', `${left.name} 離開辦公室`, true)
        handlers.playerLeave?.(msg.id)
        break
      }
      case S2C.SNAPSHOT:
        handlers.snapshot?.(msg.players || [])
        break
      case S2C.CHAT:
        store.pushChat(msg.from, msg.text)
        break
      case S2C.PAINT:
        handlers.paint?.(msg)
        break
      case S2C.CORRECT:
        handlers.correct?.(msg.pos)
        break
      case S2C.ERROR:
        if (msg.error === 'room full') {
          roomFull = true
          store.netStatus = 'full'
        }
        break
    }
  }

  const connect = () => {
    if (closed) return
    store.netStatus = retries > 0 ? 'reconnecting' : 'connecting'
    ws = new WebSocket(url())
    ws.onopen = () => send({ type: C2S.JOIN, name })
    ws.onmessage = (event) => {
      const parsed = parseServerMessage(event.data)
      if (parsed.ok) handle(parsed.msg)
    }
    ws.onclose = () => {
      ws = null
      if (closed) return
      // 房間已滿:不計入重試次數,固定間隔再試,有人離開時就能進入
      if (roomFull) {
        roomFull = false
        store.netStatus = 'full'
        retryTimer = setTimeout(connect, 5000)
        return
      }
      if (retries >= MAX_RETRIES) {
        store.netStatus = 'failed'
        return
      }
      store.netStatus = 'reconnecting'
      const delay = Math.min(1000 * 2 ** retries, 8000)
      retries += 1
      retryTimer = setTimeout(connect, delay)
    }
    ws.onerror = () => ws?.close()
  }

  return {
    connect(nickname) {
      name = nickname
      closed = false
      roomFull = false
      connect()
    },
    sendState: (pos, yaw, pitch, pose) => send({ type: C2S.STATE, pos, yaw, pitch, pose }),
    sendChat: (text) => send({ type: C2S.CHAT, text }),
    sendShoot: (origin, dir) => send({ type: C2S.SHOOT, origin, dir }),
    disconnect() {
      closed = true
      clearTimeout(retryTimer)
      ws?.close()
      ws = null
    },
  }
}
