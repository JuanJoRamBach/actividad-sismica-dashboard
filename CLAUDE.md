# CLAUDE.md

Context for Claude Code working on this repo. Read this before making changes.

## What this is

"Actividad Sísmica" — a real-time seismic activity dashboard. Shows live earthquake
data for Chile, Spain, and 12 other countries (USGS FDSN), with maps, magnitude
trends, depth/severity analysis, and multi-country comparison (max 3 at once).

Built as a single-page Vite + React app. No backend — everything fetches directly
from public APIs client-side.

## Stack

- React 18 + Vite (see `package.json`)
- `recharts` for charts (line/area/bar/scatter/pie)
- `d3-geo` for map projections (Mercator) and point-in-polygon (`geoContains`)
- No CSS framework — all styling is inline `style={}` + a single `<style>` block
  injected in `App.jsx` for keyframes/hover states. No CSS modules, no Tailwind.
- No state management library — plain `useState`/`useMemo`/`useContext`.

## Commands

```bash
npm install
npm run dev      # local dev server
npm run build    # production build to dist/ — ALWAYS run this before committing
                  # non-trivial changes, it catches JSX/syntax errors fast
npm run preview  # serve the production build locally
```

## Architecture (src/App.jsx — the whole app lives here + i18n.js)

- `COUNTRY_REGISTRY` — the source of truth for every supported country: bounding
  box (for the USGS query), ISO3 code (for geoBoundaries), timezone, locale,
  fallback-data activity profile. Adding a new country = one entry here.
- `THEMES` — two themes only: `crimson` (dark/night) and `atlas` (light/day).
  A third theme ("Cianotipo") was deliberately removed per user request — don't
  re-add it without being asked. Both themes were built against real contrast
  math (WCAG ratios + colorblind simulation), not picked by eye. If you touch
  theme colors, re-verify contrast — see git history / conversation log for the
  Python contrast-checking approach used originally (relative luminance, WCAG
  formula, Machado et al. 2009 CVD simulation matrices). Don't just eyeball it.
- `ThemeContext` / `LangContext` — theme and translation strings are provided via
  React Context from the top-level `App` component, consumed via
  `React.useContext(...)` in every sub-component. This is deliberate: it lets a
  single day/night toggle and a single language detection re-color/re-translate
  everything without prop-drilling. If you add a new component that needs colors
  or strings, pull them from context, don't hardcode hex values or Spanish/English
  text directly.
- `fetchCountryData(id)` — live USGS fetch, falls back to `generateFallback(id)`
  (deterministic seeded RNG, NOT random each load) if the fetch fails or returns
  empty. The fallback exists so the dashboard is never blank, including in
  environments that block third-party fetches (e.g. it was originally built
  and demoed inside an iframe-sandboxed artifact preview that could NOT reach
  earthquake.usgs.gov — hence "Modo demostración" showing up in early screenshots.
  This should NOT happen in a real deployed browser context. If it does happen
  post-deploy, that's a real bug worth investigating, not expected behavior.
- `fetchBoundary(iso3, level)` — live geoBoundaries fetch (ADM0 = country outline,
  ADM1 = states/provinces), CC-BY 4.0, no API key. Called on-demand: ADM0 fetches
  when a country becomes active, ADM1 fetches lazily only when the "Regiones" tab
  is opened for that country. Do NOT pre-bundle or pre-fetch boundaries for all
  14 registry countries — that was an explicit design decision (keep initial load
  light, most users only ever activate 2-3 countries).
  **VERIFIED (2026-08-19)**: tested against the live API. The field name
  (`meta.simplifiedGeometryGeoJSON || meta.gjDownloadURL`) was correct, but the
  URL itself didn't work — both fields point at `github.com/<owner>/<repo>/raw/
  <ref>/<path>`, which (a) 302-redirects through a response carrying an invalid
  empty `Access-Control-Allow-Origin` header that browsers reject outright, and
  (b) even if that resolved, the files are Git-LFS-tracked, so any raw-content
  mirror (raw.githubusercontent.com, jsDelivr, statically.io) only serves the
  small LFS pointer text, not the real geometry. Fixed by resolving the short
  commit SHA via the CORS-enabled `api.github.com/repos/.../commits/{ref}`
  endpoint and building a `media.githubusercontent.com/media/...` URL directly
  — see `toMediaGithubUsercontent()` next to `fetchBoundary()`.
- `CountryMapCard` — the unified map component (replaces what used to be two
  separate sections, "Densidad Sísmica" and "Epicentros Individuales" — they were
  merged because they rendered the same underlying data twice). Three tabs share
  one `d3.geoMercator().fitSize(...)` projection per country:
  - `bubbles` — solid, non-blended circles (deliberately NO `mix-blend-mode`,
    per explicit user request: "no bleeding" between nearby points)
  - `density` — continuous KDE-style glow field, DOES use `mix-blend-mode: screen`
    intentionally, this is the one place overlap-brightening is wanted
  - `regions` — choropleth via `geoContains` point-in-polygon against ADM1
- Country categorical colors (`C.palette`) are assigned by **position** in
  `activeCountries`, not fixed per-country. First active country = palette[0],
  etc. This means colors can shift if you remove the first country and add a
  new one. Known/accepted trade-off, not a bug.
- `dotRed` (epicenter dot / event-marker color) is deliberately a different hue
  from `alertRed` in every theme. Do not make these the same color — there was
  a real semantic-collision bug earlier (red event dots read as "everything is
  high alert") and this was fixed on purpose. Verify hue separation if you touch
  either token.

## i18n (src/i18n.js)

- Two languages: `es` (default) and `en`. Detected via `navigator.languages`/
  `navigator.language` — anything starting with `es` → Spanish, everything else
  → English. This is intentional (broad non-Spanish default), not a bug.
- All user-facing strings should go through the `STRINGS` dictionary and be
  read via the `t` object from `LangContext`. Don't hardcode new Spanish or
  English strings directly in JSX — add both translations to `i18n.js` first.
- Dynamic strings (needing interpolation) are functions in the dictionary, e.g.
  `maxCountriesNote: (n) => \`...${n}...\`` — follow that pattern for new ones.
- USGS place names (e.g. "56 km SW of Valparaíso, Chile") come from the API in
  English regardless of dashboard language — that's source data, not app UI,
  and is not translated. Leave as-is.

## Known TODOs / not yet done

- [ ] GitHub repo metadata: short description, topics/tags, and a public-facing
      README pass (current README is functional/setup-focused, written for the
      developer, not for a visitor). Suggested topics: `react`, `vite`, `d3`,
      `dashboard`, `earthquake`, `seismic`, `usgs`, `data-visualization`.
      Suggested description: "Live earthquake monitoring dashboard for Chile,
      Spain, and 12+ other countries — USGS data, real geographic boundaries,
      day/night + ES/EN auto-detection." (tune as needed)
- [x] `LICENSE` file (MIT) — confirmed committed and tracked in git.
- [x] geoBoundaries live verification — done 2026-08-19, see above. The field
      name was fine; the real bug was a CORS-broken redirect plus Git LFS, now
      fixed in `fetchBoundary()`.
- [ ] No screenshots in the README yet — worth adding once deployed.
- [ ] Bundle size warning at build time (~640kB main chunk, mostly recharts +
      d3-geo) — not urgent, but code-splitting (`React.lazy` for chart-heavy
      sections) would help if this becomes a real complaint.

## Things NOT to change without being asked

- Don't reintroduce a third theme.
- Don't remove the fallback-data system (`generateFallback`) — it's the safety
  net that keeps the dashboard functional when USGS is unreachable.
- Don't pre-bundle boundary data for all countries "for performance" — the
  on-demand fetch pattern was a deliberate choice, not an oversight.
- Don't add `mix-blend-mode` back to the `bubbles` tab.
- Don't merge `dotRed` and `alertRed` into the same color.
