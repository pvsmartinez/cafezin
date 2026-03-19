(function () {
  var TRACK_ENDPOINT =
    "https://dxxwlnvemqgpdrnkzrcr.supabase.co/functions/v1/track-landing";
  var SESSION_KEY = "cafezin-landing-session";

  function sessionId() {
    try {
      var existing = sessionStorage.getItem(SESSION_KEY);
      if (existing) return existing;
      var created =
        String(Date.now()) + "-" + Math.random().toString(36).slice(2, 10);
      sessionStorage.setItem(SESSION_KEY, created);
      return created;
    } catch {
      return "session-unavailable";
    }
  }

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
    } catch {
      // Fall through to fetch.
    }

    fetch(TRACK_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: body,
      keepalive: true,
    }).catch(function () {
      // Ignore analytics errors on the public site.
    });
  }

  function track(eventName, metadata) {
    send({
      eventName: eventName,
      pagePath: window.location.pathname,
      locale: locale(),
      referrer: document.referrer || null,
      metadata: Object.assign(
        {
          title: document.title,
          sessionId: sessionId(),
        },
        metadata || {},
      ),
    });
  }

  function loadVercelAnalytics() {
    if (document.querySelector("script[data-cafezin-vercel-analytics]")) return;

    var script = document.createElement("script");
    script.defer = true;
    script.src = "/_vercel/insights/script.js";
    script.setAttribute("data-cafezin-vercel-analytics", "true");
    document.head.appendChild(script);
  }

  function bindDownloadClicks() {
    document
      .querySelectorAll(".btn-download[data-platform]")
      .forEach(function (node) {
        node.addEventListener("click", function () {
          var platform = node.getAttribute("data-platform") || "unknown";
          track("download_click", { platform: platform });
        });
      });
  }

  window.cafezinTrack = function (eventName, metadata) {
    track(eventName, metadata);
  };

  loadVercelAnalytics();
  bindDownloadClicks();
  track("page_view");

  var pageEvent = document.body.getAttribute("data-track-page-event");
  if (pageEvent) track(pageEvent);
})();
