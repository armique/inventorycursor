/**
 * Barcode / EAN / UPC product lookup.
 * GET|POST /api/barcode?barcode=4011200296908
 */
import { handleBarcodeLookup } from '../lib/apiHandlers/barcodeLookupHandler.js';

export default async function handler(req, res) {
  return handleBarcodeLookup(req, res);
}
