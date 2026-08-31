const fs = require('fs');
const path = require('path');

async function check() {
  const res = await fetch('http://localhost:5173/api/supabase-sync?userId=568865df-ee65-4de7-870b-ef73cd1f9c35');
  const data = await res.json();
  const items = data.items || [];

  const linkedItems = items.filter(i => !!i.ebay_order_id);
  const linkedOrderIds = new Set(linkedItems.map(i => i.ebay_order_id));

  const dir = 'data/ebay-abrechnung';
  const files = fs.readdirSync(dir).filter(f => f.endsWith('.csv'));
  const allOrdersInCsv = new Set();
  const matchedOrdersInCsv = new Set();

  for (const f of files) {
    const text = fs.readFileSync(path.join(dir, f), 'utf8');
    const lineq�hrGFW�B�7ƗB���%���"���f�"�6��7B��bƖ�W2���6��7B6��2���7ƗB�s�r���f�"�6��7B6���b6��2���6��7B6�V��6���&W�6R���"�r�rr��G&�҂����b����GG�'���G�W���G�W�B��FW7B�6�V⒒�����&FW'4��77b�FB�6�V⓰��b�Ɩ�VD�&FW$�G2�2�6�V⒒���F6�VD�&FW'4��77g"�FB�6�V⓰�ТТТТР�6��6��R���r�s���T$�%$T4��T�r5DE2���r���6��6��R���r�t��fV�F�'��FV�2v�F�V&���&FW%��C�r�Ɩ�VD�FV�2��V�wF����6��6��R���r�uV�VRV&���&FW%��G2����fV�F�'��r�Ɩ�VD�&FW$�G2�6��R���6��6��R���r�uF�F�V�VR�&FW"�G2��'&V6��V�r55g3�r����&FW'4��77b�6��R���6��6��R���r�t�&VG�Ĕ�TB�&FW'2��'&V6��V�s�r��F6�VD�&FW'4��77b�6��R���6��6��R���r�uV�Ɩ�VB�V�F��r�&FW'2��'&V6��V�s�r����&FW'4��77g"�6��R��F6�VD�&FW'4��77g"�6��R���Ц6�V6���