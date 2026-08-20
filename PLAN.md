# PLAN.md — Map & UI fixes (in progress)

Context for picking this up from a different session/device. This is a live
findings list from manual QA on the deployed dashboard
(`actividad-sismica-dashboard.drashkygolbez.workers.dev`), not yet fixed.
Ordered smallest → largest per the user's request. Nothing below has been
started yet.

**Working rule: do not `git commit` or `git push` without the user explicitly
saying so in that turn.** This applies to this session too, not just the one
that set it.

---

## 0. Map fitting — FIXED (correction: this was a real fix, not a false positive)

**Correction, 2026-08-21:** an earlier version of this section (below,
preserved for history) concluded the underfill bug was a misread of a thin
coastline outline and never a real bug. The user has since clarified that
account was wrong — the container *sizes* were already standardized before
that session, but the map projection *inside* the container genuinely
wasn't filling it correctly, and it was genuinely fixed about 30 minutes
into that same session. As of 2026-08-21 the user confirms it "works as it
should with no problems" across the countries checked. Treating this as
closed, but if it resurfaces, don't trust the analysis below at face
value — it was arrived at via a flawed verification method (see the
"pixel-scan" caveat in it) and the conclusion it reached was itself wrong.

<details>
<summary>Superseded investigation (kept for history, conclusion was wrong)</summary>

Re-investigated 2026-08-20 while working on the density feature (a density
blob appearing to "float" disconnected from the coastline looked like this
bug at first). Verified rigorously — not by eyeballing a screenshot, which
is how this got misdiagnosed twice in the same session:

- Replicated `mainlandRing()` + `fitSize()` in Node against **fresh live**
  geoBoundaries data for both Chile and Spain — the mainland ring's
  projected bounds fill their box exactly (Chile: y spans 0→624 of a
  0→624 box; Spain: y spans 0→324 of a 0→324 box).
- Confirmed against the **live running app**, not just theory: rendered
  the actual SVG to a canvas and scanned real painted pixels across the
  full width, row by row. Chile: content from y=8 to y=632 of 640 (full
  height). Spain: content from y=8 to y=336 of 340 (full height). No gap
  at top or bottom for either country.

**Conclusion (WRONG, see correction above): both countries currently fill
their card correctly.** What looked like a gap in a screenshot was believed
to be a thin (`opacity: 0.55`), low-contrast coastline outline against a
near-black background, in a small compressed image. The actual fix that
resolved the real underlying bug landed later in the same session — this
verification pass simply happened to run before that fix, or against a
code path that didn't exercise the bug.

</details>

<details>
<summary>Original bug description (for history)</summary>

The bug already partially fixed, needs finishing

`CountryMapCard` in [src/App.jsx](src/App.jsx) projects each country's ADM0
boundary with `geoMercator().fitSize(...)`. Two issues already diagnosed and
partially fixed in earlier work (see git log — "Fix map rendering at planet
scale due to inverted ring winding"):

- geoBoundaries' ADM0 files ship every ring wound clockwise (backwards from
  GeoJSON's right-hand-rule spec). d3-geo reads a backwards ring as "the
  whole globe except this landmass," which was making every country render
  at near-planet scale. Fixed via `fixRingWinding()` in `fetchBoundary()`.
- Remote territories (Easter Island for Chile, the Canary Islands for Spain)
  were dragging the fit-scale out, shrinking the mainland into a corner.
  Partially addressed via `mainlandRing()`, which fits the projection scale
  to the largest contiguous polygon instead of the whole multi-part geometry.

**Still broken:** confirmed by the user post-fix — Chile now looks correct
(expected, it's genuinely a very elongated shape). But **Spain doesn't fill
the card's height**, leaving blank space at the bottom instead of the
outline being scaled/centered to use the full available frame.

**This is not a Spain-specific issue — the user has confirmed other
countries show the same underfill problem.** Treat this as a general bug in
how the map fits/fills its container, not something to patch per-country.
The fix should be a standardized fill/height behavior that works correctly
for any country's aspect ratio, not a one-off adjustment for Spain's shape.
Needs investigating — likely something in how `fitSize`'s width/height-
constrained letterboxing interacts with `mainlandRing`'s bbox, or an
asymmetric translate — and must be verified across **all** entries in
`COUNTRY_REGISTRY` (both `tall: true` and default) before considering it
done, not just the one or two that get screenshotted.

</details>

---

## 1. Popup/tooltip text contrast (smallest) — DONE

Fixed in [src/App.jsx](src/App.jsx): added theme-aware `surface` /
`surfaceBorder` / `surfaceShadow` tokens to both `THEMES` entries, replaced
the hardcoded dark-only colors in `getTooltipStyle()`, `AlertTooltip`, and
the map click-popup with those tokens, and added `itemStyle` to every
recharts `<Tooltip>` so series text also uses `C.text` instead of recharts'
default. Alert-level label colors got their own verified `ALERT_SURFACE_TEXT`
map (distinct from the badge/marker `C.alert*` colors) so they stay legible
against the new elevated surface in both themes.

**Bonus fix that came out of the same change:** adding
`html, body { margin: 0; background: ${C.bg}; }` to the injected `<style>`
block also fixed the page's default 8px browser margin — the whole page
previously had an unintended 8px padding around it from the UA stylesheet.

## 2. Regions tab missing affordances — DONE

Fixed in [src/App.jsx](src/App.jsx) `CountryMapCard`: region `<path>`s now have
`onMouseEnter`/`onMouseLeave`/`onClick` handlers (mirroring the bubbles tab's
hover-preview / click-to-pin pattern) that populate the same `popup` state,
now tagged with `kind: "region"` vs `kind: "event"` so the existing popup
renders region name + event count instead of epicenter details. Popup
position uses `path.centroid(f)` (computed once in `regionCounts`) rather
than mouse coordinates, so it stays anchored to the region regardless of
where inside it the user hovers. The hovered/pinned region also gets a
visibly thicker, full-opacity stroke (`C.text` at 1.4px vs the default faint
0.5px) so there's a hover state even before the popup appears.

Added a legend below the SVG (regions tab only): "{label} · 0 [gradient bar
using heatLow→heatMid→heatHigh] {maxRegionCount}", matching `heatColor()`'s
actual scale per-country per-render (not a fixed 0–N). New i18n keys
`regionEventsCount(n)` and `regionLegendLabel` in both `es`/`en`.

Verified in-browser (dev server): clicking a region pins the popup with
region name + "N eventos"/"N events", hover shows the thicker stroke,
legend renders correctly for both Chile and Spain with their own max counts.

**Follow-up requested by user (2026-08-21), NOT YET BUILT — superseded/
expanded scope, see §6 below.** The region popup currently only shows a
count ("N eventos"). This grew into a larger cross-tab task during
discussion on 2026-08-21 — see §6 ("Consistent event-list window across
all 3 map tabs") for the current, decided scope. Do not implement just the
narrow "add a list to the region popup" version described in the original
note below without reading §6 first — the ordering, default-collapsed
behavior, and cross-tab consistency requirements all live there now.

<details>
<summary>Original narrower note (superseded, kept for context)</summary>

The region popup currently only shows a count ("N eventos"). It should
instead show a scrollable list of the actual events in that region (place,
mag, time — same fields as the bubble/epicenter popup), and each event in
that list should be a hyperlink to its full USGS report at
`https://earthquake.usgs.gov/earthquakes/eventpage/{event.id}`. Needs the
per-region event list, not just the count, threaded from `regionCounts` in
`CountryMapCard` into the popup render.

</details>

## 2b. Regions tab (ADM1) boundary lines too thin, especially in Atlas (day theme)

**Reported 2026-08-21, not yet fixed.** Same category of bug as the ADM0
country-outline fix from earlier in this project (see git log — the
outline was originally `stroke={C.textFaint}` at `strokeWidth={0.8}`,
`opacity={0.6}`, bumped to `stroke={C.text}` at `strokeWidth={1.5}`,
`opacity={0.55}` because it was nearly invisible at normal card size). The
*region* (ADM1) boundary stroke inside the Regions tab is a **separate**
line in the code and apparently never got the same treatment — in Chile
the user can't distinguish region borders from each other at all, and in
Spain they're barely differentiable. Reads worse in Atlas (day theme)
specifically, consistent with a light theme having less inherent contrast
margin than the near-black crimson background for a given stroke color/
opacity. Find the ADM1 `<path>` stroke in `CountryMapCard`'s `regions`
render branch and apply the same kind of contrast/width bump, verified in
both themes, not just crimson.

## 3. Density tab — visual design and color — DONE

This one went through a LOT of iteration (color scheme alone changed maybe
six times) before landing. Full blow-by-blow is in the conversation log if
ever needed, but don't re-read it to "fix" the current colors — the palette
below is the user's own explicit final direction, arrived at by them
directly specifying hex values after several rejected proposals. Only change
it if asked.

### Technique (stable since early on, not what kept changing)

Replaced the old blurred-circle approach entirely with a real **geodensity
plot** — a 2D kernel density estimate (KDE), computed by hand (not
`d3.contourDensity()`, which only supports one shared bandwidth for every
point) and fed into `d3.contours()` (the lower-level generator that takes a
raw value grid). This matters because **each event's kernel radius is scaled
from its own magnitude** (`feltRadiusKm()`, a log-linear fit to rough real
felt-radius anchors, converted to this projection's pixels via
`destinationPoint()` — actually projecting a point N km away rather than
assuming a flat km-per-pixel ratio). `d3-contour` + `d3-interpolate` added as
dependencies.

Key implementation details worth knowing before touching this again:

- **Grid combination is `Math.max()`, not a sum or screen-blend.** An
  earlier screen-blend version ("brightness accumulates on overlap") was
  reverted — it doesn't just brighten a cluster's peak, it inflates values
  toward the ceiling across the whole *shared area* between close points,
  which made a tight cluster (e.g. Granada's 4-event sequence) render as one
  solid blob with no internal texture. `max()` keeps each point's own
  natural Gaussian shape intact, so close-but-distinct events still read as
  separate bumps.
- **Alpha/color normalize against a fixed ceiling (1), not this map's own
  max value.** Normalizing against the map's own max meant an isolated
  event's visibility depended on what else happened to be on the same map —
  a strong nearby cluster could crush a real, separate earthquake down to
  invisible. Weight is capped per-point (`Math.min(0.9, 0.55 + w*0.35)`) so
  a strong isolated event reaches near-ceiling on its own merit.
- **Alpha curve is `t^4.5`** (`t` = the fixed-ceiling-normalized density
  value) — steep enough that only the hot core stays solid and the rest
  dissipates, but not so steep that translucent color loses all contrast
  against a light background (this was tuned down from `t^6` after the
  light-theme version became nearly invisible).
- **Threshold spacing is a cosine ease** (`0.5 - 0.5*cos(π·i/levels)`, dense
  at both ends of the range, sparse in the middle) — needed resolution at
  the low end so weak events get a real gradient instead of 1-2 flat bands,
  and at the high end since a Gaussian is flattest right at its own peak.
- **Edge clipping**: KDE padding alone stops a decayed *tail* from
  hard-cutting at the frame edge, but not a hotspot's actual *core* when the
  real event is genuinely close to the country's bounding-box edge (real
  case: an offshore Japan Trench event). Fixed with an independent soft-edge
  vignette (blurred black frame-stroke as an SVG luminance mask) layered on
  top of the hard clip.
- **Epicenter markers are separate from the density field**, deliberately —
  an earlier version tried folding a "yellow hot core" into the merged
  KDE's own peak color, but a merged cluster's peak doesn't sit at any real
  epicenter's coordinates, so the highlight visibly didn't match the actual
  event locations. Markers now use the exact same `p.x`/`p.y` as the pulsar
  ring (`className="liveDot"`, reusing the existing "breathe" keyframe) —
  guaranteed to line up, verified by direct coordinate diff.

### Current palette (as of 2026-08-20, user's explicit final call)

- **Felt-zone glow** (`heatLow`/`heatMid`/`heatHigh`, shared with the Regions
  choropleth): deep royal indigo/violet, `#3B0066 → #6600CC` (atlas) /
  `→ #9D4EDD` (crimson, brighter top end since it needs to pop against
  near-black rather than cream). Rejected on the way here: a single red-hue
  HCL ramp (too subtle to show accumulation), real Inferno/Magma anchor
  points (user's later call, still purple-forward — see below), a teal/cyan
  version (user's own idea, later reconsidered: teal reads too close to
  `alertGreen`'s existing "safe/no alert" meaning in this app, bad clash).
- **Epicenter markers + pulsar ring**: neon magenta-to-orange,
  `#FF007F → #FF8000`. This is the one place orange is fine — it's not part
  of an escalating severity ramp (where it previously got rejected for
  reading as "less severe than red"), it's a fixed-identity pinpoint marker.
  Interpolated via `heatRamp(C, t)` in HCL (not raw RGB) for the glow itself
  so equal steps in density read as equal steps in perceived intensity.

Chile's single event (this test period) correctly renders nothing when
there's only 1 point on the whole map — not a bug, a KDE needs ≥2 points to
produce a meaningful surface.

### Follow-on UI added after the palette was finalized (also DONE)

Once the color/technique settled, the user asked for three more pieces,
all shipped and committed (`1b5ba2a`):

- **Theme-aware legend** below the map (density tab only): "{label} [Baja/Low]
  [gradient bar heatLow→heatMid→heatHigh] [Alta/High]" — new i18n keys
  `densityLegendLabel/Low/High` in `es`/`en`.
- **Epicenter list panel** (bottom-left, over the map, density tab only):
  fixed 200px width, 130px scrollable list, collapsible via a full-width
  clickable header button (`listCollapsed` state). Clicking an entry calls
  `zoomToEvent(p)` to pan/zoom the map to that event rather than opening a
  detail popup (per explicit correction from an earlier version that opened
  a USGS-link popup instead — user wanted map-centering, not a popup).
  New i18n keys `epicenterListTitle/Hint/Collapse/Expand/Empty`.
  **TODO, requested 2026-08-20 end of session, not yet built:** this panel
  should default to **collapsed/closed**, not open. Check `listCollapsed`'s
  initial `useState` value in `CountryMapCard` — it's very likely
  initialized `false` (open) right now and needs to start `true`.
- **Real d3-zoom bug found and fixed**: `.transition().duration(x).call(zoomBehaviorRef.current.transform, target)`
  silently no-ops in this environment — confirmed via fresh-module console
  testing (bypassing the app's bundle) that the exact same `.call()` without
  `.transition()` applies instantly and correctly. `zoomBy`, `zoomReset`, and
  the new `zoomToEvent` all use plain `.call()` now — no animated glide, but
  actually functional.
- **Layout bug fixed**: the epicenter list panel's `position: absolute;
  bottom: 8` was anchoring to a container that also included the
  normal-flow legend sitting below the `<svg>`, so the panel sat higher
  than intended (misaligned relative to the map's own bottom edge). Fixed
  by wrapping the `<svg>` + its absolute-positioned children (zoom controls,
  popup, epicenter list) in their own inner `position: relative` div,
  separate from the legend, which now renders as a sibling after it.
- **Atlas (day) theme legend read backwards** — its `heatLow→heatHigh` ramp
  went dark→light, same direction as the crimson (dark) theme. A dark→light
  ramp reads correctly as weak→strong against crimson's near-black
  background, but backwards against atlas's light cream background (the
  darkest end reads as the strongest, regardless of where it sits in the
  ramp). Fixed by inverting atlas's ramp to pale→dark instead:
  `heatLow: "#C9A6E8"` (WCAG 1.76:1 vs bg — intentionally subtle) →
  `heatMid: "#8B3DC9"` (4.93:1) → `heatHigh: "#3B0066"` (12.92:1) —
  monotonically increasing contrast now matches the low→high labels.
- Also fixed in the same commit: `StatChip` (Period Summary cards) had
  inconsistent title/value vertical alignment depending on whether the
  label wrapped to 1 or 2 lines — added `minHeight: 28` + flex alignment to
  reserve consistent label space.

### Post-ship fixes (found after committing `1b5ba2a`, now in `main`)

Two real problems surfaced once the feature was live and got a second look
against real screenshots — worth recording precisely since both are the
kind of mistake that's easy to reintroduce.

**Bug: Density and Regions silently shared one palette.** `heatLow/Mid/
High` was one token set read by *both* the Density surface and the Regions
choropleth. Landing the Density palette meant overwriting those same three
keys — which reskinned Regions too, without anyone asking for that. Fixed
by splitting into fully independent token sets: `regionLow/Mid/High`
(restored to the original pre-session red/pink and brown/gold values) and
`densityLow/Mid/High` (Density's own palette). Same problem existed for
the epicenter marker color, which was typed as a literal hex string in
three separate JSX spots instead of a token — replaced with
`epicenterCore`/`epicenterEdge` per theme. **Lesson: shared tokens across
two visually-independent features are a trap — give each feature its own
names even when the values start out equal.**

**User preference: night theme reverted to the pre-Density-rework look.**
After seeing it live, the user preferred the *original* red → crimson →
hot-pink glow with a flat/glowing gold epicenter dot over the violet/
magenta palette — specifically for the **crimson (night) theme only**.
Atlas (day) keeps the violet/magenta-orange palette from the six-round
session; **don't apply this reversion to atlas too** — an early attempt at
this fix mistakenly reverted both themes symmetrically, which was wrong
and had to be undone. Current state:
- crimson: `densityLow/Mid/High = #3A0A0A/#B2231F/#FF1F8F` (dark red →
  crimson → hot pink, restored from the original pre-session `heatLow/
  Mid/High`), `epicenterCore = epicenterEdge = #FFD200` (single-hue gold).
- atlas: `densityLow/Mid/High = #C9A6E8/#8B3DC9/#3B0066` (the six-round
  violet palette, contrast-corrected pale→dark direction), `epicenterCore
  = #FF007F`, `epicenterEdge = #FF8000` (the original two-tone magenta-
  to-orange marker).

Two real implementation bugs came out of chasing this, both worth keeping
in mind before touching marker rendering again:
- **Epicenter marker radius must NOT be divided by the zoom level `k`.**
  The pulse ring intentionally divides by `k` to stay a constant on-screen
  size regardless of zoom. The marker dot does the opposite on purpose —
  it should grow somewhat as you zoom in, using a small base radius clamp
  (`Math.min(3.2, Math.max(1.5, radiusPx * 0.055))`, no `/k`) rather than
  a fixed on-screen size. Dividing it by `k` (an earlier attempt at fixing
  overlap) made dots stay tiny at high zoom instead of growing — wrong
  direction.
- **A flat, fully-opaque marker fill fuses into a hard blob when several
  markers overlap at high zoom; a radial gradient that fades to 0 opacity
  at its edge blends softly instead.** The "dots merging into one shape"
  complaint wasn't a sizing bug — it was a flat-fill regression from an
  earlier simplification. Fixed by keeping a 3-stop radial gradient
  (`0% → 30% → 100%`, opacity `1 → 0.65 → 0`) instead of a solid fill.
- **The Density alpha curve's exponent direction was backwards on a first
  attempt.** Lowering the exponent (4.5 → 3) to make the surface "more
  transparent" actually raised opacity in the 0.3–0.7 density range even
  though the peak was capped — e.g. at t=0.5, exponent 3 gives 0.125
  before any ceiling is applied, versus 0.044 at the original 4.5. A
  *higher* exponent (settled on 6) combined with an opacity ceiling
  (`Math.pow(t, 6) * 0.65`) is what actually reads as more transparent —
  it's lower than the original curve at every t < 1, not just at the peak.

## 4. Boundary loading flakiness — LIKELY EXPLAINED, needs the fix in §7

- Perú failed to load boundary once on first attempt, worked on retry.
- Changing the time-range filter (e.g. Last Month → Last Week) caused **all
  active countries'** boundaries to fail to load simultaneously, even though
  they'd loaded fine moments before.

**2026-08-21 update:** during unrelated discussion about GitHub API rate
limits (see §7), it came out that `fetchBoundary()` has **zero caching** —
every mount does a fresh `api.github.com` + `media.githubusercontent.com`
round-trip, with no dedup even across identical requests. Repeated
add/remove/re-add of countries during a testing session (which is exactly
what happened in the sessions that hit this) burns through GitHub's
unauthenticated 60 req/hour-per-IP quota fast, especially since each
country needs 2–3 requests (meta + SHA resolution + geometry) per level
(ADM0, and again for ADM1 if Regions is opened). **This is very likely the
actual cause of the "all boundaries failed to load simultaneously"
symptom** — not a bug in the time-range logic specifically, but the
cumulative effect of no caching finally tipping over the rate limit at
some point in the session, which could coincide with any UI action,
including a range change. Confirming this requires checking the browser
console for a 403/rate-limit response at the time of failure (not done
yet) but building the cache in §7 should resolve this either way, since it
removes the repeat-fetch pattern that would trigger it. Re-verify this
item specifically is gone once §7 ships — don't assume it's fixed just
because the cache landed.

## 5. Performance/freezing — PARTIALLY IMPROVED, needs re-verification

- ~~Switching to the Density tab froze the page for ~1 minute on first
  hit, several seconds on later switches.~~ **User confirms 2026-08-21:
  tab switching no longer freezes.** Not clear what fixed this — no work
  was specifically aimed at it, so it may be an incidental effect of other
  changes in the same session (density/regions rework), or of something
  external (browser update, machine state). Worth a quick sanity check
  but not re-investigating from scratch.
- **Still needs re-checking, not confirmed fixed:**
  - Removing a country froze ~10s, then froze again briefly right after.
  - Removing a country froze long enough to trigger Firefox's "this page
    is slowing down your browser" warning.
  - Dashboard gets slower the longer the session runs (possible leak or
    unbounded accumulation somewhere).
  - Hover tooltip lags behind fast mouse movement, even on a fresh load.
  - Scrolling feels janky/stepped rather than smooth.
- **~~New question raised 2026-08-21~~ — ANSWERED, and partially fixed,
  2026-08-21.** Checked `useMemo` deps directly rather than guessing:
  `projection`/`path` (deps `[adm0, W, H]`) and `regionCounts` (deps
  `[adm1, path, events]`) were already correctly independent of
  `mapView` — no bug there, tab switching was never recomputing the
  country outline or region choropleth. **But `DensitySurface`'s KDE grid
  computation had its own internal `useMemo`, inside a component that
  only exists while `mapView === "density"`** — every tab switch away
  unmounted it, and every switch back remounted a fresh instance with no
  memory of the previous computation, rerunning the whole KDE grid from
  scratch even with unchanged events. This is almost certainly the actual
  cause of the original "Density tab freezes on switch" report. Fixed by
  pulling the computation out into a standalone `computeDensityContours()`
  function and memoizing it in `CountryMapCard` itself (a `densityData`
  useMemo, gated by a `densityVisited` flag so it's still not computed
  until Density is actually opened once) — same pattern `regionCounts`
  already used successfully. `DensitySurface` is now pure rendering, no
  computation of its own.

  **Verified, not just assumed:** instrumented the live dev app (Chile +
  Spain, "Último año" range, ~500+ events) — cold first switch into
  Density took long enough to exceed a 30s script timeout (confirms the
  *first* computation is genuinely expensive for a large dataset — a
  real, separate problem this fix does NOT address, see below), but a
  second switch away and back rendered the identical 44 contour paths in
  ~650ms. That's the fix working as intended: it stops the *repeat* cost,
  it doesn't make the one real computation faster.

  **~~Still open~~ — FIXED, 2026-08-21.** The raw KDE cost for large
  datasets was real (confirmed above), and likely the actual explanation
  for the user's original "~1 minute" freeze report, not just the
  recompute-on-remount bug. Considered capping to the top-N events
  (globally or per-region) but rejected it — for a seismic tool, silently
  dropping real events to go faster is a data-integrity problem, and a
  magnitude-based cut would specifically erase swarm/aftershock
  clustering (the many-small-events signal a density map exists to show)
  while leaving isolated big events untouched.

  Instead: `clusterDensityPoints()` bins events into a small fixed grid
  (independent of the main density grid) before the per-point Gaussian
  splat — only genuinely close-in-screen-space points merge; isolated/
  large events pass through untouched. Since the existing combine rule is
  `max()` not sum, a cluster of near-identical overlapping small events
  already produced a nearly identical visual result to just its
  strongest member, so this simplifies already-redundant work rather
  than cutting real data — every individual event is still shown in
  bubbles/lists elsewhere.

  **Verified, not assumed:** same live dataset as above (Chile+Spain,
  "Último año", ~500+ events) — cold first switch dropped from 30+
  seconds to **~989ms**, with an **identical 44 contour paths** rendered
  before and after. Same visual output, ~27x faster.

  Remaining, smaller levers (Web Worker offload, coarser grid, capping
  kernel reach) are no longer needed for this dataset but stay
  available if a future pathological case (very large, evenly-spread,
  non-clustered event set) needs them — clustering helps least exactly
  when data isn't clustered.

Likely candidates for the other still-open freeze items (country removal,
tooltip lag, scrolling jank): `geoContains` region-containment checks
(O(events × regions)) re-running on every country add/remove — not yet
investigated.

## 6. Consistent event-list window across all 3 map tabs — NOT STARTED, scope decided 2026-08-21

Currently only the Density tab has a collapsible event-list panel; the
other two tabs have nothing (Epicentros) or a legend but no list
(Regiones), so the card's height visibly differs by tab and jumps when
you switch. Decided scope, discussed 2026-08-21, don't re-litigate without
reason:

- **Epicentros tab**: add the same collapsible list panel Density already
  has, plus a legend below the map (mirroring Regiones' legend), so all 3
  tabs share the same container height.
- **Regiones tab**: the *region* popup becomes this tab's version of the
  panel. Default state is collapsed, showing placeholder copy along the
  lines of "Press a region to show events" (exact i18n string still TBD —
  needs both `es`/`en`). No region selected → stays closed. User clicks a
  region → panel opens showing that region's actual event list (not just
  the count it shows today — see the superseded note in §2 for the
  original narrower version of this ask, now folded into this item).
- **Density tab**: the epicenter markers (the small pulsar dots on the KDE
  surface) currently have no hover interaction at all. They should get
  the **same hover popup Epicentros' bubbles already have** (place, mag,
  depth, time) — this is new interactive surface for Density, not a
  redesign of the existing list panel.
- **Ordering must be decided once and applied consistently across all 3
  tabs' lists** — currently unspecified/accidental (probably just
  USGS API response order for the existing Density list, never chosen on
  purpose). Options discussed: most recent first, strongest magnitude
  first, or nearest-to-viewport-center first. **Needs an explicit decision
  before implementation** — whatever's chosen affects list-header/hint
  copy too (e.g. "most recent" vs "largest"), so don't build 3 different
  orders by accident by copy-pasting without deciding first.
- **Open technical question, check before or during implementation:**
  does `CountryMapCard` recompute the map projection/paths on every
  `mapView` tab switch even though the underlying boundary/projection
  doesn't change between tabs? See the note in §5 — this may be a
  legitimate performance bug in its own right, and touching this code for
  the list-panel work is a natural point to check it, but treat it as a
  separate, verifiable finding, not an assumption baked into this task.

**User's explicit process preference for this item, given its size:**
tackle it in disciplined pieces with individual commits per sub-piece
(each still requires asking before pushing, per the standing rule at the
top of this file) rather than one large uncommitted pass — easier to
isolate and revert if a specific piece goes wrong.

## 7. GitHub API boundary-fetch caching — DONE

Implemented in [src/App.jsx](src/App.jsx) `fetchBoundary()`: resolved
boundary GeoJSON (post `fixRingWinding`/`fixShapeNames`) is cached in
localStorage keyed by `boundary-cache-v{BOUNDARY_CACHE_VERSION}-{iso3}-
{level}`, no TTL. Verified via automated network-request check (not just
eyeballing): second page load makes zero requests to `geoboundaries.org`
or any `github.com`/`githubusercontent.com` host, and the map still
renders correctly from the cached data. `BOUNDARY_CACHE_VERSION` is the
manual-bust escape hatch — bump it if the fetch/fix pipeline itself ever
changes and old cached entries need invalidating.

Also resolves the practical cause of item 4 (boundary loading flakiness)
by construction — repeated add/remove of countries no longer spends
network requests after the first fetch per country/level, so there's
much less opportunity to trip GitHub's rate limit at all.

<details>
<summary>Original scoping note (superseded by the above, kept for context)</summary>

NOT STARTED, priority raised 2026-08-21

Previously logged as a low-priority "nice to have" (see HANDOFF.md). Re-
scoped upward after clarifying the actual mechanics of GitHub's rate
limit, discussed 2026-08-21:

- GitHub's unauthenticated REST API limit (60 requests/hour) is scoped to
  **the calling IP address across ALL of `api.github.com`**, not per-app,
  per-origin, or per-referrer, and not a shared account-wide pool that all
  dashboard visitors draw from together. Each visitor spends their own
  budget — so this is not a "the app breaks under real traffic" risk.
- **But it's still a real problem worth fixing on principle:** since the
  quota is shared across *everything* that visitor's browser does against
  GitHub's API that hour — not just our app — repeatedly burning it here
  could leave a visitor rate-limited on some *unrelated* GitHub-backed
  tool they use the same hour. That's an inconsiderate side effect of our
  own lack of caching, not something to shrug off just because it isn't a
  scaling risk. Direct quote from the user on this: "we can't inconvenience
  the User because of our bad practice."
- `fetchBoundary()` currently has **no caching at all** — confirmed in
  code, every mount does a fresh 2–3-request round trip (meta lookup, SHA
  resolution via `api.github.com`, geometry fetch) with no dedup even for
  identical repeat requests within the same session.
- **Fix**: cache resolved boundary GeoJSON keyed by `{iso3}-{level}`
  (localStorage, since country/region borders essentially never change —
  a long TTL, maybe weeks-to-months, is reasonable; consider no TTL at
  all with a manual-bust escape hatch instead of guessing a "correct"
  expiry). This should also make the app feel snappier on repeat visits/
  repeat country toggling generally, independent of the rate-limit angle.
- Also worth checking while in this code: whether something is firing
  *more* fetch calls than the true minimum per add (e.g. an effect
  re-running extra times, possibly React StrictMode double-invocation in
  dev inflating the apparent problem) — separate from "no cache exists,"
  since that would make the rate-limit problem worse than the baseline
  no-cache case alone would.
- Related to and likely explains item 4 (boundary loading flakiness) —
  see that section for the connection.

</details>

---

## Suggested order of attack

Smallest → largest, per the user's instruction. Items 4/5/6/7 below were
discussed together on 2026-08-21 and the user asked to tackle them one at
a time — order kept smallest-to-largest per this project's established
convention unless told otherwise:
1. ~~Popup/tooltip contrast (isolated CSS/token fix)~~ — DONE
2. ~~Regions tab legend + click/hover affordance~~ — DONE
3. ~~Density tab color + rendering approach~~ — DONE
4. ~~Map fitting~~ — DONE (see corrected §0)
5. ~~Regions tab (ADM1) boundary lines too thin, esp. Atlas/day theme~~
   (§2b) — DONE
6. ~~GitHub API boundary caching~~ (§7) — DONE
7. Performance re-verification (§5) — re-check remaining freeze symptoms
   now that tab-switching is confirmed fixed; check the tab-switch
   recompute question while here
8. Consistent event-list window across all 3 tabs (§6) — largest, most
   decisions required (ordering, Density hover parity, Regiones window
   behavior), tackle in individually-committed pieces per the user's
   stated preference
