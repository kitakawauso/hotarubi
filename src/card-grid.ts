// ============================================================
// card-grid.ts — 札配置グリッドUI（配置・暗記・投影で共用）
// ============================================================

import { getPoems, cardImagePath } from './data'
import type { FieldCard } from './projection-render'

// ============================================================
// 型定義
// ============================================================
export interface ArrangementCard {
  poem_id: number
  row: number   // 0-2
  col: number   // 0-15
}

type Slot = number | null  // poem_id または空

// grid[field][row][col]: field 0=自陣, 1=敵陣
let _grid: Slot[][][] = [
  [new Array(16).fill(null), new Array(16).fill(null), new Array(16).fill(null)],
  [new Array(16).fill(null), new Array(16).fill(null), new Array(16).fill(null)],
]

// 札セット: null = 全100枚、Set = 使用する poem_id の集合
let _activeSet: Set<number> | null = null

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
// 投影ウィンドウへの BroadcastChannel 送信
// ============================================================
const _projChannel = new BroadcastChannel('hotarubi-projection')

// 投影ウィンドウは開いた時点の状態を持っていないため、配置変更時だけでなく
// 投影側から hello を受け取ったときにも呼び出して現在の配置を送り直す。
export function broadcastArrangement(): void {
  const { self, enemy } = getArrangement()
  _projChannel.postMessage({
    type: 'state',
    payload: {
      cards: {
        self:  self.map(c  => ({ poem_id: c.poem_id, row: c.row, col: c.col } as FieldCard)),
        enemy: enemy.map(c => ({ poem_id: c.poem_id, row: c.row, col: c.col } as FieldCard)),
      },
    },
  })
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
        if (_compactMode) _compactRow(f, r)
        _notifyChange()
        _renderAll()
        return
      }
    }
  }
}

function _compactRow(field: number, row: number): void {
  const cards = _grid[field][row].filter(s => s !== null) as number[]
  const newRow = new Array(16).fill(null)
  let left = 0, right = 15
  for (let i = 0; i < cards.length; i++) {
    if (i % 2 === 0) newRow[left++] = cards[i]
    else             newRow[right--] = cards[i]
  }
  _grid[field][row] = newRow
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
  `

  // 札セットパネル（トグル）
  const setPanel = document.createElement('div')
  setPanel.style.cssText = 'display:none;width:100%;padding:8px;background:var(--bg2);border:1px solid var(--border);border-radius:6px;margin-top:4px;font-size:12px;'
  setPanel.innerHTML = `
    <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin-bottom:6px;">
      <span style="color:var(--text2);">現在: <strong id="set-current-label">全100枚</strong></span>
      <button id="set-clear" style="font-size:11px;padding:3px 8px;">クリア</button>
    </div>
    <div style="display:flex;gap:12px;flex-wrap:wrap;align-items:flex-start;">
      <div>
        <div style="color:var(--text3);margin-bottom:3px;">1の位で指定（5つ選択）:</div>
        <select multiple id="set-1s" size="5" style="width:70px;">
          ${[0,1,2,3,4,5,6,7,8,9].map(d => `<option value="${d}">${d}</option>`).join('')}
        </select>
      </div>
      <div>
        <div style="color:var(--text3);margin-bottom:3px;">10の位で指定（5つ選択）:</div>
        <select multiple id="set-10s" size="5" style="width:70px;">
          ${[0,1,2,3,4,5,6,7,8,9].map(d => `<option value="${d}">${d}</option>`).join('')}
        </select>
      </div>
      <div style="display:flex;flex-direction:column;gap:4px;justify-content:flex-end;padding-bottom:4px;">
        <button id="set-apply">適用</button>
      </div>
    </div>
    <p style="font-size:11px;color:var(--text3);margin:4px 0 0;">
      ※1の位と10の位は排他。先に選択されている方を優先。未選択の場合は全100枚。
    </p>
  `
  toolbar.insertAdjacentElement('afterend', setPanel)

  const updateSetBtn = (label: string) => {
    ;(toolbar.querySelector('#arrange-set-btn') as HTMLButtonElement).textContent = `札セット: ${label}`
  }

  toolbar.querySelector('#arrange-set-btn')!.addEventListener('click', () => {
    setPanel.style.display = setPanel.style.display === 'none' ? '' : 'none'
  })

  setPanel.querySelector('#set-clear')!.addEventListener('click', () => {
    _activeSet = null
    ;(setPanel.querySelector('#set-current-label') as HTMLElement).textContent = '全100枚'
    updateSetBtn('全100枚')
    ;(setPanel.querySelector('#set-1s') as HTMLSelectElement).selectedIndex = -1
    ;(setPanel.querySelector('#set-10s') as HTMLSelectElement).selectedIndex = -1
  })

  setPanel.querySelector('#set-apply')!.addEventListener('click', () => {
    const ones = Array.from((setPanel.querySelector('#set-1s') as HTMLSelectElement).selectedOptions).map(o => parseInt(o.value))
    const tens = Array.from((setPanel.querySelector('#set-10s') as HTMLSelectElement).selectedOptions).map(o => parseInt(o.value))
    const poems = getPoems()

    let ids: number[]
    let label: string
    if (ones.length > 0) {
      ids = poems.filter(p => ones.includes(p.id % 10)).map(p => p.id)
      label = `1の位:${ones.join(',')} (${ids.length}枚)`
    } else if (tens.length > 0) {
      ids = poems.filter(p => tens.includes(Math.floor((p.id - 1) / 10))).map(p => p.id)
      label = `10の位:${tens.join(',')} (${ids.length}枚)`
    } else {
      ids = poems.map(p => p.id)
      label = '全100枚'
    }

    _activeSet = ids.length < 100 ? new Set(ids) : null
    ;(setPanel.querySelector('#set-current-label') as HTMLElement).textContent = label
    updateSetBtn(label)
  })

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
