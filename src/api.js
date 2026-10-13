import { createApiClient } from './apiClient.mjs';

const api = createApiClient();

export function getTranscript(...args) { return api.getTranscript(...args); }
export function updateTranscript(...args) { return api.updateTranscript(...args); }
export function deleteTranscript(...args) { return api.deleteTranscript(...args); }
export function getStats(...args) { return api.getStats(...args); }
export function saveDictation(...args) { return api.saveDictation(...args); }
export function saveFailedSession(...args) { return api.saveFailedSession(...args); }
export function setCredentials(...args) { return api.setCredentials(...args); }
export function clearCredentials(...args) { return api.clearCredentials(...args); }
export default api;
