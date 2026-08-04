// ============================================================
// player.ts — プレイヤー管理UI
// ============================================================

import { loadPlayers, savePlayers, type StoredPlayer } from './store'

const RANK_LABELS = ['未設定', '初段', '二段', '三段', '四段', '五段', '六段', '七段']

type Player = StoredPlayer

// SQLite はメモリDBに落ちて再読み込みで消えるため、プレイヤーは localStorage に持つ。
const _players = {
  list(): Player[] { return loadPlayers() },
  upsert(p: Player): void {
    const list = loadPlayers()
    const i = list.findIndex(x => x.id === p.id)
    if (i >= 0) list[i] = p
    else list.push(p)
    savePlayers(list)
  },
  remove(id: number): void {
    savePlayers(loadPlayers().filter(p => p.id !== id))
  },
  nextId(): number {
    return Math.max(0, ...loadPlayers().map(p => p.id)) + 1
  },
}

export function initPlayers(containerSelector: string): void {
  const container = document.querySelector<HTMLElement>(containerSelector)
  if (!container) return

  container.innerHTML = `
    <div style="display:flex;gap:20px;flex-wrap:wrap;">
      <div style="flex:1;min-width:240px;">
        <p class="section-title" style="font-size:13px;">プレイヤー一覧</p>
        <div id="player-list" style="display:flex;flex-direction:column;gap:6px;margin-bottom:12px;"></div>
        <button id="player-new" class="primary">＋ 新規追加</button>
      </div>
      <div id="player-form-wrap" style="flex:2;min-width:280px;display:none;">
        <p class="section-title" style="font-size:13px;">プレイヤー情報</p>
        <form id="player-form" style="display:flex;flex-direction:column;gap:10px;">
          <input type="hidden" id="pf-id">
          <div class="form-row">
            <label>名前 *</label>
            <input type="text" id="pf-name" required maxlength="40" style="flex:1;">
          </div>
          <div class="form-row">
            <label>段位</label>
            <select id="pf-rank">
              ${RANK_LABELS.map((l, i) => `<option value="${i}">${l}</option>`).join('')}
            </select>
          </div>
          <div class="form-row">
            <label>性別</label>
            <select id="pf-gender">
              <option value="">未設定</option>
              <option value="male">男性</option>
              <option value="female">女性</option>
              <option value="other">その他</option>
            </select>
          </div>
          <div class="form-row">
            <label>年齢</label>
            <input type="number" id="pf-age" min="1" max="120" style="width:80px;">
          </div>
          <div class="form-row">
            <label>身長 (cm)</label>
            <input type="number" id="pf-height" min="50" max="250" step="0.1" style="width:80px;">
          </div>
          <div style="display:flex;gap:8px;">
            <button type="submit" class="primary">保存</button>
            <button type="button" id="pf-cancel">キャンセル</button>
            <button type="button" id="pf-delete" style="margin-left:auto;color:#e06060;border-color:#e06060;display:none;">削除</button>
          </div>
        </form>
      </div>
    </div>
  `

  const list       = container.querySelector<HTMLElement>('#player-list')!
  const formWrap   = container.querySelector<HTMLElement>('#player-form-wrap')!
  const form       = container.querySelector<HTMLFormElement>('#player-form')!
  const idInput    = container.querySelector<HTMLInputElement>('#pf-id')!
  const nameInput  = container.querySelector<HTMLInputElement>('#pf-name')!
  const rankSel    = container.querySelector<HTMLSelectElement>('#pf-rank')!
  const genderSel  = container.querySelector<HTMLSelectElement>('#pf-gender')!
  const ageInput   = container.querySelector<HTMLInputElement>('#pf-age')!
  const heightInput= container.querySelector<HTMLInputElement>('#pf-height')!
  const deleteBtn  = container.querySelector<HTMLButtonElement>('#pf-delete')!

  function renderList(): void {
    const players = _players.list()
    list.innerHTML = ''
    if (players.length === 0) {
      list.innerHTML = '<span style="color:var(--text3);font-size:12px;">プレイヤーがいません</span>'
      return
    }
    for (const p of players) {
      const el = document.createElement('div')
      el.style.cssText = 'display:flex;align-items:center;gap:8px;padding:6px 8px;background:var(--bg2);border:1px solid var(--border);border-radius:6px;cursor:pointer;'
      el.innerHTML = `
        <span style="font-size:13px;flex:1;">${p.name}</span>
        <span style="font-size:11px;color:var(--text3);">${RANK_LABELS[p.rank] ?? ''}</span>
      `
      el.addEventListener('click', () => openForm(p))
      list.appendChild(el)
    }
  }

  function openForm(player?: Player): void {
    formWrap.style.display = ''
    if (player) {
      idInput.value      = String(player.id ?? '')
      nameInput.value    = player.name
      rankSel.value      = String(player.rank)
      genderSel.value    = player.gender ?? ''
      ageInput.value     = player.age !== undefined ? String(player.age) : ''
      heightInput.value  = player.height_cm !== undefined ? String(player.height_cm) : ''
      deleteBtn.style.display = ''
    } else {
      form.reset()
      idInput.value = ''
      deleteBtn.style.display = 'none'
    }
    nameInput.focus()
  }

  function closeForm(): void {
    formWrap.style.display = 'none'
  }

  container.querySelector('#player-new')!.addEventListener('click', () => openForm())
  container.querySelector('#pf-cancel')!.addEventListener('click', closeForm)

  deleteBtn.addEventListener('click', () => {
    const id = parseInt(idInput.value)
    if (!id || !confirm('このプレイヤーを削除しますか？')) return
    _players.remove(id)
    closeForm()
    renderList()
  })

  form.addEventListener('submit', e => {
    e.preventDefault()
    const id = parseInt(idInput.value) || undefined
    const name = nameInput.value.trim()
    if (!name) return
    _players.upsert({
      id: id ?? _players.nextId(),
      name,
      rank: parseInt(rankSel.value),
      gender: (genderSel.value || undefined) as Player['gender'],
      age: ageInput.value ? parseInt(ageInput.value) : undefined,
      height_cm: heightInput.value ? parseFloat(heightInput.value) : undefined,
    })
    closeForm()
    renderList()
  })

  renderList()
}
