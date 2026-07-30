// ============================================================
// projection-render.ts — 投影 Canvas 描画・メッシュワープ・ハイライト
// ============================================================

import { cardImagePath, computeEffectiveKimari, findKimariMatches, getPoems } from './data'

// ============================================================
// 型定義
// ============================================================
export interface CalibrationPoint { x: number; y: number }

export interface CalibrationData {
  corners: [CalibrationPoint, CalibrationPoint, CalibrationPoint, CalibrationPoint] | null  // TL,TR,BL,BR
  rowEdges: Array<{ left: CalibrationPoint; right: CalibrationPoint }> | null               // 7要素
}

export interface FieldCard {
  poem_id: number
  row: number  // 0-2
  col: number  // 0-15
}

export interface ProjectionState {
  cards: { self: FieldCard[]; enemy: FieldCard[] }
  highlights: number[]           // ハイライト中の poem_id 一覧
  calibration: CalibrationData
  settings: {
    row_gap_mm: number
    field_gap_mm: number
    hl_color: string
    hl_border_color: string
    hl_fill_opacity: number
    hl_border_width: number
    hl_offset_x: number
    hl_offset_y: number
    hl_base_offset: number
    hl_per_char: number
  }
}

// ============================================================
// カード物理寸法（mm）→ 論理比率
// ============================================================
const CARD_W_MM = 52
const CARD_H_MM = 73
const COLS = 16
const ROWS_PER_FIELD = 3

// 画像キャッシュ
const _imgCache = new Map<string, HTMLImageElement>()

function loadImage(src: string): Promise<HTMLImageElement> {
  if (_imgCache.has(src)) return Promise.resolve(_imgCache.get(src)!)
  return new Promise(resolve => {
    const img = new Image()
    img.onload = () => { _imgCache.set(src, img); resolve(img) }
    img.onerror = () => { _imgCache.set(src, img); resolve(img) }
    img.src = src
  })
}

function preloadImage(src: string): void {
  if (_imgCache.has(src)) return
  loadImage(src)
}

// ============================================================
// メイン描画関数
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

  const { settings, calibration } = state

  const totalRowGap = (ROWS_PER_FIELD - 1) * settings.row_gap_mm
  const logW = COLS * CARD_W_MM
  const fieldH = ROWS_PER_FIELD * CARD_H_MM + totalRowGap
  const logH = fieldH * 2 + settings.field_gap_mm

  if (calibration.corners) {
    drawWarped(ctx, state, logW, logH, fieldH)
  } else {
    drawFitted(ctx, canvasW, canvasH, state, logW, logH, fieldH)
  }
}

// ============================================================
// キャリブレーションなし: 画面にフィット
// ============================================================
function drawFitted(
  ctx: CanvasRenderingContext2D,
  canvasW: number,
  canvasH: number,
  state: ProjectionState,
  logW: number,
  logH: number,
  fieldH: number
): void {
  const scale = Math.min(canvasW / logW, canvasH / logH)
  const ox = (canvasW - logW * scale) / 2
  const oy = (canvasH - logH * scale) / 2
  const toScreen = (lx: number, ly: number) => ({ x: ox + lx * scale, y: oy + ly * scale })
  drawGrid(ctx, state, logW, fieldH, toScreen)
}

// ============================================================
// キャリブレーションあり: メッシュワープ
// ============================================================
function drawWarped(
  ctx: CanvasRenderingContext2D,
  state: ProjectionState,
  logW: number,
  logH: number,
  fieldH: number
): void {
  const { corners, rowEdges } = state.calibration
  if (!corners) return

  const [TL, TR, BL, BR] = corners

  let toScreen: (lx: number, ly: number) => { x: number; y: number }

  if (rowEdges && rowEdges.length > 0) {
    // rowEdges（絶対座標）+ corners で縦方向を線形補間
    const n = rowEdges.length
    const vPts = [0, ...Array.from({ length: n }, (_, i) => (i + 1) / (n + 1)), 1]
    const leftPts  = [TL, ...rowEdges.map(e => e.left),  BL]
    const rightPts = [TR, ...rowEdges.map(e => e.right), BR]

    toScreen = (lx, ly) => {
      const u = lx / logW
      const v = ly / logH
      // v が属するセグメントを探す
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
  } else {
    // bilinear（4隅のみ）
    toScreen = (lx, ly) => {
      const u = lx / logW
      const v = ly / logH
      return {
        x: (1-u)*(1-v)*TL.x + u*(1-v)*TR.x + (1-u)*v*BL.x + u*v*BR.x,
        y: (1-u)*(1-v)*TL.y + u*(1-v)*TR.y + (1-u)*v*BL.y + u*v*BR.y,
      }
    }
  }

  drawGrid(ctx, state, logW, fieldH, toScreen)
}

// ============================================================
// グリッド描画（敵陣は180°回転）
// ============================================================
function drawGrid(
  ctx: CanvasRenderingContext2D,
  state: ProjectionState,
  logW: number,
  fieldH: number,
  toScreen: (lx: number, ly: number) => { x: number; y: number }
): void {
  const { settings, cards, highlights } = state
  const rowGap = settings.row_gap_mm
  const fieldGap = settings.field_gap_mm

  const selfMap = new Map<string, number>()
  for (const c of cards.self) selfMap.set(`${c.row},${c.col}`, c.poem_id)
  const enemyMap = new Map<string, number>()
  for (const c of cards.enemy) enemyMap.set(`${c.row},${c.col}`, c.poem_id)

  const highlightSet = new Set(highlights)

  // 敵陣: 論理Y=0〜fieldH（上半分）
  // 自陣: 論理Y=fieldH+fieldGap〜2*fieldH+fieldGap（下半分）
  for (let field = 0; field < 2; field++) {
    const isEnemy = field === 0
    const baseY = isEnemy ? 0 : fieldH + fieldGap
    const slotMap = isEnemy ? enemyMap : selfMap

    for (let row = 0; row < ROWS_PER_FIELD; row++) {
      const rowY = baseY + row * (CARD_H_MM + rowGap)
      for (let col = 0; col < COLS; col++) {
        const lx = col * CARD_W_MM
        const ly = rowY

        let sc0: {x:number,y:number}, sc1: {x:number,y:number},
            sc2: {x:number,y:number}, sc3: {x:number,y:number}

        if (isEnemy) {
          // 敵陣: 行・列ともに逆順で 180° 回転
          const rlx = logW - lx - CARD_W_MM
          const rly = fieldH - ly - CARD_H_MM
          sc0 = toScreen(rlx + CARD_W_MM, rly + CARD_H_MM)  // TL(回転後)
          sc1 = toScreen(rlx,             rly + CARD_H_MM)  // TR
          sc2 = toScreen(rlx + CARD_W_MM, rly)              // BL
          sc3 = toScreen(rlx,             rly)               // BR
        } else {
          sc0 = toScreen(lx,            ly)
          sc1 = toScreen(lx + CARD_W_MM, ly)
          sc2 = toScreen(lx,            ly + CARD_H_MM)
          sc3 = toScreen(lx + CARD_W_MM, ly + CARD_H_MM)
        }

        const poemId = slotMap.get(`${row},${col}`) ?? null
        drawCardQuad(ctx, sc0, sc1, sc2, sc3, poemId, highlightSet.has(poemId ?? -1), settings)
      }
    }
  }
}

// ============================================================
// 任意四角形へのカード描画（アフィン変換）
// tl=左上, tr=右上, bl=左下, br=右下（画面座標）
// ============================================================
function drawCardQuad(
  ctx: CanvasRenderingContext2D,
  tl: {x:number,y:number}, tr: {x:number,y:number},
  bl: {x:number,y:number}, br: {x:number,y:number},
  poemId: number | null,
  highlighted: boolean,
  settings: ProjectionState['settings']
): void {
  ctx.save()

  // クリッピングパス（四角形）
  ctx.beginPath()
  ctx.moveTo(tl.x, tl.y)
  ctx.lineTo(tr.x, tr.y)
  ctx.lineTo(br.x, br.y)
  ctx.lineTo(bl.x, bl.y)
  ctx.closePath()
  ctx.clip()

  if (poemId !== null) {
    const src = cardImagePath(poemId)
    const img = _imgCache.get(src)

    if (img?.complete && img.naturalWidth > 0) {
      const iW = img.naturalWidth
      const iH = img.naturalHeight
      // アフィン変換: 画像 (0,0)→tl, (iW,0)→tr, (0,iH)→bl
      // setTransform(a, b, c, d, e, f) where:
      //   a,b: how x-axis of image maps to screen
      //   c,d: how y-axis of image maps to screen
      //   e,f: origin offset (tl)
      ctx.save()
      ctx.setTransform(
        (tr.x - tl.x) / iW, (tr.y - tl.y) / iW,
        (bl.x - tl.x) / iH, (bl.y - tl.y) / iH,
        tl.x, tl.y
      )
      ctx.drawImage(img, 0, 0)
      ctx.restore()
    } else {
      // 未ロード: プレースホルダー
      preloadImage(src)
      const cx = (tl.x + tr.x + bl.x + br.x) / 4
      const cy = (tl.y + tr.y + bl.y + br.y) / 4
      const h = Math.hypot(bl.x - tl.x, bl.y - tl.y)
      ctx.fillStyle = '#2a1a08'
      ctx.beginPath()
      ctx.moveTo(tl.x, tl.y); ctx.lineTo(tr.x, tr.y)
      ctx.lineTo(br.x, br.y); ctx.lineTo(bl.x, bl.y)
      ctx.closePath(); ctx.fill()
      ctx.fillStyle = '#c8900a'
      ctx.font = `${Math.max(h * 0.25, 8)}px serif`
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle'
      ctx.fillText(String(poemId), cx, cy)
    }

    // ハイライトオーバーレイ（スクリーン座標で、hl_offset_x/y 分シフト）
    if (highlighted) {
      const { hl_color, hl_border_color, hl_fill_opacity, hl_border_width, hl_offset_x, hl_offset_y } = settings
      const ox = hl_offset_x
      const oy = hl_offset_y
      const hex = hl_color.replace('#', '')
      const r = parseInt(hex.slice(0, 2), 16)
      const g = parseInt(hex.slice(2, 4), 16)
      const b = parseInt(hex.slice(4, 6), 16)
      ctx.fillStyle = `rgba(${r},${g},${b},${hl_fill_opacity})`
      ctx.beginPath()
      ctx.moveTo(tl.x + ox, tl.y + oy); ctx.lineTo(tr.x + ox, tr.y + oy)
      ctx.lineTo(br.x + ox, br.y + oy); ctx.lineTo(bl.x + ox, bl.y + oy)
      ctx.closePath(); ctx.fill()
      ctx.strokeStyle = hl_border_color
      ctx.lineWidth = hl_border_width
      ctx.beginPath()
      ctx.moveTo(tl.x + ox, tl.y + oy); ctx.lineTo(tr.x + ox, tr.y + oy)
      ctx.lineTo(br.x + ox, br.y + oy); ctx.lineTo(bl.x + ox, bl.y + oy)
      ctx.closePath(); ctx.stroke()
    }
  } else {
    // 空スロット
    ctx.strokeStyle = '#2a2010'
    ctx.lineWidth = 1
    ctx.beginPath()
    ctx.moveTo(tl.x, tl.y); ctx.lineTo(tr.x, tr.y)
    ctx.lineTo(br.x, br.y); ctx.lineTo(bl.x, bl.y)
    ctx.closePath(); ctx.stroke()
  }

  ctx.restore()
}

// ============================================================
// ハイライトスケジューラ
// ============================================================
const _pendingHighlightTimers: ReturnType<typeof setTimeout>[] = []

export function scheduleHighlights(
  poemId: number,
  upperStartAbsMs: number,
  settings: ProjectionState['settings'],
  remainingIds: number[],
  channel: BroadcastChannel
): void {
  clearScheduledHighlights()

  const poems = getPoems()
  const effectiveKimari = computeEffectiveKimari(remainingIds, poems)
  const currentKimari = effectiveKimari.get(poemId)
  if (!currentKimari) return

  for (let len = 1; len <= currentKimari.length; len++) {
    const prefix = currentKimari.slice(0, len)
    const t = upperStartAbsMs
      + settings.hl_base_offset * 1000
      + len * settings.hl_per_char * 1000

    const targets = findKimariMatches(prefix, remainingIds, effectiveKimari)
    const isFinal = len === currentKimari.length
    const delay = Math.max(0, t - Date.now())

    _pendingHighlightTimers.push(setTimeout(() => {
      channel.postMessage({ type: 'highlight', highlights: targets, final: isFinal })
    }, delay))
  }
}

export function clearScheduledHighlights(): void {
  for (const t of _pendingHighlightTimers) clearTimeout(t)
  _pendingHighlightTimers.length = 0
}
