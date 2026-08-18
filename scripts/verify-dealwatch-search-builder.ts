/**
 * Dealwatch search constructor: compile, 6-spec cap, save round-trip.
 * Run: npx tsx scripts/verify-dealwatch-search-builder.ts
 */
import assert from 'node:assert/strict';
import type { DealwatchSearch } from '../services/dealwatchApi';
import { listingParamsFromSearch } from '../services/dealwatchApi';
import {
  MAX_SPEC_PILLS,
  addBuilderCategory,
  addBuilderFacet,
  compileSearchBuilder,
  defaultBuilderLibrary,
  draftFromSearch,
  emptySearchBuilderDraft,
  ensureLibraryHasSelection,
  isBuilderDirty,
  readSearchConstructor,
  removeBuilderFacet,
  snapKaRadius,
} from '../utils/dealwatchSearchBuilder';

const library = defaultBuilderLibrary();
const motherboard = library.categories.find((c) => c.id === 'motherboard');
assert.ok(motherboard);
const b450 = motherboard.facets.find((f) => f.id === 'b450');
const b550 = motherboard.facets.find((f) => f.id === 'b550');
assert.ok(b450 && b550);

const draft = {
  ...emptySearchBuilderDraft(),
  categoryId: 'motherboard',
  facetIds: [b450.id, b550.id],
  minPrice: 20,
  maxPrice: 80,
  radiusKm: 60,
  marketplace: 'kleinanzeigen' as const,
};

const compiled = compileSearchBuilder(draft, library);
assert.deepEqual(compiled.searchVariants, ['B450 mainboard', 'B550 mainboard']);
assert.equal(compiled.search, 'B450 mainboard|B550 mainboard');
assert.equal(compiled.radiusKm, 60);
assert.equal(compiled.locationId, '6699');
assert.match(compiled.name, /Motherboard/);
assert.match(compiled.name, /B450/);
assert.equal(compiled.constructor.categoryId, 'motherboard');
assert.deepEqual(compiled.constructor.facetIds, ['b450', 'b550']);

const saved: DealwatchSearch = {
  id: 's1',
  name: compiled.name,
  search: compiled.search,
  searchVariants: compiled.searchVariants,
  minPrice: compiled.minPrice,
  maxPrice: compiled.maxPrice,
  marketplace: compiled.marketplace,
  radiusKm: compiled.radiusKm,
  locationId: compiled.locationId,
  locationLabel: compiled.locationLabel,
  constructor: compiled.constructor,
};

const restored = draftFromSearch(saved, library);
assert.equal(restored.categoryId, 'motherboard');
assert.deepEqual(restored.facetIds, ['b450', 'b550']);
assert.equal(restored.minPrice, 20);
assert.equal(restored.maxPrice, 80);
assert.equal(restored.radiusKm, 60);
assert.equal(restored.marketplace, 'kleinanzeigen');
assert.equal(isBuilderDirty(restored, library, saved), false);

const dirtyDraft = { ...restored, maxPrice: 100 };
assert.equal(isBuilderDirty(dirtyDraft, library, saved), true);

const extra = motherboard.facets.slice(0, 8).map((f) => f.id);
assert.ok(extra.length > MAX_SPEC_PILLS);
const capped = compileSearchBuilder({ ...draft, facetIds: extra }, library);
assert.equal(capped.searchVariants.length, MAX_SPEC_PILLS);
assert.equal(capped.constructor.facetIds.length, MAX_SPEC_PILLS);

const params = listingParamsFromSearch(saved);
assert.equal(params.searchVariants, 'B450 mainboard|B550 mainboard');
assert.equal(params.radiusKm, 60);
assert.equal(params.locationId, '6699');

const noCtor = readSearchConstructor({ id: 'x', name: 'n', search: 'b450' });
assert.equal(noCtor, null);

const withCtor = readSearchConstructor(saved);
assert.equal(withCtor?.categoryId, 'motherboard');

let lib2 = addBuilderCategory(library, 'Cooling');
lib2 = addBuilderFacet(lib2, 'cooling', '120mm');
const cooling = lib2.categories.find((c) => c.id === 'cooling');
assert.ok(cooling);
assert.equal(cooling.seed, 'cooling');
assert.ok(cooling.facets.some((f) => f.label === '120mm'));
lib2 = removeBuilderFacet(lib2, 'cooling', '120mm');
assert.equal(lib2.categories.find((c) => c.id === 'cooling')?.facets.length, 0);

const merged = ensureLibraryHasSelection(defaultBuilderLibrary(), {
  categoryId: 'custom-part',
  facetIds: ['foo-bar'],
});
assert.ok(merged.categories.some((c) => c.id === 'custom-part'));
assert.ok(
  merged.categories.find((c) => c.id === 'custom-part')?.facets.some((f) => f.id === 'foo-bar')
);

assert.equal(snapKaRadius(55), 50);
assert.equal(snapKaRadius(0), 0);

const seedOnly = compileSearchBuilder(
  { ...emptySearchBuilderDraft(), categoryId: 'cpu', facetIds: [], marketplace: 'ebay' },
  library
);
assert.deepEqual(seedOnly.searchVariants, ['prozessor']);
assert.equal(seedOnly.search, 'prozessor');
assert.equal(seedOnly.radiusKm, 0);
assert.equal(seedOnly.locationId, '');

console.log('verify-dealwatch-search-builder: ok');
