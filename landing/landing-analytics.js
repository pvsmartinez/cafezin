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

  function bindDownloadClicks() {
    document
      .querySelectorAll(".btn-download[data-platform]")
      .forEach(function (node) {
        node.addEventListener("click", function () {
          var platform = node.getAttribute("data-platform") || "unknown";
          track("download_click", { platform: platform });
          ga4("file_download", { file_name: "Cafezin", platform: platform });
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

  bindDownloadClicks();

  // Evento explícito de conversão setado no <body> (ex: página de obrigado).
  var pageEvent = document.body.getAttribute("data-track-page-event");
  if (pageEvent) {
    track(pageEvent);
    if (pageEvent === "premium_checkout_success") ga4("purchase", {});
  }
})();
