# hotarubi

競技かるた総合練習システム。ブラウザのみで動作する（バックエンドなし）。

- `index.html` — 研究者用の操作画面（プレイヤー管理・競技/暗記・投影調整・振り返り・設定）
- `projection.html` — 投影用の表示専用画面

設計方針や研究文脈は [CLAUDE.md](CLAUDE.md) を参照。

## セットアップ

```bash
npm install
npm run dev
```

## アセットの配置

読手音声と取り札画像はリポジトリに含めていない（`.gitignore` で除外）。
ローカルで以下の場所に配置すること。

| 種別 | 配置先 | 命名規則 |
| --- | --- | --- |
| 読手音声 | `public/audio/readers/<読手名>/` | `<読手名>_{NNN}_{P}.ogg`（NNN = 000–100、P = 1（上の句）/ 2（下の句）） |
| 取り札画像 | `public/images/torifuda/` | `torifuda_F_{N}.jpeg`（N = 札番号 − 1、0–99） |

`public/data/hyakuninisshu.csv`（札番号・和歌ひらがな・決まり字）のみリポジトリに含まれる。
