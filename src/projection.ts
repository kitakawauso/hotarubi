// ============================================================
// projection.ts — 投影ウィンドウ エントリ
// BroadcastChannel で操作画面から状態を受信し Canvas に描画するだけ。
// ロジックは持たない。
// ============================================================

import { renderProjection, type ProjectionState } from './projection-render'
import { defaultCalibration, DEFAULT_HIGHLIGHT } from './store'

const canvas = document.getElementById('projection-canvas') as HTMLCanvasElement
const ctx = canvas.getContext('2d')!

// 現在の投影状態
let state: ProjectionState = {
  mode: 'play',
  cards: { self: [], enemy: [] },
  targetIds: [],
  candidateIds: [],
  calibration: defaultCalibration(),
  highlight: { ...DEFAULT_HIGHLIGHT },
}

function render(): void {
  renderProjection(ctx, canvas.width, canvas.height, state)
}

// キャンバスをウィンドウサイズに合わせる。
// 初回呼び出しは state と render の宣言より後に置くこと。
// 先に呼ぶと render() が let state の TDZ に触れて ReferenceError になり、
// モジュールの評価がここで止まって以降の受信処理が一切登録されない。
function resizeCanvas(): void {
  canvas.width = window.innerWidth
  canvas.height = window.innerHeight
  render()
}
window.addEventListener('resize', resizeCanvas)

// ============================================================
// メッセージ型（操作画面と共有）
// ============================================================
export interface ProjectionMessage {
  type: 'state' | 'highlight' | 'clear_highlights' | 'mode' | 'hello' | 'ping' | 'pong'
  /** 部分更新（配置・キャリブレーション・ハイライト設定） */
  payload?: Partial<ProjectionState>
  targetIds?: number[]
  candidateIds?: number[]
  mode?: ProjectionState['mode']
}

// ============================================================
// 受信
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
      state = { ...state, targetIds: msg.targetIds ?? [], candidateIds: msg.candidateIds ?? [] }
      render()
      break
    case 'clear_highlights':
      state = { ...state, targetIds: [], candidateIds: [] }
      render()
      break
    case 'mode':
      state = { ...state, mode: msg.mode ?? 'play' }
      render()
      break
    case 'ping':
      channel.postMessage({ type: 'pong' })
      break
  }
})

// 初回描画（受信ハンドラを登録してから）
resizeCanvas()

// 開かれた時点の状態を持っていないので、操作画面に送り直してもらう
channel.postMessage({ type: 'hello' })
