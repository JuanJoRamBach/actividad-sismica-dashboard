# HANDOFF — 2026-08-20 session

Read this first if you're picking up this project cold. It summarizes one
session's work — four punch-list items, one of which (the Density tab) ran
long — so you don't have to reconstruct it from git log or conversation
history. Full technical detail lives in [PLAN.md](PLAN.md) — this file is
the short version plus "what's next."

## Post-ship correction (same session, follow-up commit)

After `1b5ba2a` landed, a second look at real screenshots caught a real
bug and a wrong assumption — both fixed and pushed in a follow-up commit.
Full detail in [PLAN.md](PLAN.md)'s "Post-ship fixes" section; short
version:

- **Bug**: Density and Regions were secretly sharing one color token set
  (`heatLow/Mid/High`), so landing the Density palette silently reskinned
  Regions too. Split into independent `regionLow/Mid/High` and
  `densityLow/Mid/High`, and moved the epicenter marker's hardcoded hex
  into real `epicenterCore`/`epicenterEdge` tokens.
- **Preference change, night theme only**: reverted the crimson theme's
  Density surface from the violet/magenta palette back to the original
  red → crimson → hot-pink glow with a gold marker. **Atlas (day) keeps
  the violet/magenta-orange palette** — don't revert that one too, an
  early attempt at this got that wrong and had to be undone.
- Two implementation lessons worth knowing before touching marker
  rendering again: the marker radius must NOT be divided by zoom level
  `k` (it should grow with zoom, unlike the pulse ring), and a flat
  opaque marker fill fuses into a hard blob on overlap where a
  fade-to-transparent gradient blends softly — that was the real cause
  of a "dots merging" complaint, not a sizing issue.

## What shipped this session (commit `1b5ba2a`, pushed to `main`)

0. **Map fitting re-investigated, ruled out as not a bug** — a previously
   reported "Spain doesn't fill its card" issue was re-checked against live
   data and actual rendered pixels; both countries fill correctly. The
   earlier "still broken" reports were misreads of a thin, low-contrast
   coastline outline in compressed screenshots. Left in PLAN.md §0 as a
   record so a future session doesn't re-chase the same false positive.
1. **Popup/tooltip contrast fixed** — hardcoded dark-only colors replaced
   with theme-aware tokens across tooltips and the map click-popup; caught
   an unrelated default page-margin bug in the same pass.
2. **Regions tab hover/click affordances + legend added** — region shapes
   now support hover-preview and click-to-pin (mirroring the bubbles tab),
   anchored to each region's centroid, plus a count-scaled legend.
3. **Real geodensity KDE for the Density map tab** — replaced a flat blurred
   blob with a proper 2D kernel density estimate: per-event kernel radius
   scaled to magnitude, `d3.contours()` for the isoband polygons,
   `Math.max()` grid combination (not sum/blend) so overlapping-but-distinct
   events stay visually separate, fixed-ceiling alpha normalization so one
   strong cluster can't crush a nearby weak event to invisible, soft-edge
   vignette masking so a hotspot near a country's bounding-box edge doesn't
   hard-clip. Color/technique took roughly six rounds of iteration to land
   — see the honest retrospective on why in the linked case-study artifact
   below; short version: palette choice has no automated pass/fail check,
   unlike everything else in this list.
   - **Final color palette**, set directly by the user after several
     rejected proposals (teal, Inferno/Magma anchors, plain red HCL):
     violet/indigo felt-zone glow (`#3B0066 → #6600CC`/`#9D4EDD`),
     magenta-to-orange epicenter markers (`#FF007F → #FF8000`), shared
     with the Regions choropleth via `heatRamp()`.
   - **Theme-aware density legend**, a **collapsible epicenter list panel**
     (click an entry to pan/zoom the map to it, not a popup), and the zoom
     controls — all positioned correctly after fixing a real layout bug
     where the panel anchored to the wrong container.
   - **Two real bugs found and fixed along the way**, not just cosmetic:
     - d3-zoom's `.transition().call(...)` pattern silently no-ops in this
       environment — confirmed via fresh-module console testing, not
       assumed. Removed `.transition()` everywhere it's used.
     - Atlas (day) theme's legend gradient read backwards — a dark→light
       ramp reads weak→strong on a black background but backwards on a
       light one. Fixed by inverting the ramp direction for atlas
       specifically, verified with real WCAG contrast math
       (1.76 → 4.93 → 12.92, now monotonic).
   - Minor: fixed inconsistent title/value alignment in the Period Summary
     stat cards (`StatChip`).

## Rules this project runs under (see CLAUDE.md)

- **The user does their own visual/manual testing.** Don't drive the
  browser to "verify" UI changes unless explicitly asked — build-check and
  automated pixel/DOM assertions are fine, screenshots-as-default are not.
- **Never commit or push without being explicitly asked in that turn.**
- Two themes only (`crimson` dark, `atlas` light) — don't add a third.
- Don't reintroduce `mix-blend-mode` on the bubbles tab; don't merge
  `dotRed` and `alertRed`; don't pre-bundle geoBoundaries for all countries.

## What's next (from PLAN.md's punch list, smallest → largest, per the user's own ordering)

Items 0–3 are done. Remaining, in order:

4. **Boundary loading flakiness** (needs repro) — changing the time-range
   filter caused all active countries' boundaries to fail to load
   simultaneously, even though they'd just loaded fine. Suspect an
   unwanted re-fetch or race condition in `CountryMapCard`'s boundary
   `useEffect`, since range shouldn't touch ADM0/ADM1 fetches at all.
5. **Performance/freezing** (largest, likely multiple root causes) —
   switching to the Density tab froze the page ~1 min on first hit;
   removing a country froze long enough to trigger a browser slow-page
   warning; hover tooltip lags even on a fresh load. Needs profiling
   before guessing at fixes — likely suspects: per-point glow rendering
   in the density path, and `geoContains` region-containment checks
   (O(events × regions)) re-running on every country add/remove.

Also still open, lower priority:
- Map fitting (§0 in PLAN.md) — re-verified as NOT currently reproducing;
  leave the section in place as a false-positive record, don't re-chase it
  without a fresh, rigorously-verified repro.
- Region popup follow-up: currently shows only an event *count* per region;
  user asked for the actual scrollable event list (place/mag/time + USGS
  link) instead, same as the bubble/epicenter popup already has.
- Optional/not requested yet: cache the geoBoundaries fetch (e.g.
  localStorage) to avoid repeatedly hitting GitHub's unauthenticated
  60 req/hour API limit during dev.

## Start here

```bash
npm install
npm run dev
```

Then open [PLAN.md](PLAN.md) for the full technical history before touching
the Density tab's colors or KDE parameters again — that palette took ~6
rounds of iteration to land and is the user's own explicit final call.
