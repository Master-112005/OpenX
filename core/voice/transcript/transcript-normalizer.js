const FILLER_WORDS = new Set([
  'ah',
  'ahem',
  'er',
  'hmm',
  'oh',
  'okay',
  'um',
  'uh'
]);

class TranscriptNormalizer {
  normalize(input) {
    return String(input || '')
      .toLowerCase()
      .replace(/[’']/g, '')
      .replace(/\b2k\b/g, ' ')
      .replace(/\b(?:aye|ai)\b[.\s]*(?=(?:open|close|search|play|pause|resume|stop|set|increase|decrease|mute|unmute)\b)/g, ' ')
      .replace(/[^\w\s%+\-*/().]/g, ' ')
      .replace(/(?:^|\s)[.]+(?=\s|$)/g, ' ')
      .split(/\s+/)
      .filter(token => token && !FILLER_WORDS.has(token))
      .join(' ')
      .replace(/^[.]+|[.]+$/g, '')
      .replace(/\s+/g, ' ')
      .trim();
  }
}

module.exports = TranscriptNormalizer;
