// ============================================================
// audio.ts — 読み上げステートマシン・読み上げUI
// ============================================================

import { audioPath, getPoems, JOUKA_ID, computeEffectiveKimari } from './data'
import { scheduleHighlights, clearScheduledHighlights } from './projection-render'
import { getArrangement } from './card-grid'

// ============================================================
// 型定義
// ============================================================
type ReadingState =
  | 'idle'
  | 'jouka_upper' | 'jouka_lower' | 'jouka_lower_again'
  | 'gap'
  | 'upper' | 'wait_for_lower' | 'lower'

export interface ReadingEvent {
  type: 'session_start' | 'upper_start' | 'lower_start' | 'lower_end' | 'session_end'
  poemId: number
  position: number
  absMs: number
  effectiveKimari?: Record<number, string>
}

// ============================================================
// イベントハンドラ
// ============================================================
type ReadingEventHandler = (e: ReadingEvent) => void
const _handlers: ReadingEventHandler[] = []

export function onReadingEvent(handler: ReadingEventHandler): () => void {
  _handlers.push(handler)
  return () => { const i = _handlers.indexOf(handler); if (i >= 0) _handlers.splice(i, 1) }
}

function _emit(
  type: ReadingEvent['type'],
  poemId: number,
  position: number,
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

// ============================================================
// 状態変数
// ============================================================
let _state: ReadingState = 'idle'
let _audio: HTMLAudioElement | null = null
let _currentPoem = 0
let _currentPos = -1
let _poemOrder: number[] = []
let _remainingIds: number[] = []
// jouka: 序歌から / upper: 現在の札の上の句から(再) / lower: 現在の札の下の句から / next: 次の札の上の句から
let _resumeFrom: 'jouka' | 'upper' | 'lower' | 'next' | null = null
let _sessionType = 'competitive'
let _waitTimer: ReturnType<typeof setTimeout> | null = null
let _gapTimer: ReturnType<typeof setTimeout> | null = null

const _projChannel = new BroadcastChannel('hotarubi-projection')

let _cfg = {
  gap_lower_upper: 1.0,
  gap_upper_lower: 5.0,
  hl_base_offset: 0.0,
  hl_per_char: 0.3,
  hl_color: '#ffff00',
  hl_border_color: '#ff8800',
  hl_fill_opacity: 0.4,
  hl_border_width: 2,
  hl_offset_x: 0,
  hl_offset_y: 0,
  row_gap_mm: 10.0,
  field_gap_mm: 30.0,
}

export function setReadingConfig(cfg: Partial<typeof _cfg>): void { Object.assign(_cfg, cfg) }
export function getReadingConfig(): Readonly<typeof _cfg> { return _cfg }
export function setSessionType(type: string): void { _sessionType = type }

// ============================================================
// UI 参照
// ============================================================
type UI = {
  btn: HTMLButtonElement
  btnRestart: HTMLButtonElement
  progress: HTMLElement
  poemInfo: HTMLElement
}
let _ui: UI | null = null

function _updateUI(): void {
  if (!_ui) return
  const { btn, btnRestart, progress, poemInfo } = _ui

  if (_state === 'idle') {
    if (_resumeFrom !== null) {
      btn.textContent = '▶ 再開'
      btnRestart.style.display = ''
    } else {
      btn.textContent = '▶ 再生'
      btnRestart.style.display = 'none'
    }
  } else if (_state === 'wait_for_lower') {
    btn.textContent = '▶ 下の句'
  } else {
    btn.textContent = '■ 停止'
  }

  progress.textContent = _poemOrder.length > 0
    ? `${Math.max(_currentPos + 1, 0)} / ${_poemOrder.length} 首`
    : ''

  if (_currentPoem > 0) {
    try {
      const poems = getPoems()
      const poem = poems.find(p => p.id === _currentPoem)
      if (poem) {
        const ek = _remainingIds.length > 0
          ? computeEffectiveKimari(_remainingIds, poems).get(_currentPoem) ?? poem.kimari_ji
          : poem.kimari_ji
        poemInfo.textContent = `${_currentPoem}番 「${ek}…」`
      }
    } catch { poemInfo.textContent = `${_currentPoem}番` }
  } else if (_currentPoem === JOUKA_ID && _state !== 'idle') {
    poemInfo.textContent = '序歌'
  } else {
    poemInfo.textContent = '—'
  }
}

// ============================================================
// 音声再生
// ============================================================
function _play(src: string, onEnd: () => void): void {
  if (_audio) { _audio.pause(); _audio.onended = null; _audio.onerror = null }
  _audio = new Audio(src)
  _audio.onended = onEnd
  _audio.onerror = () => { console.error('音声エラー:', src); onEnd() }
  _audio.play().catch(err => { console.warn('play()失敗:', src, err); onEnd() })
}

function _clearTimers(): void {
  if (_waitTimer) { clearTimeout(_waitTimer); _waitTimer = null }
  if (_gapTimer)  { clearTimeout(_gapTimer);  _gapTimer = null }
  clearScheduledHighlights()
}

// ============================================================
// ステートマシン遷移
// ============================================================
function _playJoukaUpper(): void {
  _state = 'jouka_upper'
  _currentPoem = JOUKA_ID
  _currentPos = -1
  _updateUI()
  _play(audioPath(0, 1), _playJoukaLower)
}

function _playJoukaLower(): void {
  _state = 'jouka_lower'
  _updateUI()
  _play(audioPath(0, 2), _playJoukaLowerAgain)
}

function _playJoukaLowerAgain(): void {
  _state = 'jouka_lower_again'
  _updateUI()
  _play(audioPath(0, 2), _gapAfterJouka)
}

function _gapAfterJouka(): void {
  _state = 'gap'
  _updateUI()
  _gapTimer = setTimeout(_playNextUpper, _cfg.gap_lower_upper * 1000)
}

function _playNextUpper(): void {
  _currentPos++
  if (_currentPos >= _poemOrder.length) {
    _endSession()
    return
  }
  _currentPoem = _poemOrder[_currentPos]

  const poems = getPoems()
  const ekMap = computeEffectiveKimari(_remainingIds, poems)
  const ekRecord: Record<number, string> = {}
  ekMap.forEach((v, k) => { ekRecord[k] = v })
  _emit('upper_start', _currentPoem, _currentPos, ekRecord)

  _playCurrentUpper()
}

// 現在の _currentPoem/_currentPos の上の句を(再)生する。
// 一時停止からの再開時にも使うため、ログ登録(_emit)は _playNextUpper 側でのみ行う。
function _playCurrentUpper(): void {
  _state = 'upper'
  _updateUI()

  scheduleHighlights(
    _currentPoem, Date.now(),
    {
      row_gap_mm: _cfg.row_gap_mm, field_gap_mm: _cfg.field_gap_mm,
      hl_color: _cfg.hl_color, hl_border_color: _cfg.hl_border_color,
      hl_fill_opacity: _cfg.hl_fill_opacity, hl_border_width: _cfg.hl_border_width,
      hl_offset_x: _cfg.hl_offset_x, hl_offset_y: _cfg.hl_offset_y,
      hl_base_offset: _cfg.hl_base_offset, hl_per_char: _cfg.hl_per_char,
    },
    _remainingIds,
    _projChannel
  )

  _play(audioPath(_currentPoem, 1), _waitForLower)
}

function _waitForLower(): void {
  _state = 'wait_for_lower'
  _updateUI()
  if (_cfg.gap_upper_lower > 0) {
    _waitTimer = setTimeout(_playCurrentLower, _cfg.gap_upper_lower * 1000)
  }
}

export function triggerLower(): void {
  if (_state !== 'wait_for_lower') return
  _clearTimers()
  _playCurrentLower()
}

function _playCurrentLower(): void {
  _state = 'lower'
  _updateUI()
  _emit('lower_start', _currentPoem, _currentPos)
  _play(audioPath(_currentPoem, 2), _afterLower)
}

function _afterLower(): void {
  _emit('lower_end', _currentPoem, _currentPos)
  _remainingIds = _remainingIds.filter(id => id !== _currentPoem)
  _state = 'gap'
  _updateUI()
  _gapTimer = setTimeout(_playNextUpper, _cfg.gap_lower_upper * 1000)
}

function _endSession(): void {
  _clearTimers()
  _projChannel.postMessage({ type: 'clear_highlights' })
  _state = 'idle'
  _resumeFrom = null
  _emit('session_end', 0, _currentPos)
  _updateUI()
}

// ============================================================
// 公開 API
// ============================================================
export function startReading(poemIds?: number[]): void {
  _clearTimers()
  const poems = getPoems()
  const ids = poemIds ?? poems.map(p => p.id)
  _poemOrder = [...ids].sort(() => Math.random() - 0.5)
  _remainingIds = [...ids]
  _currentPos = -1
  _currentPoem = 0
  _resumeFrom = null

  if (_onSessionStart) _onSessionStart(_sessionType, ids)
  _emit('session_start', 0, -1)
  _playJoukaUpper()
}

export function stopReading(): void {
  if (_state === 'idle') return
  _clearTimers()
  _projChannel.postMessage({ type: 'clear_highlights' })
  if (_audio) { _audio.pause(); _audio.onended = null }

  if (['jouka_upper', 'jouka_lower', 'jouka_lower_again'].includes(_state)) {
    _resumeFrom = 'jouka'
  } else if (_state === 'upper') {
    // 上の句再生中に停止 → 再開時は同じ札の上の句からやり直す
    _resumeFrom = 'upper'
  } else if (_state === 'gap') {
    // 下の句終了後の間隔中に停止 → 再開時は次の札の上の句へ進む
    // (_currentPoem は既に読み終えた札を指しているため、下の句を再生してはいけない)
    _resumeFrom = 'next'
  } else {
    // wait_for_lower / lower
    _resumeFrom = 'lower'
  }
  _state = 'idle'
  _updateUI()
}

export function resumeReading(): void {
  if (_state !== 'idle' || _resumeFrom === null) return
  if (_resumeFrom === 'jouka') _playJoukaUpper()
  else if (_resumeFrom === 'upper') _playCurrentUpper()
  else if (_resumeFrom === 'next') _playNextUpper()
  else _playCurrentLower()
}

export function getReadingState(): ReadingState { return _state }

// ============================================================
// 読み上げUI 初期化
// ============================================================
export function initReading(containerSelector: string): void {
  const container = document.querySelector<HTMLElement>(containerSelector)
  if (!container) return

  container.innerHTML = `
    <div style="display:flex;flex-direction:column;gap:16px;">
      <div class="form-row">
        <label>読む首</label>
        <select id="r-poem-range">
          <option value="all">全100首</option>
          <option value="arrangement">配置済みの札のみ</option>
        </select>
      </div>

      <div style="display:flex;align-items:center;gap:12px;flex-wrap:wrap;">
        <button id="r-main-btn" class="primary" style="font-size:16px;padding:10px 28px;">▶ 再生</button>
        <button id="r-restart-btn" style="display:none;font-size:12px;">最初から</button>
        <span id="r-progress" style="color:var(--text3);font-size:13px;"></span>
      </div>

      <div id="r-poem-info" style="font-size:20px;color:var(--accent2);letter-spacing:0.12em;min-height:1.5em;">—</div>
    </div>
  `

  const btn        = container.querySelector<HTMLButtonElement>('#r-main-btn')!
  const btnRestart = container.querySelector<HTMLButtonElement>('#r-restart-btn')!
  const progress   = container.querySelector<HTMLElement>('#r-progress')!
  const poemInfo   = container.querySelector<HTMLElement>('#r-poem-info')!
  const rangeSel   = container.querySelector<HTMLSelectElement>('#r-poem-range')!

  _ui = { btn, btnRestart, progress, poemInfo }

  btn.addEventListener('click', () => {
    if (_state === 'idle') {
      if (_resumeFrom !== null) {
        resumeReading()
      } else {
        if (rangeSel.value === 'arrangement') {
          const arr = getArrangement()
          const ids = [...new Set([
            ...arr.self.map(c => c.poem_id),
            ...arr.enemy.map(c => c.poem_id),
          ])]
          startReading(ids.length > 0 ? ids : undefined)
        } else {
          startReading()
        }
      }
    } else if (_state === 'wait_for_lower') {
      triggerLower()
    } else {
      stopReading()
    }
  })

  btnRestart.addEventListener('click', () => {
    stopReading()
    _resumeFrom = null
    _updateUI()
  })

  _updateUI()
}
