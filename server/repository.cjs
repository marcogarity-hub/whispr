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

function createRepository(client) {
  return {
    async saveDictation({ text, mode, duration, timestamp }) {
      const data = checked(await client.rpc('save_dictation', {
        p_text: text,
        p_mode: mode,
        p_duration: duration,
        p_timestamp: timestamp
      }));
      return { transcript: mapTranscript(data.transcript), session: mapSession(data.session) };
    },

    async getLatestTranscript() {
      return mapTranscript(checked(await client.from('transcripts').select('*').eq('id', 1).maybeSingle()));
    },

    async updateTranscript(id, text, timestamp) {
      const wordCount = text.trim().split(/\s+/).length;
      return mapTranscript(checked(await client.from('transcripts')
        .update({ text: text.trim(), word_count: wordCount, updated_at: timestamp })
        .eq('id', id)
        .select('*')
        .maybeSingle()));
    },

    async deleteTranscript() {
      const data = checked(await client.from('transcripts').delete().eq('id', 1).select('id'));
      return data.length > 0;
    },

    async saveFailedSession({ duration, errorMessage, timestamp }) {
      const data = checked(await client.from('sessions')
        .insert({ duration, word_count: 0, status: 'error', error_message: errorMessage, created_at: timestamp })
        .select('*')
        .single());
      return mapSession(data);
    },

    async getStats() {
      return checked(await client.rpc('get_stats'));
    }
  };
}

module.exports = { createRepository };
