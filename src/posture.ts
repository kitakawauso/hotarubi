// ============================================================
// posture.ts — MediaPipe Pose・骨格キャプチャ・可視化
// ============================================================

import { onReadingEvent } from './audio'
import { db, type PostureFrame } from './db'
import { getCurrentSessionId } from './session'
import { getHighlight } from './store'

// ============================================================
// 型定義
// ============================================================
interface Keypoint { x: number; y: number; z: number; visibility?: number }

// ============================================================
// 状態
// ============================================================
let _video: HTMLVideoElement | null = null
let _overlayCtx: CanvasRenderingContext2D | null = null
let _overlayW = 480
let _overlayH = 360
let _poseDetector: any = null
let _poseLoop: number | null = null

// キャプチャ（DB保存）制御
let _savingFrames = false
let _currentLogId: number | null = null
let _capturePhase: 'pre_upper' | 'post_upper' = 'pre_upper'
let _frameBuffer: PostureFrame[] = []
let _stopTimer: ReturnType<typeof setTimeout> | null = null
let _sessionStartMs = 0
let _hooksSetup = false

// ============================================================
// MediaPipe 初期化
// ============================================================
async function initPoseDetector(): Promise<boolean> {
  try {
    const vision = await import('@mediapipe/tasks-vision')
    const { PoseLandmarker, FilesetResolver } = vision
    const filesetResolver = await FilesetResolver.forVisionTasks(
      'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision/wasm'
    )
    _poseDetector = await PoseLandmarker.createFromOptions(filesetResolver, {
      baseOptions: {
        modelAssetPath: 'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task',
        delegate: 'GPU',
      },
      runningMode: 'VIDEO',
      numPoses: 1,
    })
    return true
  } catch (e) {
    console.error('MediaPipe 初期化失敗:', e)
    return false
  }
}

// ============================================================
// カメラ起動・停止
// ============================================================
async function startCamera(videoEl: HTMLVideoElement): Promise<boolean> {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      video: { width: 640, height: 480, facingMode: 'user' },
    })
    videoEl.srcObject = stream
    await new Promise<void>(resolve => { videoEl.onloadedmetadata = () => resolve() })
    await videoEl.play()
    return true
  } catch (e) {
    console.error('カメラアクセス失敗:', e)
    return false
  }
}

function stopCamera(videoEl: HTMLVideoElement): void {
  const stream = videoEl.srcObject as MediaStream | null
  if (stream) stream.getTracks().forEach(t => t.stop())
  videoEl.srcObject = null
}

// ============================================================
// ガイドライン描画（敵陣下段の位置合わせ用）
// ============================================================
function _drawGuideLine(ctx: CanvasRenderingContext2D, W: number, H: number): void {
  // 画面下から約1/3の高さに描画（調整の目安）
  const y = H * 0.67
  ctx.save()
  ctx.strokeStyle = '#ff6600'
  ctx.lineWidth = 2
  ctx.setLineDash([12, 6])
  ctx.beginPath()
  ctx.moveTo(0, y)
  ctx.lineTo(W, y)
  ctx.stroke()
  ctx.setLineDash([])
  ctx.fillStyle = '#ff6600'
  ctx.font = '11px sans-serif'
  ctx.fillText('← 敵陣下段をここに合わせる', 8, y - 4)
  ctx.restore()
}

// ============================================================
// 統合ポーズ検出ループ（常時表示 + 指定期間のみDB保存）
// ============================================================
function _startLoop(): void {
  if (_poseLoop !== null) return

  function loop(): void {
    if (!_video || _video.paused || !_overlayCtx) {
      _poseLoop = requestAnimationFrame(loop)
      return
    }

    _overlayCtx.clearRect(0, 0, _overlayW, _overlayH)
    _drawGuideLine(_overlayCtx, _overlayW, _overlayH)

    if (_poseDetector) {
      try {
        const res = _poseDetector.detectForVideo(_video, Date.now())
        if (res.landmarks?.[0]) {
          drawSkeleton(_overlayCtx, res.landmarks[0], '#00ff88')

          // キャプチャ期間中のみDB保存
          if (_savingFrames) {
            const sid = getCurrentSessionId()
            if (sid !== null && _currentLogId !== null) {
              _frameBuffer.push({
                session_id: sid,
                log_id: _currentLogId,
                frame_ms: Date.now() - _sessionStartMs,
                keypoints: JSON.stringify(res.landmarks[0].map((lm: any) => ({
                  x: lm.x, y: lm.y, z: lm.z, visibility: lm.visibility,
                }))),
                phase: _capturePhase,
              })
            }
          }
        }
      } catch { /* フレームスキップ */ }
    }

    _poseLoop = requestAnimationFrame(loop)
  }

  _poseLoop = requestAnimationFrame(loop)
}

function _stopLoop(): void {
  if (_poseLoop !== null) { cancelAnimationFrame(_poseLoop); _poseLoop = null }
}

// ============================================================
// キャプチャ制御（DB保存のON/OFF）
// ============================================================
function _startCapture(logId: number, phase: 'pre_upper' | 'post_upper'): void {
  _currentLogId = logId
  _capturePhase = phase
  _savingFrames = true
  _frameBuffer = []
}

function _stopCapture(): void {
  _savingFrames = false
  if (_stopTimer !== null) { clearTimeout(_stopTimer); _stopTimer = null }
  if (_frameBuffer.length > 0) {
    db.insertPostureFrames(_frameBuffer)
    _frameBuffer = []
  }
}

// ============================================================
// 読み上げイベントとの連携（1回のみ登録）
// ============================================================
function _setupReadingHooks(): void {
  if (_hooksSetup) return
  _hooksSetup = true

  onReadingEvent(e => {
    switch (e.type) {
      case 'session_start':
        _sessionStartMs = e.absMs
        break

      case 'silence_start': {
        // 下の句が終わって無音に入った = 取り札の直前。予備動作の記録を開始する。
        // この時点ではまだ次の札の reading_log が無いので、いったん直前の札の
        // log_id でバッファし、kami_start で確定した log_id に付け替える。
        _startCapture(_currentLogId ?? 0, 'pre_upper')
        break
      }

      case 'kami_start': {
        if (_stopTimer) { clearTimeout(_stopTimer); _stopTimer = null }
        const sid = getCurrentSessionId()
        const log = sid !== null
          ? db.getReadingLog(sid).find(l => l.poem_id === e.poemId && l.position === e.position)
          : undefined

        if (log?.id !== undefined) {
          for (const f of _frameBuffer) {
            if (f.phase === 'pre_upper') f.log_id = log.id
          }
          _currentLogId = log.id
          _capturePhase = 'post_upper'
          _savingFrames = true
        }
        break
      }

      case 'kami_end':
        // 上の句を読み終えたところまでを1枚分の記録とする
        _stopCapture()
        break

      case 'session_end':
        _stopCapture()
        break
    }
  })
}

// ============================================================
// 骨格可視化
// ============================================================
const POSE_CONNECTIONS = [
  [0, 1], [1, 2], [2, 3], [3, 7],
  [0, 4], [4, 5], [5, 6], [6, 8],
  [9, 10],
  [11, 12], [11, 13], [13, 15], [15, 17], [15, 19], [17, 19],
  [12, 14], [14, 16], [16, 18], [16, 20], [18, 20],
  [11, 23], [12, 24], [23, 24],
  [23, 25], [25, 27], [27, 29], [27, 31], [29, 31],
  [24, 26], [26, 28], [28, 30], [28, 32], [30, 32],
]

export function drawSkeleton(
  ctx: CanvasRenderingContext2D,
  keypoints: Keypoint[],
  color: string,
  alpha = 1
): void {
  ctx.save()
  ctx.globalAlpha = alpha
  ctx.strokeStyle = color
  ctx.fillStyle = color
  ctx.lineWidth = 2

  for (const [a, b] of POSE_CONNECTIONS) {
    const ka = keypoints[a], kb = keypoints[b]
    if (!ka || !kb) continue
    if ((ka.visibility ?? 1) < 0.3 || (kb.visibility ?? 1) < 0.3) continue
    ctx.beginPath()
    ctx.moveTo(ka.x * ctx.canvas.width, ka.y * ctx.canvas.height)
    ctx.lineTo(kb.x * ctx.canvas.width, kb.y * ctx.canvas.height)
    ctx.stroke()
  }

  for (const kp of keypoints) {
    if ((kp.visibility ?? 1) < 0.3) continue
    ctx.beginPath()
    ctx.arc(kp.x * ctx.canvas.width, kp.y * ctx.canvas.height, 3, 0, Math.PI * 2)
    ctx.fill()
  }

  ctx.restore()
}

// ============================================================
// UI 初期化
// ============================================================
export function initPosture(containerSelector: string): void {
  const container = document.querySelector<HTMLElement>(containerSelector)
  if (!container) return

  container.innerHTML = `
    <div style="display:flex;flex-direction:column;gap:12px;height:100%;">
      <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;flex-shrink:0;">
        <button id="posture-start-cam">カメラ起動</button>
        <button id="posture-stop-cam" disabled>カメラ停止</button>
        <span id="posture-status" style="font-size:12px;color:var(--text3);">未起動</span>
      </div>
      <div style="position:relative;flex:1;min-height:0;">
        <video id="posture-video"
          style="display:block;background:#000;border-radius:4px;width:100%;height:100%;object-fit:cover;"></video>
        <canvas id="posture-overlay"
          style="position:absolute;top:0;left:0;width:100%;height:100%;pointer-events:none;"></canvas>
      </div>
      <p style="font-size:11px;color:var(--text3);flex-shrink:0;margin:0;">
        カメラを起動すると常時姿勢推定します。無音（取り札の直前）から上の句の終わりまでの骨格を保存します。
        計測しない場合は起動不要です。
      </p>
    </div>
  `

  const video   = container.querySelector<HTMLVideoElement>('#posture-video')!
  const overlay = container.querySelector<HTMLCanvasElement>('#posture-overlay')!
  const statusEl = container.querySelector<HTMLElement>('#posture-status')!
  const startBtn = container.querySelector<HTMLButtonElement>('#posture-start-cam')!
  const stopBtn  = container.querySelector<HTMLButtonElement>('#posture-stop-cam')!

  _video = video

  // canvasサイズをvideoに合わせる
  const resizeObserver = new ResizeObserver(() => {
    overlay.width  = video.clientWidth  || 480
    overlay.height = video.clientHeight || 360
    _overlayW = overlay.width
    _overlayH = overlay.height
  })
  resizeObserver.observe(video)

  _overlayCtx = overlay.getContext('2d')!

  startBtn.addEventListener('click', async () => {
    startBtn.disabled = true
    statusEl.textContent = '初期化中...'

    if (!_poseDetector) {
      const ok = await initPoseDetector()
      if (!ok) {
        statusEl.textContent = 'MediaPipe 初期化失敗'
        startBtn.disabled = false
        return
      }
    }

    const ok = await startCamera(video)
    if (!ok) {
      statusEl.textContent = 'カメラアクセス失敗'
      startBtn.disabled = false
      return
    }

    stopBtn.disabled = false
    statusEl.textContent = '動作中'
    _setupReadingHooks()
    _startLoop()
  })

  stopBtn.addEventListener('click', () => {
    _stopLoop()
    _stopCapture()
    stopCamera(video)
    if (_overlayCtx) _overlayCtx.clearRect(0, 0, overlay.width, overlay.height)
    startBtn.disabled = false
    stopBtn.disabled = true
    statusEl.textContent = '停止'
  })
}
