import { describe, it, expect } from 'vitest'
import { normalizeStatus, isCounted, countWorkload, ghostPlan, CLICKUP_USER_SEATS, MAX_GHOSTS, EXCLUDED_STATUSES } from '../shared/workload.js'
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
    for (const v of Object.values(out)) expect(v).toEqual({ open: 0, overdue: 0 })
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
    expect(countWorkload(tasks, NOW)['seat-will']).toEqual({ open: 3, overdue: 1 })
  })

  it('a shared card counts for each assignee once; unknown users are ignored', () => {
    const out = countWorkload([task('in progress', [WILL, YUHUA, WILL, 999]), task('in progress', [999])], NOW)
    expect(out['seat-will'].open).toBe(1)
    expect(out['seat-yuhua'].open).toBe(1)
  })

  it('handles missing assignees and bad due dates', () => {
    const out = countWorkload([{ status: 'new', assignees: undefined }, task('new', [WILL], 'abc')], NOW)
    expect(out['seat-will']).toEqual({ open: 1, overdue: 0 })
  })
})

describe('ghostPlan', () => {
  it('one ghost per card, capped', () => {
    expect(ghostPlan(0)).toEqual({ normal: 0, overdue: 0 })
    expect(ghostPlan(3, 0)).toEqual({ normal: 3, overdue: 0 })
    expect(ghostPlan(5, 2)).toEqual({ normal: 3, overdue: 2 })
    expect(ghostPlan(99, 0)).toEqual({ normal: MAX_GHOSTS, overdue: 0 })
    expect(ghostPlan(99, 99)).toEqual({ normal: 0, overdue: MAX_GHOSTS })
  })

  it('overdue ghosts never exceed the total, bad input is safe', () => {
    expect(ghostPlan(2, 9)).toEqual({ normal: 0, overdue: 2 })
    expect(ghostPlan(-4, 1)).toEqual({ normal: 0, overdue: 0 })
    expect(ghostPlan(NaN, NaN)).toEqual({ normal: 0, overdue: 0 })
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
