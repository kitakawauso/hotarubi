// ============================================================
// db.ts — SQLite WASM (OPFS) 初期化・全テーブル定義・クエリ関数
// ============================================================

// @sqlite.org/sqlite-wasm は ESM + Worker 経由で使用
// OPFS は Cross-Origin-Isolation が必要（vite.config.ts で設定済み）

type SqliteDB = {
  exec: (sql: string, opts?: Record<string, unknown>) => unknown
  selectObjects: (sql: string, bind?: unknown[]) => Record<string, unknown>[]
  run: (sql: string, bind?: unknown[]) => void
  close: () => void
}

let _db: SqliteDB | null = null

// ============================================================
// 初期化
// ============================================================
export async function initDB(): Promise<void> {
  if (_db) return

  // @sqlite.org/sqlite-wasm を動的インポート
  const { default: sqlite3InitModule } = await import('@sqlite.org/sqlite-wasm')
  const sqlite3 = await sqlite3InitModule({ print: console.log, printErr: console.error })

  // OPFS (Origin Private File System) で永続化
  if ('opfs' in sqlite3) {
    _db = new sqlite3.oo1.OpfsDb('/hotarubi.db') as unknown as SqliteDB
  } else {
    // OPFS 非対応ブラウザのフォールバック（メモリDB）
    console.warn('OPFS 非対応。メモリDBを使用します（データは保存されません）')
    _db = new sqlite3.oo1.DB(':memory:') as unknown as SqliteDB
  }

  createTables()
}

function getDB(): SqliteDB {
  if (!_db) throw new Error('initDB() を先に呼んでください')
  return _db
}

// ============================================================
// テーブル定義
// ============================================================
function createTables(): void {
  const db = getDB()

  db.exec(`
    PRAGMA journal_mode=WAL;
    PRAGMA foreign_keys=ON;

    -- プレイヤー
    CREATE TABLE IF NOT EXISTS players (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      name        TEXT NOT NULL UNIQUE,
      rank        INTEGER NOT NULL DEFAULT 0,
      gender      TEXT,
      age         INTEGER,
      height_cm   REAL,
      created_at  TEXT NOT NULL DEFAULT (datetime('now'))
    );

    -- 設定プロファイル
    CREATE TABLE IF NOT EXISTS settings (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      name            TEXT NOT NULL,
      player_id       INTEGER REFERENCES players(id),
      gap_lower_upper REAL NOT NULL DEFAULT 1.0,
      gap_upper_lower REAL NOT NULL DEFAULT 5.0,
      hl_base_offset  REAL NOT NULL DEFAULT 0.0,
      hl_per_char     REAL NOT NULL DEFAULT 0.3,
      hl_color        TEXT NOT NULL DEFAULT '#ffff00',
      hl_border_color TEXT NOT NULL DEFAULT '#ff8800',
      hl_fill_opacity REAL NOT NULL DEFAULT 0.4,
      hl_border_width INTEGER NOT NULL DEFAULT 2,
      hl_offset_x     INTEGER NOT NULL DEFAULT 0,
      hl_offset_y     INTEGER NOT NULL DEFAULT 0,
      row_gap_mm      REAL NOT NULL DEFAULT 10.0,
      field_gap_mm    REAL NOT NULL DEFAULT 30.0,
      calibration     TEXT NOT NULL DEFAULT '{}',
      created_at      TEXT NOT NULL DEFAULT (datetime('now'))
    );

    -- セッション
    CREATE TABLE IF NOT EXISTS sessions (
      id                INTEGER PRIMARY KEY AUTOINCREMENT,
      player_id         INTEGER REFERENCES players(id),
      session_type      TEXT NOT NULL,
      settings_id       INTEGER REFERENCES settings(id),
      settings_snapshot TEXT NOT NULL DEFAULT '{}',
      started_at        TEXT NOT NULL DEFAULT (datetime('now')),
      ended_at          TEXT,
      has_highlight     INTEGER NOT NULL DEFAULT 1
    );

    -- 札配置スナップショット
    CREATE TABLE IF NOT EXISTS arrangements (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id  INTEGER NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
      snapshot_at TEXT NOT NULL DEFAULT (datetime('now')),
      self_side   TEXT NOT NULL DEFAULT '[]',
      enemy_side  TEXT NOT NULL DEFAULT '[]'
    );

    -- 読み上げイベントログ
    CREATE TABLE IF NOT EXISTS reading_log (
      id               INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id       INTEGER NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
      position         INTEGER NOT NULL,
      poem_id          INTEGER NOT NULL,
      upper_start_ms   INTEGER,
      lower_start_ms   INTEGER,
      lower_end_ms     INTEGER,
      effective_kimari TEXT NOT NULL DEFAULT '{}'
    );

    -- 骨格フレーム
    CREATE TABLE IF NOT EXISTS posture_frames (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id INTEGER NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
      log_id     INTEGER NOT NULL REFERENCES reading_log(id) ON DELETE CASCADE,
      frame_ms   INTEGER NOT NULL,
      keypoints  TEXT NOT NULL,
      phase      TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_posture_session ON posture_frames(session_id, log_id);

    -- 振り返りビュー
    CREATE VIEW IF NOT EXISTS session_review AS
    SELECT
      s.id AS session_id,
      s.player_id,
      s.session_type,
      s.has_highlight,
      rl.position,
      rl.poem_id,
      rl.upper_start_ms,
      rl.lower_start_ms,
      rl.lower_end_ms,
      rl.effective_kimari,
      a.self_side,
      a.enemy_side
    FROM sessions s
    JOIN reading_log rl ON rl.session_id = s.id
    LEFT JOIN arrangements a ON a.session_id = s.id
    ORDER BY s.id, rl.position;
  `)
}

// ============================================================
// 型定義
// ============================================================
export interface Player {
  id?: number
  name: string
  rank: number  // 0=未設定, 1〜7=初段〜七段
  gender?: 'male' | 'female' | 'other'
  age?: number
  height_cm?: number
  created_at?: string
}

export interface Settings {
  id?: number
  name: string
  player_id?: number
  gap_lower_upper: number  // 0.5-1.5秒
  gap_upper_lower: number  // 1-10秒
  hl_base_offset: number   // -2.0〜2.0秒
  hl_per_char: number      // 0.1〜1.0秒/字
  hl_color: string
  hl_border_color: string
  hl_fill_opacity: number
  hl_border_width: number
  hl_offset_x: number
  hl_offset_y: number
  row_gap_mm: number
  field_gap_mm: number
  calibration: string  // JSON
}

export const DEFAULT_SETTINGS: Omit<Settings, 'name'> = {
  gap_lower_upper: 1.0,
  gap_upper_lower: 5.0,
  hl_base_offset: 0.0,
  hl_per_char: 0.3,
  hl_color: '#ffff00',
  hl_border_color: '#ff8800',
  hl_fill_opacity: 0.4,
  hl_border_width: 2,
  hl_offset_x: 0,
  hl_offset_y: 0,
  row_gap_mm: 10.0,
  field_gap_mm: 30.0,
  calibration: '{}',
}

export interface Session {
  id?: number
  player_id?: number
  session_type: 'competitive' | 'memorization' | 'practice'
  settings_id?: number
  settings_snapshot: string  // JSON
  started_at?: string
  ended_at?: string
  has_highlight: 0 | 1
}

export interface ArrangementCard {
  poem_id: number
  row: number  // 0-2
  col: number  // 0-15
}

export interface ReadingLogEntry {
  id?: number
  session_id: number
  position: number
  poem_id: number
  upper_start_ms?: number
  lower_start_ms?: number
  lower_end_ms?: number
  effective_kimari: string  // JSON: {[poemId]: kimariStr}
}

export interface PostureFrame {
  session_id: number
  log_id: number
  frame_ms: number
  keypoints: string  // JSON
  phase: 'pre_upper' | 'post_upper'
}

// ============================================================
// クエリ関数 — Players
// ============================================================
export const db = {
  // --- Players ---
  getPlayers(): Player[] {
    return getDB().selectObjects('SELECT * FROM players ORDER BY created_at DESC') as unknown as Player[]
  },

  getPlayer(id: number): Player | undefined {
    const rows = getDB().selectObjects('SELECT * FROM players WHERE id=?', [id]) as unknown as Player[]
    return rows[0]
  },

  insertPlayer(p: Player): number {
    const db = getDB()
    db.run(
      `INSERT INTO players (name, rank, gender, age, height_cm) VALUES (?,?,?,?,?)`,
      [p.name, p.rank, p.gender ?? null, p.age ?? null, p.height_cm ?? null]
    )
    const rows = db.selectObjects('SELECT last_insert_rowid() AS id') as { id: number }[]
    return rows[0].id
  },

  updatePlayer(p: Player): void {
    getDB().run(
      `UPDATE players SET name=?, rank=?, gender=?, age=?, height_cm=? WHERE id=?`,
      [p.name, p.rank, p.gender ?? null, p.age ?? null, p.height_cm ?? null, p.id]
    )
  },

  deletePlayer(id: number): void {
    getDB().run('DELETE FROM players WHERE id=?', [id])
  },

  // --- Settings ---
  getSettingsList(playerId?: number): Settings[] {
    if (playerId !== undefined) {
      return getDB().selectObjects(
        'SELECT * FROM settings WHERE player_id=? OR player_id IS NULL ORDER BY created_at DESC',
        [playerId]
      ) as unknown as Settings[]
    }
    return getDB().selectObjects('SELECT * FROM settings ORDER BY created_at DESC') as unknown as Settings[]
  },

  getSettings(id: number): Settings | undefined {
    const rows = getDB().selectObjects('SELECT * FROM settings WHERE id=?', [id]) as unknown as Settings[]
    return rows[0]
  },

  upsertSettings(s: Settings): number {
    const db = getDB()
    if (s.id) {
      db.run(
        `UPDATE settings SET name=?,player_id=?,gap_lower_upper=?,gap_upper_lower=?,
         hl_base_offset=?,hl_per_char=?,hl_color=?,hl_border_color=?,hl_fill_opacity=?,
         hl_border_width=?,hl_offset_x=?,hl_offset_y=?,row_gap_mm=?,field_gap_mm=?,
         calibration=? WHERE id=?`,
        [s.name, s.player_id ?? null, s.gap_lower_upper, s.gap_upper_lower,
         s.hl_base_offset, s.hl_per_char, s.hl_color, s.hl_border_color,
         s.hl_fill_opacity, s.hl_border_width, s.hl_offset_x, s.hl_offset_y,
         s.row_gap_mm, s.field_gap_mm, s.calibration, s.id]
      )
      return s.id
    } else {
      db.run(
        `INSERT INTO settings (name,player_id,gap_lower_upper,gap_upper_lower,
         hl_base_offset,hl_per_char,hl_color,hl_border_color,hl_fill_opacity,
         hl_border_width,hl_offset_x,hl_offset_y,row_gap_mm,field_gap_mm,calibration)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        [s.name, s.player_id ?? null, s.gap_lower_upper, s.gap_upper_lower,
         s.hl_base_offset, s.hl_per_char, s.hl_color, s.hl_border_color,
         s.hl_fill_opacity, s.hl_border_width, s.hl_offset_x, s.hl_offset_y,
         s.row_gap_mm, s.field_gap_mm, s.calibration]
      )
      const rows = db.selectObjects('SELECT last_insert_rowid() AS id') as { id: number }[]
      return rows[0].id
    }
  },

  deleteSettings(id: number): void {
    getDB().run('DELETE FROM settings WHERE id=?', [id])
  },

  // --- Sessions ---
  getSessions(playerId?: number): Session[] {
    if (playerId !== undefined) {
      return getDB().selectObjects(
        'SELECT * FROM sessions WHERE player_id=? ORDER BY started_at DESC',
        [playerId]
      ) as unknown as Session[]
    }
    return getDB().selectObjects('SELECT * FROM sessions ORDER BY started_at DESC') as unknown as Session[]
  },

  insertSession(s: Session): number {
    const db = getDB()
    db.run(
      `INSERT INTO sessions (player_id, session_type, settings_id, settings_snapshot, has_highlight)
       VALUES (?,?,?,?,?)`,
      [s.player_id ?? null, s.session_type, s.settings_id ?? null, s.settings_snapshot, s.has_highlight]
    )
    const rows = db.selectObjects('SELECT last_insert_rowid() AS id') as { id: number }[]
    return rows[0].id
  },

  endSession(id: number): void {
    getDB().run(`UPDATE sessions SET ended_at=datetime('now') WHERE id=?`, [id])
  },

  // --- Arrangements ---
  insertArrangement(sessionId: number, selfSide: ArrangementCard[], enemySide: ArrangementCard[]): number {
    const db = getDB()
    db.run(
      `INSERT INTO arrangements (session_id, self_side, enemy_side) VALUES (?,?,?)`,
      [sessionId, JSON.stringify(selfSide), JSON.stringify(enemySide)]
    )
    const rows = db.selectObjects('SELECT last_insert_rowid() AS id') as { id: number }[]
    return rows[0].id
  },

  getLatestArrangement(sessionId: number): { self_side: ArrangementCard[], enemy_side: ArrangementCard[] } | undefined {
    const rows = getDB().selectObjects(
      'SELECT * FROM arrangements WHERE session_id=? ORDER BY snapshot_at DESC LIMIT 1',
      [sessionId]
    ) as { self_side: string, enemy_side: string }[]
    if (!rows[0]) return undefined
    return {
      self_side: JSON.parse(rows[0].self_side),
      enemy_side: JSON.parse(rows[0].enemy_side),
    }
  },

  // --- Reading Log ---
  insertReadingLog(entry: ReadingLogEntry): number {
    const db = getDB()
    db.run(
      `INSERT INTO reading_log (session_id, position, poem_id, upper_start_ms, lower_start_ms, lower_end_ms, effective_kimari)
       VALUES (?,?,?,?,?,?,?)`,
      [entry.session_id, entry.position, entry.poem_id,
       entry.upper_start_ms ?? null, entry.lower_start_ms ?? null,
       entry.lower_end_ms ?? null, entry.effective_kimari]
    )
    const rows = db.selectObjects('SELECT last_insert_rowid() AS id') as { id: number }[]
    return rows[0].id
  },

  updateReadingLogTimes(id: number, updates: Partial<Pick<ReadingLogEntry, 'upper_start_ms' | 'lower_start_ms' | 'lower_end_ms'>>): void {
    const parts: string[] = []
    const vals: unknown[] = []
    if (updates.upper_start_ms !== undefined) { parts.push('upper_start_ms=?'); vals.push(updates.upper_start_ms) }
    if (updates.lower_start_ms !== undefined) { parts.push('lower_start_ms=?'); vals.push(updates.lower_start_ms) }
    if (updates.lower_end_ms !== undefined) { parts.push('lower_end_ms=?'); vals.push(updates.lower_end_ms) }
    if (parts.length === 0) return
    vals.push(id)
    getDB().run(`UPDATE reading_log SET ${parts.join(',')} WHERE id=?`, vals)
  },

  getReadingLog(sessionId: number): ReadingLogEntry[] {
    return getDB().selectObjects(
      'SELECT * FROM reading_log WHERE session_id=? ORDER BY position',
      [sessionId]
    ) as unknown as ReadingLogEntry[]
  },

  // --- Posture Frames ---
  insertPostureFrames(frames: PostureFrame[]): void {
    const db = getDB()
    for (const f of frames) {
      db.run(
        `INSERT INTO posture_frames (session_id, log_id, frame_ms, keypoints, phase)
         VALUES (?,?,?,?,?)`,
        [f.session_id, f.log_id, f.frame_ms, f.keypoints, f.phase]
      )
    }
  },

  getPostureFrames(sessionId: number, logId?: number): PostureFrame[] {
    if (logId !== undefined) {
      return getDB().selectObjects(
        'SELECT * FROM posture_frames WHERE session_id=? AND log_id=? ORDER BY frame_ms',
        [sessionId, logId]
      ) as unknown as PostureFrame[]
    }
    return getDB().selectObjects(
      'SELECT * FROM posture_frames WHERE session_id=? ORDER BY frame_ms',
      [sessionId]
    ) as unknown as PostureFrame[]
  },
}
