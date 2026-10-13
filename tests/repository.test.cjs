const test = require('node:test');
const assert = require('node:assert/strict');

const { createRepository } = require('../server/repository.cjs');

const timestamp = '2026-10-08T00:00:00Z';

function createFakeClient() {
  const calls = [];
  const transcript = {
    id: 1,
    text: 'one two',
    mode: 'exact',
    word_count: 2,
    created_at: timestamp,
    updated_at: timestamp
  };
  const session = {
    id: 7,
    duration: 3,
    word_count: 2,
    status: 'success',
    error_message: null,
    created_at: timestamp
  };
  const responses = {
    save: { data: { transcript, session }, error: null },
    latest: [
      { data: null, error: null },
      { data: null, error: new Error('database unavailable') }
    ],
    update: { data: { ...transcript, text: 'three four', word_count: 2, updated_at: timestamp }, error: null },
    delete: { data: [{ id: 1 }], error: null },
    failedSession: {
      data: { id: 8, duration: 2, word_count: 0, status: 'error', error_message: 'No microphone', created_at: timestamp },
      error: null
    },
    stats: { data: { totalWords: 2, totalDurationSeconds: 3, sessionCount: 1, successRate: 100 }, error: null }
  };

  function builder(table) {
    const operation = { table, filters: [], values: null, action: null, selected: null };
    const query = {
      select(columns) {
        operation.selected = columns;
        return query;
      },
      eq(column, value) {
        operation.filters.push({ column, value });
        return query;
      },
      update(values) {
        operation.action = 'update';
        operation.values = values;
        return query;
      },
      delete() {
        operation.action = 'delete';
        return query;
      },
      insert(values) {
        operation.action = 'insert';
        operation.values = values;
        return query;
      },
      async maybeSingle() {
        calls.push({ type: 'query', operation: { ...operation } });
        if (operation.action === 'update') return responses.update;
        return responses.latest.shift();
      },
      async single() {
        calls.push({ type: 'query', operation: { ...operation } });
        return responses.failedSession;
      },
      then(resolve, reject) {
        calls.push({ type: 'query', operation: { ...operation } });
        return Promise.resolve(responses.delete).then(resolve, reject);
      }
    };
    return query;
  }

  return {
    calls,
    responses,
    rpc: async (name, args) => {
      calls.push({ type: 'rpc', name, args });
      if (name === 'save_dictation') return responses.save;
      return responses.stats;
    },
    from: builder
  };
}

test('saveDictation maps Supabase rows and computes no client-supplied word count', async () => {
  const client = createFakeClient();
  const result = await createRepository(client).saveDictation({ text: 'one two', mode: 'exact', duration: 3, timestamp });

  assert.equal(client.calls[0].name, 'save_dictation');
  assert.deepEqual(client.calls[0].args, { p_text: 'one two', p_mode: 'exact', p_duration: 3, p_timestamp: timestamp });
  assert.equal(result.transcript.wordCount, 2);
  assert.equal(result.session.status, 'success');
  assert.deepEqual(result.transcript, {
    id: 1, text: 'one two', mode: 'exact', wordCount: 2, createdAt: timestamp, updatedAt: timestamp
  });
});

test('repository maps query results and propagates Supabase errors', async () => {
  const client = createFakeClient();
  const repository = createRepository(client);

  assert.equal(await repository.getLatestTranscript(), null);
  const updated = await repository.updateTranscript(1, 'three four', timestamp);
  assert.equal(updated.wordCount, 2);
  assert.equal(updated.text, 'three four');
  const updateQuery = client.calls.find(call => call.operation?.action === 'update');
  assert.deepEqual(updateQuery.operation.values, { text: 'three four', word_count: 2, updated_at: timestamp });

  assert.equal(await repository.deleteTranscript(), true);
  const deleteQuery = client.calls.find(call => call.operation?.action === 'delete');
  assert.deepEqual(deleteQuery.operation.filters, [{ column: 'id', value: 1 }]);

  const failed = await repository.saveFailedSession({ duration: 2, errorMessage: 'No microphone', timestamp });
  assert.equal(failed.status, 'error');
  const insertQuery = client.calls.find(call => call.operation?.action === 'insert');
  assert.deepEqual(insertQuery.operation.values, {
    duration: 2, word_count: 0, status: 'error', error_message: 'No microphone', created_at: timestamp
  });

  assert.equal((await repository.getStats()).sessionCount, 1);
  await assert.rejects(repository.getLatestTranscript(), /database unavailable/);
});
