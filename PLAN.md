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

## 0. Map fitting — RE-VERIFIED, NOT CURRENTLY REPRODUCING

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

**Conclusion: both countries currently fill their card correctly.** What
looked like a gap in a screenshot was a thin (`opacity: 0.55`), low-contrast
coastline outline against a near-black background, in a small compressed
image — easy to misread, especially for Chile's smoother northern desert
coastline. A single-vertical-line pixel scan (my first check) also gives a
false negative here since Chile's coastline is a diagonal squiggle, not a
vertical strip — it can legitimately miss a real line for long stretches.

Leaving this section instead of deleting it so a future session doesn't
re-diagnose the same false positive. If a real underfill/scaling bug shows
up again, verify with the pixel-scan method above (or an actual screenshot)
before trusting a quick visual read — this bug was "fixed," then "confirmed
still broken" from a misread, twice, in one session.

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

**Follow-up requested by user, not yet built:** the region popup currently
only shows a count ("N eventos"). It should instead show a scrollable list
of the actual events in that region (place, mag, time — same fields as the
bubble/epicenter popup), and each event in that list should be a hyperlink
to its full USGS report at
`https://earthquake.usgs.gov/earthquakes/eventpage/{event.id}`. Needs the
per-region event list, not just the count, threaded from `regionCounts` in
`CountryMapCard` into the popup render.

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

## 4. Boundary loading flakiness (needs repro)

- Perú failed to load boundary once on first attempt, worked on retry.
- Changing the time-range filter (e.g. Last Month → Last Week) caused **all
  active countries'** boundaries to fail to load simultaneously, even though
  they'd loaded fine moments before. Time range shouldn't affect ADM0/ADM1
  fetches at all — suggests an unwanted re-fetch or race condition tied to a
  re-render triggered by the range change. Needs investigation in the
  `useEffect` boundary-fetch logic in `CountryMapCard`.

## 5. Performance/freezing (largest — likely several root causes)

- Switching to the Density tab froze the page for ~1 minute on first hit,
  several seconds on later switches.
- Removing a country froze ~10s, then froze again briefly right after.
- Removing a country froze long enough to trigger Firefox's "this page is
  slowing down your browser" warning.
- Dashboard gets slower the longer the session runs (possible leak or
  unbounded accumulation somewhere — event listeners, un-cleared effects,
  growing state).
- Hover tooltip lags behind fast mouse movement, even on a **fresh** load —
  so there's a baseline responsiveness problem, not just accumulation over
  time.
- Scrolling feels janky/stepped rather than smooth.

This is the biggest bucket and probably has more than one cause. The
density-tab freeze and the general slowness are worth profiling separately
before guessing at fixes — likely candidates given the codebase: the
`DensityField` component's per-point glow rendering approach, and whatever
recomputes on every country add/remove (projections, region containment
checks via `geoContains`, which is O(events × regions) and re-run on
country list changes).

---

## Suggested order of attack

Smallest → largest, per the user's instruction:
1. ~~Popup/tooltip contrast (isolated CSS/token fix)~~ — DONE
2. ~~Regions tab legend + click/hover affordance~~ — DONE
3. ~~Density tab color + rendering approach~~ — DONE
4. Map fitting (Spain and other non-tall countries)
5. Boundary-fetch-on-range-change bug
6. Performance/freeze investigation (needs profiling, not just code reading)
