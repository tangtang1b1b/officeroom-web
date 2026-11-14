import { describe, it, expect } from 'vitest'
import { parseClientMessage, validateClientMessage, parseServerMessage, S2C } from '../shared/protocol.js'

const p = (o) => parseClientMessage(JSON.stringify(o))

describe('protocol', () => {
  it('accepts valid join and trims name', () => {
    const r = p({ type: 'join', name: '  Amy ' })
    expect(r.ok).toBe(true)
    expect(r.msg.name).toBe('Amy')
  })
  it('rejects empty / too long name', () => {
    expect(p({ type: 'join', name: '   ' }).ok).toBe(false)
    expect(p({ type: 'join', name: 'a'.repeat(16) }).ok).toBe(true)
    expect(p({ type: 'join', name: 'a'.repeat(17) }).ok).toBe(false)
    expect(p({ type: 'join', name: 5 }).ok).toBe(false)
  })
  it('accepts valid state', () => {
    expect(p({ type: 'state', pos: [1, 0, 2], yaw: 0.5, pitch: -0.2, pose: 'crouch' }).ok).toBe(true)
  })
  it('rejects bad state', () => {
    expect(p({ type: 'state', pos: [1, 0], yaw: 0, pitch: 0, pose: 'stand' }).ok).toBe(false)
    expect(p({ type: 'state', pos: [1, 0, 2], yaw: 0, pitch: 0, pose: 'fly' }).ok).toBe(false)
    expect(p({ type: 'state', pos: [1, 0, '2'], yaw: 0, pitch: 0, pose: 'stand' }).ok).toBe(false)
    expect(p({ type: 'state', pos: [1e9, 0, 2], yaw: 0, pitch: 0, pose: 'stand' }).ok).toBe(false)
  })
  it('rejects non-finite numbers', () => {
    expect(validateClientMessage({ type: 'state', pos: [NaN, 0, 0], yaw: 0, pitch: 0, pose: 'stand' }).ok).toBe(false)
    expect(validateClientMessage({ type: 'state', pos: [0, 0, 0], yaw: Infinity, pitch: 0, pose: 'stand' }).ok).toBe(false)
  })
  it('chat length limits', () => {
    expect(p({ type: 'chat', text: 'hi' }).ok).toBe(true)
    expect(p({ type: 'chat', text: 'x'.repeat(200) }).ok).toBe(true)
    expect(p({ type: 'chat', text: 'x'.repeat(201) }).ok).toBe(false)
    expect(p({ type: 'chat', text: '' }).ok).toBe(false)
    expect(p({ type: 'chat', text: 123 }).ok).toBe(false)
  })
  it('shoot normalizes dir and rejects zero', () => {
    const r = p({ type: 'shoot', origin: [0, 1.6, 0], dir: [0, 0, 5] })
    expect(r.ok).toBe(true)
    expect(r.msg.dir).toEqual([0, 0, 1])
    expect(p({ type: 'shoot', origin: [0, 1.6, 0], dir: [0, 0, 0] }).ok).toBe(false)
    expect(p({ type: 'shoot', origin: [0, 1.6], dir: [0, 0, 1] }).ok).toBe(false)
  })
  it('shoot only accepts whitelisted paint colors', () => {
    const base = { type: 'shoot', origin: [0, 1.6, 0], dir: [0, 0, 1] }
    expect(p({ ...base, color: '#1e90ff' }).msg.color).toBe('#1e90ff')
    expect(p({ ...base, color: 'url(evil)' }).msg.color).toBeUndefined()
    expect(p(base).msg.color).toBeUndefined()
  })
  it('clamps pitch and normalizes yaw', () => {
    const r = p({ type: 'state', pos: [0, 0, 0], yaw: 7 * Math.PI, pitch: 9, pose: 'stand' })
    expect(r.msg.pitch).toBe(1.5)
    expect(Math.abs(r.msg.yaw)).toBeCloseTo(Math.PI)
    const r2 = p({ type: 'state', pos: [0, 0, 0], yaw: -100, pitch: -9, pose: 'stand' })
    expect(r2.msg.pitch).toBe(-1.5)
    expect(Math.abs(r2.msg.yaw)).toBeLessThanOrEqual(Math.PI)
  })
  it('strips bidi / zero-width chars from name and chat', () => {
    expect(p({ type: 'join', name: 'A​B‮C⁦D﻿E' }).msg.name).toBe('ABCDE')
    expect(p({ type: 'join', name: '​‏' }).ok).toBe(false)
    expect(p({ type: 'chat', text: 'hi‮ there‍' }).msg.text).toBe('hi there')
    expect(p({ type: 'chat', text: '​⁩' }).ok).toBe(false)
  })
  it('server messages: new types accepted', () => {
    expect(S2C.CORRECT).toBe('correct')
    expect(S2C.ERROR).toBe('error')
    expect(parseServerMessage(JSON.stringify({ type: 'error', error: 'room full' })).ok).toBe(true)
    expect(parseServerMessage(JSON.stringify({ type: 'correct', pos: [1, 0, 2] })).ok).toBe(true)
    expect(parseServerMessage(JSON.stringify({ type: 'paint', from: '1', origin: [0, 1, 0], pos: [1, 1, 1], normal: [0, 1, 0], color: '#fff', part: 'head' })).ok).toBe(true)
    expect(parseServerMessage(JSON.stringify({ type: 'bogus' })).ok).toBe(false)
  })
  it('rejects malformed / unknown input', () => {
    expect(parseClientMessage('not json').ok).toBe(false)
    expect(parseClientMessage('[]').ok).toBe(false)
    expect(parseClientMessage('null').ok).toBe(false)
    expect(p({ type: 'hack' }).ok).toBe(false)
    expect(parseClientMessage(123).ok).toBe(false)
    expect(parseClientMessage('x'.repeat(5000)).ok).toBe(false)
  })
})

describe('seat join and sit pose', () => {
  it('accepts seatId and keeps it', () => {
    const r = p({ type: 'join', name: 'Will', seatId: 'seat-will' })
    expect(r.ok).toBe(true)
    expect(r.msg.seatId).toBe('seat-will')
    expect('seatId' in p({ type: 'join', name: 'Bob' }).msg).toBe(false)
  })
  it('rejects bad seatId', () => {
    expect(p({ type: 'join', name: 'Will', seatId: 5 })).toEqual({ ok: false, error: 'bad seat' })
    expect(p({ type: 'join', name: 'Will', seatId: 'x'.repeat(33) }).error).toBe('bad seat')
    expect(p({ type: 'join', name: 'Will', seatId: 'x'.repeat(32) }).ok).toBe(true)
    expect(p({ type: 'join', seatId: 'seat-1' }).error).toBe('bad name')
  })
  it('accepts sit pose', () => {
    expect(p({ type: 'state', pos: [1, 0, 2], yaw: 0, pitch: 0, pose: 'sit' }).ok).toBe(true)
  })
})
