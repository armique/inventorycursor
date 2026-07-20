import { handleFirestoreQuota } from '../lib/apiHandlers/firestoreQuotaHandler.js';

export default async function handler(req, res) {
  return handleFirestoreQuota(req, res);
}
