function normalizeWhitespace(text) {
  return String(text ?? '').replace(/\s+/g, ' ').trim();
}

function cleanTranscript(text, mode = 'exact') {
  if (!['exact', 'polished'].includes(mode)) throw new Error(`Unsupported transcript mode: ${mode}`);
  const normalized = normalizeWhitespace(text);
  if (mode === 'exact') return normalized;
  return normalized
    .replace(/\b(?:um+|uh+|er+)\b[\s,]*/gi, '')
    .replace(/\byou know\b[\s,]*/gi, '')
    .replace(/\s+/g, ' ')
    .trim();
}

module.exports = { cleanTranscript, normalizeWhitespace };
