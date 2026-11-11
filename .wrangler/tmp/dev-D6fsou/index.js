var __defProp = Object.defineProperty;
var __name = (target, value) => __defProp(target, "name", { value, configurable: true });

// worker/Room.js
import { DurableObject } from "cloudflare:workers";

// shared/layout.js
var ROOM = {
  minX: -7,
  maxX: 7,
  minZ: -5,
  maxZ: 5,
  height: 3
};
var PLAYER = {
  radius: 0.3,
  // 各姿勢的身體高度與眼睛高度(須與 utils/office/stickman.js 的模型一致)
  bodyHeight: { stand: 1.75, crouch: 1.3, prone: 0.3 },
  eyeHeight: { stand: 1.6, crouch: 1.15, prone: 0.4 },
  walkSpeed: { stand: 3.2, crouch: 1.6, prone: 0.8 },
  // 趴下時身體從腳底沿面向(-z 旋轉 yaw)平躺的長度
  proneLength: 1.75
};
var DESK = { w: 1.6, d: 0.75, h: 0.75 };
var CHAIR = { w: 0.55, d: 0.55, h: 0.9 };
var CHAIR_COLLIDER_HEIGHT = 1.25;
var CLUSTER_CENTERS = [
  { x: -4, z: -2 },
  { x: 0, z: -2 },
  { x: 4, z: -2 },
  { x: -4, z: 2 },
  { x: 0, z: 2 },
  { x: 4, z: 2 }
];
var DESKS = [];
var CHAIRS = [];
CLUSTER_CENTERS.forEach((center, index) => {
  ;
  [-1, 1].forEach((side) => {
    DESKS.push({
      id: `desk-${index}-${side}`,
      x: center.x,
      z: center.z + side * (DESK.d / 2 + 0.02),
      side,
      ...DESK
    });
    CHAIRS.push({
      id: `chair-${index}-${side}`,
      x: center.x,
      z: center.z + side * (DESK.d + 0.55),
      side,
      ...CHAIR
    });
  });
});
var CRATES = [
  { id: "crate-0", x: -6.2, z: -4.2, w: 0.7, d: 0.5, h: 0.45 },
  { id: "crate-1", x: -5.4, z: -4.4, w: 0.6, d: 0.5, h: 0.4 }
];
var PARTITION = { w: 1.6, h: 0.3, d: 0.02 };
var MONITOR = { w: 0.55, h: 0.32, d: 0.03, y: 0.3, zOffset: 0.1 };
var partitionOf = /* @__PURE__ */ __name((desk) => ({
  x: desk.x,
  z: desk.z + (desk.side > 0 ? -desk.d / 2 + 0.01 : desk.d / 2 - 0.01),
  ...PARTITION
}), "partitionOf");
var monitorOf = /* @__PURE__ */ __name((desk) => ({
  x: desk.x,
  z: desk.z + (desk.side > 0 ? -MONITOR.zOffset : MONITOR.zOffset),
  ...MONITOR
}), "monitorOf");
var box = /* @__PURE__ */ __name((id, x, z, w, d, minY, maxY) => ({
  id,
  min: [x - w / 2, minY, z - d / 2],
  max: [x + w / 2, maxY, z + d / 2]
}), "box");
var COLLIDERS = [
  ...DESKS.flatMap((desk) => {
    const part = partitionOf(desk);
    const mon = monitorOf(desk);
    return [
      box(desk.id, desk.x, desk.z, desk.w, desk.d, 0, desk.h),
      box(`${desk.id}-partition`, part.x, part.z, part.w, part.d, desk.h, desk.h + part.h),
      box(`${desk.id}-monitor`, mon.x, mon.z, mon.w, mon.d, desk.h + mon.y - mon.h / 2, desk.h + mon.y + mon.h / 2)
    ];
  }),
  ...CHAIRS.map((chair) => box(chair.id, chair.x, chair.z, chair.w, chair.d, 0, CHAIR_COLLIDER_HEIGHT)),
  ...CRATES.map((crate) => box(crate.id, crate.x, crate.z, crate.w, crate.d, 0, crate.h))
];
var SPAWN_POINTS = [
  { x: -6, z: 0 },
  { x: 6, z: 0 },
  { x: 0, z: -4.2 },
  { x: 0, z: 4.2 },
  { x: -6, z: 4 },
  { x: 6, z: -4 }
];

// shared/protocol.js
var MAX_PLAYERS = 10;
var MAX_NAME_LENGTH = 16;
var MAX_CHAT_LENGTH = 200;
var POSES = ["stand", "crouch", "prone"];
var C2S = {
  JOIN: "join",
  STATE: "state",
  CHAT: "chat",
  SHOOT: "shoot"
};
var S2C = {
  WELCOME: "welcome",
  PLAYER_JOIN: "player_join",
  PLAYER_LEAVE: "player_leave",
  SNAPSHOT: "snapshot",
  CHAT: "chat",
  PAINT: "paint",
  CORRECT: "correct",
  ERROR: "error"
};
var MAX_PITCH = 1.5;
var isFiniteNum = /* @__PURE__ */ __name((n) => typeof n === "number" && Number.isFinite(n), "isFiniteNum");
var isVec3 = /* @__PURE__ */ __name((v) => Array.isArray(v) && v.length === 3 && v.every(isFiniteNum), "isVec3");
var isObject = /* @__PURE__ */ __name((v) => v !== null && typeof v === "object" && !Array.isArray(v), "isObject");
var COORD_LIMIT = 1e3;
var UNSAFE_CHARS = /[\u0000-\u001f\u007f​-‏‪-‮⁦-⁩﻿]/g;
function sanitizeName(name) {
  return String(name).replace(UNSAFE_CHARS, "").trim();
}
__name(sanitizeName, "sanitizeName");
function normalizeAngle(a) {
  const twoPi = Math.PI * 2;
  let r = a % twoPi;
  if (r > Math.PI) r -= twoPi;
  else if (r < -Math.PI) r += twoPi;
  return r;
}
__name(normalizeAngle, "normalizeAngle");
function validateClientMessage(data) {
  if (!isObject(data) || typeof data.type !== "string") return fail("bad message");
  switch (data.type) {
    case C2S.JOIN: {
      if (typeof data.name !== "string") return fail("bad name");
      const name = sanitizeName(data.name);
      if (name.length === 0 || name.length > MAX_NAME_LENGTH) return fail("bad name");
      return { ok: true, msg: { type: C2S.JOIN, name } };
    }
    case C2S.STATE: {
      if (!isVec3(data.pos) || data.pos.some((n) => Math.abs(n) > COORD_LIMIT)) return fail("bad pos");
      if (!isFiniteNum(data.yaw) || !isFiniteNum(data.pitch)) return fail("bad angle");
      if (!POSES.includes(data.pose)) return fail("bad pose");
      return {
        ok: true,
        msg: {
          type: C2S.STATE,
          pos: [...data.pos],
          yaw: normalizeAngle(data.yaw),
          pitch: Math.max(-MAX_PITCH, Math.min(MAX_PITCH, data.pitch)),
          pose: data.pose
        }
      };
    }
    case C2S.CHAT: {
      if (typeof data.text !== "string") return fail("bad text");
      const text = sanitizeName(data.text);
      if (text.length === 0 || text.length > MAX_CHAT_LENGTH) return fail("bad text");
      return { ok: true, msg: { type: C2S.CHAT, text } };
    }
    case C2S.SHOOT: {
      if (!isVec3(data.origin) || data.origin.some((n) => Math.abs(n) > COORD_LIMIT)) return fail("bad origin");
      if (!isVec3(data.dir)) return fail("bad dir");
      const len = Math.hypot(...data.dir);
      if (len < 1e-6) return fail("bad dir");
      return {
        ok: true,
        msg: { type: C2S.SHOOT, origin: [...data.origin], dir: data.dir.map((n) => n / len) }
      };
    }
    default:
      return fail("unknown type");
  }
}
__name(validateClientMessage, "validateClientMessage");
function parseClientMessage(raw) {
  if (typeof raw !== "string" || raw.length > 2048) return fail("bad payload");
  let data;
  try {
    data = JSON.parse(raw);
  } catch {
    return fail("bad json");
  }
  return validateClientMessage(data);
}
__name(parseClientMessage, "parseClientMessage");
var encode = /* @__PURE__ */ __name((msg) => JSON.stringify(msg), "encode");
function fail(error) {
  return { ok: false, error };
}
__name(fail, "fail");

// shared/raycast.js
var EPS = 1e-9;
function raycastBox(origin, dir, min, max, maxDist = Infinity) {
  let tmin = -Infinity;
  let tmax = Infinity;
  let axis = -1;
  let sign = 0;
  for (let i = 0; i < 3; i++) {
    if (Math.abs(dir[i]) < EPS) {
      if (origin[i] < min[i] || origin[i] > max[i]) return null;
      continue;
    }
    let t1 = (min[i] - origin[i]) / dir[i];
    let t2 = (max[i] - origin[i]) / dir[i];
    let s = -1;
    if (t1 > t2) {
      ;
      [t1, t2] = [t2, t1];
      s = 1;
    }
    if (t1 > tmin) {
      tmin = t1;
      axis = i;
      sign = s;
    }
    if (t2 < tmax) tmax = t2;
    if (tmin > tmax) return null;
  }
  if (tmax < 0) return null;
  if (tmin < 0) {
    let major = 0;
    for (let i = 1; i < 3; i++) if (Math.abs(dir[i]) > Math.abs(dir[major])) major = i;
    const n = [0, 0, 0];
    n[major] = dir[major] > 0 ? -1 : 1;
    return { distance: 0, point: [origin[0], origin[1], origin[2]], normal: n };
  }
  if (axis < 0 || tmin > maxDist) return null;
  const normal = [0, 0, 0];
  normal[axis] = sign;
  return { distance: tmin, point: at(origin, dir, tmin), normal };
}
__name(raycastBox, "raycastBox");
function raycastBoxes(origin, dir, boxes = COLLIDERS, maxDist = Infinity) {
  let best = null;
  for (const box2 of boxes) {
    const hit = raycastBox(origin, dir, box2.min, box2.max, maxDist);
    if (hit && (!best || hit.distance < best.distance)) {
      best = { ...hit, box: box2 };
    }
  }
  return best;
}
__name(raycastBoxes, "raycastBoxes");
function raycastPlayer(origin, dir, pos, pose = "stand", maxDist = Infinity, yaw = 0) {
  if (pose === "prone") return raycastProne(origin, dir, pos, yaw, maxDist);
  const r = PLAYER.radius;
  const h = PLAYER.bodyHeight[pose] ?? PLAYER.bodyHeight.stand;
  const y0 = pos[1];
  const y1 = pos[1] + h;
  let best = null;
  const consider = /* @__PURE__ */ __name((t, normal) => {
    if (t < 0 || t > maxDist) return;
    if (!best || t < best.distance) best = { distance: t, point: at(origin, dir, t), normal };
  }, "consider");
  const ox = origin[0] - pos[0];
  const oz = origin[2] - pos[2];
  const a = dir[0] * dir[0] + dir[2] * dir[2];
  if (a > EPS) {
    const b = 2 * (ox * dir[0] + oz * dir[2]);
    const c = ox * ox + oz * oz - r * r;
    const disc = b * b - 4 * a * c;
    if (disc >= 0) {
      const t = (-b - Math.sqrt(disc)) / (2 * a);
      const y = origin[1] + t * dir[1];
      if (t >= 0 && y >= y0 && y <= y1) {
        const px = ox + t * dir[0];
        const pz = oz + t * dir[2];
        consider(t, [px / r, 0, pz / r]);
      }
    }
  }
  if (Math.abs(dir[1]) > EPS) {
    for (const [yy, ny] of [[y1, 1], [y0, -1]]) {
      const t = (yy - origin[1]) / dir[1];
      if (t < 0) continue;
      const px = ox + t * dir[0];
      const pz = oz + t * dir[2];
      if (px * px + pz * pz <= r * r) consider(t, [0, ny, 0]);
    }
  }
  return best;
}
__name(raycastPlayer, "raycastPlayer");
function raycastProne(origin, dir, pos, yaw, maxDist) {
  const s = Math.sin(yaw);
  const c = Math.cos(yaw);
  const fwd = [-s, 0, -c];
  const right = [c, 0, -s];
  const toLocal = /* @__PURE__ */ __name((v) => [v[0] * right[0] + v[2] * right[2], v[1], v[0] * fwd[0] + v[2] * fwd[2]], "toLocal");
  const rel = [origin[0] - pos[0], origin[1] - pos[1], origin[2] - pos[2]];
  const r = PLAYER.radius;
  const hit = raycastBox(
    toLocal(rel),
    toLocal(dir),
    [-r, 0, 0],
    [r, PLAYER.bodyHeight.prone, PLAYER.proneLength],
    maxDist
  );
  if (!hit) return null;
  const [nr, ny, nf] = hit.normal;
  return {
    distance: hit.distance,
    point: at(origin, dir, hit.distance),
    normal: [nr * right[0] + nf * fwd[0], ny, nr * right[2] + nf * fwd[2]]
  };
}
__name(raycastProne, "raycastProne");
function raycastRoom(origin, dir, maxDist = Infinity) {
  const min = [ROOM.minX, 0, ROOM.minZ];
  const max = [ROOM.maxX, ROOM.height, ROOM.maxZ];
  let best = null;
  for (let i = 0; i < 3; i++) {
    if (Math.abs(dir[i]) < EPS) continue;
    const forward = dir[i] > 0;
    const plane = forward ? max[i] : min[i];
    const t = (plane - origin[i]) / dir[i];
    if (t < 0 || t > maxDist) continue;
    if (!best || t < best.distance) {
      const normal = [0, 0, 0];
      normal[i] = forward ? -1 : 1;
      best = { distance: t, point: at(origin, dir, t), normal };
    }
  }
  if (best) {
    best.point = best.point.map((v, i) => Math.min(max[i], Math.max(min[i], v)));
  }
  return best;
}
__name(raycastRoom, "raycastRoom");
function raycastWorld(origin, dir, { players = [], ignoreId = null, boxes = COLLIDERS, maxDist = 100 } = {}) {
  let best = null;
  const room = raycastRoom(origin, dir, maxDist);
  if (room) best = { kind: "wall", ...room };
  const box2 = raycastBoxes(origin, dir, boxes, best ? best.distance : maxDist);
  if (box2 && (!best || box2.distance < best.distance)) {
    best = { kind: "box", distance: box2.distance, point: box2.point, normal: box2.normal, boxId: box2.box.id };
  }
  for (const p of players) {
    if (p.id === ignoreId) continue;
    const hit = raycastPlayer(origin, dir, p.pos, p.pose, best ? best.distance : maxDist, p.yaw ?? 0);
    if (hit && (!best || hit.distance < best.distance)) {
      best = { kind: "player", ...hit, targetId: p.id };
    }
  }
  return best;
}
__name(raycastWorld, "raycastWorld");
function at(o, d, t) {
  return [o[0] + d[0] * t, o[1] + d[1] * t, o[2] + d[2] * t];
}
__name(at, "at");

// shared/collision.js
var circleHitsBox = /* @__PURE__ */ __name((x, z, radius, box2) => {
  const nearestX = Math.max(box2.min[0], Math.min(x, box2.max[0]));
  const nearestZ = Math.max(box2.min[2], Math.min(z, box2.max[2]));
  const dx = x - nearestX;
  const dz = z - nearestZ;
  return dx * dx + dz * dz < radius * radius;
}, "circleHitsBox");
var isBlocked = /* @__PURE__ */ __name((x, z, radius = PLAYER.radius) => {
  if (x - radius < ROOM.minX || x + radius > ROOM.maxX) return true;
  if (z - radius < ROOM.minZ || z + radius > ROOM.maxZ) return true;
  return COLLIDERS.some((box2) => circleHitsBox(x, z, radius, box2));
}, "isBlocked");

// worker/rules.js
var MOVE_SPEED_FACTOR = 1.3;
var MOVE_BUDGET_CAP = 2;
var COLLISION_RADIUS_TOLERANCE = 0.01;
var MAX_SHOOT_ORIGIN_OFFSET = 0.5;
var SHOOT_COOLDOWN_MS = 150;
var CHAT_WINDOW_MS = 1e3;
var CHAT_MAX_PER_WINDOW = 3;
var STATE_MAX_PER_SEC = 30;
var MESSAGE_MAX_PER_SEC = 60;
var JOIN_TIMEOUT_MS = 1e4;
var MAX_CONNECTIONS = 20;
function createLimiter() {
  return { start: 0, count: 0 };
}
__name(createLimiter, "createLimiter");
function rateAllow(limiter, now, max, windowMs = 1e3) {
  if (now - limiter.start >= windowMs) {
    limiter.start = now;
    limiter.count = 0;
  }
  if (limiter.count >= max) return false;
  limiter.count++;
  return true;
}
__name(rateAllow, "rateAllow");
function cooldownReady(holder, key, now, ms) {
  if (now - holder[key] < ms) return false;
  holder[key] = now;
  return true;
}
__name(cooldownReady, "cooldownReady");
function createMoveBucket(now) {
  return { budget: MOVE_BUDGET_CAP, at: now };
}
__name(createMoveBucket, "createMoveBucket");
function evaluateMove(player, newPos, now) {
  const bucket = player.move;
  const dt = Math.max(0, (now - bucket.at) / 1e3);
  bucket.at = now;
  const rate = (PLAYER.walkSpeed[player.pose] ?? PLAYER.walkSpeed.stand) * MOVE_SPEED_FACTOR;
  bucket.budget = Math.min(MOVE_BUDGET_CAP, bucket.budget + rate * dt);
  const dist = Math.hypot(newPos[0] - player.pos[0], newPos[2] - player.pos[2]);
  if (dist > bucket.budget) return { ok: false, reason: "speed" };
  if (isBlocked(newPos[0], newPos[2], PLAYER.radius - COLLISION_RADIUS_TOLERANCE)) {
    return { ok: false, reason: "blocked" };
  }
  bucket.budget -= dist;
  return { ok: true, pos: [newPos[0], 0, newPos[2]] };
}
__name(evaluateMove, "evaluateMove");
var insideBox = /* @__PURE__ */ __name((p, box2) => p[0] >= box2.min[0] && p[0] <= box2.max[0] && p[1] >= box2.min[1] && p[1] <= box2.max[1] && p[2] >= box2.min[2] && p[2] <= box2.max[2], "insideBox");
function isShootOriginValid(origin, eye) {
  const d = Math.hypot(origin[0] - eye[0], origin[1] - eye[1], origin[2] - eye[2]);
  if (d > MAX_SHOOT_ORIGIN_OFFSET) return false;
  if (origin[0] < ROOM.minX || origin[0] > ROOM.maxX) return false;
  if (origin[1] < 0 || origin[1] > ROOM.height) return false;
  if (origin[2] < ROOM.minZ || origin[2] > ROOM.maxZ) return false;
  return !COLLIDERS.some((box2) => insideBox(origin, box2));
}
__name(isShootOriginValid, "isShootOriginValid");
function spawnYaw(x, z) {
  return Math.atan2(x, z);
}
__name(spawnYaw, "spawnYaw");
function isOriginAllowed(origin, requestHost) {
  if (origin === null || origin === void 0 || origin === "") return true;
  let u;
  try {
    u = new URL(origin);
  } catch {
    return false;
  }
  if (u.host === requestHost) return true;
  return ["localhost", "127.0.0.1", "[::1]"].includes(u.hostname);
}
__name(isOriginAllowed, "isOriginAllowed");

// worker/Room.js
var COLORS = ["#e6194b", "#3cb44b", "#4363d8", "#f58231", "#911eb4", "#42d4f4", "#f032e6", "#bfef45", "#fabed4", "#469990"];
var BROADCAST_MS = 50;
var CORRECT_MIN_INTERVAL_MS = 100;
var MAX_SHOT_DIST = 100;
var Room = class extends DurableObject {
  static {
    __name(this, "Room");
  }
  constructor(ctx, env) {
    super(ctx, env);
    this.players = /* @__PURE__ */ new Map();
    this.sessions = /* @__PURE__ */ new Set();
    this.nextId = 1;
    this.timer = null;
  }
  async fetch(request) {
    if (request.headers.get("Upgrade") !== "websocket") {
      return new Response("Expected WebSocket", { status: 426 });
    }
    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    server.accept();
    if (this.players.size >= MAX_PLAYERS || this.sessions.size >= MAX_CONNECTIONS) {
      server.send(encode({ type: S2C.ERROR, error: "room full" }));
      server.close(1013, "room full");
      return new Response(null, { status: 101, webSocket: client });
    }
    const id = String(this.nextId++);
    const session = {
      id,
      ws: server,
      joined: false,
      chatTimes: [],
      lastShoot: 0,
      lastCorrect: 0,
      msgLimiter: createLimiter(),
      stateLimiter: createLimiter(),
      joinTimer: null
    };
    this.sessions.add(session);
    session.joinTimer = setTimeout(() => {
      if (!session.joined) this.drop(session, 1008, "join timeout");
    }, JOIN_TIMEOUT_MS);
    server.addEventListener("message", (e) => this.onMessage(session, e.data));
    server.addEventListener("close", () => this.onLeave(session));
    server.addEventListener("error", () => this.onLeave(session));
    return new Response(null, { status: 101, webSocket: client });
  }
  onMessage(session, raw) {
    const now = Date.now();
    if (!rateAllow(session.msgLimiter, now, MESSAGE_MAX_PER_SEC)) {
      this.drop(session, 1008, "rate limit");
      return;
    }
    const parsed = parseClientMessage(raw);
    if (!parsed.ok) return;
    const msg = parsed.msg;
    if (msg.type === C2S.JOIN) return this.onJoin(session, msg);
    if (!session.joined) return;
    if (msg.type === C2S.STATE) return this.onState(session, msg, now);
    if (msg.type === C2S.CHAT) return this.onChat(session, msg, now);
    if (msg.type === C2S.SHOOT) return this.onShoot(session, msg, now);
  }
  onJoin(session, msg) {
    if (session.joined) return;
    if (this.players.size >= MAX_PLAYERS) {
      this.send(session.ws, { type: S2C.ERROR, error: "room full" });
      this.drop(session, 1013, "room full");
      return;
    }
    const used = new Set([...this.players.values()].map((p) => p.color));
    const color = COLORS.find((c) => !used.has(c)) ?? COLORS[0];
    const spawn = this.pickSpawn();
    const now = Date.now();
    Object.assign(session, {
      joined: true,
      name: msg.name,
      color,
      pos: [spawn.x, 0, spawn.z],
      yaw: spawnYaw(spawn.x, spawn.z),
      pitch: 0,
      pose: "stand",
      move: createMoveBucket(now)
    });
    clearTimeout(session.joinTimer);
    this.players.set(session.id, session);
    this.send(session.ws, {
      type: S2C.WELCOME,
      id: session.id,
      you: { pos: session.pos, yaw: session.yaw },
      players: [...this.players.values()].map(publicPlayer)
    });
    this.broadcast({ type: S2C.PLAYER_JOIN, player: publicPlayer(session) }, session.id);
    this.startTimer();
  }
  // 選離現有玩家最遠的出生點
  pickSpawn() {
    let best = SPAWN_POINTS[0];
    let bestScore = -1;
    for (const sp of SPAWN_POINTS) {
      let score = Infinity;
      for (const p of this.players.values()) {
        score = Math.min(score, Math.hypot(p.pos[0] - sp.x, p.pos[2] - sp.z));
      }
      if (score > bestScore) {
        bestScore = score;
        best = sp;
      }
    }
    return best;
  }
  onState(p, msg, now) {
    if (!rateAllow(p.stateLimiter, now, STATE_MAX_PER_SEC)) return;
    const result = evaluateMove(p, msg.pos, now);
    if (result.ok) {
      p.pos = result.pos;
    } else if (now - p.lastCorrect >= CORRECT_MIN_INTERVAL_MS) {
      p.lastCorrect = now;
      this.send(p.ws, { type: S2C.CORRECT, pos: p.pos });
    }
    p.yaw = msg.yaw;
    p.pitch = msg.pitch;
    p.pose = msg.pose;
  }
  onChat(p, msg, now) {
    p.chatTimes = p.chatTimes.filter((t) => now - t < CHAT_WINDOW_MS);
    if (p.chatTimes.length >= CHAT_MAX_PER_WINDOW) return;
    p.chatTimes.push(now);
    this.broadcast({ type: S2C.CHAT, from: p.name, text: msg.text });
  }
  onShoot(p, msg, now) {
    if (!cooldownReady(p, "lastShoot", now, SHOOT_COOLDOWN_MS)) return;
    const eye = [p.pos[0], PLAYER.eyeHeight[p.pose], p.pos[2]];
    if (!isShootOriginValid(msg.origin, eye)) return;
    const hit = raycastWorld(msg.origin, msg.dir, {
      players: [...this.players.values()],
      ignoreId: p.id,
      maxDist: MAX_SHOT_DIST
    });
    if (!hit) return;
    const paint = {
      type: S2C.PAINT,
      from: p.id,
      origin: msg.origin,
      pos: hit.point,
      normal: hit.normal,
      color: p.color
    };
    if (hit.kind === "player") paint.targetId = hit.targetId;
    this.broadcast(paint);
  }
  drop(session, code, reason) {
    try {
      session.ws.close(code, reason);
    } catch {
    }
    this.onLeave(session);
  }
  onLeave(session) {
    clearTimeout(session.joinTimer);
    this.sessions.delete(session);
    if (!this.players.delete(session.id)) return;
    this.broadcast({ type: S2C.PLAYER_LEAVE, id: session.id });
    try {
      session.ws.close();
    } catch {
    }
    if (this.players.size === 0) this.stopTimer();
  }
  startTimer() {
    if (this.timer) return;
    this.timer = setInterval(() => {
      this.broadcast({ type: S2C.SNAPSHOT, players: [...this.players.values()].map(publicPlayer) });
    }, BROADCAST_MS);
  }
  stopTimer() {
    clearInterval(this.timer);
    this.timer = null;
  }
  send(ws, obj) {
    try {
      ws.send(encode(obj));
    } catch {
    }
  }
  broadcast(obj, exceptId = null) {
    const data = encode(obj);
    for (const p of this.players.values()) {
      if (p.id === exceptId) continue;
      try {
        p.ws.send(data);
      } catch {
      }
    }
  }
};
function publicPlayer(p) {
  return { id: p.id, name: p.name, color: p.color, pos: p.pos, yaw: p.yaw, pitch: p.pitch, pose: p.pose };
}
__name(publicPlayer, "publicPlayer");

// worker/index.js
var worker_default = {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === "/ws") {
      if (request.headers.get("Upgrade") !== "websocket") {
        return new Response("Expected WebSocket", { status: 426 });
      }
      if (!isOriginAllowed(request.headers.get("Origin"), url.host)) {
        return new Response("Forbidden", { status: 403 });
      }
      const stub = env.ROOM.get(env.ROOM.idFromName("main"));
      return stub.fetch(request);
    }
    return env.ASSETS.fetch(request);
  }
};

// node_modules/wrangler/templates/middleware/middleware-ensure-req-body-drained.ts
var drainBody = /* @__PURE__ */ __name(async (request, env, _ctx, middlewareCtx) => {
  try {
    return await middlewareCtx.next(request, env);
  } finally {
    try {
      if (request.body !== null && !request.bodyUsed) {
        const reader = request.body.getReader();
        while (!(await reader.read()).done) {
        }
      }
    } catch (e) {
      console.error("Failed to drain the unused request body.", e);
    }
  }
}, "drainBody");
var middleware_ensure_req_body_drained_default = drainBody;

// node_modules/wrangler/templates/middleware/middleware-miniflare3-json-error.ts
function reduceError(e) {
  return {
    name: e?.name,
    message: e?.message ?? String(e),
    stack: e?.stack,
    cause: e?.cause === void 0 ? void 0 : reduceError(e.cause)
  };
}
__name(reduceError, "reduceError");
var jsonError = /* @__PURE__ */ __name(async (request, env, _ctx, middlewareCtx) => {
  try {
    return await middlewareCtx.next(request, env);
  } catch (e) {
    const error = reduceError(e);
    const body = JSON.stringify(error);
    const headers = {
      "Content-Type": "application/json",
      "MF-Experimental-Error-Stack": "true"
    };
    const encoded = encodeURIComponent(body);
    if (encoded.length <= 8192) {
      headers["MF-Experimental-Error-Stack-Payload"] = encoded;
    }
    return new Response(body, { status: 500, headers });
  }
}, "jsonError");
var middleware_miniflare3_json_error_default = jsonError;

// .wrangler/tmp/bundle-QaHaFi/middleware-insertion-facade.js
var __INTERNAL_WRANGLER_MIDDLEWARE__ = [
  middleware_ensure_req_body_drained_default,
  middleware_miniflare3_json_error_default
];
var middleware_insertion_facade_default = worker_default;

// node_modules/wrangler/templates/middleware/common.ts
var __facade_middleware__ = [];
function __facade_register__(...args) {
  __facade_middleware__.push(...args.flat());
}
__name(__facade_register__, "__facade_register__");
function __facade_invokeChain__(request, env, ctx, dispatch, middlewareChain) {
  const [head, ...tail] = middlewareChain;
  const middlewareCtx = {
    dispatch,
    next(newRequest, newEnv) {
      return __facade_invokeChain__(newRequest, newEnv, ctx, dispatch, tail);
    }
  };
  return head(request, env, ctx, middlewareCtx);
}
__name(__facade_invokeChain__, "__facade_invokeChain__");
function __facade_invoke__(request, env, ctx, dispatch, finalMiddleware) {
  return __facade_invokeChain__(request, env, ctx, dispatch, [
    ...__facade_middleware__,
    finalMiddleware
  ]);
}
__name(__facade_invoke__, "__facade_invoke__");

// .wrangler/tmp/bundle-QaHaFi/middleware-loader.entry.ts
var __Facade_ScheduledController__ = class ___Facade_ScheduledController__ {
  constructor(scheduledTime, cron, noRetry) {
    this.scheduledTime = scheduledTime;
    this.cron = cron;
    this.#noRetry = noRetry;
  }
  scheduledTime;
  cron;
  static {
    __name(this, "__Facade_ScheduledController__");
  }
  #noRetry;
  noRetry() {
    if (!(this instanceof ___Facade_ScheduledController__)) {
      throw new TypeError("Illegal invocation");
    }
    this.#noRetry();
  }
};
function wrapExportedHandler(worker) {
  if (__INTERNAL_WRANGLER_MIDDLEWARE__ === void 0 || __INTERNAL_WRANGLER_MIDDLEWARE__.length === 0) {
    return worker;
  }
  for (const middleware of __INTERNAL_WRANGLER_MIDDLEWARE__) {
    __facade_register__(middleware);
  }
  const fetchDispatcher = /* @__PURE__ */ __name(function(request, env, ctx) {
    if (worker.fetch === void 0) {
      throw new Error("Handler does not export a fetch() function.");
    }
    return worker.fetch(request, env, ctx);
  }, "fetchDispatcher");
  return {
    ...worker,
    fetch(request, env, ctx) {
      const dispatcher = /* @__PURE__ */ __name(function(type, init) {
        if (type === "scheduled" && worker.scheduled !== void 0) {
          const controller = new __Facade_ScheduledController__(
            Date.now(),
            init.cron ?? "",
            () => {
            }
          );
          return worker.scheduled(controller, env, ctx);
        }
      }, "dispatcher");
      return __facade_invoke__(request, env, ctx, dispatcher, fetchDispatcher);
    }
  };
}
__name(wrapExportedHandler, "wrapExportedHandler");
function wrapWorkerEntrypoint(klass) {
  if (__INTERNAL_WRANGLER_MIDDLEWARE__ === void 0 || __INTERNAL_WRANGLER_MIDDLEWARE__.length === 0) {
    return klass;
  }
  for (const middleware of __INTERNAL_WRANGLER_MIDDLEWARE__) {
    __facade_register__(middleware);
  }
  return class extends klass {
    #fetchDispatcher = /* @__PURE__ */ __name((request, env, ctx) => {
      this.env = env;
      this.ctx = ctx;
      if (super.fetch === void 0) {
        throw new Error("Entrypoint class does not define a fetch() function.");
      }
      return super.fetch(request);
    }, "#fetchDispatcher");
    #dispatcher = /* @__PURE__ */ __name((type, init) => {
      if (type === "scheduled" && super.scheduled !== void 0) {
        const controller = new __Facade_ScheduledController__(
          Date.now(),
          init.cron ?? "",
          () => {
          }
        );
        return super.scheduled(controller);
      }
    }, "#dispatcher");
    fetch(request) {
      return __facade_invoke__(
        request,
        this.env,
        this.ctx,
        this.#dispatcher,
        this.#fetchDispatcher
      );
    }
  };
}
__name(wrapWorkerEntrypoint, "wrapWorkerEntrypoint");
var WRAPPED_ENTRY;
if (typeof middleware_insertion_facade_default === "object") {
  WRAPPED_ENTRY = wrapExportedHandler(middleware_insertion_facade_default);
} else if (typeof middleware_insertion_facade_default === "function") {
  WRAPPED_ENTRY = wrapWorkerEntrypoint(middleware_insertion_facade_default);
}
var middleware_loader_entry_default = WRAPPED_ENTRY;
export {
  Room,
  __INTERNAL_WRANGLER_MIDDLEWARE__,
  middleware_loader_entry_default as default
};
//# sourceMappingURL=index.js.map
