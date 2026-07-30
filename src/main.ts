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
import { initCardGrid, setModalOpener, broadcastArrangement } from './card-grid'
import { initReading, setSessionType } from './audio'
import { initCalibration, openProjectionWindow, broadcastCalibration, setCalibrationMode } from './calibration'
import { initHighlightPanel, broadcastHighlightConfig } from './settings'
import { initPosture } from './posture'
import { initPlayers } from './player'
import { initSession } from './session'

// ============================================================
// タブルーター
// ============================================================
const TABS = ['calibration', 'arrange', 'play', 'players'] as const
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

    case 'arrange':
      if (!_initialized.has('arrange')) {
        _initialized.add('arrange')
        initCardGrid('#card-grid-container', '#arrange-toolbar')
      }
      break

    case 'play':
      if (!_initialized.has('play')) {
        _initialized.add('play')
        setSessionType('competitive')
        initReading('#play-reading-slot')
        initHighlightPanel('#play-highlight-slot')
        initPosture('#play-posture-slot')
      }
      break

    case 'players':
      if (!_initialized.has('players')) {
        _initialized.add('players')
        initPlayers('#players-ui')
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

  const render = (filter: string) => {
    grid.innerHTML = ''
    const filtered = filter
      ? options.filter(o => o.kimari.startsWith(filter) || o.label?.includes(filter))
      : options

    for (const opt of filtered) {
      const btn = document.createElement('button')
      btn.className = 'modal-card-btn'
      btn.textContent = opt.label ?? opt.kimari
      btn.title = `${opt.poem_id}番: ${opt.kimari}`
      btn.onclick = () => { closeModal(); onSelect(opt.poem_id) }
      grid.appendChild(btn)
    }
    if (filtered.length === 0) {
      grid.innerHTML = '<span style="color:var(--text3);font-size:12px;">該当なし</span>'
    }
  }

  render('')
  searchInput.oninput = () => render(searchInput.value.trim())
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

    grid.innerHTML = ''
    for (const opt of visible) {
      const btn = document.createElement('button')
      btn.className = 'modal-card-btn' + (selected.has(opt.poem_id) ? ' selected' : '')
      btn.textContent = `${opt.poem_id}. ${opt.kimari}`
      btn.title = `${opt.poem_id}番: ${opt.kimari}`
      btn.onclick = () => {
        if (selected.has(opt.poem_id)) selected.delete(opt.poem_id)
        else selected.add(opt.poem_id)
        btn.classList.toggle('selected', selected.has(opt.poem_id))
        syncCount()
      }
      grid.appendChild(btn)
    }
    if (visible.length === 0) {
      grid.innerHTML = '<span style="color:var(--text3);font-size:12px;">該当なし</span>'
    }
  }

  render('')
  syncCount()
  searchInput.oninput = () => render(searchInput.value.trim())

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
