import { handleAiText } from '../lib/apiHandlers/aiTextHandler.js';

export default async function handler(req, res) {
  return handleAiText(req, res);
}
