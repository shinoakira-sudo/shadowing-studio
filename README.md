# Shadowing Studio

TOEIC Part 3・4 レベルの英文でシャドーイングを練習し、録音を Gemini が評価する個人用アプリ。GitHub Pages で公開。

- `index.html` — アプリ本体（単一ファイル）
- `content.js` — 付属教材100本（10カテゴリ × 10本、TOEIC 600/730/860）、文ごとの音声タイムスタンプ、読み方（カタカナ＋IPA）
- `audio/<id>.mp3` — お手本音声（Piper TTS: ryan / lessac medium。`build_content.py` で生成）
- `content/` — 教材の元データ（all.json）と執筆ルール（SPEC.md）、読み方（kana.json）とその表記ルール（KANA_SPEC.md）
- `supabase/functions/` — Edge Functions のソース（assess＝発音評価、tts＝Google TTS音声生成、kana＝読み方生成）
- `tools/` — 生成スクリプト（build_content.py＝同梱音声、bake_kana.py＝読み方の検証と content.js への焼き込み）

## バックエンド（Supabase 東京プロジェクト）
- Edge Function `assess` — 録音（16kHz WAV）とスクリプトを Gemini に送り、発音・イントネーション・流暢さ・語ごとの判定・日本語の指導ポイントを JSON で返す。Secrets: `GEMINI_API_KEY`, 任意 `GEMINI_MODEL`
- テーブル `shadowing_users` / `shadowing_attempts` — ユーザーと実施履歴（anon キーで読み書き。個人用途前提）

## 学習ロジック
- 状態: 未着手 → 要復習（80点未満）→ あと1回で定着（80点以上1回）→ 定着（80点以上を2回連続）
- 今日のおすすめ: 一晩おいた要復習 → あと1回で定着 → 未着手（直近の平均点に合うレベル）→ 平均点が最低の教材
- 連続日数・直近14日の実施・スコア推移を表示
