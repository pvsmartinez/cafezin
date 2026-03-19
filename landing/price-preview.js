(function () {
  const ENDPOINT =
    "https://dxxwlnvemqgpdrnkzrcr.supabase.co/functions/v1/price-preview";
  const CACHE_PREFIX = "cafezin-price-preview:";
  const CACHE_TTL_MS = 5 * 60 * 1000;

  function readCache(key) {
    try {
      const raw = sessionStorage.getItem(CACHE_PREFIX + key);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      if (!parsed || typeof parsed.cachedAt !== "number") return null;
      if (Date.now() - parsed.cachedAt > CACHE_TTL_MS) return null;
      return parsed.data ?? null;
    } catch {
      return null;
    }
  }

  function writeCache(key, data) {
    try {
      sessionStorage.setItem(
        CACHE_PREFIX + key,
        JSON.stringify({ cachedAt: Date.now(), data }),
      );
    } catch {
      // Ignore sessionStorage failures on privacy-restricted browsers.
    }
  }

  async function requestPricePreview(options) {
    const cacheKey = `${options.country || ""}:${options.currency || ""}`;
    const cached = readCache(cacheKey);
    if (cached) return cached;

    const params = new URLSearchParams();
    if (options.country) params.set("country", options.country);
    if (options.currency) params.set("currency", options.currency);

    const response = await fetch(`${ENDPOINT}?${params.toString()}`, {
      headers: { Accept: "application/json" },
    });

    if (!response.ok) {
      throw new Error(`Price preview failed with status ${response.status}`);
    }

    const data = await response.json();
    if (!data?.amountFormatted) {
      throw new Error("Price preview returned no amount");
    }

    writeCache(cacheKey, data);
    return data;
  }

  window.loadCafezinPricePreview = async function loadCafezinPricePreview(
    options,
  ) {
    const amountEl = document.querySelector(options.amountSelector);
    if (!amountEl) return null;

    const periodEl = options.periodSelector
      ? document.querySelector(options.periodSelector)
      : null;
    const noteEl = options.noteSelector
      ? document.querySelector(options.noteSelector)
      : null;

    try {
      const data = await requestPricePreview(options);
      amountEl.textContent = data.amountFormatted;
      if (periodEl && options.periodText)
        periodEl.textContent = options.periodText;
      if (noteEl && options.noteText) noteEl.textContent = options.noteText;
      return data;
    } catch (error) {
      console.warn("Cafezin price preview failed", error);
      return null;
    }
  };
})();
