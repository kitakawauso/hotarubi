// ============================================================
// audio.ts — 読み上げステートマシン・読み上げイベント配信・読み上げUI
//
// 読み方は hisakatano に倣う。実際の競技と同じく
//   「前の札の下の句 → 無音 → 次の札の上の句」
// が1サイクルで、上の句が取り札フェーズにあたる。
// 同じ札の上下をまとめて読むのではない点に注意。
//
//   idle --PLAY(初回)--> joka → joka_silence → joka_shimo
//                                                  ↓
//   idle <--(手動)-- kami ← silence ← shimo <──────┘
//        --PLAY-->  shimo → silence → kami → …（自動再生なら継続）
// ============================================================

import { audioPath, getPoems, JOUKA_ID, computeEffectiveKimari } from './data'
import { getArrangement, getFieldPoemIds, removeCard } from './card-grid'
import { getHighlight } from './store'
import { broadcastHighlight, clearHighlight } from './projection-render'

// ============================================================
// 型
// ============================================================
type Phase = 'joka' | 'joka_silence' | 'joka_shimo' | 'shimo' | 'silence' | 'kami' | null

export interface ReadingEvent {
  type: 'session_start' | 'shimo_start' | 'shimo_end' | 'silence_start'
      | 'kami_start' | 'kami_end' | 'session_end'
  poemId: number
  position: number
  absMs: number
  effectiveKimari?: Record<number, string>
}

type ReadingEventHandler = (e: ReadingEvent) => void
const _handlers: ReadingEventHandler[] = []

export function onReadingEvent(handler: ReadingEventHandler): () => void {
  _handlers.push(handler)
  return () => { const i = _handlers.indexOf(handler); if (i >= 0) _handlers.splice(i, 1) }
}

function _emit(
  type: ReadingEvent['type'], poemId: number, position: number,
  effectiveKimari?: Record<number, string>
): void {
  const e: ReadingEvent = { type, poemId, position, absMs: Date.now(), effectiveKimari }
  for (const h of [..._handlers]) h(e)
}

// ============================================================
// セッション開始コールバック
// ============================================================
type SessionStartCallback = (sessionType: string, poemIds: number[]) => number
let _onSessionStart: SessionStartCallback | null = null
export function setSessionStartCallback(cb: SessionStartCallback): void { _onSessionStart = cb }

let _sessionType = 'competitive'
export function setSessionType(type: string): void { _sessionType = type }

// ============================================================
// 状態
// ============================================================
let _playing = false
let _phase: Phase = null
let _unread: number[] = []
let _readCount = 0
let _current: number | null = null   // いま音声を鳴らしている札
let _prev: number | null = null      // 次に下の句を読む札
let _next: number | null = null      // 次に上の句を読む札（取り札）
let _started = false                 // 序歌を読み終えたか

let _audio: HTMLAudioElement | null = null
let _timers: ReturnType<typeof setTimeout>[] = []
let _autoPlayTimer: ReturnType<typeof setTimeout> | null = null

// ============================================================
// タイマー
// ============================================================
function _setTimer(fn: () => void, ms: number): void {
  _timers.push(setTimeout(fn, ms))
}

function _clearTimers(): void {
  for (const t of _timers) clearTimeout(t)
  _timers = []
  if (_autoPlayTimer) { clearTimeout(_autoPlayTimer); _autoPlayTimer = null }
}

// ============================================================
// 音声再生
// ============================================================
function _play(poemId: number, part: 1 | 2, onEnd: () => void): void {
  if (_audio) { _audio.pause(); _audio.onended = null; _audio.onerror = null }
  const src = audioPath(poemId, part)
  _audio = new Audio(src)
  _audio.onended = onEnd
  _audio.onerror = () => { console.error('音声エラー:', src); _setTimer(onEnd, 100) }
  _audio.play().catch(err => { console.warn('play()失敗:', src, err); _setTimer(onEnd, 100) })
}

// ============================================================
// 次の札を抽選（一様。Fisher-Yates 相当のインデックス抽選）
// ============================================================
function _pickNext(): void {
  if (_unread.length === 0) { _next = null; return }
  const i = Math.floor(Math.random() * _unread.length)
  _next = _unread[i]
  _unread.splice(i, 1)
}

// ============================================================
// 決まり字
// ============================================================
function _kimariFor(poemId: number): string {
  const poems = getPoems()
  const cfg = getHighlight()
  if (cfg.source === 'fixed') {
    return poems.find(p => p.id === poemId)?.kimari_ji ?? ''
  }
  // 場に残っている札の中で一意に決まる最小プレフィックス
  const field = getFieldPoemIds()
  const basis = field.includes(poemId) ? field : [...field, poemId]
  return computeEffectiveKimari(basis, poems).get(poemId)
    ?? poems.find(p => p.id === poemId)?.kimari_ji ?? ''
}

function _effectiveKimariRecord(): Record<number, string> {
  const rec: Record<number, string> = {}
  computeEffectiveKimari(getFieldPoemIds(), getPoems()).forEach((v, k) => { rec[k] = v })
  return rec
}

// ============================================================
// ハイライトの予約（無音の開始時に張る）
//   点灯時刻 = 無音開始 + silenceSec + leadSec + (k-1) × perCharSec
// leadSec がマイナスなら上の句が始まる前に点く。
// ============================================================
function _scheduleHighlights(targetId: number): void {
  const cfg = getHighlight()
  const poems = getPoems()
  const field = getFieldPoemIds()

  // 場に無い札（空札）は光らせようがない
  if (!field.includes(targetId)) return

  const kimari = _kimariFor(targetId)
  const maxK = cfg.mode === 'target_only' ? 1 : Math.max(1, kimari.length)

  for (let k = 1; k <= maxK; k++) {
    const delayMs = Math.max(0, cfg.silenceSec + cfg.leadSec + (k - 1) * cfg.perCharSec) * 1000
    _setTimer(() => {
      // 点灯時刻は予約時の値で決まるが、色とモードは発火時の設定を読む
      // （競技タブで読み上げ中に変えてもその場で効くように）
      if (getHighlight().mode === 'target_only') {
        broadcastHighlight([targetId], [])
        return
      }
      // 決まり字プレフィックスに一致する場の札を集める。
      // 2枚以上あるうちは候補色でまとめて光らせ、1枚に絞れたときだけ確定色にする
      // （早い段階で正解が分かってしまわないようにするため）。
      const prefix = kimari.slice(0, k)
      const matches = field.filter(id => {
        const t = poems.find(p => p.id === id)?.hiragana ?? ''
        return t.startsWith(prefix)
      })
      if (matches.length <= 1) broadcastHighlight(matches.length ? matches : [targetId], [])
      else broadcastHighlight([], matches)
    }, delayMs)
  }
}

// ============================================================
// 遷移
// ============================================================
function _enterJoka(): void {
  _phase = 'joka'
  _current = JOUKA_ID
  _updateUI()
  _play(JOUKA_ID, 1, () => {
    _phase = 'joka_silence'
    _current = null
    _pickNext()
    _updateUI()
    _setTimer(_enterJokaShimo, getHighlight().jokaSilenceSec * 1000)
  })
}

function _enterJokaShimo(): void {
  _phase = 'joka_shimo'
  _current = JOUKA_ID
  _updateUI()
  _play(JOUKA_ID, 2, () => {
    _started = true
    _prev = JOUKA_ID
    _enterSilence()
  })
}

function _enterShimo(): void {
  if (_prev === null) { _enterSilence(); return }
  _phase = 'shimo'
  _current = _prev
  _updateUI()
  _emit('shimo_start', _prev, _readCount)
  _play(_prev, 2, () => {
    _emit('shimo_end', _prev!, _readCount)
    if (_next === null) { _endSession(); return }
    _enterSilence()
  })
}

function _enterSilence(): void {
  _phase = 'silence'
  _current = null
  _updateUI()
  _emit('silence_start', _next ?? 0, _readCount)
  if (_next !== null) _scheduleHighlights(_next)
  _setTimer(_enterKami, getHighlight().silenceSec * 1000)
}

function _enterKami(): void {
  if (_next === null) { _endSession(); return }
  _phase = 'kami'
  _current = _next
  _readCount++
  _updateUI()
  _emit('kami_start', _current, _readCount - 1, _effectiveKimariRecord())

  _play(_current, 1, () => {
    const done = _current!
    _emit('kami_end', done, _readCount - 1)
    clearHighlight()

    // 読まれた札を場から取り除く（場に無ければ何もしない）
    removeCard(done)

    _prev = done
    _pickNext()
    _current = null
    _phase = null

    const cfg = getHighlight()
    if (cfg.autoPlay && _next !== null) {
      _updateUI()
      _autoPlayTimer = setTimeout(() => { _autoPlayTimer = null; _enterShimo() }, cfg.autoPlayIntervalSec * 1000)
    } else if (_next === null) {
      _endSession()
    } else {
      // 手動: いったん待機に戻り、次の「▶ 進む」で下の句から再開する
      _playing = false
      _updateUI()
    }
  })
}

function _endSession(): void {
  _clearTimers()
  clearHighlight()
  if (_audio) { _audio.pause(); _audio.onended = null }
  _playing = false
  _phase = null
  _current = null
  _emit('session_end', 0, _readCount)
  _updateUI()
}

// ============================================================
// 公開 API
// ============================================================
export function startReading(poemIds?: number[]): void {
  _clearTimers()
  const ids = poemIds ?? getPoems().map(p => p.id)
  _unread = [...ids]
  _readCount = 0
  _current = null
  _prev = null
  _next = null
  _started = false
  _playing = true

  if (_onSessionStart) _onSessionStart(_sessionType, ids)
  _emit('session_start', 0, -1)
  _enterJoka()
}

/** 待機中に押されたとき: 序歌からか、次の札の下の句からか */
export function resumeReading(): void {
  if (_playing) return
  _playing = true
  if (!_started) { _enterJoka(); return }
  _enterShimo()
}

export function stopReading(): void {
  _clearTimers()
  clearHighlight()
  if (_audio) { _audio.pause(); _audio.onended = null }
  _playing = false
  _phase = null
  _current = null
  _updateUI()
}

export function resetReading(): void {
  stopReading()
  _unread = []
  _readCount = 0
  _prev = null
  _next = null
  _started = false
  _emit('session_end', 0, _readCount)
  _updateUI()
}

export function isPlaying(): boolean { return _playing }

// ============================================================
// 読み上げパネル UI（競技タブ）
// ============================================================
type UI = {
  btnPlay: HTMLButtonElement
  btnReset: HTMLButtonElement
  phase: HTMLElement
  progress: HTMLElement
  info: HTMLElement
  rangeSel: HTMLSelectElement
}
let _ui: UI | null = null

const PHASE_LABEL: Record<string, string> = {
  joka: '序歌（上の句）', joka_silence: '序歌（無音）', joka_shimo: '序歌（下の句）',
  shimo: '下の句', silence: '無音', kami: '上の句（取り札）',
}

function _updateUI(): void {
  if (!_ui) return
  const { btnPlay, phase, progress, info } = _ui

  if (_playing) {
    btnPlay.textContent = '■ 停止'
  } else if (_started) {
    btnPlay.textContent = '▶ 次の札へ'
  } else {
    btnPlay.textContent = '▶ 読み上げ開始'
  }

  phase.textContent = _phase ? (PHASE_LABEL[_phase] ?? _phase) : '待機中'
  progress.textContent = `読了 ${_readCount} 枚 / 未読 ${_unread.length} 枚`

  if (_phase === 'kami' && _current !== null) {
    info.textContent = `${_current}番 「${_kimariFor(_current)}…」`
  } else if (_next !== null) {
    info.textContent = `次: ${_next}番`
  } else {
    info.textContent = '—'
  }
}

export function initReading(containerSelector: string): void {
  const container = document.querySelector<HTMLElement>(containerSelector)
  if (!container) return

  container.innerHTML = `
    <div style="display:flex;flex-direction:column;gap:14px;">
      <div class="form-row">
        <label>読む札</label>
        <select id="r-range">
          <option value="all">全100首（空札を含む）</option>
          <option value="field">配置された札のみ</option>
        </select>
      </div>

      <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;">
        <button id="r-play" class="primary" style="font-size:15px;padding:9px 24px;">▶ 読み上げ開始</button>
        <button id="r-reset">最初から</button>
      </div>

      <div style="display:flex;gap:16px;font-size:12px;color:var(--text3);">
        <span id="r-phase">待機中</span>
        <span id="r-progress"></span>
      </div>

      <div id="r-info" style="font-size:19px;color:var(--accent2);letter-spacing:0.12em;min-height:1.4em;">—</div>
    </div>
  `

  _ui = {
    btnPlay: container.querySelector<HTMLButtonElement>('#r-play')!,
    btnReset: container.querySelector<HTMLButtonElement>('#r-reset')!,
    phase: container.querySelector<HTMLElement>('#r-phase')!,
    progress: container.querySelector<HTMLElement>('#r-progress')!,
    info: container.querySelector<HTMLElement>('#r-info')!,
    rangeSel: container.querySelector<HTMLSelectElement>('#r-range')!,
  }

  _ui.btnPlay.addEventListener('click', () => {
    if (_playing) { stopReading(); return }
    if (_started) { resumeReading(); return }

    if (_ui!.rangeSel.value === 'field') {
      const arr = getArrangement()
      const ids = [...new Set([...arr.self, ...arr.enemy].map(c => c.poem_id))]
      startReading(ids.length > 0 ? ids : undefined)
    } else {
      startReading()
    }
  })

  _ui.btnReset.addEventListener('click', resetReading)

  _updateUI()
}
