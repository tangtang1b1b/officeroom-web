import { Room } from './Room.js'
import { isOriginAllowed } from './rules.js'

export { Room }

export default {
  async fetch(request, env) {
    const url = new URL(request.url)
    if (url.pathname === '/ws') {
      if (request.headers.get('Upgrade') !== 'websocket') {
        return new Response('Expected WebSocket', { status: 426 })
      }
      if (!isOriginAllowed(request.headers.get('Origin'), url.host)) {
        return new Response('Forbidden', { status: 403 })
      }
      // 固定單一房間
      const stub = env.ROOM.get(env.ROOM.idFromName('main'))
      return stub.fetch(request)
    }
    return env.ASSETS.fetch(request)
  },
}
