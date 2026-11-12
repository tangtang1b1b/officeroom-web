import { describe, it, expect } from 'vitest'
import { normalizeStatus, isCounted, countWorkload, ghostPlan, CLICKUP_USER_SEATS, MAX_GHOSTS, PRIORITY_SCALE, EXCLUDED_STATUSES, fanAngle, fanSlot } from '../shared/workload.js'
import { fetchOpenTasks, resolveTeamId, refreshWorkload } from '../worker/clickup.js'
import { SEATS } from '../shared/layout.js'

const NOW = 1_794_470_400_000 // 固定「現在」
const task = (status, ids, due = null) => ({ id: 't', status, due_date: due, assignees: ids.map((id) => ({ id })) })
const WILL = 3640413
const YUHUA = 1039322

describe('status matching', () => {
  it('ignores case, emoji and extra spaces', () => {
    expect(normalizeStatus('qa ready 👀')).toBe('qa ready')
    expect(normalizeStatus('  STUCK 🚧 ')).toBe('stuck')
    expect(normalizeStatus('fixed 🦾')).toBe('fixed')
    expect(normalizeStatus('In   Review')).toBe('in review')
    expect(normalizeStatus('in-review')).toBe('in review')
    expect(normalizeStatus('QA_ready')).toBe('qa ready')
    expect(normalizeStatus(null)).toBe('')
  })

  it('excludes exactly the statuses the team listed', () => {
    for (const s of ['in review', 'pending', 'block', 'complete', 'fixed', 'stuck', 'qa ready', 'done', 'resolved']) {
      expect(isCounted(task(s, [WILL])), s).toBe(false)
      expect(isCounted(task(s.toUpperCase() + ' ✅', [WILL])), s).toBe(false)
    }
    expect(EXCLUDED_STATUSES.size).toBe(9)
  })

  it('counts everything else, including fixing / new / todo / back log / not set / open', () => {
    for (const s of ['fixing 🔨', 'new 📝', 'todo 📝', 'back log', 'not set', 'Open', 'in progress', 'not started']) {
      expect(isCounted(task(s, [WILL])), s).toBe(true)
    }
  })

  it('also accepts object statuses and treats done / closed types as finished', () => {
    expect(isCounted(task({ status: 'in progress', type: 'custom' }, [WILL]))).toBe(true)
    expect(isCounted(task({ status: 'shipped', type: 'done' }, [WILL]))).toBe(false)
    expect(isCounted(task({ status: 'whatever', type: 'closed' }, [WILL]))).toBe(false)
  })
})

describe('countWorkload', () => {
  it('maps the seven coworkers to seats and starts everyone at zero', () => {
    const out = countWorkload([], NOW)
    expect(Object.keys(out).sort()).toEqual(Object.values(CLICKUP_USER_SEATS).sort())
    for (const v of Object.values(out)) expect(v).toEqual({ open: 0, overdue: 0, priority: { urgent: 0, high: 0, normal: 0, low: 0 } })
  })

  it('every mapped seat exists in the seat table with a name', () => {
    for (const seatId of Object.values(CLICKUP_USER_SEATS)) {
      expect(SEATS.find((s) => s.id === seatId && s.name), seatId).toBeTruthy()
    }
  })

  it('counts open cards and overdue ones, skipping excluded statuses', () => {
    const tasks = [
      task('in progress', [WILL], String(NOW - 1000)), // 逾期
      task('not started', [WILL], String(NOW + 86_400_000)), // 未逾期
      task('new 📝', [WILL]), // 沒有截止日
      task('qa ready 👀', [WILL], String(NOW - 1000)), // 排除狀態:不算(即使逾期)
      task('block', [WILL]),
    ]
    expect(countWorkload(tasks, NOW)['seat-will']).toMatchObject({ open: 3, overdue: 1 })
  })

  it('a shared card counts for each assignee once; unknown users are ignored', () => {
    const out = countWorkload([task('in progress', [WILL, YUHUA, WILL, 999]), task('in progress', [999])], NOW)
    expect(out['seat-will'].open).toBe(1)
    expect(out['seat-yuhua'].open).toBe(1)
  })

  it('handles missing assignees and bad due dates', () => {
    const out = countWorkload([{ status: 'new', assignees: undefined }, task('new', [WILL], 'abc')], NOW)
    expect(out['seat-will']).toMatchObject({ open: 1, overdue: 0 })
  })
})

describe('ghostPlan (fusing and priority size)', () => {
  const reds = (plan) => plan.filter((g) => g.red).length
  const whites = (plan) => plan.filter((g) => !g.red).length

  it('3 cards or fewer: one white ghost each, normal size', () => {
    expect(ghostPlan({ open: 0 })).toEqual([])
    expect(ghostPlan({ open: 1 })).toEqual([{ red: false, scale: 1 }])
    const three = ghostPlan({ open: 3 })
    expect(three).toHaveLength(3)
    expect(reds(three)).toBe(0)
  })

  it('over 3 cards fuses every 3 into one red; the rest stay white (7 cards = 2 red + 1 white)', () => {
    const seven = ghostPlan({ open: 7 })
    expect(reds(seven)).toBe(2)
    expect(whites(seven)).toBe(1)
    const shapes = [4, 5, 6, 9].map((n) => ghostPlan({ open: n })).map((p) => [reds(p), whites(p)])
    expect(shapes).toEqual([
      [1, 1],
      [1, 2],
      [2, 0],
      [3, 0],
    ])
  })

  it('reds come first, then whites', () => {
    const plan = ghostPlan({ open: 8 })
    expect(plan.map((g) => g.red)).toEqual([true, true, false, false])
  })

  it('size follows priority: urgent > high > normal > low', () => {
    const one = (key) => ghostPlan({ open: 1, priority: { [key]: 1 } })[0].scale
    expect(one('urgent')).toBeGreaterThan(one('high'))
    expect(one('high')).toBeGreaterThan(one('normal'))
    expect(one('normal')).toBeGreaterThan(one('low'))
  })

  it('the most urgent cards are fused first, so the first red ghost is the biggest; low ones end up as small whites', () => {
    const plan = ghostPlan({ open: 7, priority: { urgent: 2, high: 0, normal: 3, low: 2 } })
    expect(plan[0]).toEqual({ red: true, scale: PRIORITY_SCALE.urgent }) // urgent, urgent, normal
    expect(plan[1]).toEqual({ red: true, scale: PRIORITY_SCALE.normal }) // normal, normal, low
    expect(plan[2]).toEqual({ red: false, scale: PRIORITY_SCALE.low }) // 剩下最不急的一張
  })

  it('a fused ghost is sized by the most urgent card in its group', () => {
    const plan = ghostPlan({ open: 6, priority: { urgent: 1, high: 1, normal: 2, low: 2 } })
    expect(plan[0].scale).toBe(PRIORITY_SCALE.urgent)
    expect(plan[1].scale).toBe(PRIORITY_SCALE.normal)
  })

  it('missing or mismatched priority data counts as normal (also for old saved data and plain numbers)', () => {
    expect(ghostPlan({ open: 4 })[0].scale).toBe(1)
    expect(ghostPlan({ open: 5, priority: { urgent: 1 } })[0].scale).toBe(PRIORITY_SCALE.urgent)
    expect(reds(ghostPlan(7))).toBe(2)
  })

  it('never draws more than the cap, keeping reds first', () => {
    const plan = ghostPlan({ open: 99 })
    expect(plan).toHaveLength(MAX_GHOSTS)
    expect(reds(plan)).toBe(MAX_GHOSTS)
  })

  it('bad input is safe', () => {
    expect(ghostPlan({ open: -4 })).toEqual([])
    expect(ghostPlan({ open: NaN })).toEqual([])
    expect(ghostPlan(undefined)).toEqual([])
  })
})

describe('priority counting', () => {
  it('reads ClickUp priority objects; no priority counts as normal', () => {
    const mk = (priority) => ({ status: 'in progress', assignees: [{ id: WILL }], priority })
    const out = countWorkload(
      [mk({ id: '1', priority: 'urgent' }), mk({ id: '2', priority: 'High' }), mk({ id: '3', priority: 'low' }), mk(null), mk(undefined), mk({ priority: 'weird' })],
      NOW,
    )
    expect(out['seat-will'].priority).toEqual({ urgent: 1, high: 1, normal: 3, low: 1 })
    expect(out['seat-will'].open).toBe(6)
  })

  it('excluded-status cards do not add to priority counts', () => {
    const out = countWorkload([{ status: 'qa ready 👀', assignees: [{ id: WILL }], priority: { priority: 'urgent' } }], NOW)
    expect(out['seat-will'].priority.urgent).toBe(0)
  })
})

// ---- ClickUp 抓取(假 fetch,不會連網) ----
const jsonRes = (body, ok = true, status = 200) => ({ ok, status, json: async () => body })

describe('ClickUp fetching', () => {
  it('uses the configured team id, else the first workspace of the token', async () => {
    expect(await resolveTeamId('tok', '123', () => {})).toBe('123')
    const f = async (url) => {
      expect(url).toContain('/team')
      return jsonRes({ teams: [{ id: '777' }, { id: '888' }] })
    }
    expect(await resolveTeamId('tok', undefined, f)).toBe('777')
    await expect(resolveTeamId('tok', undefined, async () => jsonRes({ teams: [] }))).rejects.toThrow()
  })

  it('sends the raw token (no Bearer), filters to the seven users, excludes closed and subtasks', async () => {
    const calls = []
    const f = async (url, init) => {
      calls.push({ url, init })
      return jsonRes({ tasks: [], last_page: true })
    }
    await fetchOpenTasks('SECRET', '42', f)
    expect(calls).toHaveLength(1)
    expect(calls[0].init.headers.Authorization).toBe('SECRET')
    expect(calls[0].url).toContain('/team/42/task?')
    expect(calls[0].url).toContain('include_closed=false')
    expect(calls[0].url).toContain('subtasks=false')
    for (const id of Object.keys(CLICKUP_USER_SEATS)) expect(calls[0].url).toContain(`assignees[]=${id}`)
  })

  it('follows pages until the last one', async () => {
    const page = (n) => Array.from({ length: n }, (_, i) => ({ id: String(i), status: 'new', assignees: [{ id: WILL }] }))
    let calls = 0
    const f = async (url) => {
      calls++
      if (url.includes('page=0')) return jsonRes({ tasks: page(100) })
      if (url.includes('page=1')) return jsonRes({ tasks: page(100) })
      return jsonRes({ tasks: page(7), last_page: true })
    }
    const tasks = await fetchOpenTasks('t', '1', f)
    expect(tasks).toHaveLength(207)
    expect(calls).toBe(3)
  })

  it('stops after a safe number of pages even if the API never says last', async () => {
    let calls = 0
    const f = async () => {
      calls++
      return jsonRes({ tasks: Array.from({ length: 100 }, () => ({ status: 'new', assignees: [] })) })
    }
    // 抓滿頁數上限還沒結束:資料不完整,要丟錯讓呼叫端保留舊資料
    await expect(fetchOpenTasks('t', '1', f)).rejects.toThrow('page limit')
    expect(calls).toBeLessThanOrEqual(10)
  })

  it('a 200 response without a tasks array is an error, not zero cards', async () => {
    await expect(fetchOpenTasks('t', '1', async () => jsonRes({}))).rejects.toThrow('unexpected')
    await expect(fetchOpenTasks('t', '1', async () => jsonRes({ tasks: null }))).rejects.toThrow('unexpected')
  })

  it('throws on API errors (429 / 401) so the caller keeps the old data', async () => {
    await expect(fetchOpenTasks('t', '1', async () => jsonRes({}, false, 429))).rejects.toThrow('429')
    await expect(fetchOpenTasks('t', '1', async () => jsonRes({}, false, 401))).rejects.toThrow('401')
  })

  it('refuses to run without a token and never puts the token in the result', async () => {
    await expect(refreshWorkload({}, () => {})).rejects.toThrow('CLICKUP_TOKEN')
    const f = async (url) =>
      url.includes('/team/')
        ? jsonRes({ tasks: [{ status: 'new', assignees: [{ id: WILL }] }], last_page: true })
        : jsonRes({ teams: [{ id: '5' }] })
    const out = await refreshWorkload({ CLICKUP_TOKEN: 'SECRET-TOKEN' }, f, NOW)
    expect(out.updatedAt).toBe(NOW)
    expect(out.seats['seat-will'].open).toBe(1)
    expect(JSON.stringify(out)).not.toContain('SECRET-TOKEN')
  })
})

describe('ghost fan layout (behind the character)', () => {
  it('three ghosts take left-back, back and right-back; the first (most urgent) sits right behind', () => {
    expect([0, 1, 2].map((i) => fanAngle(i, 3))).toEqual([0, -60, 60])
  })

  it('a single ghost sits right behind; two spread left and right', () => {
    expect(fanAngle(0, 1)).toBe(0)
    const two = [fanAngle(0, 2), fanAngle(1, 2)]
    expect(two[0]).toBeLessThan(0)
    expect(two[1]).toBeGreaterThan(0)
  })

  it('all angles stay within the rear fan (never in front of the character)', () => {
    for (let n = 1; n <= MAX_GHOSTS; n++) {
      for (let i = 0; i < n; i++) expect(Math.abs(fanAngle(i, n))).toBeLessThanOrEqual(65)
    }
  })

  it('rows are used in order and 12 ghosts fit in three rows', () => {
    expect(fanSlot(0).row).toBe(0)
    expect(fanSlot(2).row).toBe(0)
    expect(fanSlot(3).row).toBe(1)
    expect(fanSlot(7).row).toBe(2)
    expect(fanSlot(MAX_GHOSTS - 1).row).toBe(2)
  })
})
