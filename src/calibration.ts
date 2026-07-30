// ============================================================
// calibration.ts — 投影調整（初期設定）
//
// 札が1枚も配置されていなくても、全スロットの枠線を投影して
// 四隅とワープを合わせられるようにする。
// 座標は投影キャンバスに対する割合（0〜1）で持つ。
// プレビューと投影ウィンドウで解像度が違っても同じ位置になる。
// ============================================================

import { renderProjection, broadcastMode, broadcastPartial } from './projection-render'
import type { ProjectionState } from './projection-render'
import { getArrangement, onArrangementChange } from './card-grid'
import {
  loadCalibration, saveCalibration, defaultCalibration, getHighlight,
  type Calibration, type NormPoint,
} from './store'
import { showToast } from './main'

// ============================================================
// 状態
// ============================================================
let _cal: Calibration = loadCalibration()
let _projWin: Window | null = null

let _canvas: HTMLCanvasElement | null = null
let _ctx: CanvasRenderingContext2D | null = null
let _dragging:
  | { type: 'corner'; idx: number }
  | { type: 'edge'; row: number; side: 'left' | 'right' }
  | null = null

const ROW_EDGE_COUNT = 7  // 3段×2陣 の間に入る境界

export function getCalibration(): Calibration { return _cal }

// ============================================================
// 投影ウィンドウ
// ============================================================
export function openProjectionWindow(): void {
  if (_projWin && !_projWin.closed) {
    _projWin.focus()
  } else {
    _projWin = window.open('projection.html', 'hotarubi-projection', 'width=1280,height=800')
  }
}

export function broadcastCalibration(): void {
  broadcastPartial({ calibration: _cal })
}

/** 調整タブに入った/出たときに投影の表示モードを切り替える */
export function setCalibrationMode(on: boolean): void {
  broadcastMode(on ? 'calibrate' : 'play')
}

// ============================================================
// プレビュー描画
// ============================================================
function _previewState(): ProjectionState {
  const arr = getArrangement()
  return {
    mode: 'calibrate',
    cards: arr,
    targetIds: [],
    candidateIds: [],
    calibration: _cal,
    highlight: getHighlight(),
  }
}

function _draw(): void {
  if (!_canvas || !_ctx) return
  renderProjection(_ctx, _canvas.width, _canvas.height, _previewState())
  _drawHandles()
}

function _toPx(p: NormPoint): { x: number; y: number } {
  return { x: p.x * _canvas!.width, y: p.y * _canvas!.height }
}

function _drawHandles(): void {
  if (!_ctx || !_canvas) return
  const ctx = _ctx

  ctx.save()
  _cal.corners.forEach((c, i) => {
    const p = _toPx(c)
    ctx.fillStyle = i === 0 ? '#ff4444' : '#ffffff'
    ctx.beginPath()
    ctx.arc(p.x, p.y, 9, 0, Math.PI * 2)
    ctx.fill()
    ctx.strokeStyle = '#000'
    ctx.lineWidth = 1.5
    ctx.stroke()
  })

  if (_cal.rowEdges) {
    for (const edge of _cal.rowEdges) {
      for (const side of ['left', 'right'] as const) {
        const p = _toPx(edge[side])
        ctx.fillStyle = '#ffcc00'
        ctx.beginPath()
        ctx.arc(p.x, p.y, 6, 0, Math.PI * 2)
        ctx.fill()
        ctx.strokeStyle = '#000'
        ctx.lineWidth = 1
        ctx.stroke()
      }
    }
  }
  ctx.restore()
}

// ============================================================
// 変更の反映（プレビュー + 投影 + 保存）
// ============================================================
function _apply(persist = true): void {
  broadcastCalibration()
  _draw()
  if (persist) saveCalibration(_cal)
}

// ============================================================
// 行エッジの生成（四隅から等分）
// ============================================================
function _makeRowEdges(): Calibration['rowEdges'] {
  const [TL, TR, BL, BR] = _cal.corners
  return Array.from({ length: ROW_EDGE_COUNT }, (_, i) => {
    const v = (i + 1) / (ROW_EDGE_COUNT + 1)
    return {
      left:  { x: TL.x + (BL.x - TL.x) * v, y: TL.y + (BL.y - TL.y) * v },
      right: { x: TR.x + (BR.x - TR.x) * v, y: TR.y + (BR.y - TR.y) * v },
    }
  })
}

// ============================================================
// マウス
// ============================================================
function _canvasXY(e: MouseEvent): { x: number; y: number } {
  const rect = _canvas!.getBoundingClientRect()
  return {
    x: (e.clientX - rect.left) * (_canvas!.width / rect.width),
    y: (e.clientY - rect.top) * (_canvas!.height / rect.height),
  }
}

function _hitTest(mx: number, my: number): typeof _dragging {
  const R = 14
  for (let i = 0; i < _cal.corners.length; i++) {
    const p = _toPx(_cal.corners[i])
    if (Math.hypot(p.x - mx, p.y - my) < R) return { type: 'corner', idx: i }
  }
  if (_cal.rowEdges) {
    for (let r = 0; r < _cal.rowEdges.length; r++) {
      for (const side of ['left', 'right'] as const) {
        const p = _toPx(_cal.rowEdges[r][side])
        if (Math.hypot(p.x - mx, p.y - my) < R) return { type: 'edge', row: r, side }
      }
    }
  }
  return null
}

function _onMouseDown(e: MouseEvent): void {
  const { x, y } = _canvasXY(e)
  _dragging = _hitTest(x, y)
}

function _onMouseMove(e: MouseEvent): void {
  if (!_dragging || !_canvas) return
  const { x, y } = _canvasXY(e)
  const np: NormPoint = { x: x / _canvas.width, y: y / _canvas.height }

  if (_dragging.type === 'corner') {
    _cal.corners[_dragging.idx] = np
  } else if (_cal.rowEdges) {
    _cal.rowEdges[_dragging.row][_dragging.side] = np
  }
  // ドラッグ中は保存せず、投影とプレビューだけ更新する
  _apply(false)
}

function _onMouseUp(): void {
  if (_dragging) saveCalibration(_cal)
  _dragging = null
}

// ============================================================
// UI
// ============================================================
export function initCalibration(containerSelector: string): void {
  const container = document.querySelector<HTMLElement>(containerSelector)
  if (!container) return

  container.innerHTML = `
    <div style="display:flex;flex-direction:column;gap:14px;">
      <p style="font-size:12px;color:var(--text3);margin:0;line-height:1.7;">
        投影ウィンドウには札の枠線だけが出ます。実際の畳に並べた札に合うよう、
        下のプレビューで赤・白のハンドル（四隅）をドラッグしてください。<br>
        台形以外の歪みが残る場合は「行ワープ」を ON にすると、各行の左右端（黄）も動かせます。
        調整内容は自動保存され、次回起動時も復元されます。
      </p>

      <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;">
        <button id="cal-warp" style="min-width:130px;">行ワープ: OFF</button>
        <button id="cal-save" class="primary">保存</button>
        <button id="cal-reset" style="color:#e06060;border-color:#e06060;">リセット</button>
      </div>

      <div style="display:flex;gap:20px;flex-wrap:wrap;">
        <label style="display:flex;align-items:center;gap:8px;">
          段間隔
          <input type="range" id="cal-rowgap" min="0" max="30" step="1" style="width:120px;">
          <span id="cal-rowgap-val" style="font-size:12px;color:var(--text3);width:44px;"></span>
        </label>
        <label style="display:flex;align-items:center;gap:8px;">
          自陣・敵陣間
          <input type="range" id="cal-fieldgap" min="0" max="80" step="1" style="width:120px;">
          <span id="cal-fieldgap-val" style="font-size:12px;color:var(--text3);width:44px;"></span>
        </label>
      </div>

      <canvas id="cal-preview" style="border:1px solid var(--border);border-radius:4px;width:100%;cursor:crosshair;background:#000;"></canvas>
    </div>
  `

  _canvas = container.querySelector<HTMLCanvasElement>('#cal-preview')!
  _ctx = _canvas.getContext('2d')!
  // 投影ウィンドウと同じ 16:9 にしておくと見え方が一致する
  _canvas.width = 960
  _canvas.height = 540

  _canvas.addEventListener('mousedown', _onMouseDown)
  _canvas.addEventListener('mousemove', _onMouseMove)
  window.addEventListener('mouseup', _onMouseUp)

  const warpBtn = container.querySelector<HTMLButtonElement>('#cal-warp')!
  const syncWarpBtn = () => {
    const on = _cal.rowEdges !== null
    warpBtn.textContent = `行ワープ: ${on ? 'ON' : 'OFF'}`
    warpBtn.style.background = on ? 'var(--accent)' : ''
  }

  warpBtn.addEventListener('click', () => {
    _cal.rowEdges = _cal.rowEdges ? null : _makeRowEdges()
    syncWarpBtn()
    _apply()
  })

  container.querySelector('#cal-save')!.addEventListener('click', () => {
    saveCalibration(_cal)
    showToast('投影調整を保存しました')
  })

  container.querySelector('#cal-reset')!.addEventListener('click', () => {
    if (!confirm('投影調整をリセットしますか？')) return
    _cal = defaultCalibration()
    syncWarpBtn()
    _apply()
  })

  // 段間隔・陣間隔
  const rowGap = container.querySelector<HTMLInputElement>('#cal-rowgap')!
  const fieldGap = container.querySelector<HTMLInputElement>('#cal-fieldgap')!
  const rowGapVal = container.querySelector<HTMLElement>('#cal-rowgap-val')!
  const fieldGapVal = container.querySelector<HTMLElement>('#cal-fieldgap-val')!

  const syncGaps = () => {
    rowGap.value = String(_cal.rowGapMm)
    fieldGap.value = String(_cal.fieldGapMm)
    rowGapVal.textContent = `${_cal.rowGapMm} mm`
    fieldGapVal.textContent = `${_cal.fieldGapMm} mm`
  }

  rowGap.addEventListener('input', () => {
    _cal.rowGapMm = parseFloat(rowGap.value)
    syncGaps()
    _apply()
  })
  fieldGap.addEventListener('input', () => {
    _cal.fieldGapMm = parseFloat(fieldGap.value)
    syncGaps()
    _apply()
  })

  syncWarpBtn()
  syncGaps()
  onArrangementChange(() => _draw())
  _apply(false)
}
