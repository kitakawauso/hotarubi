// ============================================================
// main.ts — メインアプリ エントリ・タブルーター・初期化
//
// タブは研究者が実際にたどる順番に並べてある:
//   ① 投影調整 → ② 札配置 → ③ 競技
// プレイヤー登録と姿勢推定は計測するときだけ使う任意の機能で、
// 投影・読み上げの前提条件にはしない。
// ============================================================

import { initDB } from './db'
import { loadPoems } from './data'
import { initCardGrid, setModalOpener, broadcastArrangement, restoreCurrentArrangement } from './card-grid'
import { initReading, setSessionType } from './audio'
import { initCalibration, openProjectionWindow, broadcastCalibration, setCalibrationMode } from './calibration'
import { initHighlightPanel, broadcastHighlightConfig } from './settings'
import { initPosture } from './posture'
import { initPlayers } from './player'
import { initSession } from './session'
import { formatHistoryLabel, type HistoryEntry } from './store'

// ============================================================
// タブルーター
// ============================================================
const TABS = ['calibration', 'camera', 'play'] as const
type Tab = typeof TABS[number]

let _currentTab: Tab = 'calibration'
const _initialized = new Set<string>()

function switchTab(tab: Tab): void {
  if (_currentTab === tab) return

  // 投影は調整タブにいる間だけ枠線表示にする
  if (_currentTab === 'calibration') setCalibrationMode(false)

  _currentTab = tab

  document.querySelectorAll('.tab-btn').forEach(el => {
    el.classList.toggle('active', (el as HTMLElement).dataset.tab === tab)
  })
  document.querySelectorAll('.view').forEach(el => {
    el.classList.toggle('active', el.id === `view-${tab}`)
  })

  initTabOnce(tab)

  if (tab === 'calibration') setCalibrationMode(true)
}

function initTabOnce(tab: Tab): void {
  switch (tab) {
    case 'calibration':
      if (!_initialized.has('calibration')) {
        _initialized.add('calibration')
        initCalibration('#calibration-ui')
      }
      break

    case 'camera':
      if (!_initialized.has('camera')) {
        _initialized.add('camera')
        initPlayers('#players-ui')
        initPosture('#camera-slot')
      }
      break

    case 'play':
      if (!_initialized.has('play')) {
        _initialized.add('play')
        setSessionType('competitive')
        initCardGrid('#card-grid-container', '#arrange-toolbar')
        initReading('#play-reading-slot')
        initHighlightPanel('#play-highlight-slot')
      }
      break
  }
}

// ============================================================
// 汎用モーダル（札選択）
// ============================================================
export interface ModalCardOption {
  poem_id: number
  kimari: string
  label?: string
}

// 決まり字の1文字目でまとめるときの並び順（一字決まりから順の慣用順）
const KIMARI_HEADS = 'むすめふさほせうつしもゆいちひきはやよかみたこおわなあ'.split('')

/**
 * 決まり字の1文字目ごとにグループ化して描画する。
 * 単一選択・複数選択のどちらのモーダルでも同じ見た目にする。
 */
function _renderGrouped(
  grid: HTMLElement,
  options: ModalCardOption[],
  makeButton: (opt: ModalCardOption) => HTMLElement
): void {
  grid.innerHTML = ''
  if (options.length === 0) {
    grid.innerHTML = '<span style="color:var(--text3);font-size:12px;">該当なし</span>'
    return
  }

  const byHead = new Map<string, ModalCardOption[]>()
  for (const o of options) {
    const head = o.kimari.charAt(0) || '—'
    if (!byHead.has(head)) byHead.set(head, [])
    byHead.get(head)!.push(o)
  }

  // 慣用順で並べ、そこに無い頭文字は後ろに回す
  const heads = [
    ...KIMARI_HEADS.filter(h => byHead.has(h)),
    ...[...byHead.keys()].filter(h => !KIMARI_HEADS.includes(h)),
  ]

  for (const head of heads) {
    const section = document.createElement('div')
    section.className = 'modal-group'

    const title = document.createElement('div')
    title.className = 'modal-group-head'
    title.textContent = head
    section.appendChild(title)

    const cards = document.createElement('div')
    cards.className = 'modal-group-cards'
    for (const o of byHead.get(head)!.sort((a, b) => a.poem_id - b.poem_id)) {
      cards.appendChild(makeButton(o))
    }
    section.appendChild(cards)
    grid.appendChild(section)
  }
}

/**
 * 検索文字列に対して「これ1枚」と言い切れる札を返す。
 * 決まり字ちょうど・札番号・決まり字より長く打った場合・打ちかけの
 * いずれでも1枚に決まれば拾う。
 */
function _uniqueMatch(options: ModalCardOption[], query: string): ModalCardOption | null {
  const q = query.trim()
  if (!q) return null

  const exact = options.filter(o => o.kimari === q)
  if (exact.length === 1) return exact[0]

  const byId = options.filter(o => String(o.poem_id) === q)
  if (byId.length === 1) return byId[0]

  // 決まり字より長く打たれた場合。一番長く一致する決まり字の札を採る
  // （「ちぎりお」なら「ち」ではなく「ちぎりお」の札）。
  const covered = options.filter(o => o.kimari.length > 0 && q.startsWith(o.kimari))
  if (covered.length > 0) {
    const maxLen = Math.max(...covered.map(o => o.kimari.length))
    const longest = covered.filter(o => o.kimari.length === maxLen)
    if (longest.length === 1) return longest[0]
  }

  // 打ちかけでも候補が1枚に絞れていれば拾う
  const prefix = options.filter(o => o.kimari.startsWith(q))
  return prefix.length === 1 ? prefix[0] : null
}

export function openCardModal(
  title: string,
  options: ModalCardOption[],
  onSelect: (poemId: number) => void
): void {
  const overlay     = document.getElementById('modal-overlay')!
  const modalTitle  = document.getElementById('modal-title')!
  const grid        = document.getElementById('modal-grid')!
  const searchInput = document.getElementById('modal-search-input') as HTMLInputElement

  modalTitle.textContent = title
  searchInput.value = ''

  const filterOf = (f: string) => f
    ? options.filter(o => o.kimari.startsWith(f) || o.label?.includes(f) || String(o.poem_id) === f)
    : options

  const render = (filter: string) => {
    _renderGrouped(grid, filterOf(filter), opt => {
      const btn = document.createElement('button')
      btn.className = 'modal-card-btn'
      btn.textContent = opt.label ?? opt.kimari
      btn.title = `${opt.poem_id}番: ${opt.kimari}`
      btn.onclick = () => { closeModal(); onSelect(opt.poem_id) }
      return btn
    })
  }

  render('')
  searchInput.oninput = () => render(searchInput.value.trim())
  searchInput.onkeydown = e => {
    if (e.key !== 'Enter') return
    e.preventDefault()
    const hit = _uniqueMatch(options, searchInput.value)
    if (hit) { closeModal(); onSelect(hit.poem_id) }
  }
  overlay.classList.add('visible')
  searchInput.focus()
}

export function closeModal(): void {
  document.getElementById('modal-overlay')!.classList.remove('visible')
  document.getElementById('modal-footer')!.classList.remove('visible')
}

// ============================================================
// 札の複数選択モーダル（読む札セットのカスタム用）
// 同じモーダル DOM を使い回し、フッターを出して選択・非選択を切り替える。
// ============================================================
export function openCardMultiSelect(
  title: string,
  options: ModalCardOption[],
  initiallySelected: number[],
  onDone: (ids: number[]) => void
): void {
  const overlay     = document.getElementById('modal-overlay')!
  const modalTitle  = document.getElementById('modal-title')!
  const grid        = document.getElementById('modal-grid')!
  const footer      = document.getElementById('modal-footer')!
  const countEl     = document.getElementById('modal-count')!
  const searchInput = document.getElementById('modal-search-input') as HTMLInputElement

  const selected = new Set(initiallySelected)
  let visible: ModalCardOption[] = options

  modalTitle.textContent = title
  searchInput.value = ''

  const syncCount = () => { countEl.textContent = `${selected.size} 枚 選択中` }

  const render = (filter: string) => {
    visible = filter
      ? options.filter(o => o.kimari.startsWith(filter) || o.label?.includes(filter) || String(o.poem_id) === filter)
      : options

    _renderGrouped(grid, visible, opt => {
      const btn = document.createElement('button')
      btn.className = 'modal-card-btn' + (selected.has(opt.poem_id) ? ' selected' : '')
      btn.textContent = opt.kimari
      btn.title = `${opt.poem_id}番: ${opt.kimari}`
      btn.onclick = () => {
        if (selected.has(opt.poem_id)) selected.delete(opt.poem_id)
        else selected.add(opt.poem_id)
        btn.classList.toggle('selected', selected.has(opt.poem_id))
        syncCount()
      }
      return btn
    })
  }

  render('')
  syncCount()
  searchInput.oninput = () => render(searchInput.value.trim())

  // 決まり字を打って Enter で1枚だけトグルする
  searchInput.onkeydown = e => {
    if (e.key !== 'Enter') return
    e.preventDefault()
    const hit = _uniqueMatch(options, searchInput.value)
    if (!hit) return
    if (selected.has(hit.poem_id)) selected.delete(hit.poem_id)
    else selected.add(hit.poem_id)
    searchInput.value = ''
    render('')
    syncCount()
  }

  document.getElementById('modal-select-all')!.onclick = () => {
    for (const o of visible) selected.add(o.poem_id)
    render(searchInput.value.trim())
    syncCount()
  }
  document.getElementById('modal-clear-all')!.onclick = () => {
    selected.clear()
    render(searchInput.value.trim())
    syncCount()
  }
  document.getElementById('modal-done')!.onclick = () => {
    closeModal()
    onDone([...selected].sort((a, b) => a - b))
  }

  footer.classList.add('visible')
  overlay.classList.add('visible')
  searchInput.focus()
}

// ============================================================
// 保存履歴のピッカー
// 投影調整・札配置・ハイライト設定で同じ見た目にする。
//   [名前(任意)] [保存] [履歴 select] [読込] [削除]
// 「保存」を押したときだけ履歴が1件増える（上書きはしない）。
// ============================================================
export interface HistoryPickerOptions {
  /** 差し込み先。ここに直接 UI を append する */
  container: HTMLElement
  /** 新しい順の履歴 */
  list: () => Array<HistoryEntry<unknown>>
  onSave: (label: string) => void
  onLoad: (id: string) => void
  onDelete: (id: string) => void
  /** 名前入力の placeholder */
  namePlaceholder?: string
}

export function initHistoryPicker(opts: HistoryPickerOptions): { refresh: () => void } {
  const wrap = document.createElement('div')
  wrap.className = 'history-picker'
  wrap.innerHTML = `
    <input type="text" class="hp-name" placeholder="${opts.namePlaceholder ?? '名前（任意）'}">
    <button class="hp-save primary">保存</button>
    <select class="hp-list"></select>
    <button class="hp-load">読込</button>
    <button class="hp-delete">削除</button>
  `
  opts.container.appendChild(wrap)

  const nameInput = wrap.querySelector<HTMLInputElement>('.hp-name')!
  const listSel   = wrap.querySelector<HTMLSelectElement>('.hp-list')!

  const refresh = (selectId?: string) => {
    const entries = opts.list()
    listSel.innerHTML = entries.length === 0
      ? '<option value="">保存なし</option>'
      : entries.map(e => `<option value="${e.id}">${formatHistoryLabel(e)}</option>`).join('')
    if (selectId) listSel.value = selectId
    listSel.disabled = entries.length === 0
  }

  // 一覧を開くたびに読み直す（別のタブや別の経路で増えていることがある）
  listSel.addEventListener('mousedown', () => refresh(listSel.value))

  wrap.querySelector('.hp-save')!.addEventListener('click', () => {
    opts.onSave(nameInput.value)
    nameInput.value = ''
    refresh()
  })

  wrap.querySelector('.hp-load')!.addEventListener('click', () => {
    if (!listSel.value) return
    opts.onLoad(listSel.value)
  })

  wrap.querySelector('.hp-delete')!.addEventListener('click', () => {
    if (!listSel.value) return
    const label = listSel.options[listSel.selectedIndex]?.textContent ?? ''
    if (!confirm(`「${label.trim()}」を削除しますか？`)) return
    opts.onDelete(listSel.value)
    refresh()
  })

  refresh()
  return { refresh: () => refresh() }
}

// ============================================================
// トースト通知
// ============================================================
let _toastTimer: ReturnType<typeof setTimeout> | null = null
export function showToast(msg: string, duration = 2000): void {
  const el = document.getElementById('toast')!
  el.textContent = msg
  el.classList.add('show')
  if (_toastTimer) clearTimeout(_toastTimer)
  _toastTimer = setTimeout(() => el.classList.remove('show'), duration)
}

// ============================================================
// 起動
// ============================================================
async function boot(): Promise<void> {
  const loading = document.getElementById('loading')!

  try {
    await Promise.all([initDB(), loadPoems()])

    initSession()
    setModalOpener(openCardModal)

    // 前回の作業中の配置を読み戻す。札配置タブを開く前でも
    // 投影と投影調整のプレビューに反映されるよう、ここで復元する。
    restoreCurrentArrangement()

    document.querySelectorAll<HTMLElement>('.tab-btn').forEach(btn => {
      btn.addEventListener('click', () => switchTab(btn.dataset.tab as Tab))
    })

    // 投影ウィンドウ: どのタブからでも開ける
    document.getElementById('btn-open-projection')!.addEventListener('click', openProjectionWindow)

    // 投影ウィンドウは開かれた時点の状態を持っていないので、
    // 起動通知（hello）を受けたら配置・調整・ハイライト設定を送り直す。
    const projChannel = new BroadcastChannel('hotarubi-projection')
    projChannel.addEventListener('message', e => {
      if ((e.data as { type?: string })?.type !== 'hello') return
      broadcastArrangement()
      broadcastCalibration()
      broadcastHighlightConfig()
      setCalibrationMode(_currentTab === 'calibration')
    })

    document.getElementById('modal-close')!.onclick = closeModal
    document.getElementById('modal-overlay')!.addEventListener('click', e => {
      if (e.target === e.currentTarget) closeModal()
    })

    // 初期タブ（投影調整）
    initTabOnce('calibration')
    setCalibrationMode(true)

    loading.classList.add('hidden')
  } catch (err) {
    console.error('起動失敗:', err)
    loading.innerHTML = `<span style="color:#e06060">起動に失敗しました: ${err}</span>`
  }
}

boot()
