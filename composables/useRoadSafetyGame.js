const STEP = 1 / 60

const clamp = (value, min, max) => Math.min(max, Math.max(min, value))
const roadX = (distance) => {
  const bend = clamp((distance - 24) / 145, 0, 1)
  const exit = clamp((distance - 300) / 165, 0, 1)
  return 18 * bend * bend * (3 - 2 * bend) - 13 * exit * exit * (3 - 2 * exit)
}

const createRandom = (seed) => {
  let value = seed >>> 0 || 1
  return () => {
    value ^= value << 13
    value ^= value >>> 17
    value ^= value << 5
    return (value >>> 0) / 4294967296
  }
}

const createScenario = (seed) => {
  const random = createRandom(seed)
  return {
    seed,
    oncomingStartDistance: 250 + random() * 100,
    oncomingSpeed: 15 + random() * 6,
    leadBrakeAt: random() > 0.28 ? 7 + random() * 5 : null,
  }
}

const createSeed = () => Math.floor(Math.random() * 0xfffffffe) + 1

export const useRoadSafetyGame = () => {
  const session = reactive({
    phase: 'menu',
    outcome: null,
    seed: createSeed(),
    scenario: null,
    elapsed: 0,
    distance: 0,
    speed: 10,
    lateral: 2.3,
    leadS: 28,
    leadSpeed: 8.5,
    leadGap: 28,
    oncomingSeen: false,
    oncomingDistance: 300,
    oncomingCleared: false,
    oncomingClearDistance: null,
    decisionShown: false,
    strategy: null,
    replay: { active: false, viewing: false, time: 0 },
    minLeadGap: Infinity,
    minOncomingGap: Infinity,
    startedOvertakeAt: null,
    startedBrakingAt: null,
    firstOncomingAt: null,
    events: [],
    trajectory: [],
    crashElapsed: 0,
    crashLateral: 0,
    currentSteer: 0,
    braking: false,
    hint: '前方彎道視線受阻，先留意車距與可用空間。',
    muted: true,
  })

  let accumulator = 0
  let previousLane = 'own'
  let passedLead = false
  let oncomingPassed = false
  let audioContext
  let engineOscillator
  let engineGain
  let previousBraking = false
  let collisionReason = ''
  let pendingNearMissReason = ''

  const lane = computed(() => (session.lateral < -0.25 ? 'oncoming' : 'own'))

  const addEvent = (label, detail = '') => {
    if (session.events.some((event) => event.label === label)) return
    session.events.push({ label, detail, time: Number(session.elapsed.toFixed(1)) })
  }

  const stopRound = (outcome, reason) => {
    session.outcome = outcome
    session.hint = reason
    addEvent(outcome === 'collision' ? '碰撞' : outcome === 'near_miss' ? '近失' : '安全通過', reason)
    if (outcome === 'collision') {
      session.phase = 'crashing'
      session.crashElapsed = 0
      session.crashLateral = session.lateral < 0 ? -1 : 1
      collisionReason = reason
    } else {
      session.phase = outcome
    }
    stopEngine()
  }

  const resetRound = (seed) => {
    session.seed = seed
    session.scenario = createScenario(seed)
    session.outcome = null
    session.elapsed = 0
    session.distance = 0
    session.speed = 10
    session.lateral = 2.3
    session.leadS = 28
    session.leadSpeed = 8.5
    session.leadGap = 28
    session.oncomingSeen = false
    session.oncomingDistance = session.scenario.oncomingStartDistance
    session.oncomingCleared = false
    session.oncomingClearDistance = null
    session.decisionShown = false
    session.strategy = null
    session.replay = { active: false, viewing: false, time: 0 }
    session.minLeadGap = Infinity
    session.minOncomingGap = Infinity
    session.startedOvertakeAt = null
    session.startedBrakingAt = null
    session.firstOncomingAt = null
    session.events = []
    session.trajectory = []
    session.crashElapsed = 0
    session.crashLateral = 0
    session.currentSteer = 0
    session.braking = false
    session.hint = '保持觀察；儀表不會替你判定超車是否安全。'
    accumulator = 0
    previousLane = 'own'
    passedLead = false
    oncomingPassed = false
    previousBraking = false
    collisionReason = ''
    pendingNearMissReason = ''
  }

  const beginTutorial = () => {
    session.phase = 'tutorial'
    session.outcome = null
  }

  const start = (seed = session.seed) => {
    resetRound(seed)
    session.phase = 'playing'
    addEvent('起點', '跟隨慢車接近右彎盲區。')
    startEngine()
  }

  const retrySame = () => start(session.seed)
  const retryNew = () => start(createSeed())
  const pause = () => {
    if (session.phase === 'playing') {
      session.phase = 'paused'
      stopEngine()
    } else if (session.phase === 'paused') {
      session.phase = 'playing'
      startEngine()
    }
  }

  const chooseStrategy = (strategy) => {
    if (session.phase !== 'decision') return
    session.strategy = strategy
    session.phase = 'playing'
    const waiting = strategy === 'wait'
    addEvent(waiting ? '選擇保持車距' : '選擇嘗試超車', waiting
      ? '留在原車道，等待對向車通過與彎道視線打開。'
      : '評估可用空間後切出；對向車出現時需及時返回。')
    session.hint = waiting ? '保持原車道並留意車距，等來車通過。' : '選擇超車後仍需觀察來車，準備返回原車道。'
    startEngine()
  }

  const step = (controls) => {
    if (session.phase !== 'playing') return
    session.elapsed += STEP

    const throttle = controls.throttle ? 1 : 0
    const brake = controls.brake ? 1 : 0
    const steer = (controls.right ? 1 : 0) - (controls.left ? 1 : 0)
    session.currentSteer = steer
    session.braking = Boolean(brake)
    const acceleration = throttle * 4.5 - brake * 8 - (throttle ? 0 : 0.35)
    session.speed = clamp(session.speed + acceleration * STEP, 0, 19)
    session.lateral = clamp(session.lateral + steer * 2.4 * STEP, -3.2, 3.2)
    session.distance += session.speed * STEP

    const currentLane = lane.value
    if (currentLane !== previousLane) {
      if (currentLane === 'oncoming') {
        session.startedOvertakeAt = session.elapsed
        addEvent('切出對向車道', '開始嘗試超車。')
      } else {
        addEvent('返回原車道', '回到自己的車道。')
      }
      previousLane = currentLane
    }

    if (brake && session.startedBrakingAt === null) {
      session.startedBrakingAt = session.elapsed
      addEvent('開始煞車', '煞車反應已記錄。')
    }
    if (brake && !previousBraking) playBrakeSound()
    previousBraking = brake > 0

    if (session.scenario.leadBrakeAt !== null && session.elapsed >= session.scenario.leadBrakeAt) {
      const targetSpeed = oncomingPassed ? 8.5 : 6.5
      const speedChange = 1.8 * STEP
      session.leadSpeed += clamp(targetSpeed - session.leadSpeed, -speedChange, speedChange)
      if (session.leadSpeed < 8.4 && !oncomingPassed) addEvent('前車減速', '前車在彎前減速，最低維持低速行進。')
    } else {
      session.leadSpeed = 8.5
    }
    session.leadS += session.leadSpeed * STEP
    session.leadGap = session.leadS - session.distance
    if (lane.value === 'own' && session.leadGap > 0) {
      session.minLeadGap = Math.min(session.minLeadGap, session.leadGap)
    }

    if (!session.decisionShown && (session.distance >= 20 || session.leadGap <= 20)) {
      session.decisionShown = true
      session.phase = 'decision'
      session.hint = '先看跟車距離、前車速度與彎道視線，再決定下一步。'
      addEvent('彎道前決策', '遊戲暫停，查看車距、前車狀態與對向視線。')
      stopEngine()
      return
    }

    if (!passedLead && session.leadGap < -2) {
      passedLead = true
      addEvent('通過前車', '已超過前方慢車。')
    }

    // Keep the opposing vehicle moving while the bend hides it from view.
    if (!session.oncomingCleared) {
      session.oncomingDistance -= (session.speed + session.scenario.oncomingSpeed) * STEP
      const carS = session.distance + session.oncomingDistance
      const midpoint = (session.distance + carS) / 2
      const sightLineX = (roadX(session.distance) + roadX(carS)) / 2
      const occluded = Math.abs(roadX(midpoint) - sightLineX) > 2.6
      const inRange = session.oncomingDistance > 0 && session.oncomingDistance < 145
      if (!session.oncomingSeen && inRange && !occluded) {
        session.oncomingSeen = true
        session.firstOncomingAt = session.elapsed
        addEvent('看見對向車', '道路彎度與視線遮蔽物允許看見來車。')
      }
      if (lane.value === 'oncoming' && session.oncomingDistance > 0) {
        session.minOncomingGap = Math.min(session.minOncomingGap, session.oncomingDistance)
      }
      if (session.oncomingDistance <= 0 && !oncomingPassed) {
        oncomingPassed = true
        if (session.oncomingSeen) addEvent('對向車通過', '記錄最小會車距離。')
        if (session.oncomingSeen && lane.value === 'oncoming' && session.minOncomingGap < 4.5) {
          stopRound('collision', '對向車進入視野後仍留在對向車道，會車空間不足。')
          return
        }
        if (session.oncomingSeen && session.minOncomingGap < 12) {
          pendingNearMissReason = '會車距離過近；提早返回自己的車道可保留更多空間。'
        }
      }
      if (session.oncomingDistance <= -8) {
        session.oncomingCleared = true
        session.oncomingClearDistance = session.distance
        if (session.oncomingSeen) addEvent('對向車離開視線', '來車已完全通過。')
        if (pendingNearMissReason) {
          stopRound('near_miss', pendingNearMissReason)
          return
        }
      }
    }

    if (lane.value === 'own' && session.leadGap > -2 && session.leadGap < 3.2) {
      const reason = session.scenario.leadBrakeAt !== null && session.elapsed >= session.scenario.leadBrakeAt
        ? '前車減速時車距不足，來不及保持安全空間。'
        : '與前車的距離不足，來不及保持安全空間。'
      stopRound('collision', reason)
      return
    }
    if (lane.value === 'oncoming' && session.oncomingDistance <= 4.5 && session.oncomingDistance >= 0) {
      stopRound('collision', '在對向車距離不足時仍位於對向車道。')
      return
    }

    const distanceAfterOncoming = session.oncomingClearDistance === null ? 0 : session.distance - session.oncomingClearDistance
    if (session.oncomingCleared && lane.value === 'oncoming' && distanceAfterOncoming >= 40) {
      stopRound('near_miss', '來車已通過；仍留在對向車道，沒有及時回到原車道。')
      return
    }
    if (session.oncomingCleared && lane.value === 'own' && distanceAfterOncoming >= 22) {
      const outcome = session.minLeadGap < 9 || session.minOncomingGap < 12 ? 'near_miss' : 'finish'
      const reason = outcome === 'finish'
        ? session.strategy === 'wait'
          ? '你保持車距等待來車通過，再沿原車道安全離開彎道。'
          : '車流已通過且你已回到原車道，本局情境結束。'
        : '本局曾接近前車或對向車；提早調整車速並保留更大間距，可留下更多反應空間。'
      stopRound(outcome, reason)
      return
    }

    session.hint = session.oncomingSeen
      ? lane.value === 'oncoming' ? '對向車已可見；煞車或返回原車道。' : '對向車已通過，保持空間繼續前進。'
      : session.leadGap < 16 ? '前車距離正在縮短，注意煞車與跟車空間。' : '彎道遮蔽視線中；沒有安全超車提示。'

    // Three samples per second preserve the run while keeping replay data compact.
    if (Math.round(session.elapsed * 60) % 3 === 0) {
      session.trajectory.push({ time: Number(session.elapsed.toFixed(3)), distance: session.distance, lateral: session.lateral, speed: session.speed, leadS: session.leadS, oncomingDistance: session.oncomingDistance, oncomingSeen: session.oncomingSeen })
    }

    updateEngine(throttle, brake)
  }

  const advance = (delta, controls) => {
    if (session.replay.active) {
      session.replay.time = Math.min(session.trajectory.at(-1)?.time || 0, session.replay.time + Math.min(delta, 0.1) * 0.65)
      if (session.replay.time >= (session.trajectory.at(-1)?.time || 0)) session.replay.active = false
      return
    }
    if (session.phase === 'crashing') {
      session.crashElapsed += Math.min(delta, 0.1)
      if (session.crashElapsed >= 2.2) {
        session.phase = 'collision'
        session.hint = collisionReason
      }
      return
    }
    if (session.phase !== 'playing') return
    accumulator += Math.min(delta, 0.1)
    while (accumulator >= STEP && session.phase === 'playing') {
      step(controls)
      accumulator -= STEP
    }
  }

  const openDebrief = () => {
    if (['finish', 'near_miss', 'collision'].includes(session.phase)) session.phase = 'debrief'
  }

  const replayRound = () => {
    if (session.trajectory.length) session.replay = { active: true, viewing: true, time: 0 }
  }

  const closeReplay = () => {
    session.replay = { active: false, viewing: false, time: session.replay.time }
  }

  const debrief = computed(() => {
    if (session.outcome === 'collision' && lane.value === 'oncoming') {
      return '本局在對向車已進入視野後仍留在對向車道。若先保持車距，等彎後視野打開再評估，能保留返回原車道的空間。'
    }
    if (session.outcome === 'collision') {
      const leadBraked = session.scenario?.leadBrakeAt !== null && session.elapsed >= session.scenario?.leadBrakeAt
      return leadBraked
        ? '本局前車減速時，你與前車距離不足，反應空間有限。提早收油、煞車並保留較大的跟車距離，可留出更多調整時間。'
        : '本局接近前車時車距不足，反應空間有限。提早收油並保留較大的跟車距離，可留出更多調整時間。'
    }
    if (session.outcome === 'near_miss') {
      return '本局曾接近前車或對向車。即使最後通過，提早等待彎後視野仍能保留更多退路。'
    }
    if (session.strategy === 'wait') return '你選擇保持車距等待，讓對向車先通過，再沿原車道離開彎道。'
    if (session.strategy === 'overtake') return '你選擇評估超車，並依來車位置調整切出與返回時機。'
    return '本局順利通過。保持可見距離與反應空間，並在盲彎前等待視線打開，是本局保留退路的做法。'
  })

  const startEngine = () => {
    if (session.muted || !import.meta.client) return
    try {
      const AudioContextClass = window.AudioContext || window.webkitAudioContext
      if (!AudioContextClass) return
      audioContext ||= new AudioContextClass()
      if (!engineOscillator) {
        engineOscillator = audioContext.createOscillator()
        engineGain = audioContext.createGain()
        engineOscillator.type = 'sawtooth'
        engineOscillator.frequency.value = 80
        engineGain.gain.value = 0
        engineOscillator.connect(engineGain)
        engineGain.connect(audioContext.destination)
        engineOscillator.start()
      }
      audioContext.resume()
    } catch {
      // Audio is optional; keyboard and visual feedback remain available.
    }
  }

  const stopEngine = () => {
    if (engineGain && audioContext) engineGain.gain.setTargetAtTime(0, audioContext.currentTime, 0.08)
  }

  const updateEngine = (throttle, brake) => {
    if (!engineOscillator || !engineGain || !audioContext || session.muted) return
    engineOscillator.frequency.setTargetAtTime(70 + session.speed * 8 + throttle * 35, audioContext.currentTime, 0.06)
    engineGain.gain.setTargetAtTime(brake ? 0.012 : 0.018, audioContext.currentTime, 0.08)
  }

  const playBrakeSound = () => {
    if (!audioContext || session.muted) return
    try {
      const oscillator = audioContext.createOscillator()
      const gain = audioContext.createGain()
      const now = audioContext.currentTime
      oscillator.type = 'triangle'
      oscillator.frequency.setValueAtTime(240, now)
      oscillator.frequency.exponentialRampToValueAtTime(95, now + 0.24)
      gain.gain.setValueAtTime(0.0001, now)
      gain.gain.exponentialRampToValueAtTime(0.025, now + 0.025)
      gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.28)
      oscillator.connect(gain)
      gain.connect(audioContext.destination)
      oscillator.start(now)
      oscillator.stop(now + 0.3)
    } catch {
      // Audio is optional; visual feedback remains available.
    }
  }

  const toggleMute = () => {
    session.muted = !session.muted
    if (session.muted) stopEngine()
    else startEngine()
  }

  const cleanup = () => {
    stopEngine()
    if (audioContext) audioContext.close()
  }

  return { session, lane, debrief, beginTutorial, start, retrySame, retryNew, pause, chooseStrategy, advance, openDebrief, replayRound, closeReplay, toggleMute, cleanup }
}
