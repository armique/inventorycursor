/**
 * MAIN-world hook: capture Kleinanzeigen messagebox API auth + JSON bodies.
 * Must run at document_start so SPA fetch/XHR is wrapped before first call.
 */
(function dealwatchKaHook() {
  if (window.__dealwatchKaHookInstalled) return;
  window.__dealwatchKaHookInstalled = true;

  const TARGET = /gateway\.kleinanzeigen\.de\/messagebox/i;

  function emit(payload) {
    try {
      window.postMessage({ source: 'dealwatch-ka-hook', ...payload }, '*');
    } catch {
      /* ignore */
    }
  }

  function readAuth(headers) {
    if (!headers) return '';
    try {
      if (typeof headers.get === 'function') {
        return headers.get('Authorization') || headers.get('authorization') || '';
      }
      if (Array.isArray(headers)) {
        for (const pair of headers) {
          if (pair && /^authorization$/i.test(String(pair[0] || ''))) return String(pair[1] || '');
        }
      }
      if (typeof headers === 'object') {
        for (const [key, value] of Object.entries(headers)) {
          if (/^authorization$/i.test(key)) return String(value || '');
        }
      }
    } catch {
      /* ignore */
    }
    return '';
  }

  function noteAuth(raw) {
    const token = String(raw || '').replace(/^Bearer\s+/i, '').trim();
    if (token.length > 12) emit({ type: 'auth', token });
  }

  function noteResponse(url, status, text) {
    let data = null;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      data = null;
    }
    emit({
      type: 'response',
      url: String(url || ''),
      status: Number(status) || 0,
      data,
      text: String(text || '').slice(0, 250000),
    });
  }

  const origFetch = window.fetch;
  window.fetch = async function dealwatchFetch(...args) {
    const input = args[0];
    const init = args[1] || {};
    const url = typeof input === 'string'
      ? input
      : (input && typeof input.url === 'string' ? input.url : String(input || ''));

    if (TARGET.test(url)) {
      noteAuth(readAuth(init.headers));
      if (input && typeof input.headers !== 'undefined') {
        try { noteAuth(readAuth(input.headers)); } catch { /* ignore */ }
      }
    }

    const res = await origFetch.apply(this, args);
    if (TARGET.test(url)) {
      try {
        const text = await res.clone().text();
        noteResponse(url, res.status, text);
      } catch {
        /* ignore */
      }
    }
    return res;
  };

  const OrigXHR = window.XMLHttpRequest;
  function HookedXHR() {
    const xhr = new OrigXHR();
    let reqUrl = '';
    const origOpen = xhr.open;
    xhr.open = function (method, url, ...rest) {
      reqUrl = String(url || '');
      return origOpen.call(this, method, url, ...rest);
    };
    const origSetHeader = xhr.setRequestHeader;
    xhr.setRequestHeader = function (name, value) {
      if (TARGET.test(reqUrl) && /^authorization$/i.test(String(name || ''))) {
        noteAuth(value);
      }
      return origSetHeader.call(this, name, value);
    };
    xhr.addEventListener('load', () => {
      if (!TARGET.test(reqUrl)) return;
      try {
        noteResponse(reqUrl, xhr.status, xhr.responseText || '');
      } catch {
        /* ignore */
      }
    });
    return xhr;
  }
  HookedXHR.prototype = OrigXHR.prototype;
  window.XMLHttpRequest = HookedXHR;
})();
