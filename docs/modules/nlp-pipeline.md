# NLP Pipeline

## Purpose

The NLP pipeline turns inconsistent natural language input into a stable command form for routing and execution.

## Modules

- `core/assistant/parser.js`
  Handles wake-word detection, raw command preservation, and polite lead-in stripping.
- `core/assistant/nlp/constants.js`
  Stores filler words, phrase replacements, and domain vocabulary.
- `core/assistant/nlp/preprocessor.js`
  Normalizes commands, strips polite prefixes, applies phrase rewrites, and collapses repeated tokens.
- `core/assistant/nlp/scorer.js`
  Scores command patterns using overlap, order, bigrams, and string similarity.
- `core/assistant/nlp/nlp.js`
  Coordinates vocabulary building, spelling correction, and scoring.

## Design Notes

- Raw command text is preserved for entity extraction.
- Corrected command text is used for intent scoring.
- Word order mistakes are tolerated through overlap and bigram scoring.
- Phrase normalization covers common speech variants such as `put on`, `start playing`, `full screen`, and British spellings like `minimise`.
- Search, open, media, and window commands also use explicit router guards where ambiguity is high.
- Media entity extraction strips filler nouns such as `song`, `track`, and `video` so playback requests stay query-focused.
