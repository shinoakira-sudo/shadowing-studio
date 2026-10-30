# Shadowing Studio

TOEICレベル英文のシャドーイング練習アプリ（デモ）。GitHub Pages で公開。

- `index.html` — アプリ本体（単一ファイル）
- `audio/*.mp3` — 付属教材のお手本音声（Piper TTS で生成、`build_audio.py` 参照）
- 発音評価は Supabase Edge Function `assess`（Gemini）を呼び出す
