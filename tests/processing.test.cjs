const test = require('node:test');
const assert = require('node:assert/strict');

const { processTranscript } = require('../server/processing.cjs');

test('exact mode preserves wording and calculates words', () => {
  assert.deepEqual(processTranscript({ text: 'hello   there', mode: 'exact' }), {
    text: 'hello there', mode: 'exact', wordCount: 2
  });
});

test('exact mode preserves punctuation while normalizing whitespace', () => {
  assert.deepEqual(processTranscript({ text: 'Hello,   world!\nNext sentence.', mode: 'exact', polish: null }), {
    text: 'Hello, world! Next sentence.', mode: 'exact', wordCount: 4
  });
});

test('polished mode preserves model text and calculates words', () => {
  const result = processTranscript({ text: 'I think this works', mode: 'polished' });
  assert.equal(result.text, 'I think this works');
  assert.equal(result.mode, 'polished');
  assert.equal(result.wordCount, 4);
});

test('polished cleanup removes shared filler words', () => {
  assert.equal(processTranscript({ text: 'Um, this is uh ready.', mode: 'polished' }).text, 'this is ready.');
});
