// ============================================================
// data.ts — 百人一首データ・決まり字変化計算
// ============================================================

export interface Poem {
  id: number        // 1-100
  hiragana: string  // 和歌全文（上の句+下の句）ひらがな
  kimari_ji: string // 初期決まり字（100首フル時）
}

// 序歌 (id=0) は別途定数
export const JOUKA_ID = 0

// アセットパス解決
export const audioPath = (poemId: number, part: 1 | 2): string =>
  `audio/readers/@03-Yamashita/@03-Yamashita_${String(poemId).padStart(3, '0')}_${part}.ogg`

// 画像ファイル名の番号は札番号そのもの（torifuda_F_0.jpeg は白紙札）。
// 0-99 ではなく 0-100 の101枚ある点に注意。
export const cardImagePath = (poemId: number): string =>
  `images/torifuda/torifuda_F_${poemId}.jpeg`

export const cardBackPath = (): string =>
  `images/torifuda/torifuda_B.jpeg`

// ============================================================
// CSV 読み込み（起動時に一度だけ呼ぶ）
// ============================================================
let _poems: Poem[] | null = null

export async function loadPoems(): Promise<Poem[]> {
  if (_poems) return _poems

  const res = await fetch('data/hyakuninisshu.csv')
  const text = await res.text()
  const lines = text.trim().split('\n').slice(1) // ヘッダー行をスキップ

  _poems = lines.map(line => {
    const cols = line.split(',')
    return {
      id: parseInt(cols[0]),
      hiragana: cols[1].trim(),
      kimari_ji: cols[2].trim(),
    }
  })

  return _poems
}

export function getPoems(): Poem[] {
  if (!_poems) throw new Error('loadPoems() を先に呼んでください')
  return _poems
}

export function getPoemById(id: number): Poem | undefined {
  return getPoems().find(p => p.id === id)
}

// ============================================================
// 決まり字変化計算
// ============================================================

/**
 * 残り札の決まり字を動的に計算する。
 * 上の句の先頭が決まり字の根拠:
 *   CSVの「和歌ひらがな」は上の句から始まる。
 *   決まり字 = 上の句の先頭 N 文字でその札を一意に特定できる最小長。
 *
 * @param remainingIds 場に残っている poem_id の配列
 * @param allPoems     全100首（getPoems()の結果）
 * @returns Map<poem_id, effective_kimari_str>
 */
export function computeEffectiveKimari(
  remainingIds: number[],
  allPoems: Poem[]
): Map<number, string> {
  const remaining = allPoems.filter(p => remainingIds.includes(p.id))

  return new Map(remaining.map(poem => {
    const text = poem.hiragana
    const maxLen = Math.max(poem.kimari_ji.length + 2, 6)

    for (let len = 1; len <= maxLen; len++) {
      const prefix = text.slice(0, len)
      const matches = remaining.filter(p => p.hiragana.startsWith(prefix))
      if (matches.length === 1) {
        return [poem.id, prefix]
      }
    }
    // フォールバック（通常は到達しない）
    return [poem.id, poem.kimari_ji]
  }))
}

/**
 * 指定 prefix に一致する（共通する決まり字を持つ）残り札の ID 一覧を返す。
 * ハイライトスケジュールで使用する。
 *
 * @param prefix        現在の決まり字プレフィックス（len文字）
 * @param remainingIds  場に残っている poem_id
 * @param effectiveKimari computeEffectiveKimari の結果
 */
export function findKimariMatches(
  prefix: string,
  remainingIds: number[],
  effectiveKimari: Map<number, string>
): number[] {
  return remainingIds.filter(id => {
    const ek = effectiveKimari.get(id)
    if (!ek) return false
    // prefix が ek の先頭に一致、または ek が prefix の先頭に一致
    return ek.startsWith(prefix) || prefix.startsWith(ek)
  })
}
