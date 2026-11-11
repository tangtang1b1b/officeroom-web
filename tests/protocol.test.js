import { describe, it, expect } from 'vitest'
import { parseClientMessage, validateClientMessage } from '../shared/protocol.js'

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
  it('rejects malformed / unknown input', () => {
    expect(parseClientMessage('not json').ok).toBe(false)
    expect(parseClientMessage('[]').ok).toBe(false)
    expect(parseClientMessage('null').ok).toBe(false)
    expect(p({ type: 'hack' }).ok).toBe(false)
    expect(parseClientMessage(123).ok).toBe(false)
    expect(parseClientMessage('x'.repeat(5000)).ok).toBe(false)
  })
})
