// ============================================================
// calibration.ts — 投影調整UI（4隅ドラッグ・行ワープ・プレビュー）
// ============================================================

import { renderProjection, type CalibrationData, type ProjectionState } from './projection-render'
import { getArrangement, onArrangementChange } from './card-grid'
import { db } from './db'

// ============================================================
// 状態
// ============================================================
type Pt = { x: number; y: number }

let _calibration: CalibrationData = { corners: null, rowEdges: null }
let _warpMode = false
let _projWin: Window | null = null
const _projChannel = new BroadcastChannel('hotarubi-projection')

let _previewCanvas: HTMLCanvasElement | null = null
let _previewCtx: CanvasRenderingContext2D | null = null
let _dragging: { type: 'corner'; idx: number } | { type: 'edge'; row: number; side: 'left' | 'right' } | null = null

// ============================================================
// ブロードキャスト
// ============================================================
function _broadcast(): void {
  _projChannel.postMessage({ type: 'calibration', calibration: _calibration })
}

// ============================================================
// プレビュー描画
// ============================================================
function _drawPreview(): void {
  if (!_previewCanvas || !_previewCtx) return
  const arr = getArrangement()
  const state: ProjectionState = {
    cards: {
      self:  arr.self.map(c  => ({ poem_id: c.poem_id, row: c.row, col: c.col })),
      enemy: arr.enemy.map(c => ({ poem_id: c.poem_id, row: c.row, col: c.col })),
    },
    highlights: [],
    calibration: _calibration,
    settings: {
      row_gap_mm: 10, field_gap_mm: 30,
      hl_color: '#ffff00', hl_border_color: '#ff8800',
      hl_fill_opacity: 0.4, hl_border_width: 2,
      hl_offset_x: 0, hl_offset_y: 0,
      hl_base_offset: 0, hl_per_char: 0.3,
    },
  }
  renderProjection(_previewCtx, _previewCanvas.width, _previewCanvas.height, state)
  _drawHandles()
}

// ============================================================
// ハンドル描画
// ============================================================
function _drawHandles(): void {
  if (!_previewCtx || !_previewCanvas) return
  const ctx = _previewCtx
  const { corners, rowEdges } = _calibration

  ctx.save()

  if (corners) {
    ctx.strokeStyle = '#00e5ff'
    ctx.lineWidth = 1.5
    ctx.beginPath()
    ctx.moveTo(corners[0].x, corners[0].y)
    ctx.lineTo(corners[1].x, corners[1].y)
    ctx.lineTo(corners[3].x, corners[3].y)
    ctx.lineTo(corners[2].x, corners[2].y)
    ctx.closePath()
    ctx.stroke()

    corners.forEach((c, i) => {
      ctx.fillStyle = i === 0 ? '#ff4444' : '#00e5ff'
      ctx.beginPath()
      ctx.arc(c.x, c.y, 8, 0, Math.PI * 2)
      ctx.fill()
    })
  }

  if (rowEdges) {
    for (const edge of rowEdges) {
      for (const side of ['left', 'right'] as const) {
        const pt = edge[side]
        ctx.fillStyle = '#ffcc00'
        ctx.beginPath()
        ctx.arc(pt.x, pt.y, 5, 0, Math.PI * 2)
        ctx.fill()
      }
    }
  }

  ctx.restore()
}

// ============================================================
// デフォルトキャリブレーション（画面内フィット）
// ============================================================
function _defaultCalibration(W: number, H: number): CalibrationData {
  const pad = 20
  return {
    corners: [
      { x: pad,     y: pad },
      { x: W - pad, y: pad },
      { x: pad,     y: H - pad },
      { x: W - pad, y: H - pad },
    ],
    rowEdges: null,
  }
}

// ============================================================
// cornersからrowEdgesを生成（ワープモードON時）
// ============================================================
function _computeRowEdgesFromCorners(): CalibrationData['rowEdges'] {
  const { corners } = _calibration
  if (!corners) return null
  const [TL, TR, BL, BR] = corners
  const n = 7
  return Array.from({ length: n }, (_, i) => {
    const v = (i + 1) / (n + 1)
    return {
      left:  { x: TL.x + (BL.x - TL.x) * v, y: TL.y + (BL.y - TL.y) * v },
      right: { x: TR.x + (BR.x - TR.x) * v, y: TR.y + (BR.y - TR.y) * v },
    }
  })
}

// ============================================================
// ヒットテスト
// ============================================================
function _hitTest(mx: number, my: number): typeof _dragging {
  const { corners, rowEdges } = _calibration
  const R = 12

  if (corners) {
    for (let i = 0; i < corners.length; i++) {
      if (Math.hypot(corners[i].x - mx, corners[i].y - my) < R) {
        return { type: 'corner', idx: i }
      }
    }
  }

  if (rowEdges) {
    for (let r = 0; r < rowEdges.length; r++) {
      for (const side of ['left', 'right'] as const) {
        const pt = rowEdges[r][side]
        if (Math.hypot(pt.x - mx, pt.y - my) < R) {
          return { type: 'edge', row: r, side }
        }
      }
    }
  }

  return null
}

// ============================================================
// マウスイベント
// ============================================================
function _onMouseDown(e: MouseEvent): void {
  const rect = _previewCanvas!.getBoundingClientRect()
  const sx = _previewCanvas!.width / rect.width
  const sy = _previewCanvas!.height / rect.height
  _dragging = _hitTest((e.clientX - rect.left) * sx, (e.clientY - rect.top) * sy)
}

function _onMouseMove(e: MouseEvent): void {
  if (!_dragging || !_previewCanvas) return
  const rect = _previewCanvas.getBoundingClientRect()
  const sx = _previewCanvas.width / rect.width
  const sy = _previewCanvas.height / rect.height
  const mx = (e.clientX - rect.left) * sx
  const my = (e.clientY - rect.top) * sy

  if (_dragging.type === 'corner' && _calibration.corners) {
    _calibration.corners[_dragging.idx] = { x: mx, y: my }
  } else if (_dragging.type === 'edge' && _calibration.rowEdges) {
    _calibration.rowEdges[_dragging.row][_dragging.side] = { x: mx, y: my }
  }

  _broadcast()
  _drawPreview()
}

function _onMouseUp(): void { _dragging = null }

// ============================================================
// UI 初期化
// ============================================================
export function initCalibration(containerSelector: string): void {
  const container = document.querySelector<HTMLElement>(containerSelector)
  if (!container) return

  container.innerHTML = `
    <div style="display:flex;flex-direction:column;gap:16px;">
      <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;">
        <button id="cal-open-proj">投影ウィンドウを開く</button>
        <button id="cal-reset">キャリブレーションをリセット</button>
        <button id="cal-warp-toggle" style="min-width:170px;">行ワープモード: OFF</button>
      </div>
      <p style="font-size:12px;color:var(--text3);margin:0;">
        青いハンドルをドラッグして投影エリアの四隅を合わせてください。
        行ワープモードをONにすると各行の歪みも補正できます。
      </p>
      <div style="position:relative;display:inline-block;">
        <canvas id="cal-preview" style="border:1px solid var(--border);border-radius:4px;max-width:100%;cursor:crosshair;"></canvas>
      </div>
    </div>
  `

  const canvas = container.querySelector<HTMLCanvasElement>('#cal-preview')!
  _previewCanvas = canvas
  _previewCtx = canvas.getContext('2d')!
  canvas.width = 832
  canvas.height = 518
  canvas.style.width = '100%'

  _calibration = _defaultCalibration(canvas.width, canvas.height)
  _broadcast()

  canvas.addEventListener('mousedown', _onMouseDown)
  canvas.addEventListener('mousemove', _onMouseMove)
  window.addEventListener('mouseup', _onMouseUp)

  // 投影ウィンドウを開く
  container.querySelector('#cal-open-proj')!.addEventListener('click', () => {
    if (_projWin && !_projWin.closed) {
      _projWin.focus()
    } else {
      _projWin = window.open('projection.html', 'hotarubi-projection', 'width=1280,height=800')
    }
  })

  // リセット
  container.querySelector('#cal-reset')!.addEventListener('click', () => {
    _warpMode = false
    const btn = container.querySelector<HTMLButtonElement>('#cal-warp-toggle')!
    btn.textContent = '行ワープモード: OFF'
    btn.style.background = ''
    _calibration = _defaultCalibration(canvas.width, canvas.height)
    _broadcast()
    _drawPreview()
  })

  // 行ワープモード切り替え
  container.querySelector('#cal-warp-toggle')!.addEventListener('click', () => {
    _warpMode = !_warpMode
    const btn = container.querySelector<HTMLButtonElement>('#cal-warp-toggle')!
    btn.textContent = `行ワープモード: ${_warpMode ? 'ON' : 'OFF'}`
    btn.style.background = _warpMode ? 'var(--accent)' : ''

    if (_warpMode) {
      _calibration.rowEdges = _computeRowEdgesFromCorners()
    } else {
      _calibration.rowEdges = null
    }
    _broadcast()
    _drawPreview()
  })

  onArrangementChange(() => _drawPreview())
  _drawPreview()
}
