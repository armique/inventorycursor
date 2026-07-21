import React, { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Camera, CheckCircle2, Loader2, Search, ShoppingBag, Upload, X, Link2, Images } from 'lucide-react';
import { prefersNativePhotoCapture } from '../utils/deviceUi';
import {
  filesToDataUrls,
  fetchImgurAlbumImageUrls,
  normalizeImageList,
  prepareInventoryImagesForStorage,
  resolveImageUrlsFromInput,
} from '../utils/imageImport';
import { localImageReadErrorMessage } from '../utils/localImageFile';
import {
  getImageSearchProviders,
  searchProductPhotos,
  type ImageSearchProvider,
  type ImageSearchResult,
} from '../services/imageSearchService';
import { fetchMyEbayListings, getEbayUsername, ebayListingToPriceMatch, type EbayMyListing, type EbayListingPriceMatch } from '../services/ebayService';
import { matchEbayListingsForItem } from '../utils/ebayListingMatch';
import { formatEUR } from '../utils/formatMoney';

export type AddPhotosApplyOptions = {
  ebayMatch?: EbayListingPriceMatch;
  offerId?: string;
};

interface Props {
  open: boolean;
  onClose: () => void;
  onApply: (urls: string[], options?: AddPhotosApplyOptions) => void | Promise<void>;
  itemCount: number;
  /** Item name used for Pixabay / photo search and eBay listing match. */
  searchName?: string;
  ebaySku?: string;
  /** Firebase Storage folder when uploading files (single item id or "shared"). */
  storageItemId?: string;
}

const AddPhotosModal: React.FC<Props> = ({
  open,
  onClose,
  onApply,
  itemCount,
  searchName = '',
  ebaySku,
  storageItemId = 'shared',
}) => {
  const [urlInput, setUrlInput] = useState('');
  const [imgurInput, setImgurInput] = useState('');
  const [pendingUrls, setPendingUrls] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [imageProviders, setImageProviders] = useState<ImageSearchProvider[]>([]);
  const [selectedProvider, setSelectedProvider] = useState('');
  const [photoSearchResults, setPhotoSearchResults] = useState<ImageSearchResult[] | null>(null);
  const [photoSearching, setPhotoSearching] = useState(false);
  const [photoSearchError, setPhotoSearchError] = useState<string | null>(null);

  const [ebayListingMatches, setEbayListingMatches] = useState<Array<EbayMyListing & { matchScore: number }> | null>(
    null
  );
  const [ebayListingLoading, setEbayListingLoading] = useState(false);
  const [ebayListingError, setEbayListingError] = useState<string | null>(null);
  const [expandedEbayListingId, setExpandedEbayListingId] = useState<string | null>(null);
  const [selectedEbayPhotosByListing, setSelectedEbayPhotosByListing] = useState<Record<string, string[]>>({});
  const [ebayImportingId, setEbayImportingId] = useState<string | null>(null);

  const storageOptions = { itemId: storageItemId };
  const canSearch = Boolean(searchName.trim());
  const singleItemMode = itemCount === 1;
  const nativePhoto = prefersNativePhotoCapture();
  const cameraInputRef = useRef<HTMLInputElement>(null);
  const libraryInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    setUrlInput('');
    setImgurInput('');
    setPendingUrls([]);
    setLoading(false);
    setError(null);
    setSelectedProvider('');
    setPhotoSearchResults(null);
    setPhotoSearching(false);
    setPhotoSearchError(null);
    setEbayListingMatches(null);
    setEbayListingLoading(false);
    setEbayListingError(null);
    setExpandedEbayListingId(null);
    setSelectedEbayPhotosByListing({});
    setEbayImportingId(null);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    getImageSearchProviders().then(setImageProviders);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !loading) onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, loading, onClose]);

  const addUrls = useCallback((urls: string[]) => {
    setPendingUrls((prev) => {
      const merged = normalizeImageList([...prev, ...urls]);
      return merged.length ? merged : prev;
    });
    setError(null);
  }, []);

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    if (!files.length) return;
    setLoading(true);
    setError(null);
    try {
      addUrls(await filesToDataUrls(files, storageOptions));
    } catch (err) {
      setError(localImageReadErrorMessage(err));
    } finally {
      setLoading(false);
      e.target.value = '';
    }
  };

  const handleParseUrls = async () => {
    if (!urlInput.trim()) return;
    setLoading(true);
    setError(null);
    try {
      addUrls(await resolveImageUrlsFromInput(urlInput));
      setUrlInput('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not parse image URL(s).');
    } finally {
      setLoading(false);
    }
  };

  const handleParseImgurAlbum = async () => {
    if (!imgurInput.trim()) return;
    setLoading(true);
    setError(null);
    try {
      addUrls(await fetchImgurAlbumImageUrls(imgurInput.trim()));
      setImgurInput('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load Imgur album.');
    } finally {
      setLoading(false);
    }
  };

  const handleFindRealPhotos = async () => {
    if (!canSearch) return;
    setPhotoSearching(true);
    setPhotoSearchError(null);
    setPhotoSearchResults(null);
    setEbayListingMatches(null);
    setEbayListingError(null);
    try {
      const results = await searchProductPhotos(searchName.trim(), 8, selectedProvider || undefined);
      if (!results.length) {
        setPhotoSearchError('No photos found for that name.');
        return;
      }
      setPhotoSearchResults(results);
    } catch (e: unknown) {
      setPhotoSearchError((e as Error)?.message || 'Photo search failed.');
    } finally {
      setPhotoSearching(false);
    }
  };

  const handleFromMyEbayListings = async () => {
    if (!canSearch) return;
    setEbayListingLoading(true);
    setEbayListingError(null);
    setEbayListingMatches(null);
    setExpandedEbayListingId(null);
    setSelectedEbayPhotosByListing({});
    setPhotoSearchResults(null);
    setPhotoSearchError(null);
    try {
      const all = await fetchMyEbayListings();
      if (!all.length) {
        setEbayListingError(`No active eBay listings found for seller ${getEbayUsername()}.`);
        return;
      }
      const matches = matchEbayListingsForItem(searchName.trim(), all, ebaySku);
      if (!matches.length) {
        setEbayListingError(
          `No listings matched "${searchName.trim()}". You have ${all.length} active listing${all.length === 1 ? '' : 's'}.`
        );
        return;
      }
      setEbayListingMatches(matches);
    } catch (e: unknown) {
      setEbayListingError((e as Error)?.message || 'Failed to load your eBay listings.');
    } finally {
      setEbayListingLoading(false);
    }
  };

  const toggleEbayPhotoSelection = (listingId: string, url: string) => {
    setSelectedEbayPhotosByListing((prev) => {
      const current = new Set(prev[listingId] || []);
      if (current.has(url)) current.delete(url);
      else current.add(url);
      return { ...prev, [listingId]: Array.from(current) };
    });
  };

  const importEbayListing = async (
    listing: EbayMyListing & { matchScore: number },
    urls: string[]
  ) => {
    if (!urls.length) return;
    setEbayImportingId(listing.listingId);
    setLoading(true);
    setError(null);
    try {
      const prepared = await prepareInventoryImagesForStorage(urls, storageOptions);
      if (!prepared.length) {
        setError('Could not import photos from this listing.');
        return;
      }
      const ebayMatch = ebayListingToPriceMatch(listing);
      const applyOptions: AddPhotosApplyOptions | undefined = ebayMatch
        ? { ebayMatch, offerId: listing.offerId }
        : listing.offerId
          ? { offerId: listing.offerId }
          : undefined;

      if (singleItemMode) {
        await onApply(prepared, applyOptions);
        onClose();
        return;
      }

      addUrls(prepared);
      setEbayListingMatches(null);
      setExpandedEbayListingId(null);
      setSelectedEbayPhotosByListing({});
    } catch {
      setError('Could not import photos from this listing.');
    } finally {
      setEbayImportingId(null);
      setLoading(false);
    }
  };

  const importEbayPhotos = (listing: EbayMyListing & { matchScore: number }, urls: string[]) => {
    void importEbayListing(listing, urls);
  };

  const selectAllEbayPhotos = (listing: EbayMyListing) => {
    setSelectedEbayPhotosByListing((prev) => ({
      ...prev,
      [listing.listingId]: [...listing.imageUrls],
    }));
  };

  const clearEbayPhotoSelection = (listingId: string) => {
    setSelectedEbayPhotosByListing((prev) => ({ ...prev, [listingId]: [] }));
  };

  const handleApply = async () => {
    if (!pendingUrls.length) {
      setError('Add at least one photo first.');
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const prepared = await prepareInventoryImagesForStorage(pendingUrls, storageOptions);
      if (!prepared.length) {
        setError('Could not prepare photos for storage.');
        return;
      }
      await onApply(prepared);
      onClose();
    } catch {
      setError('Could not add photos. Try again.');
    } finally {
      setLoading(false);
    }
  };

  if (!open) return null;

  return createPortal(
    <div
      className={`fixed inset-0 z-[210] flex bg-slate-900/50 backdrop-blur-sm ${
        nativePhoto ? 'items-end sm:items-center justify-center p-0 sm:p-4' : 'items-center justify-center p-4'
      }`}
      onClick={() => !loading && onClose()}
    >
      <div
        className={`bg-white w-full max-w-2xl shadow-2xl border border-slate-200 overflow-hidden flex flex-col ${
          nativePhoto
            ? 'rounded-t-2xl sm:rounded-2xl max-h-[min(92dvh,720px)] pb-safe'
            : 'rounded-2xl max-h-[min(92vh,720px)]'
        }`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-4 py-3 border-b border-slate-100 flex items-center justify-between gap-2 bg-slate-50/80 shrink-0">
          <div className="flex items-center gap-2 min-w-0">
            <Camera size={18} className="text-blue-600 shrink-0" />
            <div className="min-w-0">
              <h2 className="text-sm font-black text-slate-900 truncate">Add photos</h2>
              <p className="text-[10px] text-slate-500 truncate">
                {itemCount} selected item{itemCount === 1 ? '' : 's'}
                {canSearch ? ` · ${searchName.trim()}` : ''}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={loading}
            className="p-1.5 rounded-lg text-slate-400 hover:bg-slate-200 hover:text-slate-700 disabled:opacity-40"
            aria-label="Close"
          >
            <X size={16} />
          </button>
        </div>

        <div className="p-4 space-y-4 overflow-y-auto flex-1 min-h-0">
          {nativePhoto && (
            <div className="space-y-2">
              <p className="text-[10px] font-black uppercase tracking-wider text-slate-500">
                From this phone
              </p>
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  disabled={loading}
                  onClick={() => cameraInputRef.current?.click()}
                  className="flex flex-col items-center justify-center gap-1.5 py-4 rounded-xl border-2 border-dashed border-rose-300 bg-rose-50/60 text-rose-800 disabled:opacity-50"
                >
                  <Camera size={20} />
                  <span className="text-[11px] font-black uppercase">Camera</span>
                </button>
                <button
                  type="button"
                  disabled={loading}
                  onClick={() => libraryInputRef.current?.click()}
                  className="flex flex-col items-center justify-center gap-1.5 py-4 rounded-xl border-2 border-dashed border-slate-300 bg-slate-50 text-slate-700 disabled:opacity-50"
                >
                  <Upload size={20} />
                  <span className="text-[11px] font-black uppercase">Library</span>
                </button>
              </div>
              <input
                ref={cameraInputRef}
                type="file"
                accept="image/*"
                capture="environment"
                className="hidden"
                onChange={handleUpload}
                disabled={loading}
              />
              <input
                ref={libraryInputRef}
                type="file"
                accept="image/*"
                multiple
                className="hidden"
                onChange={handleUpload}
                disabled={loading}
              />
            </div>
          )}

          {/* Fetch from web — same as item editor */}
          <div className="space-y-2 rounded-xl border border-blue-100 bg-blue-50/40 p-3">
            <p className="text-[10px] font-black uppercase tracking-wider text-blue-800">Fetch photos</p>
            {!canSearch && (
              <p className="text-[10px] text-amber-700 font-bold">Select an item with a name to search Pixabay or eBay.</p>
            )}
            {imageProviders.length > 0 && (
              <div className="flex flex-wrap gap-1">
                <button
                  type="button"
                  onClick={() => setSelectedProvider('')}
                  className={`px-2 py-1 rounded-lg text-[9px] font-black uppercase tracking-widest border transition-colors ${
                    selectedProvider === ''
                      ? 'bg-slate-900 text-white border-slate-900'
                      : 'bg-white text-slate-500 border-slate-200 hover:bg-slate-50'
                  }`}
                >
                  Auto
                </button>
                {imageProviders.map((p) => (
                  <button
                    key={p.name}
                    type="button"
                    disabled={!p.configured}
                    onClick={() => setSelectedProvider(p.name)}
                    title={p.configured ? `Only use ${p.label}` : `${p.label} not configured on server`}
                    className={`px-2 py-1 rounded-lg text-[9px] font-black uppercase tracking-widest border transition-colors disabled:opacity-40 ${
                      selectedProvider === p.name
                        ? 'bg-blue-600 text-white border-blue-600'
                        : 'bg-white text-slate-500 border-slate-200 hover:bg-slate-50'
                    }`}
                  >
                    {p.label}
                  </button>
                ))}
              </div>
            )}
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={handleFindRealPhotos}
                disabled={photoSearching || !canSearch || loading}
                className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-blue-600 text-white text-[10px] font-black uppercase tracking-widest hover:bg-blue-700 disabled:opacity-50"
              >
                <Search size={12} className={photoSearching ? 'animate-spin' : ''} />
                {photoSearching ? 'Searching…' : 'Find real photos'}
              </button>
              <button
                type="button"
                onClick={handleFromMyEbayListings}
                disabled={ebayListingLoading || !canSearch || loading}
                className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-white border border-blue-200 text-blue-700 text-[10px] font-black uppercase tracking-widest hover:bg-blue-50 disabled:opacity-50"
              >
                <ShoppingBag size={12} />
                {ebayListingLoading ? 'Loading…' : 'My eBay photos'}
              </button>
            </div>
            {itemCount > 1 && canSearch && (
              <p className="text-[10px] text-slate-500">Search uses the first selected item name for all targets.</p>
            )}
            {photoSearchError && (
              <p className="text-[10px] font-bold text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-2.5 py-1.5">
                {photoSearchError}
              </p>
            )}
            {ebayListingError && (
              <p className="text-[10px] font-bold text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-2.5 py-1.5">
                {ebayListingError}
              </p>
            )}
            {photoSearchResults && photoSearchResults.length > 0 && (
              <div className="rounded-xl border border-slate-200 bg-white p-2.5 space-y-2">
                <div className="flex items-center justify-between">
                  <p className="text-[10px] font-black uppercase tracking-widest text-slate-500">
                    {photoSearchResults.length} result{photoSearchResults.length === 1 ? '' : 's'} — click to add
                  </p>
                  <button
                    type="button"
                    onClick={() => setPhotoSearchResults(null)}
                    className="text-[10px] font-bold text-slate-400 hover:text-slate-700"
                  >
                    Dismiss
                  </button>
                </div>
                <div className="grid grid-cols-4 gap-2 max-h-36 overflow-y-auto">
                  {photoSearchResults.map((r) => (
                    <button
                      key={r.url}
                      type="button"
                      title={r.title}
                      onClick={() => addUrls([r.url])}
                      className="aspect-square rounded-lg overflow-hidden bg-slate-100 ring-1 ring-slate-200 hover:ring-2 hover:ring-blue-400"
                    >
                      <img src={r.thumbnail} alt="" className="w-full h-full object-cover" />
                    </button>
                  ))}
                </div>
              </div>
            )}
            {ebayListingMatches && ebayListingMatches.length > 0 && (
              <div className="space-y-2 max-h-52 overflow-y-auto">
                {ebayListingMatches.map((listing) => {
                  const expanded = expandedEbayListingId === listing.listingId;
                  const selected = selectedEbayPhotosByListing[listing.listingId] || [];
                  const selectedSet = new Set(selected);
                  const importing = ebayImportingId === listing.listingId;
                  return (
                    <div key={listing.listingId} className="rounded-xl bg-white border border-slate-200 p-2.5 space-y-2">
                      <div className="flex gap-2">
                        {listing.thumbnail ? (
                          <img src={listing.thumbnail} alt="" className="w-12 h-12 rounded-lg object-cover shrink-0" />
                        ) : (
                          <div className="w-12 h-12 rounded-lg bg-slate-100 shrink-0" />
                        )}
                        <div className="min-w-0 flex-1">
                          <p className="text-xs font-bold text-slate-900 line-clamp-2">{listing.title}</p>
                          <div className="flex flex-wrap gap-1.5 mt-1.5">
                            <button
                              type="button"
                              disabled={importing || loading || listing.imageUrls.length === 0}
                              onClick={() => importEbayPhotos(listing, listing.imageUrls)}
                              className="px-2 py-1 rounded-md bg-blue-600 text-white text-[9px] font-black uppercase disabled:opacity-50"
                            >
                              {importing ? 'Importing…' : `Import all ${listing.imageUrls.length}`}
                            </button>
                            <button
                              type="button"
                              disabled={importing || loading}
                              onClick={() =>
                                setExpandedEbayListingId(expanded ? null : listing.listingId)
                              }
                              className="px-2 py-1 rounded-md border border-blue-200 text-blue-700 text-[9px] font-black uppercase disabled:opacity-50"
                            >
                              {expanded ? 'Hide' : 'Pick'}
                            </button>
                          </div>
                          {listing.price != null && listing.price > 0 && (
                            <p className="text-[10px] text-slate-500 mt-1">
                              €{formatEUR(listing.price)} on eBay
                              {singleItemMode ? ' · price applied automatically' : ''}
                            </p>
                          )}
                        </div>
                      </div>
                      {expanded && (
                        <div className="space-y-2 border-t border-slate-100 pt-2">
                          <div className="flex items-center justify-between gap-2">
                            <p className="text-[10px] font-bold text-slate-500">
                              {selected.length} selected
                            </p>
                            <div className="flex gap-2">
                              <button
                                type="button"
                                onClick={() => selectAllEbayPhotos(listing)}
                                className="text-[10px] font-bold text-blue-600 hover:underline"
                              >
                                Select all
                              </button>
                              <button
                                type="button"
                                onClick={() => clearEbayPhotoSelection(listing.listingId)}
                                className="text-[10px] font-bold text-slate-400 hover:text-slate-700"
                              >
                                Clear
                              </button>
                            </div>
                          </div>
                          <div className="grid grid-cols-4 gap-1.5">
                            {listing.imageUrls.map((url) => {
                              const isSelected = selectedSet.has(url);
                              return (
                                <button
                                  key={url}
                                  type="button"
                                  onClick={() => toggleEbayPhotoSelection(listing.listingId, url)}
                                  className={`relative aspect-square rounded-lg overflow-hidden ring-2 ${
                                    isSelected ? 'ring-blue-500' : 'ring-slate-200'
                                  }`}
                                >
                                  <img src={url} alt="" className="w-full h-full object-cover" />
                                  {isSelected && (
                                    <span className="absolute top-0.5 right-0.5 bg-blue-600 text-white rounded-full p-0.5">
                                      <CheckCircle2 size={10} />
                                    </span>
                                  )}
                                </button>
                              );
                            })}
                          </div>
                          <button
                            type="button"
                            disabled={!selected.length || importing || loading}
                            onClick={() => importEbayPhotos(listing, selected)}
                            className="w-full py-1.5 rounded-lg bg-blue-600 text-white text-[9px] font-black uppercase disabled:opacity-50"
                          >
                            {importing ? 'Importing…' : `Add ${selected.length} selected`}
                          </button>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {!nativePhoto && (
            <div className="space-y-2">
              <label className="text-[10px] font-black uppercase tracking-wider text-slate-500 flex items-center gap-1.5">
                <Upload size={12} /> Upload from device
              </label>
              <label className="flex items-center justify-center gap-2 w-full py-3 rounded-xl border-2 border-dashed border-slate-200 bg-slate-50 text-xs font-bold text-slate-600 cursor-pointer hover:border-blue-300 hover:bg-blue-50/50 transition-colors">
                <Camera size={16} className="text-slate-400" />
                Choose images
                <input type="file" accept="image/*" multiple className="hidden" onChange={handleUpload} disabled={loading} />
              </label>
              <p className="text-[10px] text-slate-400 font-medium leading-snug">
                iPhone HEIC photos are converted to JPEG automatically. iCloud files with a cloud icon must
                finish downloading first (right-click → Always keep on this device).
              </p>
            </div>
          )}
          {nativePhoto && (
            <p className="text-[10px] text-slate-400 font-medium leading-snug">
              HEIC photos convert to JPEG automatically. Prefer Library for multiple shots at once.
            </p>
          )}

          <div className="space-y-2">
            <label className="text-[10px] font-black uppercase tracking-wider text-slate-500 flex items-center gap-1.5">
              <Link2 size={12} /> Image URL(s)
            </label>
            <textarea
              value={urlInput}
              onChange={(e) => setUrlInput(e.target.value)}
              placeholder="Paste one or more direct image URLs (one per line)"
              rows={2}
              className="w-full px-3 py-2 rounded-xl border border-slate-200 bg-white text-xs font-medium outline-none focus:ring-2 focus:ring-blue-500/20 resize-none"
            />
            <button
              type="button"
              onClick={handleParseUrls}
              disabled={loading || !urlInput.trim()}
              className="w-full py-2 rounded-xl bg-slate-900 text-white text-xs font-black uppercase tracking-wide disabled:opacity-50"
            >
              Add from URL
            </button>
          </div>

          <div className="space-y-2">
            <label className="text-[10px] font-black uppercase tracking-wider text-slate-500 flex items-center gap-1.5">
              <Images size={12} /> Imgur album / gallery
            </label>
            <input
              value={imgurInput}
              onChange={(e) => setImgurInput(e.target.value)}
              placeholder="https://imgur.com/a/… or /gallery/…"
              className="w-full px-3 py-2 rounded-xl border border-slate-200 bg-white text-xs font-medium outline-none focus:ring-2 focus:ring-blue-500/20"
            />
            <button
              type="button"
              onClick={handleParseImgurAlbum}
              disabled={loading || !imgurInput.trim()}
              className="w-full py-2 rounded-xl border border-slate-200 bg-white text-xs font-black uppercase tracking-wide text-slate-700 hover:bg-slate-50 disabled:opacity-50"
            >
              Import album
            </button>
          </div>

          {error && (
            <p className="text-xs text-red-600 font-medium bg-red-50 border border-red-100 rounded-lg px-3 py-2">{error}</p>
          )}

          {pendingUrls.length > 0 && (
            <div className="space-y-2 rounded-xl border border-slate-200 bg-slate-50 p-3 -mx-1">
              <p className="text-[10px] font-black uppercase tracking-wider text-slate-500">
                Preview ({pendingUrls.length})
              </p>
              <div className="flex gap-3 overflow-x-auto pb-1 snap-x snap-mandatory">
                {pendingUrls.map((url) => (
                  <div key={url} className="relative shrink-0 w-32 sm:w-36 snap-start">
                    <div className="aspect-[4/3] rounded-xl border border-slate-200 bg-white flex items-center justify-center overflow-hidden p-1">
                      <img
                        src={url}
                        alt=""
                        className="max-w-full max-h-full w-full h-full object-contain"
                      />
                    </div>
                    <button
                      type="button"
                      onClick={() => setPendingUrls((prev) => prev.filter((u) => u !== url))}
                      className="absolute top-1.5 right-1.5 w-7 h-7 rounded-full bg-red-500 text-white flex items-center justify-center shadow-md ring-2 ring-white hover:bg-red-600 active:scale-95 z-10"
                      aria-label="Remove photo"
                    >
                      <X size={14} />
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        <div className="px-4 py-3 border-t border-slate-100 flex gap-2 shrink-0 bg-white">
          <button
            type="button"
            onClick={onClose}
            disabled={loading}
            className="flex-1 py-2.5 rounded-xl border border-slate-200 text-xs font-bold text-slate-600 hover:bg-slate-50 disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleApply}
            disabled={loading || pendingUrls.length === 0}
            className="flex-1 py-2.5 rounded-xl bg-blue-600 text-white text-xs font-black uppercase tracking-wide hover:bg-blue-700 disabled:opacity-50 flex items-center justify-center gap-2"
          >
            {loading ? <Loader2 size={14} className="animate-spin" /> : <Camera size={14} />}
            {loading ? 'Saving…' : 'Add to items'}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
};

export default React.memo(AddPhotosModal);
