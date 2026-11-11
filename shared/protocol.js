// 前後端共用的訊息協定(JSON)。pos 為腳底位置 [x,y,z](y=0 為地面)。

export const MAX_PLAYERS = 7
// 玩家顏色(伺服器依序分配,在線玩家不重複);前端的外型也依序號決定,所以每個人的上衣顏色都不同
export const PLAYER_COLORS = ['#e6194b', '#3cb44b', '#4363d8', '#f58231', '#911eb4', '#42d4f4', '#f032e6', '#bfef45', '#fabed4', '#469990']
export const MAX_NAME_LENGTH = 16
export const MAX_CHAT_LENGTH = 200
export const MAX_SEAT_ID_LENGTH = 32
export const POSES = ['stand', 'crouch', 'prone', 'sit']

export const C2S = {
  JOIN: 'join',
  STATE: 'state',
  CHAT: 'chat',
  SHOOT: 'shoot',
}

export const S2C = {
  WELCOME: 'welcome',
  PLAYER_JOIN: 'player_join',
  PLAYER_LEAVE: 'player_leave',
  SNAPSHOT: 'snapshot',
  CHAT: 'chat',
  PAINT: 'paint',
  CORRECT: 'correct',
  ERROR: 'error',
}

// 最終伺服器訊息格式(pos 皆為 [x,y,z]):
// join(C2S)   { type, name, seatId? }  // seatId 選填(≤32 字元);有 seatId 時伺服器以座位表的名字為準
// welcome     { type, id, you:{pos,yaw,pose,seatId}, players:[Player] }
// player_join { type, player:Player }
// player_leave{ type, id }
// snapshot    { type, players:[Player] }
// chat        { type, from:name, text }
// paint       { type, from:id, origin:[x,y,z], pos:[x,y,z], normal:[x,y,z], color, targetId?, part? }  // part: head|torso|armL|armR|legL|legR(命中玩家時)
// correct     { type, pos:[x,y,z], pose }  // 客戶端須同時套用 pose(坐姿時 pos 即座位中心)
// error       { type, error }  // 含 'room full' | 'seat taken' | 'bad seat' | 'name reserved'(後三者伺服器隨即斷線 1008)
// Player = { id, name, color, pos, yaw, pitch, pose, seatId }  // seatId 訪客為 null

export const MAX_PITCH = 1.5

const isFiniteNum = (n) => typeof n === 'number' && Number.isFinite(n)
const isVec3 = (v) => Array.isArray(v) && v.length === 3 && v.every(isFiniteNum)
const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v)

const COORD_LIMIT = 1000

// 控制字元、雙向控制字元與零寬字元
const UNSAFE_CHARS = /[\u0000-\u001f\u007f​-‏‪-‮⁦-⁩﻿]/g

export function sanitizeName(name) {
  return String(name).replace(UNSAFE_CHARS, '').trim()
}

// 正規化到 [-π, π]
export function normalizeAngle(a) {
  const twoPi = Math.PI * 2
  let r = a % twoPi
  if (r > Math.PI) r -= twoPi
  else if (r < -Math.PI) r += twoPi
  return r
}

// 回傳 { ok: true, msg } 或 { ok: false, error }。msg 為只含白名單欄位的新物件。
export function validateClientMessage(data) {
  if (!isObject(data) || typeof data.type !== 'string') return fail('bad message')
  switch (data.type) {
    case C2S.JOIN: {
      if (typeof data.name !== 'string') return fail('bad name')
      const name = sanitizeName(data.name)
      if (name.length === 0 || name.length > MAX_NAME_LENGTH) return fail('bad name')
      const msg = { type: C2S.JOIN, name }
      if (data.seatId !== undefined && data.seatId !== null) {
        if (typeof data.seatId !== 'string' || data.seatId.length === 0 || data.seatId.length > MAX_SEAT_ID_LENGTH) return fail('bad seat')
        msg.seatId = data.seatId
      }
      return { ok: true, msg }
    }
    case C2S.STATE: {
      if (!isVec3(data.pos) || data.pos.some((n) => Math.abs(n) > COORD_LIMIT)) return fail('bad pos')
      if (!isFiniteNum(data.yaw) || !isFiniteNum(data.pitch)) return fail('bad angle')
      if (!POSES.includes(data.pose)) return fail('bad pose')
      return {
        ok: true,
        msg: {
          type: C2S.STATE,
          pos: [...data.pos],
          yaw: normalizeAngle(data.yaw),
          pitch: Math.max(-MAX_PITCH, Math.min(MAX_PITCH, data.pitch)),
          pose: data.pose,
        },
      }
    }
    case C2S.CHAT: {
      if (typeof data.text !== 'string') return fail('bad text')
      const text = sanitizeName(data.text)
      if (text.length === 0 || text.length > MAX_CHAT_LENGTH) return fail('bad text')
      return { ok: true, msg: { type: C2S.CHAT, text } }
    }
    case C2S.SHOOT: {
      if (!isVec3(data.origin) || data.origin.some((n) => Math.abs(n) > COORD_LIMIT)) return fail('bad origin')
      if (!isVec3(data.dir)) return fail('bad dir')
      const len = Math.hypot(...data.dir)
      if (len < 1e-6) return fail('bad dir')
      return {
        ok: true,
        msg: { type: C2S.SHOOT, origin: [...data.origin], dir: data.dir.map((n) => n / len) },
      }
    }
    default:
      return fail('unknown type')
  }
}

// 解析原始 WebSocket 字串。過大的資料直接拒絕。
export function parseClientMessage(raw) {
  if (typeof raw !== 'string' || raw.length > 2048) return fail('bad payload')
  let data
  try {
    data = JSON.parse(raw)
  } catch {
    return fail('bad json')
  }
  return validateClientMessage(data)
}

// 客戶端用:解析伺服器訊息,只檢查 type 與基本形狀
export function parseServerMessage(raw) {
  if (typeof raw !== 'string') return fail('bad payload')
  let data
  try {
    data = JSON.parse(raw)
  } catch {
    return fail('bad json')
  }
  if (!isObject(data) || !Object.values(S2C).includes(data.type)) return fail('unknown type')
  return { ok: true, msg: data }
}

export const encode = (msg) => JSON.stringify(msg)

function fail(error) {
  return { ok: false, error }
}
