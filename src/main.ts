// ============================================================
// main.ts — メインアプリ エントリ・タブルーター・初期化
// ============================================================

import { initDB } from './db'
import { loadPoems } from './data'
import { initCardGrid, setModalOpener } from './card-grid'
import { initReading, setSessionType } from './audio'
import { initCalibration } from './calibration'
import { initPosture } from './posture'
import { initPlayers } from './player'
import { initReview } from './review'
import { initSettings } from './settings'
import { initSession } from './session'

// ============================================================
// タブルーター
// ============================================================
const TABS = ['players', 'competitive', 'memorize', 'calibration', 'review', 'settings'] as const
type Tab = typeof TABS[number]

let _currentTab: Tab = 'players'
const _initialized = new Set<string>()

// 共有読み上げパネルを指定スロットに移動する
function _moveReadingPanel(slotId: string): void {
  const panel = document.getElementById('reading-shared-panel')!
  const slot  = document.getElementById(slotId)!
  if (panel.parentElement !== slot) {
    panel.style.display = ''
    slot.appendChild(panel)
  }
}

function switchTab(tab: Tab): void {
  if (_currentTab === tab) return
  _currentTab = tab

  document.querySelectorAll('.tab-btn').forEach(el => {
    el.classList.toggle('active', (el as HTMLElement).dataset.tab === tab)
  })
  document.querySelectorAll('.view').forEach(el => {
    const isActive = el.id === `view-${tab}`
    el.classList.toggle('active', isActive)
  })

  initTabOnce(tab)
}

function initTabOnce(tab: Tab): void {
  switch (tab) {
    case 'players':
      if (!_initialized.has('players')) {
        _initialized.add('players')
        initPlayers('#players-ui')
      }
      break

    case 'competitive':
      // 読み上げパネルを競技スロットに移動
      if (!_initialized.has('reading')) {
        _initialized.add('reading')
        initReading('#reading-shared-panel')
      }
      setSessionType('competitive')
      _moveReadingPanel('comp-reading-slot')

      if (!_initialized.has('posture')) {
        _initialized.add('posture')
        initPosture('#comp-posture-slot')
      }
      break

    case 'memorize':
      // 読み上げパネルを暗記スロットに移動
      if (!_initialized.has('reading')) {
        _initialized.add('reading')
        initReading('#reading-shared-panel')
      }
      setSessionType('memorization')
      _moveReadingPanel('memo-reading-slot')

      if (!_initialized.has('arrange')) {
        _initialized.add('arrange')
        initCardGrid('#card-grid-container', '#arrange-toolbar')
      }
      break

    case 'calibration':
      if (!_initialized.has('calibration')) {
        _initialized.add('calibration')
        initCalibration('#calibration-ui')
      }
      break

    case 'review':
      if (!_initialized.has('review')) {
        _initialized.add('review')
        initReview('#review-ui')
      }
      break

    case 'settings':
      if (!_initialized.has('settings')) {
        _initialized.add('settings')
        initSettings('#settings-ui')
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

type ModalCallback = (poemId: number) => void
let _modalCb: ModalCallback | null = null

export function openCardModal(
  title: string,
  options: ModalCardOption[],
  onSelect: ModalCallback
): void {
  const overlay     = document.getElementById('modal-overlay')!
  const modalTitle  = document.getElementById('modal-title')!
  const grid        = document.getElementById('modal-grid')!
  const searchInput = document.getElementById('modal-search-input') as HTMLInputElement

  modalTitle.textContent = title
  _modalCb = onSelect
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
  _modalCb = null
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

    // タブクリック
    document.querySelectorAll<HTMLElement>('.tab-btn').forEach(btn => {
      btn.addEventListener('click', () => switchTab(btn.dataset.tab as Tab))
    })

    // モード選択ボタン（プレイヤー画面）
    document.getElementById('btn-start-competitive')!.addEventListener('click', () => switchTab('competitive'))
    document.getElementById('btn-start-memorize')!.addEventListener('click', () => switchTab('memorize'))

    // モーダルを閉じる
    document.getElementById('modal-close')!.onclick = closeModal
    document.getElementById('modal-overlay')!.addEventListener('click', e => {
      if (e.target === e.currentTarget) closeModal()
    })

    // 初期タブ（プレイヤー）を初期化
    initTabOnce('players')

    loading.classList.add('hidden')
  } catch (err) {
    console.error('起動失敗:', err)
    loading.innerHTML = `<span style="color:#e06060">起動に失敗しました: ${err}</span>`
  }
}

boot()
