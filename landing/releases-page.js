(function () {
  var root = document.getElementById("js-releases-list");
  if (!root) return;

  var isPt =
    (document.documentElement.lang || "").toLowerCase().indexOf("pt") === 0;
  var copy = isPt
    ? {
        loading: "Carregando release notes…",
        empty: "Ainda não há release notes publicadas.",
        highlights: "Destaques",
        release: "GitHub Release",
        downloads: "Downloads",
      }
    : {
        loading: "Loading release notes…",
        empty: "No release notes published yet.",
        highlights: "Highlights",
        release: "GitHub Release",
        downloads: "Downloads",
      };

  function formatDate(value) {
    try {
      return new Intl.DateTimeFormat(isPt ? "pt-BR" : "en-US", {
        dateStyle: "medium",
      }).format(new Date(value));
    } catch (_error) {
      return value;
    }
  }

  function escapeHtml(value) {
    return String(value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function renderEmpty(message) {
    root.innerHTML =
      '<div class="release-empty">' + escapeHtml(message) + "</div>";
  }

  function render(releases) {
    if (!Array.isArray(releases) || releases.length === 0) {
      renderEmpty(copy.empty);
      return;
    }

    root.innerHTML = releases
      .map(function (entry) {
        var highlights = Array.isArray(entry.highlights)
          ? entry.highlights
              .map(function (item) {
                return "<li>" + escapeHtml(item) + "</li>";
              })
              .join("")
          : "";

        return (
          "" +
          '<article class="release-card">' +
          '<div class="release-meta">' +
          '<span class="release-version-pill">' +
          escapeHtml(entry.version || "") +
          "</span>" +
          "<span>" +
          escapeHtml(formatDate(entry.publishedAt || "")) +
          "</span>" +
          "</div>" +
          "<h2>" +
          escapeHtml(entry.title || entry.version || "") +
          "</h2>" +
          '<p class="release-summary">' +
          escapeHtml(entry.summary || "") +
          "</p>" +
          (highlights
            ? "<h3>" +
              copy.highlights +
              '</h3><ul class="release-highlights">' +
              highlights +
              "</ul>"
            : "") +
          '<div class="release-links">' +
          '<a href="' +
          escapeHtml(
            (entry.links && entry.links.githubRelease) ||
              "https://github.com/pvsmartinez/cafezin/releases",
          ) +
          '" rel="noopener noreferrer">' +
          copy.release +
          "</a>" +
          '<a href="' +
          (isPt ? "/br/download" : "/download") +
          '">' +
          copy.downloads +
          "</a>" +
          "</div>" +
          "</article>"
        );
      })
      .join("");
  }

  renderEmpty(copy.loading);

  fetch("/releases.json", { cache: "no-store" })
    .then(function (response) {
      if (!response.ok) throw new Error("Failed to load releases");
      return response.json();
    })
    .then(function (payload) {
      render(payload.releases || []);
    })
    .catch(function () {
      renderEmpty(copy.empty);
    });
})();
