// ============================================================
// projection-render.ts — 投影 Canvas 描画・座標変換
//
// 描画は2モードだけ:
//   play      … 通常。何も描かず、光らせる札だけを塗りつぶす。
//   calibrate … 投影調整。札の有無に関わらず全スロットの枠線を描く。
// 取り札の画像は投影しない（畳の上の実物に重ねるため）。
// ============================================================

import type { ArrangementCard, Calibration, HighlightConfig, NormPoint } from './store'
import { getHighlight, loadCalibration } from './store'

// ============================================================
// 型
// ============================================================
export interface ProjectionState {
  mode: 'play' | 'calibrate'
  cards: { self: ArrangementCard[]; enemy: ArrangementCard[] }
  /** 読まれた札（濃い色） */
  targetIds: number[]
  /** 決まり字が一致する他の札（薄い色）。mode=target_only なら空。 */
  candidateIds: number[]
  calibration: Calibration
  highlight: HighlightConfig
}

// ============================================================
// 投影ウィンドウへの送信（操作画面側から呼ぶ）
//
// 投影ウィンドウは「変更があったとき」しか受け取らないので、
// 起動通知（hello）を受けたら broadcastAll() で全部送り直すこと。
// ============================================================
const _channel = new BroadcastChannel('hotarubi-projection')

export function broadcastHighlight(targetIds: number[], candidateIds: number[]): void {
  _channel.postMessage({ type: 'highlight', targetIds, candidateIds })
}

export function clearHighlight(): void {
  _channel.postMessage({ type: 'clear_highlights' })
}

export function broadcastMode(mode: ProjectionState['mode']): void {
  _channel.postMessage({ type: 'mode', mode })
}

export function broadcastPartial(payload: Partial<ProjectionState>): void {
  _channel.postMessage({ type: 'state', payload })
}

/** 配置・調整・ハイライト設定をまとめて送る */
export function broadcastAll(cards: ProjectionState['cards']): void {
  broadcastPartial({ cards, calibration: loadCalibration(), highlight: getHighlight() })
}

// ============================================================
// 盤面の論理寸法（mm）
// ============================================================
const CARD_W_MM = 52
const CARD_H_MM = 73
const COLS = 16
const ROWS_PER_FIELD = 3

// 調整モードの枠線（畳の上で見やすい色）
const CALIB_LINE = '#00e5ff'
const CALIB_EDGE = '#ff4081'

// ============================================================
// メイン描画
// ============================================================
export function renderProjection(
  ctx: CanvasRenderingContext2D,
  canvasW: number,
  canvasH: number,
  state: ProjectionState
): void {
  ctx.clearRect(0, 0, canvasW, canvasH)
  ctx.fillStyle = '#000'
  ctx.fillRect(0, 0, canvasW, canvasH)

  const { calibration } = state
  const fieldH = ROWS_PER_FIELD * CARD_H_MM + (ROWS_PER_FIELD - 1) * calibration.rowGapMm
  const logW = COLS * CARD_W_MM
  const logH = fieldH * 2 + calibration.fieldGapMm

  const toScreen = makeTransform(calibration, canvasW, canvasH, logW, logH)

  if (state.mode === 'calibrate') {
    drawCalibrationGuide(ctx, state, logW, fieldH, toScreen)
  } else {
    drawHighlights(ctx, state, logW, fieldH, toScreen)
  }
}

// ============================================================
// 論理座標（mm）→ 画面座標
// 正規化キャリブレーション（0〜1）× キャンバス実寸で解決する。
// ============================================================
type Transform = (lx: number, ly: number) => { x: number; y: number }

function makeTransform(
  cal: Calibration, canvasW: number, canvasH: number,
  logW: number, logH: number
): Transform {
  const px = (p: NormPoint) => ({ x: p.x * canvasW, y: p.y * canvasH })
  const [TL, TR, BL, BR] = cal.corners.map(px) as [
    { x: number; y: number }, { x: number; y: number },
    { x: number; y: number }, { x: number; y: number }
  ]

  if (cal.rowEdges && cal.rowEdges.length > 0) {
    // 縦方向は行エッジを通る区分線形補間、横方向は線形
    const n = cal.rowEdges.length
    const vPts = [0, ...Array.from({ length: n }, (_, i) => (i + 1) / (n + 1)), 1]
    const leftPts = [TL, ...cal.rowEdges.map(e => px(e.left)), BL]
    const rightPts = [TR, ...cal.rowEdges.map(e => px(e.right)), BR]

    return (lx, ly) => {
      const u = lx / logW
      const v = ly / logH
      let seg = vPts.length - 2
      for (let i = 0; i < vPts.length - 1; i++) {
        if (v <= vPts[i + 1]) { seg = i; break }
      }
      const dv = vPts[seg + 1] - vPts[seg]
      const t = dv < 1e-9 ? 0 : (v - vPts[seg]) / dv
      const lp = {
        x: leftPts[seg].x + (leftPts[seg + 1].x - leftPts[seg].x) * t,
        y: leftPts[seg].y + (leftPts[seg + 1].y - leftPts[seg].y) * t,
      }
      const rp = {
        x: rightPts[seg].x + (rightPts[seg + 1].x - rightPts[seg].x) * t,
        y: rightPts[seg].y + (rightPts[seg + 1].y - rightPts[seg].y) * t,
      }
      return { x: lp.x + (rp.x - lp.x) * u, y: lp.y + (rp.y - lp.y) * u }
    }
  }

  // 四隅のみ: bilinear
  return (lx, ly) => {
    const u = lx / logW
    const v = ly / logH
    return {
      x: (1-u)*(1-v)*TL.x + u*(1-v)*TR.x + (1-u)*v*BL.x + u*v*BR.x,
      y: (1-u)*(1-v)*TL.y + u*(1-v)*TR.y + (1-u)*v*BL.y + u*v*BR.y,
    }
  }
}

// ============================================================
// スロットの四隅を求める
// 敵陣（field=0, 上半分）は論理座標を反転して 180° 回転させる。
// ============================================================
type Quad = [
  { x: number; y: number }, { x: number; y: number },
  { x: number; y: number }, { x: number; y: number }
]

function slotQuad(
  isEnemy: boolean, row: number, col: number,
  logW: number, fieldH: number, rowGapMm: number, fieldGapMm: number,
  toScreen: Transform
): Quad {
  const baseY = isEnemy ? 0 : fieldH + fieldGapMm
  const ly = baseY + row * (CARD_H_MM + rowGapMm)
  const lx = col * CARD_W_MM

  if (isEnemy) {
    const rlx = logW - lx - CARD_W_MM
    const rly = fieldH - (ly - baseY) - CARD_H_MM
    return [
      toScreen(rlx + CARD_W_MM, rly + CARD_H_MM),
      toScreen(rlx,             rly + CARD_H_MM),
      toScreen(rlx,             rly),
      toScreen(rlx + CARD_W_MM, rly),
    ]
  }
  return [
    toScreen(lx,              ly),
    toScreen(lx + CARD_W_MM,  ly),
    toScreen(lx + CARD_W_MM,  ly + CARD_H_MM),
    toScreen(lx,              ly + CARD_H_MM),
  ]
}

function pathQuad(ctx: CanvasRenderingContext2D, q: Quad, ox = 0, oy = 0): void {
  ctx.beginPath()
  ctx.moveTo(q[0].x + ox, q[0].y + oy)
  ctx.lineTo(q[1].x + ox, q[1].y + oy)
  ctx.lineTo(q[2].x + ox, q[2].y + oy)
  ctx.lineTo(q[3].x + ox, q[3].y + oy)
  ctx.closePath()
}

// ============================================================
// 投影調整モード: 全スロットの枠線
// 番号も着色もしない。位置合わせに必要な線だけを描く。
// ============================================================
function drawCalibrationGuide(
  ctx: CanvasRenderingContext2D,
  state: ProjectionState,
  logW: number, fieldH: number,
  toScreen: Transform
): void {
  const { rowGapMm, fieldGapMm } = state.calibration

  ctx.save()
  ctx.strokeStyle = CALIB_LINE
  ctx.lineWidth = 1.5

  for (let field = 0; field < 2; field++) {
    const isEnemy = field === 0
    for (let row = 0; row < ROWS_PER_FIELD; row++) {
      for (let col = 0; col < COLS; col++) {
        const q = slotQuad(isEnemy, row, col, logW, fieldH, rowGapMm, fieldGapMm, toScreen)
        pathQuad(ctx, q)
        ctx.stroke()
      }
    }
  }

  // 盤面全体の外枠は太く（四隅を合わせやすくするため）
  ctx.strokeStyle = CALIB_EDGE
  ctx.lineWidth = 3
  const logH = fieldH * 2 + fieldGapMm
  pathQuad(ctx, [
    toScreen(0, 0), toScreen(logW, 0),
    toScreen(logW, logH), toScreen(0, logH),
  ])
  ctx.stroke()

  ctx.restore()
}

// ============================================================
// 通常モード: 光らせる札だけ塗りつぶす
// ============================================================
function drawHighlights(
  ctx: CanvasRenderingContext2D,
  state: ProjectionState,
  logW: number, fieldH: number,
  toScreen: Transform
): void {
  const { cards, targetIds, candidateIds, calibration, highlight } = state
  if (targetIds.length === 0 && candidateIds.length === 0) return

  const targets = new Set(targetIds)
  const candidates = new Set(candidateIds)

  ctx.save()
  for (const [isEnemy, list] of [[true, cards.enemy], [false, cards.self]] as const) {
    for (const card of list) {
      const isTarget = targets.has(card.poem_id)
      const isCandidate = !isTarget && candidates.has(card.poem_id)
      if (!isTarget && !isCandidate) continue

      const q = slotQuad(
        isEnemy, card.row, card.col,
        logW, fieldH, calibration.rowGapMm, calibration.fieldGapMm, toScreen
      )
      fillCard(ctx, q, isTarget ? highlight.targetColor : highlight.candidateColor, highlight)
    }
  }
  ctx.restore()
}

function fillCard(
  ctx: CanvasRenderingContext2D, q: Quad,
  color: string, hl: HighlightConfig
): void {
  const { offsetX: ox, offsetY: oy } = hl

  ctx.globalAlpha = hl.fillOpacity
  ctx.fillStyle = color
  pathQuad(ctx, q, ox, oy)
  ctx.fill()

  ctx.globalAlpha = 1
  if (hl.borderWidth > 0) {
    ctx.strokeStyle = hl.borderColor
    ctx.lineWidth = hl.borderWidth
    pathQuad(ctx, q, ox, oy)
    ctx.stroke()
  }
}
