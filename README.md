# Shadowing Studio

TOEIC Part 3・4 レベルの英文でシャドーイングを練習し、録音を Gemini が評価する個人用アプリ。GitHub Pages で公開。

- `index.html` — アプリ本体（単一ファイル）
- `content.js` — 付属教材100本（10カテゴリ × 10本、TOEIC 600/730/860）、文ごとの音声タイムスタンプ、読み方（カタカナ＋IPA）
- `audio/<id>.mp3` — お手本音声（Piper TTS: ryan / lessac medium。`build_content.py` で生成）
- `content/` — 教材の元データ（all.json）と執筆ルール（SPEC.md）、読み方（kana.json）とその表記ルール（KANA_SPEC.md）
- `supabase/functions/` — Edge Functions のソース（assess＝発音評価、tts＝Google TTS音声生成、kana＝読み方生成）
- `tools/` — 生成スクリプト（build_content.py＝同梱音声、bake_kana.py＝読み方の検証と content.js への焼き込み）

## バックエンド（Supabase 東京プロジェクト）
- Edge Function `assess`（評価 v2）— 録音（16kHz WAV）を次の順で評価し JSON で返す。Secrets: `GEMINI_API_KEY`、任意 `GEMINI_MODEL_ASR` / `GEMINI_MODEL_JUDGE`
  1. **聞き取り**：Gemini がスクリプトを見ずに書き起こす（見せると「言っていない語」まで聞こえたことにしてしまうため）
  2. **照合**：書き起こしとスクリプトを語単位でアライメント（`core.ts`。数字・時刻・金額・略語・短縮形・英米綴り・同音語は正規化）→ 語ごとに ok / 不明瞭 / 別の語 / 抜け
  3. **採点**：Gemini が照合結果を事実として受け取り、発音・イントネーション・流暢さと日本語の指導ポイントを出す（語の判定は変えられない）
  4. **総合点**：½×再現率 ＋ ½×3観点の平均。上限は 1.5×再現率−50（再現率85%なら78点）なので、抜けが多いと80点（定着ライン）に届かない
- `tests/audio/` — 評価の回帰確認用の合成音声（完璧／語の抜け／言い換え／カタカナ発音／途中で停止／無音／訛り）。`node --experimental-strip-types tests/align_test.mjs` で照合ロジックをオフライン検証
- テーブル `shadowing_users` / `shadowing_attempts` — ユーザーと実施履歴（anon キーで読み書き。個人用途前提）

## 学習ロジック
- 状態: 未着手 → 要復習（80点未満）→ あと1回で定着（80点以上1回）→ 定着（80点以上を2回連続）。定着の判定には評価 v2 のスコアだけを使う（v1 は抜け・言い間違いが減点されず高めに出ていたため。履歴と連続日数には残る）
- 今日のおすすめ: 一晩おいた要復習 → あと1回で定着 → 未着手（直近の平均点に合うレベル）→ 平均点が最低の教材
- 連続日数・直近14日の実施・スコア推移を表示
