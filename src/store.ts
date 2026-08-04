// ============================================================
// store.ts — localStorage による永続化
// 投影調整・札配置・ハイライト設定の3つを保持する。
// 計測ログ（reading_log / posture_frames）は db.ts の SQLite 側。
// ============================================================

// ============================================================
// キー
// ============================================================
const KEY_CALIBRATION = 'hotarubi_calibration'
const KEY_ARRANGEMENTS = 'hotarubi_arrangements'
const KEY_HIGHLIGHT = 'hotarubi_highlight'
const KEY_READSET = 'hotarubi_readset'
const KEY_CARDSET = 'hotarubi_cardset'
const KEY_CURRENT_ARR = 'hotarubi_current_arrangement'
const KEY_PLAYERS = 'hotarubi_players'
const KEY_CALIB_HISTORY = 'hotarubi_calibration_history'
const KEY_HL_HISTORY = 'hotarubi_highlight_history'

// ============================================================
// 型
// ============================================================

/** 正規化座標（0〜1）。投影ウィンドウと調整プレビューで解像度が違うため割合で持つ。 */
export interface NormPoint { x: number; y: number }

export interface Calibration {
  /** 盤面の四隅（左上・右上・左下・右下）。投影キャンバスに対する割合。 */
  corners: [NormPoint, NormPoint, NormPoint, NormPoint]
  /** 行ワープ用の中間エッジ。null ならワープ無効（四隅の bilinear のみ）。 */
  rowEdges: Array<{ left: NormPoint; right: NormPoint }> | null
  /** 段と段の隙間（mm） */
  rowGapMm: number
  /** 自陣と敵陣の隙間（mm） */
  fieldGapMm: number
}

export interface ArrangementCard {
  poem_id: number
  row: number  // 0-2
  col: number  // 0-15
}

/** ハイライトの見せ方。競技タブからリアルタイムに変更する。 */
export interface HighlightConfig {
  /** target_only = 読まれた札1枚だけ / kimariji_stages = 決まり字で段階的に絞り込む */
  mode: 'target_only' | 'kimariji_stages'
  /** 決まり字を場の残り札から動的に再計算するか、CSV の初期決まり字を使うか */
  source: 'dynamic' | 'fixed'
  /**
   * 空札（場に無い札）が読まれたときも、決まり字が途中まで一致する
   * 場の札を光らせるか。決まり字で段階的に絞り込むモードでのみ効く。
   */
  highlightKarafuda: boolean
  /** 無音開始から何秒後に1段目を出すか。マイナスで上の句より前に出る。 */
  leadSec: number
  /** 決まり字1文字あたりの追加遅延（秒/字）。mode=kimariji_stages のときだけ効く。 */
  perCharSec: number
  /** 下の句のあとの間（秒）。この時間が経つと上の句が始まる。 */
  silenceSec: number
  /** 読まれた札の塗りつぶし色 */
  targetColor: string
  /** 決まり字が一致する他の札の色（mode=kimariji_stages のみ） */
  candidateColor: string
  /** 塗りつぶすか */
  fillEnabled: boolean
  fillOpacity: number
  /** 枠線を描くか */
  borderEnabled: boolean
  borderColor: string
  borderWidth: number
  /** 実際の札とのズレ補正（投影キャンバス px） */
  offsetX: number
  offsetY: number
  /** 自動で次の札へ進むか */
  autoPlay: boolean
  /** 自動再生の間隔（秒） */
  autoPlayIntervalSec: number
}

// ============================================================
// 既定値
// ============================================================
export function defaultCalibration(): Calibration {
  return {
    corners: [
      { x: 0.05, y: 0.05 }, { x: 0.95, y: 0.05 },
      { x: 0.05, y: 0.95 }, { x: 0.95, y: 0.95 },
    ],
    rowEdges: null,
    rowGapMm: 10,
    fieldGapMm: 30,
  }
}

export const DEFAULT_HIGHLIGHT: HighlightConfig = {
  mode: 'target_only',
  source: 'dynamic',
  highlightKarafuda: false,
  leadSec: 0.5,
  perCharSec: 0.15,
  silenceSec: 1.0,
  targetColor: '#00ff00',
  candidateColor: '#00aa55',
  fillEnabled: true,
  fillOpacity: 0.85,
  borderEnabled: true,
  borderColor: '#ffffff',
  borderWidth: 2,
  offsetX: 0,
  offsetY: 0,
  autoPlay: false,
  autoPlayIntervalSec: 1.0,
}

// ============================================================
// 低レベル
// ============================================================
function load<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(key)
    return raw ? (JSON.parse(raw) as T) : null
  } catch {
    return null
  }
}

function save(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value))
  } catch { /* 容量超過などは無視 */ }
}

// ============================================================
// 投影調整
// ============================================================
export function loadCalibration(): Calibration {
  const raw = load<Partial<Calibration>>(KEY_CALIBRATION)
  const def = defaultCalibration()
  if (!raw || !Array.isArray(raw.corners) || raw.corners.length !== 4) return def
  return {
    corners: raw.corners as Calibration['corners'],
    rowEdges: Array.isArray(raw.rowEdges) ? raw.rowEdges : null,
    rowGapMm: typeof raw.rowGapMm === 'number' ? raw.rowGapMm : def.rowGapMm,
    fieldGapMm: typeof raw.fieldGapMm === 'number' ? raw.fieldGapMm : def.fieldGapMm,
  }
}

export function saveCalibration(c: Calibration): void {
  save(KEY_CALIBRATION, c)
}

// ============================================================
// 保存履歴（共通）
//
// 「保存」を押すたびに日時つきで1件積む。上書きはしない。
// あとから一覧で選んで読み込める。件数は HISTORY_MAX で頭打ちにし、
// 古いものから捨てる。
// ============================================================
const HISTORY_MAX = 50

export interface HistoryEntry<T> {
  id: string
  /** ISO 文字列 */
  savedAt: string
  /** 任意の名前。空なら日時だけで区別する */
  label: string
  data: T
}

function loadHistory<T>(key: string): HistoryEntry<T>[] {
  const raw = load<HistoryEntry<T>[]>(key)
  if (!Array.isArray(raw)) return []
  // 新しいものが先頭
  return raw.filter(e => e && typeof e.id === 'string')
}

function pushHistory<T>(key: string, data: T, label: string): HistoryEntry<T> {
  const entry: HistoryEntry<T> = {
    id: `${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    savedAt: new Date().toISOString(),
    label: label.trim(),
    data,
  }
  const list = [entry, ...loadHistory<T>(key)].slice(0, HISTORY_MAX)
  save(key, list)
  return entry
}

function removeHistory(key: string, id: string): void {
  save(key, loadHistory(key).filter(e => e.id !== id))
}

/** 一覧に出す表示名。「7/31 14:23 名前」の形。 */
export function formatHistoryLabel(e: HistoryEntry<unknown>): string {
  const d = new Date(e.savedAt)
  const stamp = `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
  return e.label ? `${stamp}  ${e.label}` : stamp
}

// ============================================================
// 札配置の履歴
// ============================================================
export function loadArrangements(): HistoryEntry<CurrentArrangement>[] {
  const list = loadHistory<CurrentArrangement>(KEY_ARRANGEMENTS)
  if (list.length > 0) return list

  // 旧形式（name/self/enemy を直に持つ配列）からの引き継ぎ
  const old = load<Array<{ id?: string; name?: string; self?: ArrangementCard[]; enemy?: ArrangementCard[]; updatedAt?: string }>>(KEY_ARRANGEMENTS)
  if (!Array.isArray(old) || old.length === 0 || !old[0]?.self) return []
  const migrated: HistoryEntry<CurrentArrangement>[] = old.map((a, i) => ({
    id: a.id ?? `mig_${i}`,
    savedAt: a.updatedAt ?? new Date().toISOString(),
    label: a.name ?? '',
    data: { self: a.self ?? [], enemy: a.enemy ?? [] },
  }))
  save(KEY_ARRANGEMENTS, migrated)
  return migrated
}

export function saveArrangement(label: string, self: ArrangementCard[], enemy: ArrangementCard[]) {
  return pushHistory<CurrentArrangement>(KEY_ARRANGEMENTS, { self, enemy }, label)
}

export function deleteArrangement(id: string): void {
  removeHistory(KEY_ARRANGEMENTS, id)
}

// ============================================================
// 投影調整の履歴
// ============================================================
export function loadCalibrationHistory(): HistoryEntry<Calibration>[] {
  return loadHistory<Calibration>(KEY_CALIB_HISTORY)
}

export function pushCalibrationHistory(c: Calibration, label: string) {
  return pushHistory<Calibration>(KEY_CALIB_HISTORY, c, label)
}

export function deleteCalibrationHistory(id: string): void {
  removeHistory(KEY_CALIB_HISTORY, id)
}

// ============================================================
// ハイライト設定の履歴
// ============================================================
export function loadHighlightHistory(): HistoryEntry<HighlightConfig>[] {
  return loadHistory<HighlightConfig>(KEY_HL_HISTORY)
}

export function pushHighlightHistory(h: HighlightConfig, label: string) {
  return pushHistory<HighlightConfig>(KEY_HL_HISTORY, h, label)
}

export function deleteHighlightHistory(id: string): void {
  removeHistory(KEY_HL_HISTORY, id)
}

// ============================================================
// 作業中の札配置
// 名前をつけた保存とは別に、いま盤面に並んでいる状態を常に保存しておき、
// 次に開いたときそのまま続きから始められるようにする。
// ============================================================
export interface CurrentArrangement {
  self: ArrangementCard[]
  enemy: ArrangementCard[]
}

export function loadCurrentArrangement(): CurrentArrangement {
  const raw = load<Partial<CurrentArrangement>>(KEY_CURRENT_ARR)
  return {
    self: Array.isArray(raw?.self) ? raw!.self! : [],
    enemy: Array.isArray(raw?.enemy) ? raw!.enemy! : [],
  }
}

export function saveCurrentArrangement(a: CurrentArrangement): void {
  save(KEY_CURRENT_ARR, a)
}

// ============================================================
// プレイヤー
// SQLite はメモリDBに落ちて再読み込みで消えるため、localStorage に持つ。
// ============================================================
export interface StoredPlayer {
  id: number
  name: string
  rank: number
  gender?: 'male' | 'female' | 'other'
  age?: number
  height_cm?: number
}

export function loadPlayers(): StoredPlayer[] {
  const raw = load<StoredPlayer[]>(KEY_PLAYERS)
  return Array.isArray(raw) ? raw : []
}

export function savePlayers(list: StoredPlayer[]): void {
  save(KEY_PLAYERS, list)
}

// ============================================================
// ハイライト設定
// ============================================================
export function loadHighlight(): HighlightConfig {
  const raw = load<Partial<HighlightConfig>>(KEY_HIGHLIGHT)
  return { ...DEFAULT_HIGHLIGHT, ...(raw ?? {}) }
}

// 現在有効なハイライト設定。読み上げ（audio.ts）と投影が参照する唯一の場所。
// 競技タブのフォームが setHighlight() で書き換えると即座に保存もされる。
let _highlight: HighlightConfig = loadHighlight()

export function getHighlight(): HighlightConfig { return _highlight }

export function setHighlight(patch: Partial<HighlightConfig>): HighlightConfig {
  _highlight = { ..._highlight, ...patch }
  save(KEY_HIGHLIGHT, _highlight)
  return _highlight
}

// ============================================================
// 読む札セット
// ============================================================
export interface ReadSet {
  /** all=全100首 / field=配置された札のみ / custom=手選び */
  mode: 'all' | 'field' | 'custom'
  /** mode=custom のときに読む poem_id */
  customIds: number[]
}

export function loadReadSet(): ReadSet {
  const raw = load<Partial<ReadSet>>(KEY_READSET)
  const mode = raw?.mode === 'field' || raw?.mode === 'custom' ? raw.mode : 'all'
  return { mode, customIds: Array.isArray(raw?.customIds) ? raw!.customIds! : [] }
}

export function saveReadSet(r: ReadSet): void {
  save(KEY_READSET, r)
}

// ============================================================
// 札セット（配置に使う札の絞り込み）
// 札番号の1の位か十の位を選び、0〜9のうち5つの数字で50枚に絞る。
// ============================================================
export interface CardSet {
  place: 'ones' | 'tens'
  digits: number[]
}

export function loadCardSet(): CardSet {
  const raw = load<Partial<CardSet>>(KEY_CARDSET)
  return {
    place: raw?.place === 'tens' ? 'tens' : 'ones',
    digits: Array.isArray(raw?.digits) ? raw!.digits!.slice(0, 5) : [],
  }
}

export function saveCardSet(s: CardSet): void {
  save(KEY_CARDSET, s)
}
