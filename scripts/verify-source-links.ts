/**
 * Verify source-link resolution: explicit fields win, legacy platform fields still work,
 * eBay links are derived from ids, and the AI creation gate exempts the right cases.
 * Run: npx tsx scripts/verify-source-links.ts
 */
import assert from 'node:assert/strict';
import { ItemStatus, type InventoryItem } from '../types';
import {
  buildEbayItemUrl,
  buildEbayOrderUrl,
  buildEbayProfileUrl,
  hasNoSourceLink,
  requiresSourceChatUrl,
  resolveItemSourceLinks,
  resolveSourceLinks,
} from '../utils/sourceLinks';

function item(overrides: Partial<InventoryItem> = {}): InventoryItem {
  return {
    id: 'i1',
    name: 'RTX 3060',
    buyPrice: 180,
    buyDate: '2026-07-23',
    category: 'Components',
    status: ItemStatus.IN_STOCK,
    comment1: '',
    comment2: '',
    ...overrides,
  };
}

const KA_CHAT = 'https://www.kleinanzeigen.de/m-nachrichten.html?conversationId=12345';
const KA_BUY_CHAT = 'https://www.kleinanzeigen.de/m-nachrichten.html?conversationId=999';
const KA_PROFILE = 'https://www.kleinanzeigen.de/s-bestandsliste.html?userId=42';

// --- nothing known ---
{
  const links = resolveItemSourceLinks(item());
  assert.deepEqual(links.list, []);
  assert.equal(hasNoSourceLink(item()), true);
}

// --- explicit generic fields win over legacy ones ---
{
  const links = resolveSourceLinks({
    sourceChatUrl: KA_CHAT,
    kleinanzeigenChatUrl: 'https://example.com/legacy',
  });
  assert.equal(links.chat?.url, KA_CHAT);
}

// --- legacy Kleinanzeigen fields still resolve (no migration needed) ---
{
  const links = resolveItemSourceLinks(
    item({ kleinanzeigenBuyChatUrl: KA_BUY_CHAT, kleinanzeigenSellerProfileUrl: KA_PROFILE })
  );
  assert.equal(links.chat?.url, KA_BUY_CHAT);
  assert.equal(links.profile?.url, KA_PROFILE);
  assert.equal(links.list.length, 2);
  assert.equal(hasNoSourceLink(item({ kleinanzeigenBuyChatUrl: KA_BUY_CHAT })), false);
}

// --- sold items prefer the sale chat, in-stock ones the purchase chat ---
{
  const both = { kleinanzeigenChatUrl: KA_CHAT, kleinanzeigenBuyChatUrl: KA_BUY_CHAT };
  assert.equal(resolveItemSourceLinks(item(both)).chat?.url, KA_CHAT, 'sale chat present → use it');
  assert.equal(
    resolveItemSourceLinks(item({ kleinanzeigenBuyChatUrl: KA_BUY_CHAT })).chat?.url,
    KA_BUY_CHAT
  );
  assert.equal(
    resolveItemSourceLinks(item({ ...both, sellDate: '2026-07-28', status: ItemStatus.SOLD })).chat
      ?.url,
    KA_CHAT
  );
}

// --- eBay: links derived from ids, since eBay never stored URLs ---
{
  assert.equal(
    buildEbayOrderUrl('01-14946-82253'),
    'https://www.ebay.de/mesh/ord/details?orderid=01-14946-82253'
  );
  assert.equal(buildEbayItemUrl('276603456789'), 'https://www.ebay.de/itm/276603456789');
  assert.equal(buildEbayProfileUrl('cpu_dealer'), 'https://www.ebay.de/usr/cpu_dealer');
  assert.equal(buildEbayOrderUrl(''), undefined);
  assert.equal(buildEbayItemUrl(''), undefined);
  assert.equal(buildEbayProfileUrl(undefined), undefined);

  const links = resolveItemSourceLinks(
    item({ ebayOrderId: '01-14946-82253', ebayListingId: '276603456789', ebayUsername: 'cpu_dealer' })
  );
  assert.equal(links.order?.url, 'https://www.ebay.de/itm/276603456789');
  assert.equal(links.profile?.url, 'https://www.ebay.de/usr/cpu_dealer');
  assert.equal(links.externalOrderId, '01-14946-82253');
  assert.equal(links.chat, undefined, 'eBay has no per-order chat URL');
  assert.match(links.order?.title || '', /built from the item id|built from the order number/);
}

// --- non-http values are ignored rather than rendered as broken links ---
{
  const links = resolveSourceLinks({ sourceChatUrl: 'conversationId=12345' });
  assert.equal(links.chat, undefined);
  assert.deepEqual(links.list, []);
}

// --- AI creation gate ---
assert.equal(requiresSourceChatUrl({}), true, 'plain new record needs a link');
assert.equal(requiresSourceChatUrl({ platform: 'kleinanzeigen.de' }), true);
assert.equal(requiresSourceChatUrl({ platform: 'ebay.de' }), false, 'eBay is traceable by id');
assert.equal(requiresSourceChatUrl({ ebayOrderId: '01-1' }), false);
assert.equal(requiresSourceChatUrl({ externalOrderId: '01-1' }), false);
assert.equal(
  requiresSourceChatUrl({ bulkImportId: 'bulk-1' }),
  false,
  'bulk children inherit the batch proof'
);

console.log('verify-source-links: ok');
