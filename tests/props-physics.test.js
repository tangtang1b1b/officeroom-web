import { describe, it, expect } from 'vitest'
import {
  PROP_PHYSICS,
  PROP_MAX_MOVE_MS,
  propById,
  isShootableProp,
  monitorPropId,
  knockProp,
  stepProps,
  hasMovingProps,
  propBox,
  propsOverlay,
  propsRaycastBoxes,
  propsSnapshot,
  pushPlayersOutOfProps,
  PROP_MAX_UP_SPEED,
  PROP_PLAYER_RADIUS_TOLERANCE,
  MONITOR_HIT_PAD,
  MONITOR_HIT_SIZE,
  homeHitBox,
  propHitBox,
  dropPlayersOffProp,
} from '../shared/props.js'
import { isBlocked, moveCircle, groundHeight, STEP_HEIGHT, activeColliders, circleBlockedByBox } from '../shared/collision.js'
import { raycastWorld } from '../shared/raycast.js'
import { isShootOriginValid, evaluateMove, createMoveBucket, COLLISION_RADIUS_TOLERANCE } from '../worker/rules.js'
import { COLLIDERS, PLAYER, ROOM, DESKS, MONITOR, HIT_PARTS, seatSpot } from '../shared/layout.js'

// chair-0-1:椅子在桌子 +z 側(桌子 desk-0-1),+z 方向是開放走道
const CHAIR = 'chair-0-1'
const DESK = DESKS.find((d) => d.id === 'desk-0-1')
const deskBox = COLLIDERS.find((b) => b.id === DESK.id)
const MON = monitorPropId(DESK.id)
const home = (id) => propById(id).home

const run = (state, players = [], dtMs = 50, maxIter = 400) => {
  let s = state
  for (let i = 0; i < maxIter && hasMovingProps(s); i++) s = stepProps(s, dtMs, players)
  return s
}

// 物品只和固定的牆、家具碰(所有可射物品都不算)
const solidFor = () => ({ has: (id) => isShootableProp(id), boxes: [] })

describe('chair physics', () => {
  it('slides along the shot direction, decelerates, stops and ends up fallen', () => {
    const h = home(CHAIR)
    const { state } = knockProp({}, CHAIR, [0, 0, 1], 0)
    const s = run(state)
    const e = s[CHAIR]
    expect(e.moving).toBe(false)
    expect(e.z - h.z).toBeGreaterThan(0.5)
    expect(Math.abs(e.x - h.x)).toBeLessThan(0.3)
    expect(e.y).toBe(0)
    expect(e.tilt).toBe(PROP_PHYSICS.chair.fallenTilt)
    expect([e.vx, e.vy, e.vz, e.spin]).toEqual([0, 0, 0, 0])
    expect(e.yaw).not.toBe(h.yaw) // 有旋轉
    const P = PROP_PHYSICS.chair
    expect(isBlocked(e.x, e.z, P.radius - 0.01, 0, solidFor(s), P.fallenHeight)).toBe(false)
  })

  it('is stopped by the desk in front of it', () => {
    const { state } = knockProp({}, CHAIR, [0, 0, -1], 0)
    const e = run(state)[CHAIR]
    expect(e.moving).toBe(false)
    expect(e.z - PROP_PHYSICS.chair.radius).toBeGreaterThanOrEqual(deskBox.max[2] - 0.01)
  })

  it('never passes through the outer wall, even with large steps and repeated shots', () => {
    const id = 'chair-will' // 靠 -x 牆
    let s = knockProp({}, id, [-1, 0, 0], 0).state
    s = knockProp(s, id, [-1, 0, 0], 0).state
    s = knockProp(s, id, [-1, 0, 0], 0).state
    expect(Math.hypot(s[id].vx, s[id].vz)).toBeCloseTo(PROP_PHYSICS.chair.maxSpeed)
    for (let i = 0; i < 100 && hasMovingProps(s); i++) {
      s = stepProps(s, 200)
      expect(s[id].x - PROP_PHYSICS.chair.radius).toBeGreaterThanOrEqual(ROOM.minX - 1e-6)
    }
    expect(s[id].moving).toBe(false)
  })

  it('stops when it would hit a player and never overlaps them', () => {
    const h = home(CHAIR)
    const player = { id: 'a', pos: [h.x, 0, h.z + 1.0], pose: 'stand' }
    let s = knockProp({}, CHAIR, [0, 0, 1], 0).state
    for (let i = 0; i < 200 && hasMovingProps(s); i++) {
      s = stepProps(s, 50, [player])
      expect(isBlocked(player.pos[0], player.pos[2], PLAYER.radius, 0, { has: () => false, boxes: [propBox(s[CHAIR])] })).toBe(false)
    }
    const e = s[CHAIR]
    expect(e.moving).toBe(false)
    expect(e.z).toBeGreaterThan(h.z + 0.1) // 有往前移動才停
    expect(e.z).toBeLessThan(player.pos[2] - PLAYER.radius - PROP_PHYSICS.chair.boxHalf + 0.05)
  })

  it('a player already touching the chair does not freeze it in place', () => {
    const h = home(CHAIR)
    const beside = { id: 'a', pos: [h.x + PROP_PHYSICS.chair.boxHalf + PLAYER.radius - 0.02, 0, h.z] }
    const e = run(knockProp({}, CHAIR, [0, 0, 1], 0).state, [beside])[CHAIR]
    expect(e.z - h.z).toBeGreaterThan(0.5)
  })

  it('re-knocking a stopped chair moves it again and restarts the restore timer', () => {
    let s = run(knockProp({}, CHAIR, [0, 0, 1], 0).state)
    const first = s[CHAIR]
    const r = knockProp(s, CHAIR, [1, 0, 0], 5000)
    expect(r.entry).toMatchObject({ moving: true, knockedAt: 5000, until: 25000, moveMs: 0 })
    expect(r.entry.tilt).toBe(first.tilt) // 倒著被再射,仍然是倒的
    s = run(r.state)
    expect(s[CHAIR].moving).toBe(false)
    expect(s[CHAIR].x - first.x).toBeGreaterThan(0.3)
    expect(s[CHAIR].until).toBe(25000)
  })

  it('caps a single movement at PROP_MAX_MOVE_MS', () => {
    const base = knockProp({}, CHAIR, [0, 0, 1], 0).state
    const s = { [CHAIR]: { ...base[CHAIR], vz: 0.5, moveMs: PROP_MAX_MOVE_MS - 20 } }
    const next = stepProps(s, 50)
    expect(next[CHAIR].moving).toBe(false)
    expect(next[CHAIR].tilt).toBe(PROP_PHYSICS.chair.fallenTilt)
  })
})

describe('monitor physics', () => {
  it('flies off the desk toward the shot, falls to the floor and lies there', () => {
    // 物品之間不互撞:前面的椅子不擋螢幕
    let s = knockProp({}, MON, [0, 0, 1], 0).state
    expect(s[MON].y).toBeGreaterThan(DESK.h)
    let maxY = s[MON].y
    for (let i = 0; i < 400 && hasMovingProps(s); i++) {
      s = stepProps(s, 50)
      maxY = Math.max(maxY, s[MON].y)
    }
    const e = s[MON]
    expect(maxY).toBeGreaterThan(home(MON).y) // 往上拋
    expect(e.moving).toBe(false)
    expect(e.y).toBe(0)
    expect(e.z).toBeGreaterThan(deskBox.max[2])
    expect(e.tilt).toBe(PROP_PHYSICS.monitor.fallenTilt)
    const P = PROP_PHYSICS.monitor
    expect(isBlocked(e.x, e.z, P.radius - 0.01, 0, solidFor(s), P.fallenHeight)).toBe(false)
  })

  it('shot sideways along the desk row: slides over the neighbouring desks and ends on the floor', () => {
    const s = run(knockProp({}, MON, [1, 0, 0], 0).state)
    const e = s[MON]
    expect(e.moving).toBe(false)
    expect(e.y).toBe(0)
    expect(groundHeight(e.x, e.z, 0, solidFor(s))).toBe(0)
  })

  it('does not drop into the narrow gap between back-to-back desks; slides across and falls off the far side', () => {
    // 往 -z 輕輕一推:翻過隔板、越過兩張桌子之間的細縫(不會卡進去),滑過對面桌子後落地
    const opposite = COLLIDERS.find((b) => b.id === 'desk-0--1')
    let s = knockProp({}, MON, [0, 0, -1], 0).state
    s = { [MON]: { ...s[MON], vz: -1.2 } }
    const P = PROP_PHYSICS.monitor
    for (let i = 0; i < 400 && hasMovingProps(s); i++) {
      s = stepProps(s, 20)
      const e = s[MON]
      // 任何時刻都不會陷進桌子裡(碰撞盒與桌子實體重疊)
      for (const d of [deskBox, opposite]) {
        const inside = e.y < d.max[1] - 0.01 && circleBlockedByBox(e.x, e.z, P.radius - 0.02, e.y, d, 0.01)
        expect(inside).toBe(false)
      }
    }
    const e = s[MON]
    expect(e.moving).toBe(false)
    expect(e.y).toBe(0)
    expect(e.z).toBeLessThan(opposite.min[2])
  })

  it('from every desk, shot in any horizontal direction, always ends up lying on the floor', () => {
    const P = PROP_PHYSICS.monitor
    const failures = []
    for (const d of DESKS) {
      const id = monitorPropId(d.id)
      for (let i = 0; i < 24; i++) {
        const a = (i / 24) * Math.PI * 2
        const s = run(knockProp({}, id, [Math.cos(a), 0.1, Math.sin(a)], 0).state, [], 50, 200)
        const e = s[id]
        const ok =
          !e.moving &&
          e.y === 0 &&
          e.tilt === P.fallenTilt &&
          !isBlocked(e.x, e.z, P.radius - 0.01, 0, solidFor(s), P.fallenHeight)
        if (!ok) failures.push(`${id} @${i}: y=${e.y.toFixed(2)} moving=${e.moving}`)
      }
    }
    expect(failures).toEqual([])
  })

  it('a monitor with no horizontal shot direction still slides off its desk', () => {
    const e = run(knockProp({}, MON, [0, 1, 0], 0).state)[MON]
    expect(e.moving).toBe(false)
    expect(e.y).toBe(0)
  })

  it('a monitor stopped by a player while on a desk stays there (players are never pushed)', () => {
    const h = home(MON)
    // 玩家站在桌上、螢幕正前方
    const player = { id: 'a', pos: [h.x + 0.6, DESK.h, h.z] }
    let s = knockProp({}, MON, [1, 0, 0], 0).state
    for (let i = 0; i < 200 && hasMovingProps(s); i++) {
      s = stepProps(s, 20, [player])
      expect(circleBlockedByBox(player.pos[0], player.pos[2], PLAYER.radius - PROP_PLAYER_RADIUS_TOLERANCE, DESK.h, propBox(s[MON]))).toBe(false)
    }
    expect(s[MON].moving).toBe(false)
  })

  it('a lying monitor is tall enough to block (not a step-over)', () => {
    expect(PROP_PHYSICS.monitor.fallenHeight).toBeGreaterThan(STEP_HEIGHT)
    const e = { ...knockProp({}, MON, [0, 0, 1], 0).entry, x: 0, y: 0, z: 0, tilt: PROP_PHYSICS.monitor.fallenTilt, moving: false }
    expect(isBlocked(0, 0, PLAYER.radius, 0, { has: () => false, boxes: [propBox(e)] })).toBe(true)
  })
})

describe('monitor enlarged hit box (raycast only)', () => {
  const monBox = COLLIDERS.find((b) => b.id === MON)
  const mid = [(monBox.min[0] + monBox.max[0]) / 2, (monBox.min[1] + monBox.max[1]) / 2, (monBox.min[2] + monBox.max[2]) / 2]
  // 只有原始碰撞盒(不放大)的射線清單
  const rawBoxes = () => COLLIDERS

  it('MONITOR_HIT_SIZE matches the home hit box and is centered on the monitor (only width and thickness are enlarged)', () => {
    const hb = homeHitBox(MON)
    const fp = [hb.max[0] - hb.min[0], hb.max[1] - hb.min[1], hb.max[2] - hb.min[2]]
    // desk-0-1 沒旋轉:x = 寬、z = 厚
    expect(fp[0]).toBeCloseTo(MONITOR_HIT_SIZE.w)
    expect(fp[1]).toBeCloseTo(MONITOR_HIT_SIZE.h)
    expect(fp[2]).toBeCloseTo(MONITOR_HIT_SIZE.d)
    expect((hb.min[1] + hb.max[1]) / 2).toBeCloseTo(mid[1])
    expect(MONITOR_HIT_SIZE.d).toBeGreaterThan(MONITOR.d * 5)
    // 上下維持真實高度(頂面不加高,不搶坐著同事頭部的命中)
    expect(hb.min[1]).toBe(monBox.min[1])
    expect(hb.max[1]).toBe(monBox.max[1])
    expect(MONITOR_HIT_SIZE.h).toBe(MONITOR.h)
    // 放大後仍在桌面之上、不碰到隔板
    expect(hb.min[1]).toBeGreaterThan(DESK.h)
    const part = COLLIDERS.find((b) => b.id === `${DESK.id}-partition`)
    expect(hb.min[2] > part.max[2] || hb.max[2] < part.min[2]).toBe(true)
    expect(homeHitBox('nope')).toBeNull()
    expect(homeHitBox(CHAIR)).toBe(propById(CHAIR).box)
  })

  it('hits rays that graze past the edge, at a steep angle, or from the side (raw box misses them)', () => {
    const boxes = propsRaycastBoxes({})
    const toward = (origin, target) => {
      const d = target.map((v, i) => v - origin[i])
      const len = Math.hypot(...d)
      return { origin, dir: d.map((v) => v / len) }
    }
    const rays = [
      // 從正前方(椅子那側)射向螢幕右邊緣外 8 公分
      { origin: [monBox.max[0] + 0.08, mid[1], mid[2] + 2], dir: [0, 0, -1] },
      // 從椅子那側由上往下陡射,瞄螢幕前方 8 公分、底部附近:真實盒射不中(打到桌面)
      toward([mid[0], 1.6, monBox.max[2] + 0.5], [mid[0], monBox.min[1] + 0.03, monBox.max[2] + 0.08]),
      // 從側面(沿桌排方向)射,薄螢幕側面只有 3 公分
      { origin: [mid[0] - 1.2, mid[1], mid[2] + 0.05], dir: [1, 0, 0] },
    ]
    for (const { origin, dir } of rays) {
      const raw = raycastWorld(origin, dir, { boxes: rawBoxes(), maxDist: 10 })
      expect(raw?.boxId).not.toBe(MON)
      const hit = raycastWorld(origin, dir, { boxes, maxDist: 10 })
      expect(hit).toMatchObject({ kind: 'box', boxId: MON })
    }
    // 放大盒以外仍射不中;擦過螢幕頂端上方的射線也不算中(頂面不加高)
    const far = raycastWorld([monBox.max[0] + 0.2, mid[1], mid[2] + 2], [0, 0, -1], { boxes, maxDist: 10 })
    expect(far?.boxId).not.toBe(MON)
    const over = raycastWorld([mid[0], monBox.max[1] + 0.03, mid[2] + 2], [0, 0, -1], { boxes, maxDist: 10 })
    expect(over?.boxId).not.toBe(MON)
  })

  it('a shot from across the desks at the head of a seated coworker is not stolen by the enlarged monitor box', () => {
    const spot = seatSpot('seat-1')
    const doll = { id: 'sitter', pos: [spot.x, 0, spot.z], pose: 'sit', yaw: spot.yaw }
    const head = HIT_PARTS.sit.head
    const boxes = propsRaycastBoxes({})
    // 射擊者在對面桌組後方(-z 側)的走道各處、各種眼高(蹲 ~ 站),瞄坐著的人頭部(高於螢幕真實頂面的部分)。
    // 只看「不放大時射得中頭」且「經過螢幕時落在舊的加高頂面範圍內」的射線(舊版會被放大盒搶走)。
    const failures = []
    let checked = 0
    for (const eye of [PLAYER.eyeHeight.crouch, 1.3, 1.45, PLAYER.eyeHeight.stand]) {
      for (let oz = -5.8; oz <= -4.85; oz += 0.15) {
        const origin = [spot.x, eye, oz]
        for (let y = monBox.max[1] + 0.005; y < head.max[1] - 0.01; y += 0.01) {
          const target = [spot.x, y, spot.z]
          const d = target.map((v, i) => v - origin[i])
          const len = Math.hypot(...d)
          const dir = d.map((v) => v / len)
          const raw = raycastWorld(origin, dir, { players: [doll], boxes: rawBoxes(), maxDist: 20 })
          if (raw?.kind !== 'player') continue
          const t = (monBox.max[2] + MONITOR_HIT_PAD - origin[2]) / dir[2]
          const yAtMon = origin[1] + dir[1] * t
          if (yAtMon <= monBox.max[1] || yAtMon >= monBox.max[1] + MONITOR_HIT_PAD) continue
          checked++
          const hit = raycastWorld(origin, dir, { players: [doll], boxes, maxDist: 20 })
          // 對面那台螢幕的厚度放大仍可能接住「低角度往上擦過它頂端邊緣」的射線(設計如此,與頂面加高無關);
          // 這裡只要求:不被自己面前這台螢幕的放大盒搶走,其餘一律射中頭
          const stolen = hit?.kind === 'box' && hit.boxId === MON
          const other = hit?.kind === 'box' && hit.boxId === monitorPropId('desk-0--1')
          if (stolen || (!other && (hit?.kind !== 'player' || hit.part !== 'head'))) failures.push(`eye=${eye} z=${oz.toFixed(2)} y=${y.toFixed(2)} -> ${hit?.kind}:${hit?.boxId ?? hit?.part}`)
        }
      }
    }
    expect(checked).toBeGreaterThan(10)
    expect(failures).toEqual([])
  })

  it('a ray starting inside the enlarged box (but outside the real monitor) is not swallowed by a zero-distance hit', () => {
    const hb = homeHitBox(MON)
    // 起點在放大盒內、真實盒前方 6 公分(例如趴在桌上頭伸到螢幕旁)
    const origin = [mid[0], mid[1], monBox.max[2] + 0.06]
    expect(origin[2]).toBeLessThan(hb.max[2])
    // 沒給起點:舊行為,任何方向都打到距離 0 的螢幕
    const naive = raycastWorld(origin, [0, 0, 1], { boxes: propsRaycastBoxes({}), maxDist: 10 })
    expect(naive).toMatchObject({ boxId: MON, distance: 0 })
    const boxes = propsRaycastBoxes({}, undefined, origin)
    expect(boxes.find((b) => b.id === MON)).toEqual(monBox)
    // 往遠離螢幕的方向射:不打到螢幕
    const away = raycastWorld(origin, [0, 0, 1], { boxes, maxDist: 10 })
    expect(away?.boxId).not.toBe(MON)
    expect(away.distance).toBeGreaterThan(0)
    // 朝螢幕射:仍打到真實盒(距離 > 0)
    const into = raycastWorld(origin, [0, 0, -1], { boxes, maxDist: 10 })
    expect(into).toMatchObject({ kind: 'box', boxId: MON })
    expect(into.distance).toBeCloseTo(0.06)
    // 起點在放大盒外、或在真實盒內:不變
    expect(propsRaycastBoxes({}, undefined, [mid[0], mid[1], mid[2] + 2])).toEqual(propsRaycastBoxes({}))
    expect(propsRaycastBoxes({}, undefined, mid).find((b) => b.id === MON)).toEqual(hb)
    // 移動後的螢幕同理
    const s = run(knockProp({}, MON, [0, 0, 1], 0).state)
    const pb = propBox(s[MON])
    const o2 = [pb.max[0] + 0.05, (pb.min[1] + pb.max[1]) / 2, (pb.min[2] + pb.max[2]) / 2]
    expect(propsRaycastBoxes(s, undefined, o2).find((b) => b.id === MON)).toEqual(pb)
    expect(propsRaycastBoxes(s).find((b) => b.id === MON)).toEqual(propHitBox(s[MON]))
  })

  it('the moved monitor is hit through its enlarged box too (same id); physics boxes are unchanged', () => {
    const s = run(knockProp({}, MON, [0, 0, 1], 0).state)
    const e = s[MON]
    const pb = propBox(e)
    const hb = propHitBox(e)
    expect(hb.min[1]).toBe(pb.min[1]) // 上下不變
    expect(hb.max[1]).toBe(pb.max[1])
    expect(hb.max[0] - hb.min[0]).toBeCloseTo(pb.max[0] - pb.min[0] + 2 * MONITOR_HIT_PAD)
    expect(hb.max[2] - hb.min[2]).toBeCloseTo(pb.max[2] - pb.min[2] + 2 * MONITOR_HIT_PAD)
    // 碰撞疊加層用的還是原本大小
    expect(propsOverlay(s).boxes[0]).toEqual(pb)
    const boxes = propsRaycastBoxes(s)
    expect(boxes.filter((b) => b.id === MON)).toEqual([hb])
    expect(propsRaycastBoxes(propsOverlay(s))).toEqual(boxes)
    // 水平擦過倒地螢幕旁 8 公分的射線也算中
    const hit = raycastWorld([e.x - 2, (pb.min[1] + pb.max[1]) / 2, pb.max[2] + 0.08], [1, 0, 0], { boxes, maxDist: 4 })
    expect(hit).toMatchObject({ kind: 'box', boxId: MON })
  })
})

describe('reception chairs and the round table', () => {
  const TABLE = 'round-table'
  const RC = 'reception-chair-s' // 在圓桌 +z 側
  const tableBox = COLLIDERS.find((b) => b.id === TABLE)
  const rcBox = COLLIDERS.find((b) => b.id === RC)
  const PT = PROP_PHYSICS.table

  it('a reception chair slides, falls over and is blocked by the (un-knocked) round table', () => {
    // 往 +z(開放的方向)滑出去、倒下
    const away = run(knockProp({}, RC, [0, 0, 1], 0).state)[RC]
    expect(away.moving).toBe(false)
    expect(away.tilt).toBe(PROP_PHYSICS.chair.fallenTilt)
    expect(away.z).toBeGreaterThan(home(RC).z + 0.05)
    expect(propBox(away).max[1]).toBeCloseTo(0.45) // 會客室椅子倒下的高度
    // 往 -z 射:撞到圓桌停住,不會穿過
    const into = run(knockProp({}, RC, [0, 0, -1], 0).state)[RC]
    expect(into.z - 0.225).toBeGreaterThanOrEqual(tableBox.max[2] - 0.01)
    // 圓桌已被射走時就不擋
    let s = knockProp({}, TABLE, [1, 0, 0], 0).state
    s = { [TABLE]: { ...s[TABLE], x: -5, moving: false } } // 桌子放到遠處
    s = run(knockProp(s, RC, [0, 0, -1], 0).state)
    expect(s[RC].z).toBeLessThan(tableBox.max[2] - 0.1)
  })

  it('the round table slides a short distance, ends up on its side and is not standable', () => {
    const h = home(TABLE)
    const s = run(knockProp({}, TABLE, [-1, 0, 0.2], 0).state)
    const e = s[TABLE]
    expect(e.moving).toBe(false)
    const dist = Math.hypot(e.x - h.x, e.z - h.z)
    expect(dist).toBeGreaterThan(0.2)
    expect(dist).toBeLessThan(1.0)
    expect(e.y).toBe(0)
    expect(e.tilt).toBe(PT.fallenTilt)
    const b = propBox(e)
    expect(b.standable).toBe(false)
    expect(b.max[1]).toBeCloseTo(PT.fallenHeight)
    expect(b.max[0] - b.min[0]).toBeCloseTo(tableBox.max[0] - tableBox.min[0])
    // 不能站在倒下的桌子上;原位也不再是支撐面
    const ov = propsOverlay(s)
    expect(groundHeight(e.x, e.z, 2, ov)).toBe(0)
    expect(groundHeight(h.x, h.z, tableBox.max[1], ov)).toBe(0)
    expect(groundHeight(h.x, h.z, tableBox.max[1])).toBe(tableBox.max[1])
  })

  it('the table is heavier than a chair: shorter slide per shot, capped speed on rapid re-shots', () => {
    expect(PT.knockSpeed).toBeLessThan(PROP_PHYSICS.chair.knockSpeed)
    expect(PT.maxSpeed).toBeLessThan(PROP_PHYSICS.chair.maxSpeed)
    let s = knockProp({}, TABLE, [-1, 0, 0], 0).state
    for (let i = 0; i < 5; i++) s = knockProp(s, TABLE, [-1, 0, 0], i).state
    expect(Math.hypot(s[TABLE].vx, s[TABLE].vz)).toBeCloseTo(PT.maxSpeed)
    expect(s[TABLE].until).toBe(4 + 30000)
  })

  it('the table is blocked by the un-knocked reception chairs and by walls', () => {
    // 往 +z 推:南側椅子還在原位 → 停在椅子前
    const e = run(knockProp({}, TABLE, [0, 0, 1], 0).state)[TABLE]
    expect(e.z + PT.radius).toBeLessThanOrEqual(rcBox.min[2] + 0.01)
    // 連射往 -x:不會穿過會議室與會客室之間的牆
    let s = knockProp({}, TABLE, [-1, 0, 0], 0).state
    for (let t = 0; t < 30; t++) {
      s = knockProp(stepProps(s, 100), TABLE, [-1, 0, 0], t * 100).state
      expect(s[TABLE].x - PT.radius).toBeGreaterThanOrEqual(-2.0 - 1e-6)
    }
  })

  it('no sequence of shots can park the table in (or seal off) the reception doorway', () => {
    const wallB = COLLIDERS.find((b) => b.id === 'wall-b')
    const wallC = COLLIDERS.find((b) => b.id === 'wall-c')
    // 門口加上一個玩家直徑(含餘裕)的淨空區:桌子的碰撞盒任何時刻都不能碰到
    const clear = { min: [wallB.max[0], wallB.min[2]], max: [wallC.min[0], wallB.max[2] + 2 * PLAYER.radius + 0.05] }
    const overlapsClear = (b) => b.min[0] < clear.max[0] && b.max[0] > clear.min[0] && b.min[2] < clear.max[1] && b.max[2] > clear.min[1]
    // 從門外能走到會客室深處(z ≥ 5.0)
    const reachable = (s) => {
      const ov = propsOverlay(s)
      const G = 0.05
      const x0 = -2.0
      const z0 = 2.8
      const nx = Math.round((2.6 - x0) / G)
      const nz = Math.round((ROOM.maxZ - z0) / G)
      const seen = new Uint8Array(nx * nz)
      const free = (i, j) => !isBlocked(x0 + i * G, z0 + j * G, PLAYER.radius, 0, ov)
      const start = [Math.round((0.5 - x0) / G), 0]
      const queue = [start]
      seen[start[1] * nx + start[0]] = 1
      while (queue.length) {
        const [i, j] = queue.pop()
        if (z0 + j * G >= 5.0) return true
        for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const a = i + di
          const b = j + dj
          if (a < 0 || b < 0 || a >= nx || b >= nz || seen[b * nx + a]) continue
          seen[b * nx + a] = 1
          if (free(a, b)) queue.push([a, b])
        }
      }
      return false
    }
    let seed = 12345
    const rand = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648)
    const door = [(clear.min[0] + clear.max[0]) / 2, wallB.max[2]]
    const failures = []
    for (let seq = 0; seq < 36; seq++) {
      let s = {}
      let now = 0
      // 前 24 組:每發都朝門口(加一點偏移);其餘:基準方向依序轉一圈再加隨機
      const base = (seq / 12) * Math.PI * 2
      for (let shot = 0; shot < 25; shot++) {
        const e = s[TABLE] || { x: home(TABLE).x, z: home(TABLE).z }
        let a
        if (seq < 24) a = Math.atan2(door[1] - e.z, door[0] - e.x) + (rand() - 0.5) * 1.2
        else a = base + (rand() - 0.5) * 2
        s = knockProp(s, TABLE, [Math.cos(a), 0, Math.sin(a)], now).state
        const wait = rand() < 0.5 ? 100 + rand() * 300 : 3000
        for (let t = 0; t < wait; t += 50) {
          s = stepProps(s, 50)
          now += 50
          if (overlapsClear(propBox(s[TABLE]))) failures.push(`seq ${seq} shot ${shot}: in doorway at ${s[TABLE].x.toFixed(2)},${s[TABLE].z.toFixed(2)}`)
        }
        const b = propBox(s[TABLE])
        if (b.min[2] < wallB.max[2] - 1e-6 || b.min[0] < -2.0 - 1e-6 || b.max[0] > 2.6 + 1e-6) failures.push(`seq ${seq}: left the reception room`)
      }
      s = run(s)
      if (!reachable(s)) failures.push(`seq ${seq}: doorway sealed with table at ${s[TABLE].x.toFixed(2)},${s[TABLE].z.toFixed(2)}`)
    }
    expect(failures.slice(0, 5)).toEqual([])
  })

  it('the table stops at a player in its path', () => {
    const h = home(TABLE)
    // 北側(-z)是通往門口的空地
    const player = { id: 'a', pos: [h.x, 0, tableBox.min[2] - PLAYER.radius - 0.3] }
    let s = knockProp({}, TABLE, [0, 0, -1], 0).state
    for (let i = 0; i < 200 && hasMovingProps(s); i++) {
      s = stepProps(s, 50, [player])
      expect(circleBlockedByBox(player.pos[0], player.pos[2], PLAYER.radius - PROP_PLAYER_RADIUS_TOLERANCE, 0, propBox(s[TABLE]))).toBe(false)
    }
    expect(s[TABLE].moving).toBe(false)
    expect(s[TABLE].z).toBeLessThan(h.z - 0.1) // 有往玩家方向移動才停
  })

  it('dropPlayersOffProp moves players standing on the table to a free floor spot (first knock only)', () => {
    const h = home(TABLE)
    const top = tableBox.max[1]
    const players = [
      { id: 'on', pos: [h.x + 0.2, top, h.z - 0.1], pose: 'stand' },
      { id: 'jump', pos: [h.x, top + 0.6, h.z], pose: 'stand' },
      { id: 'floor', pos: [h.x + 1.5, 0, h.z - 1], pose: 'stand' },
      { id: 'edge', pos: [tableBox.max[0] + 0.1, top, h.z], pose: 'stand' }, // 圓心不在桌上:本來就沒被撐住
    ]
    const after = knockProp({}, TABLE, [1, 0, 0], 0).state
    const ov = propsOverlay(after)
    const out = dropPlayersOffProp({}, TABLE, players, ov)
    expect(out.map((o) => o.id).sort()).toEqual(['jump', 'on'])
    for (const { pos } of out) {
      expect(pos[1]).toBe(0)
      expect(isBlocked(pos[0], pos[2], PLAYER.radius, 0, ov)).toBe(false)
    }
    // 已被射走(再射)、不可站立的物品、未知 id:不處理
    expect(dropPlayersOffProp(after, TABLE, players, ov)).toEqual([])
    expect(dropPlayersOffProp({}, CHAIR, [{ id: 'x', pos: [home(CHAIR).x, 1.2, home(CHAIR).z] }], ov)).toEqual([])
    expect(dropPlayersOffProp({}, 'nope', players, ov)).toEqual([])
  })
})

describe('bounds and player safety', () => {
  const PM = PROP_PHYSICS.monitor
  const effR = PLAYER.radius - PROP_PLAYER_RADIUS_TOLERANCE
  const overlaps = (e, p) => circleBlockedByBox(p.pos[0], p.pos[2], effR, p.pos[1] || 0, propBox(e))

  it('player tolerance matches the server rule', () => {
    expect(PROP_PLAYER_RADIUS_TOLERANCE).toBe(COLLISION_RADIUS_TOLERANCE)
  })

  it('rapid alternating re-shots never lift a monitor out of the room', () => {
    let s = knockProp({}, MON, [0, 0, 1], 0).state
    let maxY = 0
    for (let t = 75; t <= 10_000; t += 75) {
      s = stepProps(s, 75)
      s = knockProp(s, MON, t % 150 ? [1, 0, 0] : [-1, 0, 0], t).state
      const e = s[MON]
      expect([e.x, e.y, e.z].every(Number.isFinite)).toBe(true)
      expect(propBox(e).max[1]).toBeLessThanOrEqual(ROOM.height + 1e-9)
      expect(e.vy).toBeLessThanOrEqual(PROP_MAX_UP_SPEED)
      expect(Math.hypot(e.vx, e.vz)).toBeLessThanOrEqual(PM.maxSpeed + 1e-9)
      maxY = Math.max(maxY, e.y)
    }
    expect(maxY).toBeLessThan(home(MON).y + 0.5) // 不會越打越高
  })

  it('clamps at the ceiling even with an absurd upward speed', () => {
    const base = knockProp({}, MON, [0, 0, 1], 0).state
    let s = { [MON]: { ...base[MON], vy: 500, vx: 0, vz: 0 } }
    for (let i = 0; i < 100 && hasMovingProps(s); i++) {
      s = stepProps(s, 50)
      const e = s[MON]
      expect(propBox(e).max[1]).toBeLessThanOrEqual(ROOM.height + 1e-9)
      expect(e.vy).toBeLessThanOrEqual(PROP_MAX_UP_SPEED)
    }
    expect(s[MON].moving).toBe(false)
    expect(knockProp(s, MON, [1, 0, 0], 1).entry.vy).toBeLessThanOrEqual(PROP_MAX_UP_SPEED)
  })

  it('a player overlapping by less than the server tolerance does not stop a sliding chair', () => {
    const h = home(CHAIR)
    const side = { id: 'a', pos: [h.x + PROP_PHYSICS.chair.boxHalf + PLAYER.radius - 0.005, 0, h.z + 0.8] }
    const e = run(knockProp({}, CHAIR, [0, 0, 1], 0).state, [side])[CHAIR]
    expect(e.z - h.z).toBeGreaterThan(1.0) // 滑過玩家身旁才停
  })

  it('landing push-out never shoves the monitor into a player', () => {
    const base = knockProp({}, MON, [0, 0, 1], 0).state
    const z = deskBox.max[2] + PM.radius - 0.05 // 落地時與桌子側面重疊 → 會被往 +z 推出
    const e0 = { ...base[MON], x: (deskBox.min[0] + deskBox.max[0]) / 2, y: 0.02, z, vx: 0, vy: 0, vz: 0, spin: 0, tilt: PM.fallenTilt }
    const player = { id: 'a', pos: [e0.x, 0, z + PM.boxHalf + effR + 0.02] }
    expect(overlaps(e0, player)).toBe(false)
    // 沒有玩家時確實會被推出、推出後會碰到玩家(確認情境成立)
    const free = run({ [MON]: e0 })[MON]
    expect(free.z).toBeGreaterThan(z + 0.03)
    expect(overlaps(free, player)).toBe(true)
    let s = { [MON]: e0 }
    for (let i = 0; i < 100 && hasMovingProps(s); i++) {
      s = stepProps(s, 20, [player])
      expect(overlaps(s[MON], player)).toBe(false)
    }
    expect(s[MON].moving).toBe(false)
  })

  it('timeout settle does not drop a monitor onto a player below it', () => {
    const base = knockProp({}, MON, [0, 0, 1], 0).state
    const player = { id: 'a', pos: [0, 0, 0] }
    const e0 = { ...base[MON], x: 0, y: PLAYER.bodyHeight.stand + 0.1, z: 0, vx: 0, vy: 0, vz: 0, moveMs: PROP_MAX_MOVE_MS - 5 }
    expect(overlaps(e0, player)).toBe(false)
    const e = stepProps({ [MON]: e0 }, 50, [player])[MON]
    expect(e.moving).toBe(false)
    expect(overlaps(e, player)).toBe(false)
    // 沒有玩家時照樣落到地上
    expect(stepProps({ [MON]: e0 }, 50)[MON].y).toBe(0)
  })
})

describe('stepProps purity', () => {
  it('returns the same object when nothing moves, and never mutates its input', () => {
    const empty = {}
    expect(stepProps(empty, 50)).toBe(empty)
    const s = knockProp({}, CHAIR, [0, 0, 1], 0).state
    const snap = JSON.parse(JSON.stringify(s))
    const next = stepProps(s, 50)
    expect(s).toEqual(snap)
    expect(next[CHAIR].z).toBeGreaterThan(s[CHAIR].z)
    expect(stepProps(s, 0)).toBe(s)
    const stopped = run(s)
    expect(stepProps(stopped, 50)).toBe(stopped)
  })

  it('propsSnapshot reports position, pose and remaining time', () => {
    const s = knockProp({}, CHAIR, [0, 0, 1], 1000).state
    const [p] = propsSnapshot(s, 6000)
    const h = home(CHAIR)
    expect(p).toEqual({ id: CHAIR, kind: 'chair', pos: [h.x, 0, h.z], yaw: h.yaw, tilt: 0, moving: true, remainingMs: 15000 })
  })
})

describe('collision overlay', () => {
  const settled = () => run(knockProp({}, CHAIR, [0, 0, 1], 0).state)

  it('the moved box blocks players; the home box no longer does', () => {
    const s = settled()
    const e = s[CHAIR]
    const h = home(CHAIR)
    const ov = propsOverlay(s)
    expect(ov.has(CHAIR)).toBe(true)
    expect(ov.boxes.map((b) => b.id)).toEqual([CHAIR])
    expect(isBlocked(e.x, e.z, PLAYER.radius, 0, ov)).toBe(true)
    expect(isBlocked(h.x, h.z, PLAYER.radius, 0, ov)).toBe(false)
    // 只停用原位(沒有移動後的盒)時不擋
    expect(isBlocked(e.x, e.z, PLAYER.radius, 0, [CHAIR])).toBe(false)
    // 跳得夠高可以越過倒下的椅子
    expect(isBlocked(e.x, e.z, PLAYER.radius, PROP_PHYSICS.chair.fallenHeight, ov)).toBe(false)
  })

  it('moveCircle and evaluateMove are stopped by the moved box', () => {
    const s = settled()
    const e = s[CHAIR]
    const ov = propsOverlay(s)
    const startZ = e.z + 1
    let r = { x: e.x, z: startZ }
    for (let i = 0; i < 20; i++) r = moveCircle(r.x, r.z, 0, -0.05, PLAYER.radius, 0, ov)
    expect(r.z).toBeGreaterThanOrEqual(e.z + PROP_PHYSICS.chair.boxHalf + PLAYER.radius - 1e-6)
    const p = { pos: [e.x, 0, startZ], pose: 'stand', move: createMoveBucket(0) }
    expect(evaluateMove(p, [e.x, 0, e.z], 1000, ov).ok).toBe(false)
  })

  it('isShootOriginValid treats the moved box as solid', () => {
    const s = settled()
    const e = s[CHAIR]
    const b = propBox(s[CHAIR])
    const inside = [e.x, b.max[1] - 0.1, e.z] // 趴姿眼高附近、仍在倒下椅子的盒內
    const ok = isShootOriginValid(inside, [e.x, 0, e.z], false, [CHAIR])
    const blocked = isShootOriginValid(inside, [e.x, 0, e.z], false, propsOverlay(s))
    expect(blocked).toBe(false)
    expect(ok).toBe(true)
  })

  it('raycast boxes hit the moved chair (same id, can be re-shot) and pass through its home spot', () => {
    const s = settled()
    const e = s[CHAIR]
    const h = home(CHAIR)
    const boxes = propsRaycastBoxes(s)
    expect(boxes).toEqual(propsRaycastBoxes(propsOverlay(s)))
    expect(boxes.filter((b) => b.id === CHAIR)).toHaveLength(1)
    const atMoved = raycastWorld([e.x - 2, 0.3, e.z], [1, 0, 0], { boxes })
    expect(atMoved).toMatchObject({ kind: 'box', boxId: CHAIR })
    const atHome = raycastWorld([h.x - 2, 0.3, h.z], [1, 0, 0], { boxes, maxDist: 2.5 })
    expect(atHome?.boxId).not.toBe(CHAIR)
  })

  it('activeColliders without an overlay is the original list', () => {
    expect(activeColliders()).toBe(COLLIDERS)
    expect(activeColliders(null)).toBe(COLLIDERS)
    expect(activeColliders(new Set([CHAIR]))).toHaveLength(COLLIDERS.length - 1)
  })

  it('pushPlayersOutOfProps accepts an overlay and avoids still-knocked moved boxes', () => {
    // 另一張椅子被打飛停在 CHAIR 原位旁邊;CHAIR 回復時站在原位的玩家不能被推進那個盒子
    const h = home(CHAIR)
    const other = 'chair-1-1'
    const base = knockProp({}, other, [0, 0, 1], 0).state
    const parked = { ...base[other], x: h.x, z: h.z + 0.6, moving: false, tilt: PROP_PHYSICS.chair.fallenTilt }
    const after = { [other]: parked }
    const ov = propsOverlay(after)
    const out = pushPlayersOutOfProps([CHAIR], [{ id: 'a', pos: [h.x, 0, h.z + 0.3] }], ov)
    expect(out).toHaveLength(1)
    const [x, y, z] = out[0].pos
    expect(isBlocked(x, z, PLAYER.radius, y, ov)).toBe(false)
  })
})
