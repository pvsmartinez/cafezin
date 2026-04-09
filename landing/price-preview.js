(function () {
  const ENDPOINT =
    "https://dxxwlnvemqgpdrnkzrcr.supabase.co/functions/v1/price-preview";
  const CACHE_PREFIX = "cafezin-price-preview:";
  const CACHE_TTL_MS = 5 * 60 * 1000;

  // Default billing interval shown on page load.
  const DEFAULT_INTERVAL = "annual";

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

  async function fetchPrices(options) {
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
    if (!data?.monthly && !data?.tiers && !data?.amountFormatted) {
      throw new Error("Price preview returned no amounts");
    }

    writeCache(cacheKey, data);
    return data;
  }

  // ── Core: apply prices for a given interval ──────────────────────────────

  function applyPrices(pricesData, interval, opts) {
    const tiers = (interval === "annual"
      ? pricesData.annual
      : pricesData.monthly) ??
      pricesData.tiers ?? { basic: pricesData.amountFormatted };

    for (const [tier, amount] of Object.entries(tiers)) {
      document.querySelectorAll(`[data-price-tier="${tier}"]`).forEach((el) => {
        el.textContent = amount;
      });
    }

    // Update period text (e.g. /month vs /yr).
    const periodMonthly = opts.periodMonthly ?? "/month";
    const periodAnnual = opts.periodAnnual ?? "/yr";
    const periodText = interval === "annual" ? periodAnnual : periodMonthly;
    document.querySelectorAll("[data-price-period]").forEach((el) => {
      el.textContent = periodText;
    });

    // Show/hide billing-note elements.
    document.querySelectorAll("[data-billing-note]").forEach((el) => {
      el.hidden = el.dataset.billingNote !== interval;
    });

    // Sync toggle button active state.
    document.querySelectorAll("[data-billing-toggle]").forEach((btn) => {
      const isActive = btn.dataset.billingToggle === interval;
      btn.classList.toggle("billing-opt--active", isActive);
      btn.setAttribute("aria-pressed", String(isActive));
    });

    // Update checkout interval data attribute so premium page can read it.
    document.querySelectorAll("[data-checkout-tier]").forEach((el) => {
      el.dataset.checkoutInterval = interval;
    });
  }

  // ── Public API ────────────────────────────────────────────────────────────

  /**
   * loadCafezinPrices({ country?, currency?, periodMonthly?, periodAnnual? })
   *
   * Fetches localized prices from Paddle, shows annual by default,
   * and wires up any [data-billing-toggle] buttons on the page.
   */
  window.loadCafezinPrices = async function loadCafezinPrices(options = {}) {
    try {
      const data = await fetchPrices(options);

      window.cafezinPrices = {
        monthly: data.monthly ?? data.tiers ?? {},
        annual: data.annual ?? {},
        currencyCode: data.currencyCode,
        countryCode: data.countryCode,
        _opts: options,
      };

      // Apply default interval.
      const interval =
        document.querySelector("[data-billing-toggle].billing-opt--active")
          ?.dataset.billingToggle ?? DEFAULT_INTERVAL;
      applyPrices(data, interval, options);

      // Wire toggle buttons.
      document.querySelectorAll("[data-billing-toggle]").forEach((btn) => {
        btn.addEventListener("click", () => {
          const newInterval = btn.dataset.billingToggle;
          if (!newInterval) return;
          applyPrices(data, newInterval, options);
          if (window.cafezinPrices) window.cafezinPrices.interval = newInterval;
          document.dispatchEvent(
            new CustomEvent("cafezin:interval-changed", {
              detail: { interval: newInterval, prices: window.cafezinPrices },
            }),
          );
        });
      });

      window.cafezinPrices.interval = interval;

      document.dispatchEvent(
        new CustomEvent("cafezin:prices-loaded", {
          detail: window.cafezinPrices,
        }),
      );

      return window.cafezinPrices;
    } catch (error) {
      console.warn("Cafezin price preview failed", error);
      return null;
    }
  };

  // Switch interval programmatically (used by premium page JS).
  window.cafezinSetInterval = function cafezinSetInterval(interval) {
    if (!window.cafezinPrices) return;
    applyPrices(
      {
        monthly: window.cafezinPrices.monthly,
        annual: window.cafezinPrices.annual,
      },
      interval,
      window.cafezinPrices._opts ?? {},
    );
    window.cafezinPrices.interval = interval;
  };

  // Legacy single-element API kept for backwards compatibility.
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
      const data = await fetchPrices(options);
      const amount =
        data.monthly?.[options.tier ?? "basic"] ??
        data.tiers?.[options.tier ?? "basic"] ??
        data.amountFormatted;
      if (!amount) return null;
      amountEl.textContent = amount;
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
