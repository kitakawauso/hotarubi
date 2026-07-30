// ============================================================
// settings.ts — 設定パネルUI・設定プロファイルCRUD
// ============================================================

import { db, type Settings, DEFAULT_SETTINGS } from './db'
import { setReadingConfig } from './audio'

// アクティブな設定（読み上げ等で参照）
let _active: Settings = { name: 'デフォルト', ...DEFAULT_SETTINGS }

export function getActiveSettings(): Settings { return _active }

export function setActiveSettings(s: Settings): void {
  _active = s
  // audio.ts に反映
  setReadingConfig({
    gap_lower_upper: s.gap_lower_upper,
    gap_upper_lower: s.gap_upper_lower,
    hl_base_offset: s.hl_base_offset,
    hl_per_char: s.hl_per_char,
    hl_color: s.hl_color,
    hl_border_color: s.hl_border_color,
    hl_fill_opacity: s.hl_fill_opacity,
    hl_border_width: s.hl_border_width,
    hl_offset_x: s.hl_offset_x,
    hl_offset_y: s.hl_offset_y,
    row_gap_mm: s.row_gap_mm,
    field_gap_mm: s.field_gap_mm,
  })
  // 投影ウィンドウに反映
  new BroadcastChannel('hotarubi-projection').postMessage({
    type: 'settings',
    settings: {
      row_gap_mm: s.row_gap_mm,
      field_gap_mm: s.field_gap_mm,
      hl_color: s.hl_color,
      hl_border_color: s.hl_border_color,
      hl_fill_opacity: s.hl_fill_opacity,
      hl_border_width: s.hl_border_width,
      hl_offset_x: s.hl_offset_x,
      hl_offset_y: s.hl_offset_y,
      hl_base_offset: s.hl_base_offset,
      hl_per_char: s.hl_per_char,
    },
  })
}

// ============================================================
// スライダー + 数値入力 のペアを生成するヘルパー
// ============================================================
function makeSlider(
  id: string,
  label: string,
  min: number,
  max: number,
  step: number,
  value: number,
  unit = ''
): HTMLElement {
  const row = document.createElement('div')
  row.className = 'form-row'
  row.innerHTML = `
    <label style="min-width:140px;">${label}</label>
    <input type="range" id="${id}-range" min="${min}" max="${max}" step="${step}" value="${value}" style="flex:1;">
    <input type="number" id="${id}-num" min="${min}" max="${max}" step="${step}" value="${value}" style="width:70px;">
    <span style="font-size:11px;color:var(--text3);">${unit}</span>
  `
  const range = row.querySelector<HTMLInputElement>(`#${id}-range`)!
  const num   = row.querySelector<HTMLInputElement>(`#${id}-num`)!
  range.addEventListener('input', () => { num.value = range.value; row.dispatchEvent(new Event('change', { bubbles: true })) })
  num.addEventListener('input', () => { range.value = num.value; row.dispatchEvent(new Event('change', { bubbles: true })) })
  return row
}

function getSliderValue(container: Element, id: string): number {
  return parseFloat((container.querySelector(`#${id}-num`) as HTMLInputElement).value)
}

function setSliderValue(container: Element, id: string, value: number): void {
  ;(container.querySelector(`#${id}-num`) as HTMLInputElement).value = String(value)
  ;(container.querySelector(`#${id}-range`) as HTMLInputElement).value = String(value)
}

// ============================================================
// 設定フォーム構築
// ============================================================
function buildSettingsForm(container: HTMLElement, s: Settings): void {
  container.innerHTML = ''

  const sections = [
    { title: '音声間隔', sliders: [
      { id: 'gap-lu', label: '下→上の句の間', min: 0.5, max: 1.5, step: 0.1, key: 'gap_lower_upper', unit: '秒' },
      { id: 'gap-ul', label: '上→下の句の間', min: 1,   max: 10,  step: 0.5, key: 'gap_upper_lower', unit: '秒' },
    ]},
    { title: 'ハイライト タイミング', sliders: [
      { id: 'hl-base', label: '基準オフセット', min: -2, max: 2, step: 0.05, key: 'hl_base_offset', unit: '秒' },
      { id: 'hl-char', label: '字数係数',       min: 0.05, max: 1, step: 0.05, key: 'hl_per_char',   unit: '秒/字' },
    ]},
    { title: 'ハイライト 外観', sliders: [
      { id: 'hl-opacity', label: '塗りつぶし不透明度', min: 0, max: 1, step: 0.05, key: 'hl_fill_opacity', unit: '' },
      { id: 'hl-border',  label: '枠線太さ',           min: 1, max: 5, step: 1,    key: 'hl_border_width', unit: 'px' },
      { id: 'hl-ox',      label: 'オフセット X',       min: -50, max: 50, step: 1, key: 'hl_offset_x',    unit: 'px' },
      { id: 'hl-oy',      label: 'オフセット Y',       min: -50, max: 50, step: 1, key: 'hl_offset_y',    unit: 'px' },
    ]},
    { title: '投影レイアウト', sliders: [
      { id: 'row-gap',   label: '段間隔',       min: 0,  max: 30, step: 1, key: 'row_gap_mm',   unit: 'mm' },
      { id: 'field-gap', label: '自陣・敵陣間', min: 0,  max: 60, step: 1, key: 'field_gap_mm', unit: 'mm' },
    ]},
  ]

  for (const sec of sections) {
    const title = document.createElement('p')
    title.className = 'section-title'
    title.style.fontSize = '12px'
    title.textContent = sec.title
    container.appendChild(title)

    for (const sl of sec.sliders) {
      const el = makeSlider(sl.id, sl.label, sl.min, sl.max, sl.step, (s as any)[sl.key], sl.unit)
      container.appendChild(el)
    }
  }

  // カラーピッカー
  const colorSection = document.createElement('div')
  colorSection.innerHTML = `
    <div class="form-row">
      <label style="min-width:140px;">ハイライト色</label>
      <input type="color" id="hl-color" value="${s.hl_color}">
    </div>
    <div class="form-row">
      <label style="min-width:140px;">枠線色</label>
      <input type="color" id="hl-border-color" value="${s.hl_border_color}">
    </div>
  `
  container.appendChild(colorSection)
}

// ============================================================
// UI 初期化
// ============================================================
export function initSettings(containerSelector: string): void {
  const container = document.querySelector<HTMLElement>(containerSelector)
  if (!container) return

  container.innerHTML = `
    <div style="display:flex;gap:20px;flex-wrap:wrap;">
      <!-- プロファイル一覧 -->
      <div style="flex:1;min-width:200px;">
        <p class="section-title" style="font-size:13px;">設定プロファイル</p>
        <div id="settings-list" style="display:flex;flex-direction:column;gap:6px;margin-bottom:12px;"></div>
        <button id="settings-new" class="primary">＋ 新規作成</button>
      </div>

      <!-- 設定フォーム -->
      <div id="settings-detail" style="flex:3;min-width:320px;display:none;">
        <div style="display:flex;gap:8px;margin-bottom:12px;align-items:center;flex-wrap:wrap;">
          <input type="text" id="settings-name" placeholder="プロファイル名" style="flex:1;">
          <button id="settings-save" class="primary">保存</button>
          <button id="settings-apply">適用</button>
          <button id="settings-delete" style="color:#e06060;border-color:#e06060;">削除</button>
          <button id="settings-cancel">閉じる</button>
        </div>
        <div id="settings-form-body"></div>
      </div>
    </div>
  `

  const list       = container.querySelector<HTMLElement>('#settings-list')!
  const detail     = container.querySelector<HTMLElement>('#settings-detail')!
  const nameInput  = container.querySelector<HTMLInputElement>('#settings-name')!
  const formBody   = container.querySelector<HTMLElement>('#settings-form-body')!
  let _editId: number | undefined

  function renderList(): void {
    const items = db.getSettingsList()
    list.innerHTML = ''
    if (items.length === 0) {
      list.innerHTML = '<span style="color:var(--text3);font-size:12px;">プロファイルがありません</span>'
      return
    }
    for (const item of items) {
      const el = document.createElement('div')
      el.style.cssText = 'display:flex;align-items:center;gap:8px;padding:6px 8px;background:var(--bg2);border:1px solid var(--border);border-radius:6px;cursor:pointer;'
      const isActive = item.id === _active.id
      el.innerHTML = `
        <span style="font-size:13px;flex:1;${isActive ? 'color:var(--accent2)' : ''}">${item.name}</span>
        ${isActive ? '<span style="font-size:10px;color:var(--accent);">使用中</span>' : ''}
      `
      el.addEventListener('click', () => openDetail(item))
      list.appendChild(el)
    }
  }

  function openDetail(s: Settings): void {
    _editId = s.id
    nameInput.value = s.name
    buildSettingsForm(formBody, s)
    detail.style.display = ''

    // 変更時にリアルタイム適用（まだ保存はしない）
    formBody.addEventListener('change', () => {
      const updated = readFormValues(s)
      setActiveSettings(updated)
    })
  }

  function readFormValues(base: Settings): Settings {
    const sliderKeys = [
      ['gap-lu', 'gap_lower_upper'], ['gap-ul', 'gap_upper_lower'],
      ['hl-base', 'hl_base_offset'], ['hl-char', 'hl_per_char'],
      ['hl-opacity', 'hl_fill_opacity'], ['hl-border', 'hl_border_width'],
      ['hl-ox', 'hl_offset_x'], ['hl-oy', 'hl_offset_y'],
      ['row-gap', 'row_gap_mm'], ['field-gap', 'field_gap_mm'],
    ] as const
    const result = { ...base, name: nameInput.value }
    for (const [id, key] of sliderKeys) {
      const el = formBody.querySelector<HTMLInputElement>(`#${id}-num`)
      if (el) (result as any)[key] = parseFloat(el.value)
    }
    const hlColor = formBody.querySelector<HTMLInputElement>('#hl-color')
    const hlBorder = formBody.querySelector<HTMLInputElement>('#hl-border-color')
    if (hlColor) result.hl_color = hlColor.value
    if (hlBorder) result.hl_border_color = hlBorder.value
    return result
  }

  function closeDetail(): void {
    detail.style.display = 'none'
    _editId = undefined
  }

  container.querySelector('#settings-new')!.addEventListener('click', () => {
    const s: Settings = { name: '新しいプロファイル', ...DEFAULT_SETTINGS }
    buildSettingsForm(formBody, s)
    nameInput.value = s.name
    _editId = undefined
    detail.style.display = ''
  })

  container.querySelector('#settings-save')!.addEventListener('click', () => {
    const base = _editId ? (db.getSettings(_editId) ?? { ...DEFAULT_SETTINGS, name: '' }) : { ...DEFAULT_SETTINGS, name: '' }
    const updated = readFormValues(base as Settings)
    updated.id = _editId
    const newId = db.upsertSettings(updated)
    updated.id = newId
    _editId = newId
    renderList()
  })

  container.querySelector('#settings-apply')!.addEventListener('click', () => {
    if (!_editId) return
    const s = db.getSettings(_editId)
    if (s) setActiveSettings(s)
    renderList()
  })

  container.querySelector('#settings-delete')!.addEventListener('click', () => {
    if (!_editId || !confirm('このプロファイルを削除しますか？')) return
    db.deleteSettings(_editId)
    closeDetail()
    renderList()
  })

  container.querySelector('#settings-cancel')!.addEventListener('click', closeDetail)

  renderList()
}
