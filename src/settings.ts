// ============================================================
// settings.ts — ハイライト設定パネル（競技タブに常設）
//
// 読み上げ中でもその場で値を変えられる。変更は即座に
//   ・localStorage へ保存
//   ・投影ウィンドウへ配信
// されるので、投影を見ながら追い込める。
// ============================================================

import { getHighlight, setHighlight, DEFAULT_HIGHLIGHT, type HighlightConfig } from './store'
import { broadcastPartial } from './projection-render'

// ============================================================
// 変更の反映
// ============================================================
function _update(patch: Partial<HighlightConfig>): void {
  const next = setHighlight(patch)
  broadcastPartial({ highlight: next })
}

/** 投影ウィンドウ起動時の再送用 */
export function broadcastHighlightConfig(): void {
  broadcastPartial({ highlight: getHighlight() })
}

// ============================================================
// 部品
// ============================================================
type SliderDef = {
  key: keyof HighlightConfig
  label: string
  min: number
  max: number
  step: number
  unit: string
  hint?: string
}

const TIMING_SLIDERS: SliderDef[] = [
  { key: 'silenceSec',      label: '無音',       min: 0,  max: 5,  step: 0.1,  unit: '秒',
    hint: '下の句のあと、上の句が始まるまで' },
  { key: 'leadSec',         label: '先行',       min: -2, max: 3,  step: 0.05, unit: '秒',
    hint: '無音の開始からの追加待ち。マイナスで上の句より前に点く' },
  { key: 'perCharSec',      label: '字数係数',   min: 0,  max: 1,  step: 0.05, unit: '秒/字',
    hint: '決まり字1文字あたりの遅延（段階表示のみ）' },
  { key: 'jokaSilenceSec',  label: '序歌の無音', min: 0,  max: 6,  step: 0.5,  unit: '秒' },
]

const APPEARANCE_SLIDERS: SliderDef[] = [
  { key: 'fillOpacity',  label: '塗り濃度', min: 0,   max: 1,  step: 0.05, unit: '' },
  { key: 'borderWidth',  label: '枠線太さ', min: 0,   max: 8,  step: 1,    unit: 'px' },
  { key: 'offsetX',      label: 'ずれ補正 X', min: -80, max: 80, step: 1,  unit: 'px' },
  { key: 'offsetY',      label: 'ずれ補正 Y', min: -80, max: 80, step: 1,  unit: 'px' },
]

function _sliderRow(def: SliderDef, cfg: HighlightConfig): string {
  const v = cfg[def.key] as number
  return `
    <div class="hl-row">
      <label title="${def.hint ?? ''}">${def.label}</label>
      <input type="range" data-key="${def.key}" min="${def.min}" max="${def.max}" step="${def.step}" value="${v}">
      <span class="hl-val" data-val="${def.key}">${v}${def.unit}</span>
    </div>
  `
}

function _injectStyles(): void {
  if (document.getElementById('hl-panel-style')) return
  const style = document.createElement('style')
  style.id = 'hl-panel-style'
  style.textContent = `
    .hl-row { display:flex; align-items:center; gap:8px; margin-bottom:7px; }
    .hl-row label { min-width:78px; font-size:12px; }
    .hl-row input[type=range] { flex:1; min-width:80px; }
    .hl-val { font-size:11px; color:var(--text3); width:56px; text-align:right; }
    .hl-group { font-size:11px; color:var(--accent2); letter-spacing:0.12em;
                border-bottom:1px solid var(--border); padding-bottom:4px; margin:12px 0 8px; }
    .hl-colors { display:flex; gap:14px; flex-wrap:wrap; }
    .hl-colors label { display:flex; align-items:center; gap:5px; font-size:12px; }
  `
  document.head.appendChild(style)
}

// ============================================================
// 初期化
// ============================================================
export function initHighlightPanel(containerSelector: string): void {
  const container = document.querySelector<HTMLElement>(containerSelector)
  if (!container) return
  _injectStyles()

  const cfg = getHighlight()

  container.innerHTML = `
    <p class="hl-group">光らせ方</p>
    <div class="hl-row">
      <label>対象</label>
      <select id="hl-mode" style="flex:1;">
        <option value="target_only">読まれた札だけ</option>
        <option value="kimariji_stages">決まり字で段階的に絞り込む</option>
      </select>
    </div>
    <div class="hl-row">
      <label title="場の残り札から決まり字を計算し直すか、CSVの初期決まり字を使うか">決まり字</label>
      <select id="hl-source" style="flex:1;">
        <option value="dynamic">場の残り札から動的に</option>
        <option value="fixed">初期決まり字（固定）</option>
      </select>
    </div>

    <p class="hl-group">タイミング</p>
    <div id="hl-timing">${TIMING_SLIDERS.map(d => _sliderRow(d, cfg)).join('')}</div>

    <p class="hl-group">見た目</p>
    <div class="hl-colors" style="margin-bottom:10px;">
      <label>読まれた札 <input type="color" id="hl-target-color" value="${cfg.targetColor}"></label>
      <label>候補 <input type="color" id="hl-candidate-color" value="${cfg.candidateColor}"></label>
      <label>枠線 <input type="color" id="hl-border-color" value="${cfg.borderColor}"></label>
    </div>
    <div id="hl-appearance">${APPEARANCE_SLIDERS.map(d => _sliderRow(d, cfg)).join('')}</div>

    <p class="hl-group">自動再生</p>
    <div class="hl-row">
      <label><input type="checkbox" id="hl-autoplay"> 自動で進む</label>
      <input type="range" id="hl-autoplay-interval" min="0" max="15" step="0.5" value="${cfg.autoPlayIntervalSec}">
      <span class="hl-val" id="hl-autoplay-val">${cfg.autoPlayIntervalSec}秒</span>
    </div>

    <div style="margin-top:14px;">
      <button id="hl-reset" style="font-size:11px;">既定値に戻す</button>
    </div>
  `

  const q = <T extends HTMLElement>(sel: string) => container.querySelector<T>(sel)!

  // --- スライダー（タイミング + 見た目をまとめて） ---
  const allSliders = [...TIMING_SLIDERS, ...APPEARANCE_SLIDERS]
  const unitOf = (key: string) => allSliders.find(d => d.key === key)?.unit ?? ''

  container.querySelectorAll<HTMLInputElement>('input[type=range][data-key]').forEach(input => {
    input.addEventListener('input', () => {
      const key = input.dataset.key as keyof HighlightConfig
      const v = parseFloat(input.value)
      _update({ [key]: v } as Partial<HighlightConfig>)
      const label = container.querySelector<HTMLElement>(`[data-val="${key}"]`)
      if (label) label.textContent = `${v}${unitOf(key)}`
    })
  })

  // --- セレクト ---
  const modeSel = q<HTMLSelectElement>('#hl-mode')
  const srcSel = q<HTMLSelectElement>('#hl-source')
  modeSel.value = cfg.mode
  srcSel.value = cfg.source
  modeSel.addEventListener('change', () => _update({ mode: modeSel.value as HighlightConfig['mode'] }))
  srcSel.addEventListener('change', () => _update({ source: srcSel.value as HighlightConfig['source'] }))

  // --- 色 ---
  const colors: Array<[string, keyof HighlightConfig]> = [
    ['#hl-target-color', 'targetColor'],
    ['#hl-candidate-color', 'candidateColor'],
    ['#hl-border-color', 'borderColor'],
  ]
  for (const [sel, key] of colors) {
    const el = q<HTMLInputElement>(sel)
    el.addEventListener('input', () => _update({ [key]: el.value } as Partial<HighlightConfig>))
  }

  // --- 自動再生 ---
  const auto = q<HTMLInputElement>('#hl-autoplay')
  const interval = q<HTMLInputElement>('#hl-autoplay-interval')
  const intervalVal = q<HTMLElement>('#hl-autoplay-val')
  auto.checked = cfg.autoPlay
  auto.addEventListener('change', () => _update({ autoPlay: auto.checked }))
  interval.addEventListener('input', () => {
    const v = parseFloat(interval.value)
    _update({ autoPlayIntervalSec: v })
    intervalVal.textContent = `${v}秒`
  })

  // --- 既定値に戻す ---
  q('#hl-reset').addEventListener('click', () => {
    _update({ ...DEFAULT_HIGHLIGHT })
    initHighlightPanel(containerSelector)  // フォームを描き直す
  })

  // 起動時の値を投影へ反映
  broadcastHighlightConfig()
}
