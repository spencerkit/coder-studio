import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { UI_CAPTURE_SCENES, type UiCaptureScene, type UiCaptureVariant } from "../scenes";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const suiteRoot = path.resolve(__dirname, "..");
const outputRoot = path.join(suiteRoot, "output");
const screenshotsRoot = path.join(outputRoot, "screenshots");

const CATEGORY_ORDER = ["page", "modal", "sheet", "toast", "empty", "error", "loading"] as const;

export interface UiManifestEntry {
  id: string;
  title: string;
  category: string;
  source: string;
  device: "desktop" | "mobile";
  theme: "dark" | "light";
  locale: "zh" | "en";
  path: string;
  description: string;
}

function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

export function buildManifestEntry(args: {
  scene: Pick<UiCaptureScene, "id" | "title" | "category" | "source" | "description">;
  screenshotPath: string;
  variant: UiCaptureVariant;
}): UiManifestEntry {
  return {
    id: args.scene.id,
    title: args.scene.title,
    category: args.scene.category,
    source: args.scene.source,
    device: args.variant.device,
    theme: args.variant.theme,
    locale: args.variant.locale,
    path: args.screenshotPath.replaceAll(path.sep, "/"),
    description: args.scene.description,
  };
}

async function walk(dir: string): Promise<string[]> {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  const files = await Promise.all(
    entries.map(async (entry) => {
      const absolute = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        return walk(absolute);
      }
      return [absolute];
    })
  );

  return files.flat();
}

export function renderReportHtml(entries: UiManifestEntry[]) {
  const payload = JSON.stringify(entries).replaceAll("<", "\\u003c");
  const sceneCount = new Set(entries.map((entry) => entry.id)).size;
  const initialSummary = `
          <div class="summary-chip">Scenes: ${sceneCount}</div>
          <div class="summary-chip">Screenshots: ${entries.length}</div>
        `;
  const groupedByCategory = new Map<string, Map<string, UiManifestEntry[]>>();

  for (const entry of entries) {
    const sceneMap = groupedByCategory.get(entry.category) ?? new Map<string, UiManifestEntry[]>();
    const sceneEntries = sceneMap.get(entry.id) ?? [];
    sceneEntries.push(entry);
    sceneMap.set(entry.id, sceneEntries);
    groupedByCategory.set(entry.category, sceneMap);
  }

  const initialContent = [...groupedByCategory.entries()]
    .sort(
      (a, b) =>
        CATEGORY_ORDER.indexOf(a[0] as (typeof CATEGORY_ORDER)[number]) -
        CATEGORY_ORDER.indexOf(b[0] as (typeof CATEGORY_ORDER)[number])
    )
    .map(([category, sceneMap]) => {
      const sceneBlocks = [...sceneMap.values()]
        .sort((a, b) => a[0].title.localeCompare(b[0].title))
        .map((sceneEntries) => {
          const cards = [...sceneEntries]
            .sort((a, b) => {
              return [a.device, a.theme, a.locale]
                .join("|")
                .localeCompare([b.device, b.theme, b.locale].join("|"));
            })
            .map((entry) => {
              const alt = escapeHtml(
                `${entry.title} ${entry.device} ${entry.theme} ${entry.locale}`
              );
              return `
                <article class="card" data-category="${escapeHtml(entry.category)}">
                  <a href="${escapeHtml(entry.path)}" target="_blank" rel="noreferrer">
                    <img src="${escapeHtml(entry.path)}" alt="${alt}" />
                  </a>
                  <div class="meta">
                    <div class="meta-row"><strong>${escapeHtml(entry.device)}</strong> / ${escapeHtml(entry.theme)} / ${escapeHtml(entry.locale)}</div>
                    <div class="meta-row">${escapeHtml(entry.source)}</div>
                  </div>
                </article>
              `;
            })
            .join("");

          return `
            <div class="scene-block">
              <h3>${escapeHtml(sceneEntries[0].title)}</h3>
              <p>${escapeHtml(sceneEntries[0].description)}</p>
              <div class="grid">${cards}</div>
            </div>
          `;
        })
        .join("");

      return `
        <section class="group" data-category="${escapeHtml(category)}">
          <h2>${escapeHtml(category)}</h2>
          ${sceneBlocks}
        </section>
      `;
    })
    .join("");

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>UI Preview Report</title>
    <style>
      :root {
        color-scheme: dark;
        font-family: "IBM Plex Sans", "Segoe UI", sans-serif;
        --bg: #0b1014;
        --panel: #131b22;
        --panel-strong: #18222b;
        --border: rgba(255, 255, 255, 0.08);
        --text: #edf2f7;
        --muted: #9fb0c3;
        --accent: #7dd3fc;
      }
      * { box-sizing: border-box; }
      body {
        margin: 0;
        background: radial-gradient(circle at top, #16222d 0%, var(--bg) 52%);
        color: var(--text);
      }
      .layout {
        display: grid;
        grid-template-columns: 280px minmax(0, 1fr);
        min-height: 100vh;
      }
      .sidebar {
        position: sticky;
        top: 0;
        height: 100vh;
        padding: 24px 20px;
        border-right: 1px solid var(--border);
        background: rgba(11, 16, 20, 0.92);
        backdrop-filter: blur(14px);
      }
      .sidebar h1 {
        margin: 0 0 8px;
        font-size: 24px;
      }
      .sidebar p {
        margin: 0 0 20px;
        color: var(--muted);
        line-height: 1.5;
      }
      .sidebar label {
        display: block;
        margin: 0 0 12px;
        font-size: 12px;
        color: var(--muted);
        text-transform: uppercase;
        letter-spacing: 0.08em;
      }
      .sidebar select {
        width: 100%;
        margin-top: 6px;
        padding: 10px 12px;
        border-radius: 10px;
        border: 1px solid var(--border);
        background: var(--panel);
        color: var(--text);
      }
      .content {
        padding: 28px;
      }
      .summary {
        display: flex;
        gap: 12px;
        flex-wrap: wrap;
        margin-bottom: 24px;
      }
      .summary-chip {
        padding: 8px 12px;
        border: 1px solid var(--border);
        border-radius: 999px;
        background: rgba(255, 255, 255, 0.04);
        color: var(--muted);
        font-size: 13px;
      }
      .group {
        margin-bottom: 40px;
      }
      .group h2 {
        margin: 0 0 16px;
        font-size: 20px;
      }
      .scene-block {
        margin-bottom: 28px;
      }
      .scene-block h3 {
        margin: 0 0 6px;
        font-size: 18px;
      }
      .scene-block p {
        margin: 0 0 14px;
        color: var(--muted);
        line-height: 1.5;
      }
      .grid {
        display: grid;
        grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
        gap: 16px;
      }
      .card {
        overflow: hidden;
        border: 1px solid var(--border);
        border-radius: 18px;
        background: linear-gradient(180deg, rgba(255,255,255,0.05), rgba(255,255,255,0.03));
        box-shadow: 0 18px 60px rgba(0, 0, 0, 0.24);
      }
      .card a {
        display: block;
        background: #0d1318;
      }
      .card img {
        display: block;
        width: 100%;
        height: auto;
      }
      .meta {
        padding: 12px 14px 14px;
        font-size: 12px;
        color: var(--muted);
      }
      .meta strong {
        color: var(--text);
      }
      .meta-row + .meta-row {
        margin-top: 4px;
      }
      .empty {
        padding: 48px 24px;
        border: 1px dashed var(--border);
        border-radius: 18px;
        background: rgba(255,255,255,0.03);
        color: var(--muted);
        text-align: center;
      }
      @media (max-width: 960px) {
        .layout {
          grid-template-columns: 1fr;
        }
        .sidebar {
          position: static;
          height: auto;
          border-right: 0;
          border-bottom: 1px solid var(--border);
        }
        .content {
          padding: 20px;
        }
      }
    </style>
  </head>
  <body>
    <div class="layout">
      <aside class="sidebar">
        <h1>UI Preview Report</h1>
        <p>Browse stable desktop and mobile screenshots by scene, theme, locale, and source.</p>
        <label>Category<select id="category"><option value="">All Categories</option></select></label>
        <label>Source<select id="source"><option value="">All Sources</option></select></label>
        <label>Device<select id="device"><option value="">All Devices</option></select></label>
        <label>Theme<select id="theme"><option value="">All Themes</option></select></label>
        <label>Locale<select id="locale"><option value="">All Locales</option></select></label>
      </aside>
      <main class="content">
        <div class="summary" id="summary">${initialSummary}</div>
        <div id="content">${initialContent}</div>
      </main>
    </div>
    <script>
      const categoryOrder = ${JSON.stringify(CATEGORY_ORDER)};
      const entries = ${payload};
      const filters = {
        category: document.getElementById("category"),
        source: document.getElementById("source"),
        device: document.getElementById("device"),
        theme: document.getElementById("theme"),
        locale: document.getElementById("locale"),
      };
      const summary = document.getElementById("summary");
      const content = document.getElementById("content");

      const appendOptions = (select, values) => {
        values.forEach((value) => {
          const option = document.createElement("option");
          option.value = value;
          option.textContent = value;
          select.appendChild(option);
        });
      };

      appendOptions(filters.category, [...new Set(entries.map((entry) => entry.category))].sort((a, b) => {
        const aIndex = categoryOrder.indexOf(a);
        const bIndex = categoryOrder.indexOf(b);
        return (aIndex === -1 ? Number.MAX_SAFE_INTEGER : aIndex) - (bIndex === -1 ? Number.MAX_SAFE_INTEGER : bIndex);
      }));
      appendOptions(filters.source, [...new Set(entries.map((entry) => entry.source))].sort());
      appendOptions(filters.device, [...new Set(entries.map((entry) => entry.device))].sort());
      appendOptions(filters.theme, [...new Set(entries.map((entry) => entry.theme))].sort());
      appendOptions(filters.locale, [...new Set(entries.map((entry) => entry.locale))].sort());

      Object.values(filters).forEach((select) => {
        select.addEventListener("change", render);
      });

      function createSummaryChip(label, value) {
        const chip = document.createElement("div");
        chip.className = "summary-chip";
        chip.textContent = label + ": " + value;
        return chip;
      }

      function render() {
        const filtered = entries.filter((entry) => {
          return Object.entries(filters).every(([key, select]) => !select.value || entry[key] === select.value);
        });

        summary.innerHTML = "";
        summary.appendChild(createSummaryChip("Scenes", new Set(filtered.map((entry) => entry.id)).size));
        summary.appendChild(createSummaryChip("Screenshots", filtered.length));

        content.innerHTML = "";

        if (filtered.length === 0) {
          const empty = document.createElement("div");
          empty.className = "empty";
          empty.textContent = "No screenshots match the current filters.";
          content.appendChild(empty);
          return;
        }

        const groupedByCategory = new Map();
        filtered.forEach((entry) => {
          if (!groupedByCategory.has(entry.category)) {
            groupedByCategory.set(entry.category, new Map());
          }
          const sceneMap = groupedByCategory.get(entry.category);
          if (!sceneMap.has(entry.id)) {
            sceneMap.set(entry.id, []);
          }
          sceneMap.get(entry.id).push(entry);
        });

        [...groupedByCategory.entries()]
          .sort((a, b) => {
            const aIndex = categoryOrder.indexOf(a[0]);
            const bIndex = categoryOrder.indexOf(b[0]);
            return (aIndex === -1 ? Number.MAX_SAFE_INTEGER : aIndex) - (bIndex === -1 ? Number.MAX_SAFE_INTEGER : bIndex);
          })
          .forEach(([category, sceneMap]) => {
            const section = document.createElement("section");
            section.className = "group";
            section.dataset.category = category;
            section.innerHTML = "<h2>" + category + "</h2>";

            [...sceneMap.entries()]
              .sort((a, b) => a[1][0].title.localeCompare(b[1][0].title))
              .forEach(([, sceneEntries]) => {
                sceneEntries.sort((a, b) => {
                  return [a.device, a.theme, a.locale].join("|").localeCompare([b.device, b.theme, b.locale].join("|"));
                });

                const block = document.createElement("div");
                block.className = "scene-block";
                block.innerHTML =
                  "<h3>" + sceneEntries[0].title + "</h3>" +
                  "<p>" + sceneEntries[0].description + "</p>";

                const grid = document.createElement("div");
                grid.className = "grid";

                sceneEntries.forEach((entry) => {
                  const card = document.createElement("article");
                  card.className = "card";
                  card.dataset.category = entry.category;
                  card.innerHTML = \`
                    <a href="\${entry.path}" target="_blank" rel="noreferrer">
                      <img src="\${entry.path}" alt="\${entry.title} \${entry.device} \${entry.theme} \${entry.locale}" />
                    </a>
                    <div class="meta">
                      <div class="meta-row"><strong>\${entry.device}</strong> / \${entry.theme} / \${entry.locale}</div>
                      <div class="meta-row">\${entry.source}</div>
                    </div>
                  \`;
                  grid.appendChild(card);
                });

                block.appendChild(grid);
                section.appendChild(block);
              });

            content.appendChild(section);
          });
      }

      render();
    </script>
  </body>
</html>`;
}

async function main() {
  await fs.mkdir(outputRoot, { recursive: true });
  const screenshotFiles = await walk(screenshotsRoot).catch(() => []);
  const screenshotSet = new Set(screenshotFiles);
  const entries: UiManifestEntry[] = [];

  for (const scene of UI_CAPTURE_SCENES) {
    for (const variant of scene.variants) {
      const relativePath = path.join(
        "screenshots",
        scene.category,
        scene.id,
        `${variant.device}__${variant.theme}__${variant.locale}.png`
      );
      const absolutePath = path.join(outputRoot, relativePath);

      if (!screenshotSet.has(absolutePath)) {
        continue;
      }

      entries.push(
        buildManifestEntry({
          scene,
          screenshotPath: relativePath,
          variant,
        })
      );
    }
  }

  const manifestPath = path.join(outputRoot, "manifest.json");
  const reportPath = path.join(outputRoot, "report.html");

  await fs.writeFile(manifestPath, `${JSON.stringify(entries, null, 2)}\n`);
  await fs.writeFile(reportPath, renderReportHtml(entries));
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  void main();
}
