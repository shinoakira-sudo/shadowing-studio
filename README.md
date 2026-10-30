# Shadowing Studio

TOEIC Part 3・4 レベルの英文でシャドーイングを練習し、録音を Gemini が評価する個人用アプリ。GitHub Pages で公開。

- `index.html` — アプリ本体（単一ファイル）
- `content.js` — 付属教材100本（10カテゴリ × 10本、TOEIC 600/730/860）と、文ごとの音声タイムスタンプ
- `audio/<id>.mp3` — お手本音声（Piper TTS: ryan / lessac medium。`build_content.py` で生成）
- `content/` — 教材の元データ（JSON）と執筆ルール（SPEC.md）

## バックエンド（Supabase 東京プロジェクト）
- Edge Function `assess` — 録音（16kHz WAV）とスクリプトを Gemini に送り、発音・イントネーション・流暢さ・語ごとの判定・日本語の指導ポイントを JSON で返す。Secrets: `GEMINI_API_KEY`, 任意 `GEMINI_MODEL`
- テーブル `shadowing_users` / `shadowing_attempts` — ユーザーと実施履歴（anon キーで読み書き。個人用途前提）

## 学習ロジック
- 状態: 未着手 → 要復習（80点未満）→ あと1回で定着（80点以上1回）→ 定着（80点以上を2回連続）
- 今日のおすすめ: 一晩おいた要復習 → あと1回で定着 → 未着手（直近の平均点に合うレベル）→ 平均点が最低の教材
- 連続日数・直近14日の実施・スコア推移を表示
