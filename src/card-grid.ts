// ============================================================
// card-grid.ts — 札配置グリッドUI（配置・暗記・投影で共用）
// ============================================================

import { getPoems, cardImagePath } from './data'
import { broadcastAll } from './projection-render'
import {
  loadArrangements, saveArrangement, deleteArrangement,
  loadCardSet, saveCardSet,
  type ArrangementCard, type SavedArrangement,
} from './store'

export type { ArrangementCard }

// ============================================================
// 型定義
// ============================================================
type Slot = number | null  // poem_id または空

const COLS = 16

// grid[field][row][col]: field 0=自陣, 1=敵陣
let _grid: Slot[][][] = [
  [new Array(16).fill(null), new Array(16).fill(null), new Array(16).fill(null)],
  [new Array(16).fill(null), new Array(16).fill(null), new Array(16).fill(null)],
]

// 札セット: null = 全100枚、Set = 使用する poem_id の集合
let _activeSet: Set<number> | null = null

// 札セットの指定内容（localStorage から復元する）
const _savedCardSet = loadCardSet()
let _setPlace: 'ones' | 'tens' = _savedCardSet.place
const _setDigits = new Set<number>(_savedCardSet.digits)

type ChangeHandler = () => void
const _changeHandlers: ChangeHandler[] = []

export function onArrangementChange(cb: ChangeHandler): () => void {
  _changeHandlers.push(cb)
  return () => { const i = _changeHandlers.indexOf(cb); if (i >= 0) _changeHandlers.splice(i, 1) }
}

function _notifyChange(): void {
  for (const h of [..._changeHandlers]) h()
  broadcastArrangement()
}

// ============================================================
// モーダルオープナー
// ============================================================
type ModalOpener = (
  title: string,
  options: Array<{ poem_id: number; kimari: string; label?: string }>,
  cb: (id: number) => void
) => void

let _openModal: ModalOpener = () => {}
export function setModalOpener(fn: ModalOpener): void { _openModal = fn }

// ============================================================
// 投影ウィンドウへの送信
// 投影ウィンドウは開いた時点の状態を持っていないため、配置変更時だけでなく
// 投影側から hello を受け取ったときにも呼び出して送り直す。
// ============================================================
export function broadcastArrangement(): void {
  broadcastAll(getArrangement())
}

// ============================================================
// 配置データアクセス
// ============================================================
export function getArrangement(): { self: ArrangementCard[]; enemy: ArrangementCard[] } {
  const toCards = (field: Slot[][]): ArrangementCard[] => {
    const cards: ArrangementCard[] = []
    for (let r = 0; r < 3; r++)
      for (let c = 0; c < 16; c++)
        if (field[r][c] !== null) cards.push({ poem_id: field[r][c]!, row: r, col: c })
    return cards
  }
  return { self: toCards(_grid[0]), enemy: toCards(_grid[1]) }
}

/** 場に出ている札の poem_id 一覧（決まり字計算とハイライト対象の判定に使う） */
export function getFieldPoemIds(): number[] {
  const { self, enemy } = getArrangement()
  return [...new Set([...self, ...enemy].map(c => c.poem_id))]
}

export function setArrangement(self: ArrangementCard[], enemy: ArrangementCard[]): void {
  _grid = [
    [new Array(16).fill(null), new Array(16).fill(null), new Array(16).fill(null)],
    [new Array(16).fill(null), new Array(16).fill(null), new Array(16).fill(null)],
  ]
  for (const c of self)  _grid[0][c.row][c.col] = c.poem_id
  for (const c of enemy) _grid[1][c.row][c.col] = c.poem_id
  _notifyChange()
  _renderAll()
}

export function removeCard(poemId: number): void {
  for (let f = 0; f < 2; f++) {
    for (let r = 0; r < 3; r++) {
      const col = _grid[f][r].indexOf(poemId)
      if (col >= 0) {
        _grid[f][r][col] = null
        if (_compactMode) _compactRow(f, r, col)
        _notifyChange()
        _renderAll()
        return
      }
    }
  }
}

/**
 * 端寄せ（送り）。出札があった段の、出札があった側だけを詰める。
 *
 * 中心（列8）を境に、出札が左半分なら **左半分の札だけ** を1つずつ左へ、
 * 右半分なら **右半分の札だけ** を1つずつ右へ寄せる。
 * 反対側の半分は動かさない。
 *
 *   例) 左半分の列1が出札
 *       [A _ B C _ _ _ _ | _ _ F G _ _ _ _]
 *     → [A B C _ _ _ _ _ | _ _ F G _ _ _ _]   右半分はそのまま
 *
 *   例) 右半分の列11が出札
 *       [A B _ _ _ _ _ _ | _ F _ G H _ _ _]
 *     → [A B _ _ _ _ _ _ | _ _ F G H _ _ _]   左半分はそのまま
 */
function _compactRow(field: number, row: number, removedCol: number): void {
  const r = _grid[field][row]
  const HALF = COLS / 2

  if (removedCol < HALF) {
    // 左半分の中だけで、空いた位置より右の札を1つずつ左へ
    for (let c = removedCol; c < HALF - 1; c++) r[c] = r[c + 1]
    r[HALF - 1] = null
  } else {
    // 右半分の中だけで、空いた位置より左の札を1つずつ右へ
    for (let c = removedCol; c > HALF; c--) r[c] = r[c - 1]
    r[HALF] = null
  }
}

// ============================================================
// 有効な札一覧（activeSetに従う）
// ============================================================
function _availablePoems(): number[] {
  const poems = getPoems()
  const all = poems.filter(p => !_activeSet || _activeSet.has(p.id)).map(p => p.id)
  return all
}

// ============================================================
// 配置パターン（A〜E）
// ============================================================
function _shuffle<T>(arr: T[]): T[] {
  return [...arr].sort(() => Math.random() - 0.5)
}

function _fillEndCluster(cards: number[]): Slot[][] {
  const shuffled = _shuffle(cards)
  const rows: Slot[][] = [new Array(16).fill(null), new Array(16).fill(null), new Array(16).fill(null)]
  const perRow = Math.ceil(shuffled.length / 3)
  let idx = 0
  for (let r = 0; r < 3; r++) {
    const count = r < 2 ? Math.min(perRow, shuffled.length - idx) : shuffled.length - idx
    if (count <= 0) break
    const chunk = shuffled.slice(idx, idx + count)
    idx += count
    let left = 0, right = 15
    for (let i = 0; i < chunk.length; i++) {
      if (i % 2 === 0) rows[r][left++] = chunk[i]
      else             rows[r][right--] = chunk[i]
    }
  }
  return rows
}

function _fillRandom(cards: number[]): Slot[][] {
  const shuffled = _shuffle(cards)
  const allSlots: [number, number][] = []
  for (let r = 0; r < 3; r++)
    for (let c = 0; c < 16; c++)
      allSlots.push([r, c])
  const pickedSlots = _shuffle(allSlots).slice(0, shuffled.length)
  const rows: Slot[][] = [new Array(16).fill(null), new Array(16).fill(null), new Array(16).fill(null)]
  shuffled.forEach((id, i) => { rows[pickedSlots[i][0]][pickedSlots[i][1]] = id })
  return rows
}

export type ArrangePattern = 'A' | 'B' | 'C' | 'D' | 'E'

export function applyArrangePattern(pattern: ArrangePattern, count = 25): void {
  if (pattern === 'E') return
  const pool = _availablePoems()
  const usedByOther = new Set<number>()

  if (pattern === 'A' || pattern === 'B') {
    const selfIds  = _shuffle(pool).slice(0, count)
    const remaining = pool.filter(id => !selfIds.includes(id))
    const enemyIds = _shuffle(remaining).slice(0, count)
    _grid[0] = pattern === 'A' ? _fillRandom(selfIds)  : _fillEndCluster(selfIds)
    _grid[1] = pattern === 'A' ? _fillRandom(enemyIds) : _fillEndCluster(enemyIds)
  } else {
    // C, D: 自陣現状維持
    for (let r = 0; r < 3; r++)
      for (const s of _grid[0][r])
        if (s !== null) usedByOther.add(s)
    const available = pool.filter(id => !usedByOther.has(id))
    const enemyIds = _shuffle(available).slice(0, count)
    _grid[1] = pattern === 'C' ? _fillRandom(enemyIds) : _fillEndCluster(enemyIds)
  }

  _notifyChange()
  _renderAll()
}

// ============================================================
// ドラッグ&ドロップ
// ============================================================
let _dragSrc: { field: number; row: number; col: number } | null = null

// ============================================================
// レンダリング
// ============================================================
let _container: HTMLElement | null = null

// 端寄せ自動。ツールバーのチェックボックスが唯一の書き込み元で、
// 札が取られた（removeCard）ときに参照される。
let _compactMode = false

function _countCards(field: number): number {
  let n = 0
  for (const row of _grid[field]) for (const s of row) if (s !== null) n++
  return n
}

function _renderAll(): void {
  if (!_container) return
  for (let f = 0; f < 2; f++) {
    for (let r = 0; r < 3; r++) {
      for (let c = 0; c < 16; c++) {
        const el = _container.querySelector<HTMLElement>(`[data-f="${f}"][data-r="${r}"][data-c="${c}"]`)
        if (el) _renderSlot(el, f, r, c)
      }
    }
  }
  const sc = _container.querySelector('#grid-self-count')
  const ec = _container.querySelector('#grid-enemy-count')
  if (sc) sc.textContent = `${_countCards(0)} / 25`
  if (ec) ec.textContent = `${_countCards(1)} / 25`
}

function _renderSlot(el: HTMLElement, field: number, row: number, col: number): void {
  const poemId = _grid[field][row][col]
  el.innerHTML = ''
  el.className = 'grid-slot'
  el.draggable = false

  if (poemId !== null) {
    el.classList.add('occupied')
    if (field === 1) el.classList.add('enemy-field')  // 敵陣: 180°回転
    el.draggable = true

    const img = document.createElement('img')
    img.src = cardImagePath(poemId)
    img.alt = String(poemId)
    img.loading = 'lazy'
    el.appendChild(img)

    // 決まり字ラベル（静的: 配置時は決まり字変化しない）
    try {
      const poem = getPoems().find(p => p.id === poemId)
      if (poem) {
        const lbl = document.createElement('span')
        lbl.className = 'slot-kimari'
        lbl.textContent = poem.kimari_ji
        el.appendChild(lbl)
      }
    } catch { /* poems not loaded yet */ }
  } else {
    el.classList.add('empty')
    el.textContent = '+'
  }
}

function _buildGrid(): HTMLElement {
  const wrap = document.createElement('div')
  wrap.style.cssText = 'display:flex;flex-direction:column;gap:16px;'

  // 敵陣（上）→ 自陣（下）の順で表示
  const fields = [
    { f: 1, label: '敵陣', id: 'enemy' },
    { f: 0, label: '自陣', id: 'self'  },
  ]

  for (const { f, label, id } of fields) {
    const section = document.createElement('div')
    section.innerHTML = `
      <div style="display:flex;align-items:center;gap:8px;margin-bottom:6px;">
        <span style="font-size:13px;color:var(--accent2);">${label}</span>
        <span id="grid-${id}-count" style="font-size:11px;color:var(--text3);">0 / 25</span>
      </div>
    `

    const grid = document.createElement('div')
    grid.className = 'card-grid'
    grid.style.cssText = 'display:grid;grid-template-columns:repeat(16,1fr);gap:3px;'

    for (let r = 0; r < 3; r++) {
      for (let c = 0; c < 16; c++) {
        const slot = document.createElement('div')
        slot.dataset.f = String(f)
        slot.dataset.r = String(r)
        slot.dataset.c = String(c)
        _renderSlot(slot, f, r, c)

        // クリック: 空スロット → モーダル
        slot.addEventListener('click', () => {
          if (_grid[f][r][c] !== null) return
          const poems = getPoems()
          const used = new Set<number>()
          for (let ff = 0; ff < 2; ff++)
            for (let rr = 0; rr < 3; rr++)
              for (const s of _grid[ff][rr])
                if (s !== null) used.add(s)
          const pool = _activeSet
            ? poems.filter(p => _activeSet!.has(p.id) && !used.has(p.id))
            : poems.filter(p => !used.has(p.id))
          _openModal('札を選択', pool.map(p => ({ poem_id: p.id, kimari: p.kimari_ji })), (poemId: number) => {
            _grid[f][r][c] = poemId
            _notifyChange()
            _renderAll()
          })
        })

        // ダブルクリック: 削除
        slot.addEventListener('dblclick', () => {
          if (_grid[f][r][c] === null) return
          _grid[f][r][c] = null
          _notifyChange()
          _renderAll()
        })

        // ドラッグ&ドロップ
        slot.addEventListener('dragstart', e => {
          if (_grid[f][r][c] === null) return
          _dragSrc = { field: f, row: r, col: c }
          e.dataTransfer!.effectAllowed = 'move'
        })
        slot.addEventListener('dragover', e => { e.preventDefault(); e.dataTransfer!.dropEffect = 'move' })
        slot.addEventListener('drop', e => {
          e.preventDefault()
          if (!_dragSrc) return
          const { field: sf, row: sr, col: sc } = _dragSrc
          if (sf === f && sr === r && sc === c) return
          const tmp = _grid[f][r][c]
          _grid[f][r][c] = _grid[sf][sr][sc]
          _grid[sf][sr][sc] = tmp
          _dragSrc = null
          _notifyChange()
          _renderAll()
        })
        slot.addEventListener('dragend', () => { _dragSrc = null })

        grid.appendChild(slot)
      }
    }
    section.appendChild(grid)
    wrap.appendChild(section)
  }

  return wrap
}

// ============================================================
// ツールバー
// ============================================================
function _buildToolbar(toolbar: HTMLElement): void {
  toolbar.innerHTML = `
    <button id="arrange-pattern-a">A: ランダム</button>
    <button id="arrange-pattern-b">B: 端寄せ</button>
    <button id="arrange-pattern-c">C: 自手動/敵ランダム</button>
    <button id="arrange-pattern-d">D: 自手動/敵端寄せ</button>
    <button id="arrange-clear">全消去</button>
    <label style="display:flex;align-items:center;gap:4px;font-size:12px;">
      <input type="checkbox" id="arrange-compact"> 端寄せ自動
    </label>
    <button id="arrange-set-btn">札セット: 全100枚</button>
    <span style="width:1px;height:22px;background:var(--border);margin:0 4px;"></span>
    <input type="text" id="arrange-name" placeholder="配置名" style="width:120px;">
    <button id="arrange-save" class="primary">保存</button>
    <select id="arrange-saved" style="max-width:170px;"></select>
    <button id="arrange-load">読込</button>
    <button id="arrange-delete" style="color:#e06060;border-color:#e06060;">削除</button>
  `

  // 札セットパネル（トグル）
  const setPanel = document.createElement('div')
  setPanel.style.cssText = 'display:none;width:100%;padding:8px;background:var(--bg2);border:1px solid var(--border);border-radius:6px;margin-top:4px;font-size:12px;'
  setPanel.innerHTML = `
    <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin-bottom:6px;">
      <span style="color:var(--text2);">現在: <strong id="set-current-label">全100枚</strong></span>
      <button id="set-clear" style="font-size:11px;padding:3px 8px;">クリア</button>
    </div>
    <div style="display:flex;align-items:center;gap:8px;margin-bottom:8px;">
      <span style="color:var(--text3);">どの桁で分ける:</span>
      <label style="display:flex;align-items:center;gap:4px;">
        <input type="radio" name="set-place" value="ones" checked> 1の位
      </label>
      <label style="display:flex;align-items:center;gap:4px;">
        <input type="radio" name="set-place" value="tens"> 十の位
      </label>
    </div>
    <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;">
      <span style="color:var(--text3);">数字を5つ:</span>
      <div id="set-digits" style="display:flex;gap:4px;flex-wrap:wrap;">
        ${[0,1,2,3,4,5,6,7,8,9].map(d => `<button type="button" class="set-digit" data-d="${d}">${d}</button>`).join('')}
      </div>
      <span id="set-digit-count" style="color:var(--text2);"></span>
      <button id="set-apply" class="primary">適用</button>
    </div>
    <p style="font-size:11px;color:var(--text3);margin:6px 0 0;">
      ※ 選んだ数字の札だけを使います（5つで50枚）。未選択なら全100枚。
    </p>
  `
  toolbar.insertAdjacentElement('afterend', setPanel)

  const updateSetBtn = (label: string) => {
    ;(toolbar.querySelector('#arrange-set-btn') as HTMLButtonElement).textContent = `札セット: ${label}`
  }

  toolbar.querySelector('#arrange-set-btn')!.addEventListener('click', () => {
    setPanel.style.display = setPanel.style.display === 'none' ? '' : 'none'
  })

  // --- 数字ボタン（最大5つまでトグル）---
  const MAX_DIGITS = 5
  const digitBtns = [...setPanel.querySelectorAll<HTMLButtonElement>('.set-digit')]
  const countEl = setPanel.querySelector<HTMLElement>('#set-digit-count')!
  const placeOf = () =>
    (setPanel.querySelector('input[name="set-place"]:checked') as HTMLInputElement).value as 'ones' | 'tens'

  const syncDigits = () => {
    const n = _setDigits.size
    countEl.textContent = `${n} / ${MAX_DIGITS}`
    for (const b of digitBtns) {
      const d = parseInt(b.dataset.d!)
      const on = _setDigits.has(d)
      b.classList.toggle('selected', on)
      // 5つ選んだら未選択のボタンは押せなくする
      b.disabled = !on && n >= MAX_DIGITS
    }
  }

  for (const b of digitBtns) {
    b.addEventListener('click', () => {
      const d = parseInt(b.dataset.d!)
      if (_setDigits.has(d)) _setDigits.delete(d)
      else if (_setDigits.size < MAX_DIGITS) _setDigits.add(d)
      syncDigits()
    })
  }

  setPanel.querySelectorAll('input[name="set-place"]').forEach(r =>
    r.addEventListener('change', () => { _setPlace = placeOf(); syncDigits() })
  )

  setPanel.querySelector('#set-clear')!.addEventListener('click', () => {
    _activeSet = null
    _setDigits.clear()
    syncDigits()
    ;(setPanel.querySelector('#set-current-label') as HTMLElement).textContent = '全100枚'
    updateSetBtn('全100枚')
    saveCardSet({ place: _setPlace, digits: [] })
  })

  setPanel.querySelector('#set-apply')!.addEventListener('click', () => {
    _setPlace = placeOf()
    const digits = [..._setDigits].sort((a, b) => a - b)
    const poems = getPoems()

    let ids: number[]
    let label: string
    if (digits.length > 0) {
      // 1の位: 100番は 0 扱い / 十の位: 1〜10 が 0、91〜100 が 9
      ids = poems
        .filter(p => digits.includes(_setPlace === 'ones' ? p.id % 10 : Math.floor((p.id - 1) / 10)))
        .map(p => p.id)
      label = `${_setPlace === 'ones' ? '1の位' : '十の位'}:${digits.join(',')} (${ids.length}枚)`
    } else {
      ids = poems.map(p => p.id)
      label = '全100枚'
    }

    _activeSet = ids.length < 100 ? new Set(ids) : null
    ;(setPanel.querySelector('#set-current-label') as HTMLElement).textContent = label
    updateSetBtn(label)
    saveCardSet({ place: _setPlace, digits })
  })

  // 保存済みの札セットを復元
  ;(setPanel.querySelector(`input[name="set-place"][value="${_setPlace}"]`) as HTMLInputElement).checked = true
  syncDigits()
  if (_setDigits.size > 0) (setPanel.querySelector('#set-apply') as HTMLButtonElement).click()

  toolbar.querySelector('#arrange-pattern-a')!.addEventListener('click', () => applyArrangePattern('A'))
  toolbar.querySelector('#arrange-pattern-b')!.addEventListener('click', () => applyArrangePattern('B'))
  toolbar.querySelector('#arrange-pattern-c')!.addEventListener('click', () => applyArrangePattern('C'))
  toolbar.querySelector('#arrange-pattern-d')!.addEventListener('click', () => applyArrangePattern('D'))
  toolbar.querySelector('#arrange-clear')!.addEventListener('click', () => {
    _grid = [
      [new Array(16).fill(null), new Array(16).fill(null), new Array(16).fill(null)],
      [new Array(16).fill(null), new Array(16).fill(null), new Array(16).fill(null)],
    ]
    _notifyChange()
    _renderAll()
  })
  ;(toolbar.querySelector('#arrange-compact') as HTMLInputElement).addEventListener('change', e => {
    _compactMode = (e.target as HTMLInputElement).checked
  })

  // --- 名前をつけて保存 / 読込（localStorage） ---
  const nameInput = toolbar.querySelector<HTMLInputElement>('#arrange-name')!
  const savedSel  = toolbar.querySelector<HTMLSelectElement>('#arrange-saved')!

  const refreshSaved = (selectId?: string) => {
    const list = loadArrangements()
    savedSel.innerHTML = list.length === 0
      ? '<option value="">保存された配置なし</option>'
      : list.map(a => `<option value="${a.id}">${a.name}（${a.self.length + a.enemy.length}枚）</option>`).join('')
    if (selectId) savedSel.value = selectId
  }

  toolbar.querySelector('#arrange-save')!.addEventListener('click', () => {
    const name = nameInput.value.trim()
    if (!name) { alert('配置名を入力してください'); return }
    const { self, enemy } = getArrangement()
    if (self.length === 0 && enemy.length === 0) { alert('札が配置されていません'); return }
    const saved = saveArrangement(name, self, enemy)
    refreshSaved(saved.id)
  })

  toolbar.querySelector('#arrange-load')!.addEventListener('click', () => {
    const target = loadArrangements().find((a: SavedArrangement) => a.id === savedSel.value)
    if (!target) return
    setArrangement(target.self, target.enemy)
    nameInput.value = target.name
  })

  toolbar.querySelector('#arrange-delete')!.addEventListener('click', () => {
    const target = loadArrangements().find((a: SavedArrangement) => a.id === savedSel.value)
    if (!target || !confirm(`「${target.name}」を削除しますか？`)) return
    deleteArrangement(target.id)
    refreshSaved()
  })

  refreshSaved()
}

// ============================================================
// スタイル注入
// ============================================================
function _injectStyles(): void {
  if (document.getElementById('card-grid-style')) return
  const style = document.createElement('style')
  style.id = 'card-grid-style'
  style.textContent = `
    .grid-slot {
      aspect-ratio: 52 / 73;
      border: 1px solid var(--border);
      border-radius: 3px;
      cursor: pointer;
      position: relative;
      overflow: hidden;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 11px;
      color: var(--text3);
      background: var(--bg2);
      transition: border-color 0.1s;
      user-select: none;
    }
    .grid-slot.empty:hover { border-color: var(--accent); color: var(--accent2); }
    .grid-slot.occupied { background: var(--bg3); cursor: grab; }
    .grid-slot.occupied:hover { border-color: var(--accent2); }
    .grid-slot img { width: 100%; height: 100%; object-fit: cover; display: block; }
    .grid-slot.enemy-field img { transform: rotate(180deg); }
    .slot-kimari {
      position: absolute;
      bottom: 1px; left: 1px;
      font-size: 9px;
      background: rgba(0,0,0,0.7);
      color: var(--accent2);
      padding: 0 2px;
      border-radius: 2px;
      pointer-events: none;
      line-height: 1.3;
    }
    .grid-slot.enemy-field .slot-kimari {
      bottom: auto; top: 1px;
      transform: rotate(180deg);
      transform-origin: top left;
      left: auto; right: 1px;
    }
  `
  document.head.appendChild(style)
}

// ============================================================
// 公開: 初期化
// ============================================================
export function initCardGrid(containerSelector: string, toolbarSelector: string): void {
  const container = document.querySelector<HTMLElement>(containerSelector)
  const toolbar = document.querySelector<HTMLElement>(toolbarSelector)
  if (!container) return

  _container = container
  _injectStyles()

  if (toolbar) _buildToolbar(toolbar)
  container.appendChild(_buildGrid())
  _renderAll()
}
