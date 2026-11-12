// 從 ClickUp 抓指派給七位同事的未完成卡片。token 只存在 Worker 的 secret(CLICKUP_TOKEN),絕不送到前端。
// fetchFn 可注入,方便測試。
import { CLICKUP_USER_SEATS, countWorkload } from '../shared/workload.js'

const API = 'https://api.clickup.com/api/v2'
const MAX_PAGES = 10 // 每頁最多 100 張;免費方案單次請求的子請求上限是 50,這裡留很大餘裕

const request = async (fetchFn, token, path) => {
  const res = await fetchFn(`${API}${path}`, { headers: { Authorization: token, Accept: 'application/json' } })
  if (!res.ok) {
    // 429:超過每分鐘 100 次;401:token 失效。呼叫端會沿用上一次成功的資料。
    throw new Error(`ClickUp ${res.status} ${path.split('?')[0]}`)
  }
  return res.json()
}

// 取得 workspace(team)id:優先用設定值,沒有就用 token 能看到的第一個
export async function resolveTeamId(token, configured, fetchFn = fetch) {
  if (configured) return String(configured)
  const data = await request(fetchFn, token, '/team')
  const id = data?.teams?.[0]?.id
  if (!id) throw new Error('ClickUp: no workspace found for this token')
  return String(id)
}

export async function fetchOpenTasks(token, teamId, fetchFn = fetch) {
  const assignees = Object.keys(CLICKUP_USER_SEATS)
    .map((id) => `assignees[]=${id}`)
    .join('&')
  const tasks = []
  let finished = false
  for (let page = 0; page < MAX_PAGES; page++) {
    // include_closed=false:不含已關閉;subtasks=false:只算頂層卡片
    const data = await request(fetchFn, token, `/team/${teamId}/task?${assignees}&include_closed=false&subtasks=false&page=${page}`)
    // 200 但格式不對(API 變動等):不能當成「沒有卡片」,否則會把好的舊資料蓋成 0
    if (!Array.isArray(data?.tasks)) throw new Error('ClickUp: unexpected response (no tasks array)')
    tasks.push(...data.tasks)
    if (data.last_page === true || data.tasks.length < 100) {
      finished = true
      break
    }
  }
  // 抓滿頁數還沒到最後一頁:資料不完整,寧可保留舊資料也不要少算
  if (!finished) throw new Error('ClickUp: too many tasks (page limit reached)')
  return tasks
}

// 抓取並統計。成功回傳 { updatedAt, seats };失敗丟出錯誤(由呼叫端保留舊資料)。
export async function refreshWorkload(env, fetchFn = fetch, now = Date.now()) {
  const token = env.CLICKUP_TOKEN
  if (!token) throw new Error('CLICKUP_TOKEN is not set')
  const teamId = await resolveTeamId(token, env.CLICKUP_TEAM_ID, fetchFn)
  const tasks = await fetchOpenTasks(token, teamId, fetchFn)
  return { updatedAt: now, seats: countWorkload(tasks, now) }
}
