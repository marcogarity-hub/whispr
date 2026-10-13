const { cleanTranscript } = require('../shared/cleanup.cjs');

function wordCount(text) {
  return text ? text.split(/\s+/).length : 0;
}

function processTranscript({ text, mode = 'exact' }) {
  const normalized = cleanTranscript(text, mode);
  return { text: normalized, mode, wordCount: wordCount(normalized) };
}

module.exports = { processTranscript };
