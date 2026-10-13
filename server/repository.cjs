const mapTranscript = row => row && ({
  id: row.id,
  text: row.text,
  mode: row.mode,
  wordCount: row.word_count,
  createdAt: row.created_at,
  updatedAt: row.updated_at
});

const mapSession = row => row && ({
  id: row.id,
  duration: row.duration,
  wordCount: row.word_count,
  status: row.status,
  errorMessage: row.error_message,
  createdAt: row.created_at
});

function checked({ data, error }) {
  if (error) throw error;
  return data;
}

function requireUser(userId) {
  if (typeof userId !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(userId)) throw new Error('Valid user ID is required');
}

function createRepository(client) {
  return {
    async saveDictation({ userId, text, mode, duration, timestamp }) {
      requireUser(userId);
      const data = checked(await client.rpc('save_dictation', {
        p_user_id: userId,
        p_text: text,
        p_mode: mode,
        p_duration: duration,
        p_timestamp: timestamp
      }));
      return { transcript: mapTranscript(data.transcript), session: mapSession(data.session) };
    },

    async getLatestTranscript(userId) {
      requireUser(userId);
      return mapTranscript(checked(await client.from('transcripts').select('*').eq('user_id', userId).eq('id', 1).maybeSingle()));
    },

    async updateTranscript(userId, id, text, timestamp) {
      requireUser(userId);
      const wordCount = text.trim().split(/\s+/).length;
      return mapTranscript(checked(await client.from('transcripts')
        .update({ text: text.trim(), word_count: wordCount, updated_at: timestamp })
        .eq('user_id', userId)
        .eq('id', id)
        .select('*')
        .maybeSingle()));
    },

    async deleteTranscript(userId) {
      requireUser(userId);
      const data = checked(await client.from('transcripts').delete().eq('user_id', userId).eq('id', 1).select('id'));
      return data.length > 0;
    },

    async saveFailedSession({ userId, duration, errorMessage, timestamp }) {
      requireUser(userId);
      const data = checked(await client.from('sessions')
        .insert({ user_id: userId, duration, word_count: 0, status: 'error', error_message: errorMessage, created_at: timestamp })
        .select('*')
        .single());
      return mapSession(data);
    },

    async getStats(userId) {
      requireUser(userId);
      return checked(await client.rpc('get_stats', { p_user_id: userId }));
    }
  };
}

module.exports = { createRepository };
