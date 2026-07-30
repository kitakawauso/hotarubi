// ============================================================
// session.ts — セッション管理・読み上げログ保存・配置スナップショット
// ============================================================

import { db } from './db'
import type { Settings } from './db'
import { onReadingEvent, setSessionStartCallback } from './audio'
import { getArrangement, removeCard } from './card-grid'

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
  poemIds: number[],
  settings: Settings | null
): number {
  _sessionStartMs = Date.now()
  _currentSettings = settings

  const snapshot = settings ? { ...settings } : {}
  _sessionId = db.insertSession({
    session_type: sessionType,
    player_id: settings?.player_id,
    settings_id: settings?.id,
    settings_snapshot: JSON.stringify(snapshot),
    has_highlight: 1,
  })

  // 配置スナップショット保存
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
// 初期化: audio.ts のイベントに登録
// ============================================================
export function initSession(): void {
  // セッション開始コールバックを audio.ts に登録
  setSessionStartCallback((sessionType, poemIds) => {
    const existing = _currentSettings
    return startSession(
      sessionType as 'competitive' | 'memorization' | 'practice',
      poemIds,
      existing
    )
  })

  // 読み上げイベントを購読して DB に保存
  onReadingEvent(e => {
    if (_sessionId === null) return
    const elapsed = e.absMs - _sessionStartMs

    switch (e.type) {
      case 'upper_start': {
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
      case 'lower_start': {
        const logId = _logIds.get(e.poemId)
        if (logId !== undefined) {
          db.updateReadingLogTimes(logId, { lower_start_ms: elapsed })
        }
        break
      }
      case 'lower_end': {
        const logId = _logIds.get(e.poemId)
        if (logId !== undefined) {
          db.updateReadingLogTimes(logId, { lower_end_ms: elapsed })
        }
        // カードを場から取り除く（端寄せするかは card-grid 側のチェックボックスに従う）
        removeCard(e.poemId)

        // 配置スナップショットを保存（読まれるたびに）
        const arr = getArrangement()
        db.insertArrangement(_sessionId!, arr.self, arr.enemy)
        break
      }
      case 'session_end': {
        endSession()
        break
      }
    }
  })
}
