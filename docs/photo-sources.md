# Photo sources (iPhone + local iCloud folder)

There is **no public iCloud Photos API** for web apps, so DeInventory uses two practical bridges:

## 1. From iPhone (primary)

In **Listing Studio → Photos → iPhone**:

1. PC shows a QR code + short link (`/upload/:token`).
2. Scan with iPhone Camera → mobile upload page.
3. Tap **Choose from Photos** → iOS opens your **full photo library**.
4. Uploads land in Firebase (`photo-inbox/{token}/…`) and appear live on the PC item.

Requires:

- Cloud / Google sign-in on the PC
- Deployed Firestore + Storage rules (`photoUploadSessions` + `photo-inbox`)
- Auth on the phone: **Anonymous** (optional) **or** Google sign-in with the same account

```bash
firebase login
bash scripts/deploy-photo-bridge-rules.sh
# optional: enable Anonymous at
# https://console.firebase.google.com/project/inventorycursor-e9000/authentication/providers
```

Links expire (~25 min) and are revoked when you close the iPhone panel.

## 2. From iCloud / local folder (secondary)

If **iCloud for Windows** syncs photos to a folder on the PC:

1. Listing Studio → Photos → **Folder**
2. Choose that folder once (Chrome or Edge)
3. Browse / search / multi-select images
4. Add them to the item (same pipeline as file upload → Storage)

Notes:

- Uses the File System Access API (Chrome/Edge on Windows; not Firefox)
- Folder permission can be remembered in IndexedDB
- **Online-only** iCloud placeholders may not list until downloaded locally
- HEIC may not preview in Chromium; prefer JPEG if iCloud is set to upload as most compatible

## 3. Classic Add

**Add** still opens the normal file picker (USB stick, Downloads, etc.).
