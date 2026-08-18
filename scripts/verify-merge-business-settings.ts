/**
 * Run: npx tsx scripts/verify-merge-business-settings.ts
 */
import assert from 'node:assert/strict';
import type { BusinessSettings } from '../types';
import { mergeBusinessSettings } from '../utils/mergeBusinessSettings';

const filled: BusinessSettings = {
  companyName: 'Armik Tech',
  ownerName: 'Armin',
  address: 'Waldstetten',
  phone: '0123',
  taxId: '11/22/333',
  vatId: '',
  iban: 'DE00',
  bic: 'COBA',
  bankName: 'Commerzbank',
  taxMode: 'SmallBusiness',
};

const emptyRemote = {
  companyName: '',
  ownerName: '',
  address: '',
  phone: '',
  taxId: '',
  iban: '',
  bic: '',
  bankName: '',
  taxMode: 'SmallBusiness',
};

const wiped = mergeBusinessSettings(filled, emptyRemote);
assert.equal(wiped.settings.companyName, 'Armik Tech');
assert.equal(wiped.settings.iban, 'DE00');
assert.equal(wiped.keptLocalFilled, true);

const otherDevice: Partial<BusinessSettings> = { companyName: 'New GmbH', phone: '999' };
const updated = mergeBusinessSettings(filled, otherDevice);
assert.equal(updated.settings.companyName, 'New GmbH');
assert.equal(updated.settings.phone, '999');
assert.equal(updated.settings.ownerName, 'Armin');

const fromEmptyCloud = mergeBusinessSettings(filled, {});
assert.equal(fromEmptyCloud.settings.companyName, 'Armik Tech');
assert.equal(fromEmptyCloud.keptLocalFilled, true);

const bothEmpty = mergeBusinessSettings(
  { ...filled, companyName: '', ownerName: '', address: '', phone: '', taxId: '', iban: '', bic: '', bankName: '' },
  emptyRemote
);
assert.equal(bothEmpty.keptLocalFilled, false);

console.log('verify-merge-business-settings: ok');
