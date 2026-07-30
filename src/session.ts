// ============================================================
// session.ts — セッション管理・読み上げログ保存・配置スナップショット
//
// 読み上げは「前の札の下の句 → 無音 → 次の札の上の句」で進むため、
// 1枚の札のログは2サイクルにまたがって埋まる:
//   kami_start  … その札の上の句が始まった（取り札フェーズ）→ 行を作る
//   shimo_start … 次のサイクルで、その札の下の句が始まった → 行を更新
// ============================================================

import { db } from './db'
import type { Settings } from './db'
import { onReadingEvent, setSessionStartCallback } from './audio'
import { getArrangement } from './card-grid'

// ============================================================
// 状態
// ============================================================
let _sessionId: number | null = null
let _sessionStartMs = 0
const _logIds = new Map<number, number>()  // poem_id → reading_log.id
let _currentSettings: Settings | null = null

export function getCurrentSessionId(): number | null { return _sessionId }

// ============================================================
// セッション操作
// ============================================================
export function startSession(
  sessionType: 'competitive' | 'memorization' | 'practice',
  settings: Settings | null
): number {
  _sessionStartMs = Date.now()
  _currentSettings = settings

  _sessionId = db.insertSession({
    session_type: sessionType,
    player_id: settings?.player_id,
    settings_id: settings?.id,
    settings_snapshot: JSON.stringify(settings ?? {}),
    has_highlight: 1,
  })

  const arr = getArrangement()
  db.insertArrangement(_sessionId, arr.self, arr.enemy)
  _logIds.clear()

  return _sessionId
}

export function endSession(): void {
  if (_sessionId === null) return
  db.endSession(_sessionId)
  _sessionId = null
  _currentSettings = null
}

// ============================================================
// 初期化: audio.ts のイベントを購読
// ============================================================
export function initSession(): void {
  setSessionStartCallback(sessionType =>
    startSession(sessionType as 'competitive' | 'memorization' | 'practice', _currentSettings)
  )

  onReadingEvent(e => {
    if (_sessionId === null) return
    const elapsed = e.absMs - _sessionStartMs

    switch (e.type) {
      case 'kami_start': {
        const id = db.insertReadingLog({
          session_id: _sessionId,
          position: e.position,
          poem_id: e.poemId,
          upper_start_ms: elapsed,
          effective_kimari: JSON.stringify(e.effectiveKimari ?? {}),
        })
        _logIds.set(e.poemId, id)
        break
      }

      case 'kami_end': {
        // 札を場から取り除くのは audio.ts 側で行う。
        // ここでは取り除いたあとの配置を記録する。
        const arr = getArrangement()
        db.insertArrangement(_sessionId, arr.self, arr.enemy)
        break
      }

      case 'shimo_start': {
        const logId = _logIds.get(e.poemId)
        if (logId !== undefined) db.updateReadingLogTimes(logId, { lower_start_ms: elapsed })
        break
      }

      case 'shimo_end': {
        const logId = _logIds.get(e.poemId)
        if (logId !== undefined) db.updateReadingLogTimes(logId, { lower_end_ms: elapsed })
        break
      }

      case 'session_end':
        endSession()
        break
    }
  })
}
