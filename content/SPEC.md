# Shadowing Studio — content spec (one JSON file per agent)

Write a JSON ARRAY. Each element is one listening script for TOEIC Part 3/4-style shadowing practice.

{
  "id": "<category-code>-<2-digit index>",      e.g. "air-01"
  "title": "<Japanese title, 8-16 chars, concrete situation>",   e.g. "シカゴ行き便の搭乗案内"
  "cat": "<category-code>",
  "type": "<Japanese genre label>",               e.g. "アナウンス"
  "level": "TOEIC 600" | "TOEIC 730" | "TOEIC 860",
  "voice": "m" | "f",                             speaker gender for TTS (alternate within a category)
  "s": [ ["<English sentence>", "<Japanese translation>"], ... ]   5 to 7 sentences
}

Rules
- American business English, natural spoken register, like real TOEIC Part 4 monologues (one speaker). 60–110 words per script. Sentences 6–22 words; vary length.
- Level mix per category: 3 × TOEIC 600 (short, concrete, common words), 4 × TOEIC 730, 3 × TOEIC 860 (longer sentences, business vocabulary, relative clauses).
- Fictional company/place/person names only (no real brands). Use ordinary American names.
- Text will be read by a TTS engine: write "50 dollars", "20 percent", "nine thirty A.M." style is NOT needed—"9:30 A.M." is fine—but avoid symbols $, %, &, #, slashes, bullet points, parentheses, quotation marks inside sentences, and abbreviations other than A.M./P.M./Mr./Ms./Dr.
- Each sentence ends with . ? or !  One sentence per array element (no two sentences in one element).
- Japanese translation: natural, polite (です・ます), faithful; keep numbers, names and times. Transliterate names in katakana.
- Include the vocabulary that TOEIC tests: scheduling, deadlines, reservations, refunds, maintenance, deliveries, promotions, directions, policy changes, apologies for inconvenience, instructions.
- Output ONLY the JSON array, UTF-8, no comments, no trailing commas. Validate it parses.
