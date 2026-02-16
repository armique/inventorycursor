// Vercel serverless function: Enhance item images by removing/replacing background.
// Uses remove.bg if REMOVE_BG_API_KEY is set. It expects a data URL from the client
// and returns a new data URL with the enhanced image. The client then uploads that
// result to Firebase Storage.

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { imageDataUrl, kind, name, category, subCategory } = req.body || {};
  if (!imageDataUrl || typeof imageDataUrl !== 'string') {
    return res.status(400).json({ error: 'Missing imageDataUrl' });
  }

  const removeBgKey = process.env.REMOVE_BG_API_KEY;
  if (!removeBgKey) {
    // No provider configured: just echo the original.
    return res.status(200).json({ dataUrl: imageDataUrl, provider: 'none' });
  }

  try {
    // Extract base64 from data URL
    const match = imageDataUrl.match(/^data:(.+);base64,(.*)$/);
    if (!match) {
      return res.status(400).json({ error: 'Invalid data URL' });
    }
    const [, mime] = match;
    const base64 = match[2];

    const form = new FormData();
    form.append('image_file_b64', base64);
    form.append('size', 'auto');

    // Optional: choose different background for PCs vs small parts.
    const isPc =
      kind === 'pc' ||
      category === 'PC' ||
      subCategory === 'Custom Built PC' ||
      subCategory === 'Pre-Built PC';

    const pcBg = process.env.REMOVE_BG_PC_BACKGROUND_URL;
    const partBg = process.env.REMOVE_BG_PART_BACKGROUND_URL;
    const bgUrl = isPc ? pcBg : partBg;
    if (bgUrl) {
      form.append('bg_image_url', bgUrl);
    } else {
      // Fallback: neutral light background
      form.append('bg_color', 'ffffff');
    }

    const resp = await fetch('https://api.remove.bg/v1.0/removebg', {
      method: 'POST',
      headers: {
        'X-Api-Key': removeBgKey,
      },
      body: form,
    });

    if (!resp.ok) {
      const text = await resp.text().catch(() => '');
      console.error('remove.bg error', resp.status, text);
      // Fall back to original image if enhancement fails
      return res.status(200).json({ dataUrl: imageDataUrl, provider: 'fallback', message: 'remove.bg failed' });
    }

    const arrayBuffer = await resp.arrayBuffer();
    const outBase64 = Buffer.from(arrayBuffer).toString('base64');
    const outMime = resp.headers.get('content-type') || mime || 'image/png';
    const enhancedDataUrl = `data:${outMime};base64,${outBase64}`;

    return res.status(200).json({ dataUrl: enhancedDataUrl, provider: 'remove.bg' });
  } catch (e) {
    console.error('enhance-image error', e);
    // Fall back to original image on any error
    return res.status(200).json({ dataUrl: imageDataUrl, provider: 'error-fallback' });
  }
}

