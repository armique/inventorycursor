# Fix Firebase Storage upload stuck at 0%

If gallery image uploads stay at **"Uploading 1/5 0%"** and never move, the Storage **bucket** is missing **CORS** configuration. Security Rules alone are not enough; the bucket must allow browser uploads.

## Steps (one-time)

### 1. Install Google Cloud CLI

- **Windows:** [Install Google Cloud CLI](https://cloud.google.com/sdk/docs/install)
- **Mac:** `brew install google-cloud-sdk`
- Or use **Google Cloud Console → Cloud Shell** (browser terminal; gcloud is pre-installed).

### 2. Log in and set project

```bash
gcloud auth login
gcloud config set project inventorycursor-e9000
```

(Replace `inventorycursor-e9000` with your Firebase project ID if different.)

### 3. Apply CORS to your Storage bucket

From the **project root** (where `storage-cors.json` is):

```bash
gcloud storage buckets update gs://inventorycursor-e9000.appspot.com --cors-file=storage-cors.json
```

If your bucket name is different, use it instead of `inventorycursor-e9000.appspot.com` (find it in Firebase Console → Project settings → General → Your apps → storageBucket).

### 4. Try upload again

Reload your app and upload the 5 images again. The percentage should increase and uploads should complete.

---

**Alternative (gsutil):**

```bash
gsutil cors set storage-cors.json gs://inventorycursor-e9000.appspot.com
```

**Check current CORS:**

```bash
gcloud storage buckets describe gs://inventorycursor-e9000.appspot.com --format="yaml(cors)"
```
