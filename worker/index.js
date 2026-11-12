import { Room } from './Room.js'
import { isOriginAllowed, parseAllowedOrigins } from './rules.js'
import { refreshWorkload } from './clickup.js'

export { Room }

// 排程抓 ClickUp 卡片數 → 交給房間廣播。失敗(token 失效、超過限速、網路錯誤)就保留上一次的資料。
export async function runWorkloadRefresh(env, fetchFn = fetch) {
  try {
    const workload = await refreshWorkload(env, fetchFn)
    await env.ROOM.get(env.ROOM.idFromName('main')).setWorkload(workload)
    console.log('workload updated', JSON.stringify(workload.seats))
  } catch (error) {
    // 只記錯誤訊息,不記 token
    console.error('workload refresh failed:', error?.message ?? String(error))
  }
}

export default {
  async scheduled(_event, env, ctx) {
    ctx.waitUntil(runWorkloadRefresh(env))
  },

  async fetch(request, env) {
    const url = new URL(request.url)
    if (url.pathname === '/ws') {
      if (request.headers.get('Upgrade') !== 'websocket') {
        return new Response('Expected WebSocket', { status: 426 })
      }
      const allowed = parseAllowedOrigins(env.ALLOWED_ORIGINS)
      if (!isOriginAllowed(request.headers.get('Origin'), url.host, allowed)) {
        return new Response('Forbidden', { status: 403 })
      }
      // 固定單一房間
      const stub = env.ROOM.get(env.ROOM.idFromName('main'))
      return stub.fetch(request)
    }
    if (url.pathname === '/seats' && request.method === 'GET') {
      const origin = request.headers.get('Origin')
      const allowed = parseAllowedOrigins(env.ALLOWED_ORIGINS)
      if (origin && !isOriginAllowed(origin, url.host, allowed)) return new Response('Forbidden', { status: 403 })
      const res = await env.ROOM.get(env.ROOM.idFromName('main')).fetch(request)
      const headers = new Headers(res.headers)
      if (origin) {
        headers.set('Access-Control-Allow-Origin', origin)
        headers.set('Vary', 'Origin')
      }
      headers.set('Cache-Control', 'no-store')
      return new Response(res.body, { status: res.status, headers })
    }
    // 靜態資源由 Vercel 提供;這裡只做健康檢查
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      return new Response('Method Not Allowed', { status: 405, headers: { Allow: 'GET, HEAD' } })
    }
    return new Response('officeroom ok', {
      status: 200,
      headers: { 'Content-Type': 'text/plain; charset=utf-8' },
    })
  },
}
