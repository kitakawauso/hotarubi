// ============================================================
// review.ts — 振り返りUI（単試合・複数試合比較・骨格重ね合わせ）
// ============================================================

import { db } from './db'
import type { Session, ReadingLogEntry, PostureFrame } from './db'
import { drawSkeleton } from './posture'
import { getPoems, getPoemById } from './data'

// ============================================================
// ヘルパー
// ============================================================
function fmtDate(s: string): string {
  return s ? s.slice(0, 16).replace('T', ' ') : '—'
}

function msToSec(ms?: number): string {
  if (ms === undefined || ms === null) return '—'
  return (ms / 1000).toFixed(1) + 's'
}

// ============================================================
// 単試合表示
// ============================================================
function renderSingleSession(container: HTMLElement, sessionId: number): void {
  const log = db.getReadingLog(sessionId)
  if (log.length === 0) {
    container.innerHTML = '<p style="color:var(--text3);">読み上げログがありません。</p>'
    return
  }

  container.innerHTML = `
    <div style="display:flex;flex-direction:column;gap:16px;">
      <div style="display:flex;align-items:center;gap:12px;">
        <label style="font-size:12px;">読み順:</label>
        <input type="range" id="rv-slider" min="0" max="${log.length - 1}" value="0" style="flex:1;">
        <span id="rv-pos-label" style="min-width:60px;font-size:12px;color:var(--text3);">1 / ${log.length}</span>
      </div>
      <div style="display:flex;gap:16px;flex-wrap:wrap;">
        <div id="rv-poem-detail" style="flex:1;min-width:200px;">
          <p class="section-title" style="font-size:12px;">詩情報</p>
          <div id="rv-poem-text" style="font-size:15px;color:var(--accent2);letter-spacing:0.1em;"></div>
          <div id="rv-timing" style="margin-top:8px;font-size:12px;color:var(--text3);line-height:1.8;"></div>
        </div>
        <div style="flex:1;min-width:240px;">
          <p class="section-title" style="font-size:12px;">骨格フレーム</p>
          <canvas id="rv-skeleton" width="320" height="240"
            style="border:1px solid var(--border);border-radius:4px;background:#000;width:100%;max-width:320px;"></canvas>
        </div>
      </div>
    </div>
  `

  const slider   = container.querySelector<HTMLInputElement>('#rv-slider')!
  const posLabel = container.querySelector<HTMLElement>('#rv-pos-label')!
  const poemText = container.querySelector<HTMLElement>('#rv-poem-text')!
  const timing   = container.querySelector<HTMLElement>('#rv-timing')!
  const skelCanvas = container.querySelector<HTMLCanvasElement>('#rv-skeleton')!
  const skelCtx  = skelCanvas.getContext('2d')!

  function renderEntry(entry: ReadingLogEntry): void {
    const poem = getPoemById(entry.poem_id)
    poemText.textContent = poem
      ? `${entry.poem_id}番 「${poem.kimari_ji}…」`
      : `詩 ${entry.poem_id}`

    timing.innerHTML = `
      上の句開始: ${msToSec(entry.upper_start_ms)}<br>
      下の句開始: ${msToSec(entry.lower_start_ms)}<br>
      下の句終了: ${msToSec(entry.lower_end_ms)}
    `

    // 骨格フレームを描画
    skelCtx.clearRect(0, 0, skelCanvas.width, skelCanvas.height)
    if (entry.id !== undefined) {
      const frames = db.getPostureFrames(sessionId, entry.id)
      if (frames.length > 0) {
        // 最初のフレームを描画
        const kps = JSON.parse(frames[Math.floor(frames.length / 2)].keypoints)
        drawSkeleton(skelCtx, kps, '#00ff88')
      } else {
        skelCtx.fillStyle = '#333'
        skelCtx.font = '12px sans-serif'
        skelCtx.fillText('骨格データなし', 10, skelCanvas.height / 2)
      }
    }
  }

  slider.addEventListener('input', () => {
    const idx = parseInt(slider.value)
    posLabel.textContent = `${idx + 1} / ${log.length}`
    renderEntry(log[idx])
  })

  renderEntry(log[0])
}

// ============================================================
// 複数試合比較
// ============================================================
function renderMultiSession(container: HTMLElement, sessionIds: number[]): void {
  const COLORS = ['#00aaff', '#ff4444', '#44ff88', '#ffaa00', '#aa44ff']

  container.innerHTML = `
    <div style="display:flex;flex-direction:column;gap:16px;">
      <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;">
        <label style="font-size:12px;">詩を選択:</label>
        <select id="rv-multi-poem" style="flex:1;max-width:200px;"></select>
      </div>
      <canvas id="rv-multi-canvas" width="640" height="480"
        style="border:1px solid var(--border);border-radius:4px;background:#000;width:100%;max-width:640px;"></canvas>
      <div id="rv-multi-legend" style="display:flex;gap:12px;flex-wrap:wrap;font-size:11px;"></div>
    </div>
  `

  const poemSel  = container.querySelector<HTMLSelectElement>('#rv-multi-poem')!
  const canvas   = container.querySelector<HTMLCanvasElement>('#rv-multi-canvas')!
  const ctx      = canvas.getContext('2d')!
  const legend   = container.querySelector<HTMLElement>('#rv-multi-legend')!

  // 全セッションのログを取得して詩のユニーク一覧を作成
  const allLogs = sessionIds.flatMap(sid => db.getReadingLog(sid).map(l => ({ ...l, sessionId: sid })))
  const poemIds = [...new Set(allLogs.map(l => l.poem_id))].sort((a, b) => a - b)
  const poems = getPoems()

  poemSel.innerHTML = poemIds.map(id => {
    const p = poems.find(p => p.id === id)
    return `<option value="${id}">${id}番 ${p?.kimari_ji ?? ''}</option>`
  }).join('')

  // 凡例
  legend.innerHTML = sessionIds.map((sid, i) => `
    <span style="display:flex;align-items:center;gap:4px;">
      <span style="width:16px;height:3px;background:${COLORS[i % COLORS.length]};display:inline-block;"></span>
      セッション ${sid}
    </span>
  `).join('')

  function drawForPoem(poemId: number): void {
    ctx.clearRect(0, 0, canvas.width, canvas.height)

    for (let i = 0; i < sessionIds.length; i++) {
      const sid = sessionIds[i]
      const log = db.getReadingLog(sid).find(l => l.poem_id === poemId)
      if (!log?.id) continue

      const frames = db.getPostureFrames(sid, log.id)
      if (frames.length === 0) continue

      // 各セッションの中間フレームを描画
      const mid = Math.floor(frames.length / 2)
      const kps = JSON.parse(frames[mid].keypoints)
      drawSkeleton(ctx, kps, COLORS[i % COLORS.length], 0.8)
    }
  }

  poemSel.addEventListener('change', () => drawForPoem(parseInt(poemSel.value)))
  if (poemIds.length > 0) drawForPoem(poemIds[0])
}

// ============================================================
// UI 初期化
// ============================================================
export function initReview(containerSelector: string): void {
  const container = document.querySelector<HTMLElement>(containerSelector)
  if (!container) return

  container.innerHTML = `
    <div style="display:flex;flex-direction:column;gap:16px;">
      <!-- フィルター -->
      <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;">
        <label style="font-size:12px;">表示モード:</label>
        <select id="rv-mode">
          <option value="single">単試合</option>
          <option value="multi">複数比較</option>
        </select>
        <label style="font-size:12px;">セッション:</label>
        <select id="rv-session-sel" style="flex:1;max-width:300px;"></select>
        <div id="rv-multi-sel" style="display:none;display:flex;gap:4px;flex-wrap:wrap;align-items:center;">
          <label style="font-size:12px;">比較対象:</label>
          <div id="rv-session-checks" style="display:flex;gap:6px;flex-wrap:wrap;"></div>
        </div>
        <button id="rv-load" class="primary">読み込む</button>
      </div>

      <!-- コンテンツ -->
      <div id="rv-content"></div>
    </div>
  `

  const modeSel   = container.querySelector<HTMLSelectElement>('#rv-mode')!
  const sessionSel= container.querySelector<HTMLSelectElement>('#rv-session-sel')!
  const multiSel  = container.querySelector<HTMLElement>('#rv-multi-sel')!
  const checksWrap= container.querySelector<HTMLElement>('#rv-session-checks')!
  const loadBtn   = container.querySelector<HTMLButtonElement>('#rv-load')!
  const content   = container.querySelector<HTMLElement>('#rv-content')!

  function populateSessions(): void {
    const sessions = db.getSessions()
    sessionSel.innerHTML = sessions.length === 0
      ? '<option value="">セッションなし</option>'
      : sessions.map(s => `<option value="${s.id}">${fmtDate(s.started_at ?? '')} (${s.session_type})</option>`).join('')

    checksWrap.innerHTML = sessions.map(s => `
      <label style="font-size:11px;display:flex;align-items:center;gap:3px;">
        <input type="checkbox" value="${s.id}">
        ${fmtDate(s.started_at ?? '')}
      </label>
    `).join('')
  }

  modeSel.addEventListener('change', () => {
    const isSingle = modeSel.value === 'single'
    sessionSel.style.display = isSingle ? '' : 'none'
    multiSel.style.display   = isSingle ? 'none' : ''
  })

  loadBtn.addEventListener('click', () => {
    if (modeSel.value === 'single') {
      const sid = parseInt(sessionSel.value)
      if (!sid) return
      renderSingleSession(content, sid)
    } else {
      const checks = Array.from(checksWrap.querySelectorAll<HTMLInputElement>('input[type=checkbox]:checked'))
      const ids = checks.map(c => parseInt(c.value)).filter(Boolean)
      if (ids.length < 2) { alert('比較するセッションを2つ以上選択してください'); return }
      renderMultiSession(content, ids)
    }
  })

  // 初期状態
  populateSessions()
  content.innerHTML = '<p style="color:var(--text3);font-size:12px;">セッションを選択して「読み込む」を押してください。</p>'
}
