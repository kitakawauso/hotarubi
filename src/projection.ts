// ============================================================
// projection.ts — 投影ウィンドウ エントリ
// BroadcastChannel でメインウィンドウからコマンドを受信し Canvas に描画する
// ============================================================

import { renderProjection, type ProjectionState } from './projection-render'

const canvas = document.getElementById('projection-canvas') as HTMLCanvasElement
const ctx = canvas.getContext('2d')!

// キャンバスをウィンドウサイズに合わせる
function resizeCanvas(): void {
  canvas.width = window.innerWidth
  canvas.height = window.innerHeight
  render()
}
window.addEventListener('resize', resizeCanvas)
resizeCanvas()

// 現在の投影状態
let state: ProjectionState = {
  cards: { self: [], enemy: [] },
  highlights: [],
  calibration: { corners: null, rowEdges: null },
  settings: {
    row_gap_mm: 10,
    field_gap_mm: 30,
    hl_color: '#ffff00',
    hl_border_color: '#ff8800',
    hl_fill_opacity: 0.4,
    hl_border_width: 2,
    hl_offset_x: 0,
    hl_offset_y: 0,
    hl_base_offset: 0,
    hl_per_char: 0.3,
  },
}

function render(): void {
  renderProjection(ctx, canvas.width, canvas.height, state)
}

// ============================================================
// BroadcastChannel でメインウィンドウからコマンドを受信
// ============================================================
const channel = new BroadcastChannel('hotarubi-projection')

channel.addEventListener('message', (e: MessageEvent) => {
  const msg = e.data as ProjectionMessage
  switch (msg.type) {
    case 'state':
      state = { ...state, ...msg.payload }
      render()
      break
    case 'highlight':
      state = { ...state, highlights: msg.highlights ?? [] }
      render()
      break
    case 'clear_highlights':
      state = { ...state, highlights: [] }
      render()
      break
    case 'settings':
      state = { ...state, settings: { ...state.settings, ...msg.settings } }
      render()
      break
    case 'calibration':
      if (msg.calibration) state = { ...state, calibration: msg.calibration }
      render()
      break
    case 'ping':
      // キャリブレーションタブのプレビュー同期のため canvas データを返す
      channel.postMessage({ type: 'pong', dataUrl: canvas.toDataURL('image/jpeg', 0.5) })
      break
  }
})

// ============================================================
// メッセージ型定義（main ↔ projection 共有）
// ============================================================
export interface ProjectionMessage {
  type: 'state' | 'highlight' | 'clear_highlights' | 'settings' | 'calibration' | 'ping'
  payload?: Partial<ProjectionState>
  highlights?: number[]
  settings?: Partial<ProjectionState['settings']>
  calibration?: ProjectionState['calibration']
}
