(function () {
  var TRACK_ENDPOINT =
    "https://dxxwlnvemqgpdrnkzrcr.supabase.co/functions/v1/track-landing";

  function locale() {
    var lang = (document.documentElement.lang || "").toLowerCase();
    return lang.indexOf("pt") === 0 ? "pt-BR" : "en";
  }

  function send(payload) {
    var body = JSON.stringify(payload);
    try {
      if (navigator.sendBeacon) {
        var blob = new Blob([body], { type: "application/json" });
        navigator.sendBeacon(TRACK_ENDPOINT, blob);
        return;
      }
    } catch (_e) {
      // Fall through to fetch.
    }
    fetch(TRACK_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: body,
      keepalive: true,
    }).catch(function () {});
  }

  // Envia evento de conversão para o Supabase (funil interno).
  function track(eventName, metadata) {
    send({
      eventName: eventName,
      pagePath: window.location.pathname,
      locale: locale(),
      referrer: document.referrer || null,
      metadata: metadata || {},
    });
  }

  // Dispara evento no GA4 (page views e comportamento vêm automaticamente pelo
  // Enhanced Measurement; aqui apenas eventos de conversão explícitos).
  function ga4(eventName, params) {
    if (typeof window.gtag === "function") {
      window.gtag("event", eventName, params || {});
    }
  }

  function inferPlatform(node) {
    var explicit = node.getAttribute("data-platform");
    if (explicit) return explicit;
    var href = node.href || node.getAttribute("href") || "";
    if (/\.dmg/i.test(href)) return "mac";
    if (/\.exe|setup/i.test(href)) return "windows";
    if (/testflight|apps\.apple/i.test(href)) return "ios";
    if (/play\.google|\.apk/i.test(href)) return "android";
    return "unknown";
  }

  // Dispara conversão do Google Ads e navega após confirmação (ou timeout de 2s).
  function gtagSendEvent(url) {
    var callback = function () {
      if (typeof url === "string") {
        window.location = url;
      }
    };
    if (typeof window.gtag === "function") {
      window.gtag("event", "conversion_event_purchase_1", {
        event_callback: callback,
        event_timeout: 2000,
      });
    } else {
      // gtag não carregou (bloqueador de ads etc.) — navega direto.
      callback();
    }
  }

  function bindDownloadClicks() {
    document.querySelectorAll(".btn-download").forEach(function (node) {
      node.addEventListener("click", function (e) {
        var href = node.href || node.getAttribute("href") || "";
        var platform = inferPlatform(node);

        // Rastreia no Supabase e GA4.
        track("download_click", { platform: platform });
        ga4("file_download", { file_name: "Cafezin", platform: platform });

        // Só intercepta links externos (downloads do GitHub etc.).
        // Links internos (/#download, /pricing) navegam normalmente.
        if (href && /^https?:\/\//i.test(href)) {
          e.preventDefault();
          gtagSendEvent(href);
        }
      });
    });
  }

  // Chamado por scripts inline nas páginas de conversão.
  window.cafezinTrack = function (eventName, metadata) {
    track(eventName, metadata || {});
    if (eventName === "premium_checkout_start") ga4("begin_checkout", metadata);
    if (eventName === "premium_checkout_success") ga4("purchase", metadata);
    if (eventName === "contact_submit") ga4("generate_lead", metadata);
  };

  function adaptHeroCta() {
    var ua = navigator.userAgent || "";
    var plat = navigator.platform || "";
    if (!/Win/i.test(plat) && !/Windows NT/i.test(ua)) return;

    var WIN_URL =
      "https://github.com/pvsmartinez/cafezin/releases/latest/download/Cafezin_setup.exe";
    var MAC_URL =
      "https://github.com/pvsmartinez/cafezin/releases/latest/download/Cafezin.dmg";

    function swap(id, href, platform) {
      var el = document.getElementById(id);
      if (!el) return;
      el.href = href;
      el.setAttribute("data-platform", platform);
      var label = el.getAttribute("data-win-label");
      if (label) {
        var span = el.querySelector("[data-cta-label]");
        if (span) {
          span.textContent = label;
        } else if (!el.querySelector("svg")) {
          el.textContent = label;
        }
      }
      var iconMac = el.querySelector('[data-icon="mac"]');
      var iconWin = el.querySelector('[data-icon="win"]');
      if (iconMac) iconMac.style.display = "none";
      if (iconWin) iconWin.style.display = "";
    }

    swap("js-hero-primary", WIN_URL, "windows");
    swap("js-hero-alt", MAC_URL, "mac");
    swap("js-cta-primary", WIN_URL, "windows");
    swap("js-cta-alt", MAC_URL, "mac");
    swap("js-pricing-free", WIN_URL, "windows");

    // Compare/persona pages: se não há botão Windows explícito, troca qualquer
    // .btn-download apontando para .dmg → .exe (ex: CTA sections das compare pages).
    var hasExplicitWin = !!document.querySelector(
      'a[href*="Cafezin_setup.exe"]',
    );
    if (!hasExplicitWin) {
      document
        .querySelectorAll("a.btn-download[href]")
        .forEach(function (node) {
          if (/Cafezin\.dmg/i.test(node.getAttribute("href"))) {
            node.href = WIN_URL;
            node.setAttribute("data-platform", "windows");
            var mainSpan = node.querySelector(".btn-main");
            var subSpan = node.querySelector(".btn-sub");
            if (mainSpan) mainSpan.textContent = "Windows";
            if (subSpan) subSpan.textContent = "Download for";
          }
        });
    }
  }

  bindDownloadClicks();
  adaptHeroCta();

  // Evento explícito de conversão setado no <body> (ex: página de obrigado).
  var pageEvent = document.body.getAttribute("data-track-page-event");
  if (pageEvent) {
    track(pageEvent);
    if (pageEvent === "premium_checkout_success") ga4("purchase", {});
  }
})();
