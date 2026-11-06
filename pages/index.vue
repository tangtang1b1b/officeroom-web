<script setup>
const { session, lane, debrief, beginTutorial, start, retrySame, retryNew, pause, chooseStrategy, advance, openDebrief, replayRound, closeReplay, toggleMute, cleanup } = useRoadSafetyGame()

const controls = reactive({ throttle: false, brake: false, left: false, right: false })
const isMobile = ref(false)
const speedKph = computed(() => Math.round(session.speed * 3.6))
const progress = computed(() => {
  if (['finish', 'near_miss', 'collision', 'debrief'].includes(session.phase)) return 100
  const scenario = session.scenario
  const encounterEnd = scenario
    ? scenario.oncomingStartDistance * (10 / (10 + scenario.oncomingSpeed)) + 25
    : 110
  return Math.min(99, (session.distance / encounterEnd) * 100)
})
const minOncomingGap = computed(() => {
  if (session.startedOvertakeAt === null) return '未切出'
  return Number.isFinite(session.minOncomingGap) ? `${Math.max(0, session.minOncomingGap).toFixed(1)} m` : '未會車'
})
const formattedGap = computed(() => (Number.isFinite(session.leadGap) ? `${Math.max(0, Math.round(session.leadGap))} m` : '—'))
const decisionGapSeconds = computed(() => (Math.max(0, session.leadGap) / Math.max(session.speed, 0.1)).toFixed(1))
const decisionLeadStatus = computed(() => session.leadSpeed < 8.4 ? '正在減速' : '維持車速')
const decisionOncomingStatus = computed(() => session.oncomingSeen
  ? `${Math.max(0, Math.round(session.oncomingDistance))} 公尺外可見`
  : '彎道遮蔽，尚未看見')
const decisionLaneStatus = computed(() => lane.value === 'own' ? '目前在原車道' : '已切出，需準備返回')
const overtakeTimeRequired = computed(() => Math.sqrt((2 * (Math.max(0, session.leadGap) + 6)) / 4.5) + 1.3)
const overtakeTimeAvailable = computed(() => session.oncomingDistance / Math.max(session.speed + (session.scenario?.oncomingSpeed || 18), 1))
const canOvertake = computed(() => lane.value === 'own' && session.leadGap > 0 && overtakeTimeAvailable.value > overtakeTimeRequired.value)
const updateViewport = () => { isMobile.value = window.innerWidth <= 760 }

const clearControls = () => {
  controls.throttle = false
  controls.brake = false
  controls.left = false
  controls.right = false
}

const keyDown = (event) => {
  const key = event.key.toLowerCase()
  if (['arrowup', 'arrowdown', 'arrowleft', 'arrowright', ' '].includes(key) && session.phase === 'playing') event.preventDefault()
  if (key === 'w' || key === 'arrowup') controls.throttle = true
  if (key === 's' || key === 'arrowdown') controls.brake = true
  if (key === 'a' || key === 'arrowleft') controls.left = true
  if (key === 'd' || key === 'arrowright') controls.right = true
  if (key === 'm' && !event.repeat) toggleMute()
  if (key === 'r' && !event.repeat && !['menu', 'tutorial', 'debrief'].includes(session.phase)) retryNew()
  if (key === 'escape' && !event.repeat) pause()
}

const keyUp = (event) => {
  const key = event.key.toLowerCase()
  if (key === 'w' || key === 'arrowup') controls.throttle = false
  if (key === 's' || key === 'arrowdown') controls.brake = false
  if (key === 'a' || key === 'arrowleft') controls.left = false
  if (key === 'd' || key === 'arrowright') controls.right = false
}

watch(() => session.phase, (phase) => {
  if (phase !== 'playing') clearControls()
})

onMounted(() => {
  updateViewport()
  window.addEventListener('keydown', keyDown)
  window.addEventListener('keyup', keyUp)
  window.addEventListener('blur', clearControls)
  window.addEventListener('resize', updateViewport)
})

onBeforeUnmount(() => {
  window.removeEventListener('keydown', keyDown)
  window.removeEventListener('keyup', keyUp)
  window.removeEventListener('blur', clearControls)
  window.removeEventListener('resize', updateViewport)
  cleanup()
})
</script>

<template>
  <div class="game-shell">
    <ClientOnly>
      <GameRoadScene v-if="!['menu', 'tutorial'].includes(session.phase)" :session="session" @frame="advance($event, controls)" />
    </ClientOnly>

    <div class="scene-vignette" aria-hidden="true"></div>

    <header v-if="session.phase === 'playing' || session.phase === 'paused'" class="hud-top">
      <div class="hud-brand">
        <span class="hud-kicker">ROAD SENSE · 情境 01</span>
        <strong>盲彎前的選擇</strong>
      </div>
      <div class="hud-stats">
        <div class="stat-card speed-card">
          <span>速度</span>
          <strong>{{ speedKph }}<small> km/h</small></strong>
        </div>
        <div class="stat-card">
          <span>與前車距離</span>
          <strong>{{ formattedGap }}</strong>
        </div>
        <button class="icon-button pause-button" type="button" @click="pause">
          {{ session.phase === 'paused' ? '繼續' : '暫停' }}
          <span>{{ session.phase === 'paused' ? '▶' : 'Ⅱ' }}</span>
        </button>
      </div>
    </header>

    <div v-if="session.phase === 'playing' || session.phase === 'paused'" class="road-progress" aria-label="路程進度">
      <span :style="{ width: `${progress}%` }"></span>
    </div>

    <main v-if="session.phase === 'menu'" class="overlay menu-overlay">
      <div class="menu-card">
        <div class="eyebrow"><span class="eyebrow-line"></span> ROAD SENSE / 01</div>
        <h1>盲彎前的<br /><em>選擇</em></h1>
        <p class="intro-copy">看不見的路，不代表沒有來車。<br />在山路彎道前，留意距離、視線與退路。</p>
        <p v-if="isMobile" class="mobile-note">建議使用桌面瀏覽器遊玩</p>
        <button class="primary-button" type="button" @click="beginTutorial">
          開始體驗 <span aria-hidden="true">↗</span>
        </button>
        <div class="menu-rule"></div>
        <div class="menu-foot"><span>一段山路・一個決定</span><span>約 1 分鐘</span></div>
        <p class="education-note">本遊戲為風險教育情境，非駕駛訓練；遊戲數值不代表真實事故率。</p>
      </div>
      <div class="corner-note">TAIWAN MOUNTAIN ROAD<br />RISK AWARENESS SIMULATION</div>
    </main>

    <main v-else-if="session.phase === 'tutorial'" class="overlay tutorial-overlay">
      <section class="tutorial-card" aria-labelledby="tutorial-title">
        <div class="eyebrow"><span class="eyebrow-line"></span> 出發前 · 01 / 01</div>
        <h2 id="tutorial-title">先看懂路況，<br /><em>再決定怎麼走。</em></h2>
        <p class="tutorial-copy">你正跟在慢車後接近右彎盲區。彎道前會停下來讓你選擇等待或嘗試超車；車距、前車速度與對向車位置會影響結果。</p>
        <div class="controls-grid">
          <div><kbd>W</kbd><kbd>↑</kbd><span>加速</span></div>
          <div><kbd>S</kbd><kbd>↓</kbd><span>煞車</span></div>
          <div><kbd>A</kbd><kbd>D</kbd><span>左右移動</span></div>
          <div><kbd>R</kbd><span>新情境重玩</span></div>
          <div><kbd>M</kbd><span>音效開／關</span></div>
          <div><kbd>Esc</kbd><span>暫停／繼續</span></div>
        </div>
        <div class="tutorial-bottom">
          <p>彎道遮蔽期間沒有「安全超車」提示；速度、距離與結果都是遊戲化參數。</p>
          <button class="primary-button" type="button" @click="start(session.seed)">我知道了，出發 <span aria-hidden="true">↗</span></button>
        </div>
      </section>
    </main>

    <aside v-if="session.phase === 'playing'" class="hud-bottom">
      <div class="road-hint" :class="{ 'hint-alert': session.oncomingSeen }">
        <span class="hint-dot"></span>
        <span>{{ session.hint }}</span>
      </div>
      <div class="hud-controls"><kbd>W</kbd><kbd>S</kbd><kbd>A</kbd><kbd>D</kbd><span>控制</span></div>
      <button class="sound-button" type="button" @click="toggleMute">音效 {{ session.muted ? '關' : '開' }} <kbd>M</kbd></button>
    </aside>

    <main v-if="session.phase === 'decision'" class="overlay state-overlay">
      <section class="result-card decision-card" aria-labelledby="decision-title">
        <div class="eyebrow"><span class="eyebrow-line"></span> 彎道前的選擇</div>
        <h2 id="decision-title">先看路況，再選擇下一步。</h2>
        <p class="decision-copy">路況已暫停。比較車距、前車狀態和對向視線，選擇下一步。</p>
        <div class="decision-factors" aria-label="目前路況">
          <div><span>跟車距離</span><strong>{{ formattedGap }} · 約 {{ decisionGapSeconds }} 秒</strong></div>
          <div><span>前車狀態</span><strong>{{ decisionLeadStatus }}</strong></div>
          <div><span>對向視線</span><strong>{{ decisionOncomingStatus }}</strong></div>
          <div><span>車道位置</span><strong>{{ decisionLaneStatus }}</strong></div>
        </div>
        <div class="decision-options">
          <button class="decision-option primary-button" type="button" @click="chooseStrategy('wait')">
            <strong>保持車距等待</strong><small>留在原車道，等來車通過</small>
          </button>
          <button class="decision-option secondary-option" type="button" :disabled="!canOvertake" @click="chooseStrategy('overtake')">
            <strong>嘗試超車</strong><small>{{ canOvertake ? '按 W+A 加速切出；來車出現時按 D 返回' : '來車接近時間不足，保持車道等待' }}</small>
          </button>
        </div>
      </section>
    </main>

    <main v-if="session.phase === 'paused'" class="overlay state-overlay">
      <section class="result-card pause-card">
        <div class="eyebrow"><span class="eyebrow-line"></span> 暫停中</div>
        <h2>先停一下。</h2>
        <p>目前情境已保留，準備好再繼續觀察路況。</p>
        <button class="primary-button" type="button" @click="pause">繼續遊戲 <span aria-hidden="true">↗</span></button>
      </section>
    </main>

    <main v-if="['finish', 'near_miss', 'collision'].includes(session.phase)" class="overlay state-overlay">
      <section class="result-card">
        <div class="eyebrow"><span class="eyebrow-line"></span> 本局結果 · 種子 {{ session.seed }}</div>
        <p class="outcome-label" :class="`outcome-${session.outcome}`">
          {{ session.outcome === 'finish' ? '安全通過' : session.outcome === 'near_miss' ? '近失事件' : '發生碰撞' }}
        </p>
        <h2>{{ session.outcome === 'finish' ? '你保留了前進的空間。' : session.outcome === 'near_miss' ? '差一點，退路變窄了。' : '這次沒有足夠的反應空間。' }}</h2>
        <p class="result-copy">{{ session.hint }}</p>
        <div class="result-metrics">
          <div><span>本局時間</span><strong>{{ session.elapsed.toFixed(1) }}<small> 秒</small></strong></div>
          <div><span>最小前車距離</span><strong>{{ Number.isFinite(session.minLeadGap) ? `${Math.max(0, session.minLeadGap).toFixed(1)} m` : '—' }}</strong></div>
          <div><span>最小會車距離</span><strong>{{ minOncomingGap }}</strong></div>
        </div>
        <div class="result-actions">
          <button class="primary-button" type="button" @click="openDebrief">回看本局線索 <span aria-hidden="true">↗</span></button>
          <button class="text-button" type="button" @click="retrySame">同情境重試</button>
        </div>
      </section>
    </main>

    <aside v-if="session.replay.viewing" class="replay-overlay">
      <span>本局外部視角重播</span>
      <button class="text-button" type="button" @click="closeReplay">返回事件回顧</button>
    </aside>

    <main v-if="session.phase === 'debrief' && !session.replay.viewing" class="overlay state-overlay">
      <section class="result-card debrief-card">
        <div class="eyebrow"><span class="eyebrow-line"></span> 路況回顧 · 種子 {{ session.seed }}</div>
        <h2>哪些線索<br /><em>改變了結果？</em></h2>
        <p class="debrief-copy">{{ debrief }}</p>
        <div class="timeline" aria-label="本局事件時間軸">
          <div v-for="event in session.events" :key="`${event.label}-${event.time}`" class="timeline-event">
            <span class="timeline-marker"></span>
            <time>{{ event.time.toFixed(1) }}s</time>
            <div><strong>{{ event.label }}</strong><small>{{ event.detail }}</small></div>
          </div>
        </div>
        <p class="debrief-footnote">這是依本局事件整理的遊戲解說，不構成現實駕駛建議或事故機率估計。</p>
        <div class="result-actions">
          <button class="text-button" type="button" @click="replayRound">外部視角重播</button>
          <button class="primary-button" type="button" @click="retrySame">同情境重試 <span aria-hidden="true">↗</span></button>
          <button class="text-button" type="button" @click="retryNew">換一組情境</button>
        </div>
      </section>
    </main>
  </div>
</template>

<style scoped>
.game-shell {
  position: relative;
  width: 100%;
  height: 100svh;
  min-height: 620px;
  overflow: hidden;
  color: #f2f0e8;
  background: linear-gradient(145deg, #a9bdb1 0%, #758b78 44%, #39483e 100%);
  font-family: 'Noto Sans TC', 'Microsoft JhengHei', sans-serif;
}

.scene-vignette {
  position: absolute;
  inset: 0;
  pointer-events: none;
  background: linear-gradient(180deg, rgb(15 22 20 / 44%) 0%, transparent 25%, transparent 63%, rgb(11 16 14 / 66%) 100%), linear-gradient(90deg, rgb(12 17 15 / 17%), transparent 38%, transparent 70%, rgb(12 17 15 / 16%));
}

.hud-top,
.hud-bottom,
.road-progress {
  position: absolute;
  z-index: 2;
}

.hud-top {
  top: 0;
  left: 0;
  right: 0;
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  padding: 30px 42px;
}

.hud-brand,
.hud-stats,
.stat-card,
.menu-foot,
.result-metrics,
.result-actions,
.tutorial-bottom {
  display: flex;
}

.hud-brand {
  flex-direction: column;
  gap: 6px;
  text-shadow: 0 2px 14px rgb(0 0 0 / 45%);
}

.hud-kicker,
.eyebrow {
  color: #e5c976;
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.17em;
}

.hud-brand strong {
  font-size: 17px;
  letter-spacing: 0.06em;
}

.hud-stats {
  align-items: stretch;
  gap: 10px;
}

.stat-card,
.icon-button {
  min-width: 138px;
  flex-direction: column;
  justify-content: center;
  gap: 5px;
  padding: 12px 16px;
  border: 1px solid rgb(255 255 255 / 19%);
  border-radius: 4px;
  background: rgb(20 29 25 / 66%);
  backdrop-filter: blur(14px);
}

.stat-card span {
  color: #b6c0b8;
  font-size: 10px;
  letter-spacing: 0.08em;
}

.stat-card strong {
  color: #f5f1e7;
  font-size: 22px;
  font-variant-numeric: tabular-nums;
  font-weight: 500;
}

.stat-card small {
  color: #d7d4c9;
  font-size: 11px;
}

.speed-card strong {
  color: #f4d774;
}

.icon-button {
  min-width: 86px;
  align-items: center;
  flex-direction: row;
  gap: 10px;
  color: #f2f0e8;
  font: inherit;
  font-size: 12px;
  cursor: pointer;
}

.icon-button span {
  color: #e5c976;
}

.road-progress {
  top: 0;
  left: 0;
  right: 0;
  height: 2px;
  background: rgb(255 255 255 / 20%);
}

.road-progress span {
  display: block;
  height: 100%;
  background: #e9c963;
  transition: width 100ms linear;
}

.replay-overlay {
  position: absolute;
  z-index: 2;
  top: 24px;
  right: 32px;
  display: flex;
  align-items: center;
  gap: 18px;
  padding: 8px 14px;
  border: 1px solid rgb(255 255 255 / 22%);
  border-radius: 3px;
  color: #f2f0e8;
  background: rgb(20 29 25 / 78%);
  font-size: 11px;
  backdrop-filter: blur(14px);
}

.hud-bottom {
  bottom: 0;
  left: 0;
  right: 0;
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  padding: 28px 42px 32px;
}

.road-hint {
  display: flex;
  align-items: center;
  gap: 11px;
  max-width: min(58vw, 540px);
  padding: 13px 17px;
  border: 1px solid rgb(255 255 255 / 18%);
  border-radius: 4px;
  color: #f5f1e7;
  background: rgb(20 29 25 / 73%);
  font-size: 13px;
  line-height: 1.6;
  backdrop-filter: blur(14px);
}

.hint-dot,
.timeline-marker {
  width: 7px;
  height: 7px;
  flex: 0 0 auto;
  border-radius: 50%;
  background: #e9c963;
  box-shadow: 0 0 12px rgb(233 201 99 / 65%);
}

.hint-alert .hint-dot {
  background: #f09565;
  box-shadow: 0 0 14px rgb(240 149 101 / 75%);
}

.hud-controls,
.sound-button {
  display: flex;
  align-items: center;
  gap: 6px;
  color: #e9e7de;
  font-size: 11px;
}

kbd {
  min-width: 23px;
  padding: 5px 6px;
  border: 1px solid rgb(255 255 255 / 27%);
  border-radius: 3px;
  color: #f2f0e8;
  background: rgb(20 29 25 / 72%);
  font-family: inherit;
  font-size: 10px;
  text-align: center;
}

.hud-controls span {
  margin-left: 6px;
}

.sound-button {
  padding: 8px 10px;
  border: 1px solid rgb(255 255 255 / 22%);
  border-radius: 3px;
  background: rgb(20 29 25 / 72%);
  cursor: pointer;
}

.overlay {
  position: absolute;
  z-index: 3;
  inset: 0;
  display: grid;
  place-items: center;
  background: rgb(13 20 17 / 32%);
  backdrop-filter: blur(2px);
}

.menu-overlay {
  justify-items: start;
  padding: 0 max(8vw, 58px);
  background: linear-gradient(90deg, rgb(14 23 19 / 76%) 0%, rgb(14 23 19 / 44%) 42%, transparent 78%);
  backdrop-filter: none;
}

.menu-card {
  width: min(420px, 40vw);
  padding: 36px 38px;
  border: 1px solid rgb(235 230 211 / 21%);
  border-radius: 5px;
  background: rgb(18 27 23 / 78%);
  box-shadow: 0 24px 80px rgb(0 0 0 / 24%);
  backdrop-filter: blur(16px);
}

.eyebrow {
  display: flex;
  align-items: center;
  gap: 10px;
}

.eyebrow-line {
  display: inline-block;
  width: 22px;
  height: 1px;
  background: #dfc36d;
}

h1,
h2,
p {
  margin: 0;
}

.menu-card h1,
.tutorial-card h2,
.result-card h2 {
  margin-top: 22px;
  color: #f6f1e5;
  font-size: clamp(36px, 4.2vw, 58px);
  font-weight: 500;
  letter-spacing: 0.04em;
  line-height: 1.19;
}

h1 em,
h2 em {
  color: #e9ce76;
  font-style: normal;
}

.intro-copy,
.tutorial-copy,
.result-copy {
  margin-top: 18px;
  color: #d0d4cb;
  font-size: 14px;
  line-height: 1.9;
}

.primary-button {
  display: inline-flex;
  min-height: 48px;
  align-items: center;
  justify-content: space-between;
  gap: 22px;
  padding: 0 17px;
  border: 1px solid #e8cd77;
  border-radius: 3px;
  color: #1c241f;
  background: #e8cd77;
  font-family: inherit;
  font-size: 13px;
  font-weight: 700;
  letter-spacing: 0.04em;
  cursor: pointer;
  transition: background 160ms ease, transform 160ms ease;
}

.primary-button:hover {
  transform: translateY(-1px);
  background: #f1d989;
}

.primary-button span {
  font-size: 16px;
}

.menu-card > .primary-button {
  width: 100%;
  margin-top: 26px;
}

.menu-rule {
  height: 1px;
  margin: 27px 0 15px;
  background: rgb(255 255 255 / 16%);
}

.menu-foot {
  justify-content: space-between;
  color: #c5cbbf;
  font-size: 11px;
  letter-spacing: 0.04em;
}

.education-note {
  margin-top: 21px;
  color: #aeb8ad;
  font-size: 10px;
  line-height: 1.7;
}

.mobile-note {
  margin-top: 12px;
  color: #f1d989;
  font-size: 11px;
}

.corner-note {
  position: absolute;
  right: 42px;
  bottom: 34px;
  color: rgb(243 240 226 / 67%);
  font-size: 9px;
  letter-spacing: 0.15em;
  line-height: 1.8;
  text-align: right;
}

.tutorial-card,
.result-card {
  width: min(640px, calc(100vw - 48px));
  padding: 34px 40px;
  border: 1px solid rgb(237 231 210 / 20%);
  border-radius: 5px;
  background: rgb(20 29 25 / 91%);
  box-shadow: 0 26px 90px rgb(0 0 0 / 38%);
  backdrop-filter: blur(18px);
}

.decision-card h2 {
  font-size: clamp(28px, 3vw, 38px);
}

.decision-copy {
  margin-top: 12px;
  color: #d0d4cb;
  font-size: 12px;
  line-height: 1.8;
}

.decision-factors {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 12px;
  margin-top: 20px;
  padding: 14px 0;
  border-top: 1px solid rgb(255 255 255 / 13%);
  border-bottom: 1px solid rgb(255 255 255 / 13%);
}

.decision-factors div {
  display: flex;
  flex-direction: column;
  gap: 7px;
}

.decision-factors span {
  color: #aeb8ad;
  font-size: 10px;
}

.decision-factors strong {
  color: #f3f0e7;
  font-size: 12px;
  font-weight: 500;
}

.decision-options {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 12px;
  margin-top: 20px;
}

.decision-option {
  display: flex;
  min-height: 74px;
  flex-direction: column;
  align-items: flex-start;
  justify-content: center;
  gap: 7px;
  padding: 12px 15px;
  text-align: left;
}

.decision-option strong {
  font: inherit;
  font-size: 13px;
  font-weight: 700;
}

.decision-option small {
  font-size: 10px;
  font-weight: 400;
  line-height: 1.5;
}

.secondary-option {
  border: 1px solid rgb(255 255 255 / 27%);
  border-radius: 3px;
  color: #f2f0e8;
  background: rgb(20 29 25 / 72%);
  font-family: inherit;
  cursor: pointer;
  transition: background 160ms ease, border-color 160ms ease;
}

.secondary-option:hover {
  border-color: #e8cd77;
  background: rgb(31 42 36 / 92%);
}

.secondary-option:disabled {
  opacity: 0.48;
  cursor: not-allowed;
}

.tutorial-card h2,
.result-card h2 {
  margin-top: 16px;
  font-size: clamp(30px, 3.4vw, 43px);
}

.tutorial-copy {
  max-width: 540px;
  margin-top: 14px;
  font-size: 13px;
}

.controls-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 14px 12px;
  margin-top: 24px;
  padding: 19px 0;
  border-top: 1px solid rgb(255 255 255 / 14%);
  border-bottom: 1px solid rgb(255 255 255 / 14%);
}

.controls-grid > div {
  display: flex;
  align-items: center;
  gap: 6px;
  color: #d9ded4;
  font-size: 11px;
}

.controls-grid > div span {
  margin-left: 3px;
}

.tutorial-bottom {
  align-items: center;
  justify-content: space-between;
  gap: 20px;
  margin-top: 19px;
}

.tutorial-bottom p,
.debrief-footnote {
  max-width: 315px;
  color: #aeb8ad;
  font-size: 10px;
  line-height: 1.7;
}

.state-overlay {
  background: rgb(11 17 14 / 53%);
}

.result-card {
  width: min(620px, calc(100vw - 48px));
  padding: 31px 36px;
}

.result-card h2 {
  font-size: clamp(28px, 3vw, 38px);
}

.result-card .result-copy {
  margin-top: 12px;
  font-size: 12px;
}

.outcome-label {
  margin-top: 24px;
  color: #e7cd78;
  font-size: 12px;
  font-weight: 700;
  letter-spacing: 0.1em;
}

.outcome-near_miss {
  color: #f0ae70;
}

.outcome-collision {
  color: #e77d62;
}

.result-metrics {
  gap: 0;
  margin-top: 22px;
  padding: 15px 0;
  border-top: 1px solid rgb(255 255 255 / 13%);
  border-bottom: 1px solid rgb(255 255 255 / 13%);
}

.result-metrics > div {
  display: flex;
  flex: 1;
  flex-direction: column;
  gap: 6px;
  padding: 0 12px;
  border-left: 1px solid rgb(255 255 255 / 13%);
}

.result-metrics > div:first-child {
  padding-left: 0;
  border-left: 0;
}

.result-metrics span {
  color: #aeb8ad;
  font-size: 10px;
}

.result-metrics strong {
  color: #f3f0e7;
  font-size: 18px;
  font-weight: 500;
  font-variant-numeric: tabular-nums;
}

.result-metrics small {
  font-size: 10px;
}

.result-actions {
  align-items: center;
  gap: 18px;
  margin-top: 20px;
}

.text-button {
  padding: 10px 0;
  border: 0;
  color: #d4d9ce;
  background: transparent;
  font: inherit;
  font-size: 12px;
  cursor: pointer;
}

.text-button:hover {
  color: #f1d989;
}

.debrief-card h2 {
  margin-top: 20px;
}

.debrief-copy {
  margin-top: 13px;
  color: #d0d4cb;
  font-size: 12px;
  line-height: 1.85;
}

.timeline {
  position: relative;
  display: grid;
  gap: 0;
  max-height: 225px;
  overflow-y: auto;
  margin-top: 18px;
  padding: 5px 0;
}

.timeline::before {
  position: absolute;
  top: 12px;
  bottom: 12px;
  left: 3px;
  width: 1px;
  background: rgb(233 201 99 / 40%);
  content: '';
}

.timeline-event {
  position: relative;
  display: grid;
  grid-template-columns: 14px 48px 1fr;
  gap: 9px;
  align-items: start;
  padding: 8px 0;
}

.timeline-marker {
  width: 7px;
  height: 7px;
  margin-top: 5px;
}

.timeline-event time {
  color: #d7c579;
  font-size: 10px;
  font-variant-numeric: tabular-nums;
}

.timeline-event strong,
.timeline-event small {
  display: block;
}

.timeline-event strong {
  color: #eeeade;
  font-size: 11px;
  font-weight: 600;
}

.timeline-event small {
  margin-top: 2px;
  color: #adb7ac;
  font-size: 10px;
}

.debrief-footnote {
  max-width: none;
  margin-top: 14px;
}

.pause-card {
  width: min(430px, calc(100vw - 48px));
}

.pause-card h2 {
  margin-top: 20px;
}

.pause-card .primary-button {
  margin-top: 22px;
}

@media (max-width: 760px) {
  .game-shell {
    min-height: 560px;
  }

  .hud-top {
    padding: 22px 18px;
  }

  .hud-brand strong {
    font-size: 14px;
  }

  .hud-stats {
    gap: 6px;
  }

  .stat-card {
    min-width: 0;
    padding: 9px 10px;
  }

  .stat-card strong {
    font-size: 17px;
  }

  .stat-card span {
    font-size: 9px;
  }

  .pause-button {
    min-width: 62px;
    padding: 8px;
    font-size: 10px;
  }

  .hud-bottom {
    align-items: flex-end;
    flex-wrap: wrap;
    gap: 10px;
    padding: 18px;
  }

  .road-hint {
    max-width: 100%;
    flex-basis: 100%;
    font-size: 11px;
  }

  .hud-controls {
    display: none;
  }

  .menu-overlay {
    justify-items: center;
    padding: 24px;
    background: rgb(14 23 19 / 43%);
  }

  .menu-card {
    width: min(420px, 100%);
    padding: 28px 25px;
  }

  .menu-card h1 {
    font-size: 42px;
  }

  .corner-note {
    right: 20px;
    bottom: 15px;
    font-size: 8px;
  }

  .tutorial-card,
  .result-card {
    padding: 25px 22px;
  }

  .controls-grid {
    grid-template-columns: repeat(2, 1fr);
  }

  .tutorial-bottom {
    align-items: flex-start;
    flex-direction: column;
  }

  .decision-factors {
    grid-template-columns: 1fr;
    gap: 10px;
  }

  .decision-factors div {
    flex-direction: row;
    align-items: baseline;
    justify-content: space-between;
  }

  .decision-options {
    grid-template-columns: 1fr;
  }

  .result-metrics > div {
    padding: 0 8px;
  }

  .result-metrics span {
    font-size: 9px;
  }

  .result-metrics strong {
    font-size: 15px;
  }
}
</style>
