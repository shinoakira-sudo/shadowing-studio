# Katakana + IPA pronunciation guides — writing rules

Input: a JSON array of {id, accent, sentences[]}. Output: a JSON object keyed by id: {"<id>": {"accent": "...", "kana": [...], "ipa": [...]}} with EXACTLY one kana string and one ipa string per input sentence, in order.

Purpose: Japanese adult learners (TOEIC ~900) shadow business English. The guide shows how a native speaker ACTUALLY says the sentence at natural speed — rhythm, stress, linking, weak forms — NOT dictionary pronunciation. Katakana must not reinforce Japanese accent.

Accent per script: US = General American (flap t: water ワーラー, rhotic). UK = British RP (non-rhotic: water ウォータ, better ベタ, car カー). AU = Australian (non-rhotic like UK; keep readable, use UK conventions).

KANA rules
1. Connected speech. Link final consonant + initial vowel into one chunk: "pick it up" → ピッキ**ラッ**プ, "an hour" → ア**ナ**ワー, "passengers on" → **パ**センジャーズォン. Drop/weaken sounds natives drop: "next day" → ネクス**デ**イ.
2. Weak forms for function words: to→タ, of→ァヴ/ア, and→ァン/ン, for→ファ, can→クン, you→ヤ, your→ヤ, the→ザ (ズィ before vowels), a→ア, have→ハヴ/ァヴ, at→アッ, that→ザッ, will→ウィル/ル, are→ァー, our→アー, from→フラム, with→ウィズ.
3. Stress: wrap ONLY the stressed syllable of each content word in ** **: **テ**ンション, ア**プ**ロキシマッリ. Never bold a whole word. Weak function words get no bold. Emphatic function words may be bolded.
4. Words separated by one space; linked words written as one chunk with no space. Use ッ for unreleased final stops (flight → フ**ラ**イッ, good → グッ), ー for long vowels. Never add a vowel after a final consonant (フライト ✗). Final s/z: **パ**センジャーズ.
5. th voiceless → ス (think スィンク); voiced → ズ (the ザ). r at word start → ゥラ only when confusable with l; otherwise plain ラ. Prefer readability over phonetic perfection. Use small kana: ティ トゥ ディ ドゥ ファ フィ フェ フォ ヴァ ヴィ ヴ ヴェ ヴォ ウィ ウェ ウォ シェ ジェ チェ.
6. Numbers/times/names as spoken: 482 → フォー **エ**イティ **トゥ**ー; 9:30 A.M. → **ナ**イン **サ**ーティ **エ**イ **エ**ム; Mr. Collins → **ミ**スタ **コ**リンズ; 20 percent → トゥ**ウェ**ンティ パ**セ**ント.
7. End each kana line with an intonation arrow: ↘ falling (statements, wh-questions), ↗ rising (yes/no questions), ↘↗ fall-rise (polite requests, "if you'd like").
8. Katakana only (plus ** and the arrow). No romaji, no Latin letters, no IPA symbols.

IPA rules
9. Same connected-speech pronunciation, between slashes. Primary stress ˈ on content words. Weak forms (tə, ə, ən, fɚ/fə, kən, jə, ðə/ði). Join linked words with ‿ (ˈpæsəndʒɚz‿ɑn). US: flap ɾ (ˈwɑɾɚ), r-colored ɚ/ɝ. UK/AU: non-rhotic, ə/ɜː, ɑː, ɒ. Length mark ː where relevant. End with the same arrow as the kana line. Example: "Please have your boarding pass ready." → /ˈpliːz hæv jɚ ˈbɔɚdɪŋ ˈpæs ˈrɛdi ↘/
10. Keep IPA readable: broad transcription, no syllable dots, no secondary stress unless it helps.

Quality checks before you finish: every ** has a closing **; no "****"; kana count == ipa count == sentences count for every id; every line ends with an arrow; no Latin letters in kana. Output ONLY the JSON object (UTF-8, no comments).
