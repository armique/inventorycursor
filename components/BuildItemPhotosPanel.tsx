import React, { useState } from 'react';
import { Search, Upload, X, ShoppingBag, CheckCircle2 } from 'lucide-react';
import {
  filesToDataUrls,
  prepareInventoryImagesForStorage,
  normalizeImageList,
} from '../utils/imageImport';
import { searchProductPhotos, type ImageSearchResult } from '../services/imageSearchService';
import { getEbayUsername } from '../services/ebayService';
import { ensureEbayListings } from '../services/ebayListingIndex';
import { matchEbayListingsForItem } from '../utils/ebayListingMatch';

interface Props {
  name: string;
  photos: string[];
  onChange: (photos: string[]) => void;
  itemId?: string;
}

const BuildItemPhotosPanel: React.FC<Props> = ({ name, photos, onChange, itemId = 'shared' }) => {
  const [photoSearching, setPhotoSearching] = useState(false);
  const [photoSearchError, setPhotoSearchError] = useState<string | null>(null);
  const [photoSearchResults, setPhotoSearchResults] = useState<ImageSearchResult[] | null>(null);
  const [ebayLoading, setEbayLoading] = useState(false);
  const [ebayError, setEbayError] = useState<string | null>(null);
  const [ebayMatches, setEbayMatches] = useState<
    Array<{ listingId: string; title: string; thumbnail?: string; imageUrls: string[]; matchScore: number }> | null
  >(null);
  const [ebayImportingId, setEbayImportingId] = useState<string | null>(null);
  const [persistingPhotos, setPersistingPhotos] = useState(false);

  const storageOptions = { itemId };

  const addPhotos = async (urls: string[]) => {
    setPersistingPhotos(true);
    try {
      const prepared = await prepareInventoryImagesForStorage(urls, storageOptions);
      const merged = normalizeImageList([...photos, ...prepared]);
      if (merged.length) onChange(merged);
    } finally {
      setPersistingPhotos(false);
    }
  };

  const setMainPhoto = (url: string) => {
    onChange(normalizeImageList([url, ...photos.filter((u) => u !== url)]));
  };

  const removePhoto = (url: string) => {
    onChange(photos.filter((u) => u !== url));
  };

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    if (!files.length) return;
    try {
      await addPhotos(await filesToDataUrls(files, storageOptions));
    } catch (err) {
      const { localImageReadErrorMessage } = await import('../utils/localImageFile');
      alert(localImageReadErrorMessage(err, 'Could not process one or more images.'));
    } finally {
      e.target.value = '';
    }
  };

  const handleFindPhotos = async () => {
    if (!name.trim()) return alert('Enter a build name first.');
    setPhotoSearching(true);
    setPhotoSearchError(null);
    setPhotoSearchResults(null);
    try {
      const results = await searchProductPhotos(name, 8);
      if (!results.length) {
        setPhotoSearchError('No photos found.');
        return;
      }
      if (!photos.length) {
        await addPhotos([results[0].url]);
        setPhotoSearchResults(results.slice(1));
      } else {
        setPhotoSearchResults(results);
      }
    } catch (e: unknown) {
      setPhotoSearchError((e as Error)?.message || 'Photo search failed.');
    } finally {
      setPhotoSearching(false);
    }
  };

  const handleEbayPhotos = async () => {
    if (!name.trim()) return alert('Enter a build name first.');
    setEbayLoading(true);
    setEbayError(null);
    setEbayMatches(null);
    try {
      const { listings: all } = await ensureEbayListings();
      if (!all.length) {
        setEbayError(`No listings found for seller ${getEbayUsername()}.`);
        return;
      }
      const matches = matchEbayListingsForItem(name, all);
      if (!matches.length) {
        setEbayError(`No listings matched "${name}" (${all.length} active).`);
        return;
      }
      setEbayMatches(matches);
    } catch (e: unknown) {
      setEbayError((e as Error)?.message || 'Failed to load eBay listings.');
    } finally {
      setEbayLoading(false);
    }
  };

  const importEbayListing = async (listing: { listingId: string; imageUrls: string[] }) => {
    if (!listing.imageUrls.length) return;
    setEbayImportingId(listing.listingId);
    try {
      await addPhotos(listing.imageUrls);
      setEbayMatches(null);
    } finally {
      setEbayImportingId(null);
    }
  };

  return (
    <div className="flex flex-col gap-2 h-full min-h-0">
      <p className="text-sm font-black uppercase tracking-widest text-slate-400">Build photos</p>

      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={handleFindPhotos}
          disabled={photoSearching || persistingPhotos || !name.trim()}
          className="inline-flex items-center gap-2 px-3 py-2 rounded-lg bg-blue-600 text-white text-xs font-black uppercase tracking-widest hover:bg-blue-700 disabled:opacity-50"
        >
          <Search size={14} className={photoSearching ? 'animate-spin' : ''} />
          {photoSearching ? '…' : 'Find photos'}
        </button>
        <button
          type="button"
          onClick={handleEbayPhotos}
          disabled={ebayLoading || persistingPhotos || !name.trim()}
          className="inline-flex items-center gap-2 px-3 py-2 rounded-lg bg-white border border-blue-200 text-blue-700 text-xs font-black uppercase tracking-widest hover:bg-blue-50 disabled:opacity-50"
        >
          <ShoppingBag size={14} />
          {ebayLoading ? '…' : 'eBay'}
        </button>
        <label className={`inline-flex items-center gap-2 px-3 py-2 rounded-lg bg-white border border-slate-200 text-xs font-black uppercase tracking-widest text-slate-600 cursor-pointer hover:bg-slate-50 ${persistingPhotos ? 'opacity-50 pointer-events-none' : ''}`}>
          <Upload size={14} /> Upload
          <input type="file" accept="image/*" multiple className="hidden" onChange={handleUpload} />
        </label>
      </div>

      {photoSearchError && (
        <p className="text-xs font-bold text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
          {photoSearchError}
        </p>
      )}
      {ebayError && (
        <p className="text-xs font-bold text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
          {ebayError}
        </p>
      )}

      {photoSearchResults && photoSearchResults.length > 0 && (
        <div className="rounded-xl border border-slate-200 bg-white p-2.5 space-y-2">
          <div className="flex justify-between items-center">
            <p className="text-xs font-black uppercase text-slate-400">Search results</p>
            <button type="button" onClick={() => setPhotoSearchResults(null)} className="text-xs text-slate-400 hover:text-slate-700">
              Dismiss
            </button>
          </div>
          <div className="grid grid-cols-4 gap-1">
            {photoSearchResults.map((r) => (
              <button
                key={r.url}
                type="button"
                onClick={() => addPhotos([r.url])}
                className="aspect-square rounded-lg overflow-hidden ring-1 ring-slate-200 hover:ring-blue-400"
              >
                <img src={r.thumbnail} alt="" className="w-full h-full object-cover" />
              </button>
            ))}
          </div>
        </div>
      )}

      {ebayMatches && ebayMatches.length > 0 && (
        <div className="rounded-xl border border-blue-200 bg-blue-50/50 p-3 space-y-2 max-h-36 overflow-y-auto">
          {ebayMatches.map((listing) => (
            <div key={listing.listingId} className="flex items-center gap-2.5 bg-white rounded-lg p-2.5 border border-slate-100">
              {listing.thumbnail && (
                <img src={listing.thumbnail} alt="" className="w-12 h-12 rounded object-cover shrink-0" />
              )}
              <p className="text-xs font-bold text-slate-700 truncate flex-1">{listing.title}</p>
              <button
                type="button"
                disabled={ebayImportingId === listing.listingId}
                onClick={() => importEbayListing(listing)}
                className="shrink-0 px-3 py-1.5 rounded bg-slate-900 text-white text-xs font-black uppercase disabled:opacity-50"
              >
                {ebayImportingId === listing.listingId ? '…' : 'Import'}
              </button>
            </div>
          ))}
        </div>
      )}

      <div className="flex-1 min-h-0 overflow-y-auto">
        {photos.length === 0 ? (
          <div className="h-32 rounded-xl border border-dashed border-amber-300 bg-amber-50/50 flex items-center justify-center">
            <p className="text-xs font-bold text-amber-700 text-center px-3">No photos yet — search, upload, or import from eBay</p>
          </div>
        ) : (
          <div className="grid grid-cols-3 gap-1.5">
            {photos.map((url, idx) => (
              <div key={url} className="relative aspect-square rounded-lg overflow-hidden ring-1 ring-slate-200 group">
                <img src={url} alt="" className="w-full h-full object-cover" />
                {idx === 0 && (
                  <span className="absolute top-0.5 left-0.5 bg-emerald-600 text-white text-[7px] font-black uppercase px-1 rounded">
                    Main
                  </span>
                )}
                <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-1">
                  {idx !== 0 && (
                    <button
                      type="button"
                      onClick={() => setMainPhoto(url)}
                      className="p-1 bg-white rounded-full text-emerald-600"
                      title="Set as main"
                    >
                      <CheckCircle2 size={12} />
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => removePhoto(url)}
                    className="p-1 bg-white rounded-full text-red-600"
                    title="Remove"
                  >
                    <X size={12} />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

export default BuildItemPhotosPanel;
