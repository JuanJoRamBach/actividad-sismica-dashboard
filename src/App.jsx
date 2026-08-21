import React, { useState, useEffect, useMemo, useCallback, useRef } from "react";
import {
  LineChart, Line, AreaChart, Area, BarChart, Bar, ScatterChart, Scatter,
  PieChart, Pie, Cell, XAxis, YAxis, ZAxis, CartesianGrid, Tooltip, Legend,
  ResponsiveContainer,
} from "recharts";
import { geoMercator, geoPath, geoContains, geoArea } from "d3-geo";
import { contours as d3contours } from "d3-contour";
import { interpolateHcl } from "d3-interpolate";
import { zoom as d3zoom, zoomIdentity } from "d3-zoom";
import { select as d3select } from "d3-selection";
import "d3-transition";
import { STRINGS, detectLang } from "./i18n.js";

function usgsEventUrl(eventId) { return `https://earthquake.usgs.gov/earthquakes/eventpage/${eventId}`; }

/* Shared across all 3 map tabs' event lists (Epicentros/Densidad/Regiones) — the */
/* user explicitly rejected a single fixed default order (most recent / strongest */
/* magnitude / nearest-to-viewport-center were all considered and turned down) in */
/* favor of a toggle they control themselves. One function, one set of toggle     */
/* buttons, reused identically in all three rather than three separate orderings. */
function sortEvents(events, mode) {
  const arr = events.slice();
  if (mode === "magnitude") arr.sort((a, b) => b.mag - a.mag);
  else arr.sort((a, b) => b.time - a.time);
  return arr;
}

/* Caps how many events actually get RENDERED on the map (bubbles, density KDE +  */
/* markers + the per-marker "breathe" pulsar CSS animation, region containment    */
/* checks) — not just the sidebar list, which was the wrong place to cap: a       */
/* high-activity country (Japan) over a long range plus an existing one (Chile)   */
/* both uncapped meant hundreds to a thousand+ simultaneously-animating SVG       */
/* elements across 2-3 country cards at once, which is a real, severe cost        */
/* regardless of how fast any single computation is. Ordered cap, top-100-by-     */
/* magnitude first (test at 100; drop to 50 if still too slow) — NOT the earlier  */
/* spatial-clustering approach used for the Density surface's OWN internal grid   */
/* computation (that stays as-is, it's a different problem: reducing redundant    */
/* KDE splats for a fixed point set, not reducing how many points/markers exist   */
/* in the first place). This never touches filtered[id] itself — period-summary   */
/* stats, charts, and Epicentros' own magnitude/count figures elsewhere in the    */
/* app still reflect the TRUE full dataset; only what CountryMapCard renders is   */
/* capped.                                                                        */
const MAP_EVENT_CAP = 100;
function capEventsForMap(events, cap) {
  if (events.length <= cap) return events;
  return events.slice().sort((a, b) => b.mag - a.mag).slice(0, cap);
}

const EARTH_RADIUS_KM = 6371;
/* Great-circle destination point, given a start point, distance, and bearing  */
/* (standard spherical formula) — used to measure "how many pixels is N km,    */
/* at this specific point on this specific projection" by projecting both the */
/* origin and a point N km away, rather than assuming a flat km-per-pixel      */
/* conversion (Mercator's scale varies with latitude, and every country here   */
/* uses its own fitted projection).                                           */
function destinationPoint(lon, lat, distanceKm, bearingDeg) {
  const delta = distanceKm / EARTH_RADIUS_KM;
  const theta = (bearingDeg * Math.PI) / 180;
  const phi1 = (lat * Math.PI) / 180, lambda1 = (lon * Math.PI) / 180;
  const phi2 = Math.asin(Math.sin(phi1) * Math.cos(delta) + Math.cos(phi1) * Math.sin(delta) * Math.cos(theta));
  const lambda2 = lambda1 + Math.atan2(
    Math.sin(theta) * Math.sin(delta) * Math.cos(phi1),
    Math.cos(delta) - Math.sin(phi1) * Math.sin(phi2)
  );
  return [(lambda2 * 180) / Math.PI, (phi2 * 180) / Math.PI];
}
/* Empirical magnitude -> "felt radius" curve (km) — a log-linear fit to rough */
/* real-world felt-area anchors (M3 ~15km, barely felt locally; M8.5+ ~500km+, */
/* strongly felt across an entire region — matching e.g. the 2010 and 2016     */
/* Chile megaquakes). This is a visualization heuristic, not a seismological   */
/* instrument, but it's grounded in real relative scale rather than arbitrary  */
/* — so the density map's glow size actually means something physical instead  */
/* of every event getting the same fixed splat regardless of how big it was.   */
function feltRadiusKm(mag) {
  return Math.pow(10, 0.345 + 0.277 * mag);
}
function zoomBtnStyle(C) {
  return {
    width: 24, height: 24, borderRadius: 6, border: `1px solid ${C.border}`, background: C.surface, color: C.text,
    fontSize: 14, lineHeight: 1, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", padding: 0,
  };
}

/* ---------------------------------------------------------------------- */
/* TEMAS — Vampiric Crimson (noche) y Atlas de Campo (día). Cianotipo se  */
/* retiró: dos temas verificados, pensados como par noche/día.            */
/* ---------------------------------------------------------------------- */
const THEMES = {
  crimson: {
    name: "Vampiric Crimson", mode: "dark",
    bg: "#0B0C10", border: "rgba(255,255,255,0.035)", borderHover: "rgba(255,255,255,0.09)", grid: "#252525",
    text: "#EDEAE7", textDim: "#9C9591", textFaint: "#84807B",
    bloodRed: "#8B0000", rose: "#A92424", dotRed: "#FF6B4C",
    regionLow: "#3A0A0A", regionMid: "#B2231F", regionHigh: "#FF1F8F",
    /* 5-stop cool->hot ramp, replacing the old 3-stop red/pink-only density       */
    /* palette — verified monotonic INCREASING lightness (15->39->57->72->77),    */
    /* correct direction for a near-black background (low density blends toward   */
    /* bg, high density stands out brightest). Hot end is a lighter coral rather   */
    /* than a fully-saturated red specifically because pure saturated reds/pinks  */
    /* cap out around L~57-64 in HCL — desaturating slightly was the only way to  */
    /* keep climbing lightness at the hot end without breaking monotonicity.      */
    densityStops: ["#16215C", "#1D5FA0", "#1C9A82", "#E8A23A", "#FFA88F"],
    epicenterCore: "#FFD200", epicenterEdge: "#FFD200",
    alertGreen: "#3FD17A", alertYellow: "#D8B93A", alertOrange: "#E0722A", alertRed: "#8B0000", alertNone: "#8C8680",
    palette: ["#2DD8C9", "#B860F5", "#E8A23A"], cardTint: "rgba(255,255,255,0.012)", glowAlpha: [0.28, 0.10],
    surface: "#161217", surfaceBorder: "rgba(255,255,255,0.12)", surfaceShadow: "rgba(0,0,0,0.5)",
  },
  atlas: {
    name: "Atlas de Campo", mode: "light",
    bg: "#F2ECDC", border: "rgba(36,31,26,0.10)", borderHover: "rgba(36,31,26,0.22)", grid: "#D9CFB8",
    text: "#241F1A", textDim: "#5C5346", textFaint: "#655D4D",
    bloodRed: "#8B2318", rose: "#A8481F", dotRed: "#6B3A56",
    regionLow: "#2A1608", regionMid: "#A8481F", regionHigh: "#E8B23A",
    /* Same 5-stop cool->hot family as crimson, verified monotonic DECREASING     */
    /* lightness (79->54->51->48->26) — correct direction for a light cream       */
    /* background, matching this project's existing convention that atlas ramps   */
    /* run pale->dark while crimson ramps run dark->light (see the earlier         */
    /* "Atlas legend read backwards" fix for why the direction matters).          */
    densityStops: ["#A8C8E8", "#4C86B8", "#1F8A6B", "#A85F1A", "#7A0F14"],
    epicenterCore: "#FF007F", epicenterEdge: "#FF8000",
    alertGreen: "#2F6B38", alertYellow: "#8C6D1F", alertOrange: "#A34E1C", alertRed: "#8B2318", alertNone: "#9C9187",
    palette: ["#2E4374", "#A8481F", "#7A6624"], cardTint: "rgba(36,31,26,0.035)", glowAlpha: [0.07, 0.04],
    surface: "#FBF7EC", surfaceBorder: "rgba(36,31,26,0.14)", surfaceShadow: "rgba(36,31,26,0.18)",
  },
};
const ThemeContext = React.createContext(THEMES.crimson);
const LangContext = React.createContext(STRINGS.es);

const RANGE_MS = { day: 86400000, week: 7 * 86400000, month: 30 * 86400000, year: 365 * 86400000 };
const MAX_COUNTRIES = 3;

/* ---------------------------------------------------------------------- */
/* Registro de países — bbox, ISO3 (para geoBoundaries), coincidencia de  */
/* texto en "place" de USGS, zona horaria y perfil sísmico                */
/* ---------------------------------------------------------------------- */
const COUNTRY_REGISTRY = {
  chile:     { label: "Chile", iso3: "CHL", bbox: { minlatitude: -56, maxlatitude: -17, minlongitude: -76, maxlongitude: -66 }, matches: ["chile"], tz: "America/Santiago", locale: "es-CL", activity: "high", depthProfile: "subduction", tall: true },
  spain:     { label: "España", labelEn: "Spain", iso3: "ESP", bbox: { minlatitude: 27, maxlatitude: 44, minlongitude: -19, maxlongitude: 5 }, matches: ["spain"], tz: "Europe/Madrid", locale: "es-ES", activity: "medium", depthProfile: "shallow" },
  mexico:    { label: "México", labelEn: "Mexico", iso3: "MEX", bbox: { minlatitude: 14, maxlatitude: 33, minlongitude: -118, maxlongitude: -86 }, matches: ["mexico"], tz: "America/Mexico_City", locale: "es-ES", activity: "high", depthProfile: "subduction" },
  peru:      { label: "Perú", labelEn: "Peru", iso3: "PER", bbox: { minlatitude: -19, maxlatitude: 0, minlongitude: -82, maxlongitude: -68 }, matches: ["peru"], tz: "America/Lima", locale: "es-ES", activity: "high", depthProfile: "subduction" },
  japan:     { label: "Japón", labelEn: "Japan", iso3: "JPN", bbox: { minlatitude: 24, maxlatitude: 46, minlongitude: 123, maxlongitude: 146 }, matches: ["japan"], tz: "Asia/Tokyo", locale: "es-ES", activity: "high", depthProfile: "subduction", tall: true },
  indonesia: { label: "Indonesia", iso3: "IDN", bbox: { minlatitude: -11, maxlatitude: 6, minlongitude: 95, maxlongitude: 141 }, matches: ["indonesia"], tz: "Asia/Jakarta", locale: "es-ES", activity: "high", depthProfile: "subduction" },
  turkey:    { label: "Turquía", labelEn: "Turkey", iso3: "TUR", bbox: { minlatitude: 36, maxlatitude: 42, minlongitude: 26, maxlongitude: 45 }, matches: ["turkey"], tz: "Europe/Istanbul", locale: "es-ES", activity: "medium", depthProfile: "shallow" },
  italy:     { label: "Italia", labelEn: "Italy", iso3: "ITA", bbox: { minlatitude: 36, maxlatitude: 47, minlongitude: 6, maxlongitude: 19 }, matches: ["italy"], tz: "Europe/Rome", locale: "es-ES", activity: "medium", depthProfile: "shallow", tall: true },
  greece:    { label: "Grecia", labelEn: "Greece", iso3: "GRC", bbox: { minlatitude: 34, maxlatitude: 42, minlongitude: 19, maxlongitude: 30 }, matches: ["greece"], tz: "Europe/Athens", locale: "es-ES", activity: "medium", depthProfile: "shallow" },
  ecuador:   { label: "Ecuador", iso3: "ECU", bbox: { minlatitude: -5, maxlatitude: 2, minlongitude: -81, maxlongitude: -75 }, matches: ["ecuador"], tz: "America/Guayaquil", locale: "es-ES", activity: "medium", depthProfile: "subduction" },
  colombia:  { label: "Colombia", iso3: "COL", bbox: { minlatitude: -4, maxlatitude: 13, minlongitude: -79, maxlongitude: -66 }, matches: ["colombia"], tz: "America/Bogota", locale: "es-ES", activity: "medium", depthProfile: "subduction" },
  portugal:  { label: "Portugal", iso3: "PRT", bbox: { minlatitude: 36, maxlatitude: 42, minlongitude: -10, maxlongitude: -6 }, matches: ["portugal"], tz: "Europe/Lisbon", locale: "es-ES", activity: "low", depthProfile: "shallow" },
  iceland:   { label: "Islandia", labelEn: "Iceland", iso3: "ISL", bbox: { minlatitude: 63, maxlatitude: 67, minlongitude: -25, maxlongitude: -13 }, matches: ["iceland"], tz: "Atlantic/Reykjavik", locale: "es-ES", activity: "medium", depthProfile: "mixed" },
  usa_ca:    { label: "EE. UU. (California)", labelEn: "USA (California)", iso3: "USA", bbox: { minlatitude: 32, maxlatitude: 42, minlongitude: -125, maxlongitude: -114 }, matches: [", ca", "california"], tz: "America/Los_Angeles", locale: "es-ES", activity: "medium", depthProfile: "shallow" },
};
const DEFAULT_ACTIVE = ["chile", "spain"];

/* COUNTRY_REGISTRY.label is Spanish-only (it's config data, not a UI string   */
/* pulled through STRINGS) — without this, English mode showed "España",      */
/* "México", "Japón" etc. next to otherwise-English UI text. labelEn is only   */
/* set where the English name actually differs from the Spanish one.          */
function countryLabel(id, lang) {
  const cfg = COUNTRY_REGISTRY[id];
  if (!cfg) return id;
  return lang === "en" && cfg.labelEn ? cfg.labelEn : cfg.label;
}

/* ---------------------------------------------------------------------- */
/* RNG determinista para datos de respaldo (si la API no responde)        */
/* ---------------------------------------------------------------------- */
function mulberry32(seed) {
  return function () {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function hashSeed(str) { let h = 0; for (let i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) | 0; return h || 1; }

function generateFallback(id, lang) {
  const cfg = COUNTRY_REGISTRY[id];
  const rng = mulberry32(hashSeed(id));
  const now = Date.now();
  const n = { high: 620, medium: 220, low: 90 }[cfg.activity] || 150;
  const maxMagCap = { high: 8.5, medium: 7.2, low: 6.0 }[cfg.activity] || 6.5;
  const { minlatitude, maxlatitude, minlongitude, maxlongitude } = cfg.bbox;
  const events = [];
  for (let i = 0; i < n; i++) {
    const t = now - rng() * 366 * 86400000;
    const u = rng();
    const mag = +(2.5 + (-Math.log(1 - u * 0.985) / Math.LN10) * 1.15).toFixed(1);
    const magClamped = Math.min(mag, maxMagCap);
    const lat = minlatitude + rng() * (maxlatitude - minlatitude);
    const lon = minlongitude + rng() * (maxlongitude - minlongitude);
    let depth;
    if (cfg.depthProfile === "subduction") { const d = rng(); depth = d < 0.5 ? rng() * 60 : d < 0.8 ? 60 + rng() * 240 : 300 + rng() * 350; }
    else if (cfg.depthProfile === "shallow") { depth = rng() < 0.8 ? rng() * 35 : 35 + rng() * 40; }
    else { depth = rng() * 120; }
    const alertRoll = rng();
    const alert = magClamped < 4 ? "none" : alertRoll < 0.55 ? "none" : alertRoll < 0.8 ? "green" : alertRoll < 0.93 ? "yellow" : alertRoll < 0.985 ? "orange" : "red";
    events.push({
      id: `${id}-fb-${i}`, mag: +magClamped.toFixed(1), magType: magClamped > 4.5 ? "mw" : "ml",
      place: `${countryLabel(id, lang)} (${lang === "en" ? "estimated" : "estimado"})`, time: t, alert,
      felt: alertRoll > 0.85 ? Math.round(rng() * 400) : 0, sig: Math.round(magClamped * 100),
      depth: +depth.toFixed(1), lat, lon, country: id,
    });
  }
  if (id === "spain") {
    events.push({ id: "anchor-1", mag: 4.9, magType: "mww", place: "2 km WSW de Granada, España", time: now - 2 * 3600000, alert: "green", felt: 210, sig: 420, depth: 10, lat: 37.1786, lon: -3.6311, country: "spain" });
    events.push({ id: "anchor-2", mag: 4.6, magType: "mb", place: "5 km ENE de Escúzar, España", time: now - 3 * 3600000, alert: "none", felt: 60, sig: 380, depth: 10, lat: 37.0875, lon: -3.7084, country: "spain" });
  } else if (id === "chile") {
    events.push({ id: "anchor-1", mag: 6.9, magType: "mww", place: "228 km NE de Antofagasta, Chile", time: now - 60 * 86400000, alert: "orange", felt: 900, sig: 780, depth: 110, lat: -22.5, lon: -68.2, country: "chile" });
  }
  return events;
}

async function fetchCountryData(id) {
  const cfg = COUNTRY_REGISTRY[id];
  const end = new Date();
  const start = new Date(end.getTime() - 366 * 86400000);
  const fmt = (d) => d.toISOString().slice(0, 10);
  const b = cfg.bbox;
  const url = `https://earthquake.usgs.gov/fdsnws/event/1/query?format=geojson&starttime=${fmt(start)}&endtime=${fmt(end)}&minlatitude=${b.minlatitude}&maxlatitude=${b.maxlatitude}&minlongitude=${b.minlongitude}&maxlongitude=${b.maxlongitude}&minmagnitude=2.5&orderby=time&limit=2000`;
  const res = await fetch(url);
  if (!res.ok) throw new Error("network");
  const json = await res.json();
  const events = (json.features || [])
    .filter((f) => f.properties.place && cfg.matches.some((m) => f.properties.place.toLowerCase().includes(m)))
    .map((f) => ({
      id: f.id, mag: f.properties.mag, magType: f.properties.magType || "?",
      place: f.properties.place, time: f.properties.time, alert: f.properties.alert || "none",
      felt: f.properties.felt || 0, tsunami: f.properties.tsunami, sig: f.properties.sig,
      depth: f.geometry.coordinates[2], lon: f.geometry.coordinates[0], lat: f.geometry.coordinates[1],
      country: id,
    }));
  if (!events.length) throw new Error("empty");
  return events;
}

/* ---------------------------------------------------------------------- */
/* Límites geográficos en vivo — geoBoundaries (CC-BY 4.0), sin API key.  */
/* Se piden solo cuando el país está activo (ADM0) o cuando se abre la    */
/* pestaña de regiones (ADM1) — no se precargan los 14 países.            */
/* ---------------------------------------------------------------------- */
/* geoBoundaries' metadata points at github.com/<owner>/<repo>/raw/<ref>/<path>.   */
/* Two problems, discovered by testing against the live API (this was previously  */
/* untested — sandboxed dev couldn't reach either domain):                        */
/*  1. That URL 302-redirects, and the redirect response itself carries an empty  */
/*     Access-Control-Allow-Origin header, which browsers treat as invalid and    */
/*     block outright, even though the final destination's headers are fine.     */
/*  2. The files are Git-LFS-tracked, so raw.githubusercontent.com/jsDelivr/etc.  */
/*     only serve the small LFS pointer text, not the actual geometry — the real  */
/*     bytes live on media.githubusercontent.com under the *full* commit SHA,     */
/*     while geoBoundaries' metadata only gives a short SHA.                      */
/* Fix: resolve the short SHA via the CORS-enabled api.github.com commits         */
/* endpoint, then build the media.githubusercontent.com URL directly — skips the  */
/* broken redirect entirely and lands on real content.                           */
function toMediaGithubUsercontent(url) {
  const m = /^https:\/\/github\.com\/([^/]+)\/([^/]+)\/raw\/([^/]+)\/(.+)$/.exec(url);
  return m ? { owner: m[1], repo: m[2], ref: m[3], path: m[4] } : null;
}

/* geoBoundaries' shapeName strings are shipped already double-UTF-8-encoded in    */
/* the source files themselves (confirmed by inspecting the raw response bytes —   */
/* not a decoding bug on our end, fetch's .json() always reads UTF-8 correctly).   */
/* Each accented char got its correct UTF-8 bytes re-encoded a second time as if   */
/* they were Latin-1, e.g. "ó" (bytes C3 B3) became the two characters "Ã" + "³"   */
/* (codepoints C3, B3 read back as Latin-1). Reversing it: read each JS char's     */
/* codepoint back as a raw byte, then UTF-8-decode that byte sequence for real.    */
function fixMojibake(str) {
  if (typeof str !== "string" || !/[-ÿ]/.test(str)) return str;
  if (/[^\u0000-ÿ]/.test(str)) return str;
  try {
    const bytes = Uint8Array.from(str, (c) => c.charCodeAt(0));
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return str;
  }
}

function fixShapeNames(gj) {
  if (!gj || !Array.isArray(gj.features)) return gj;
  gj.features.forEach((f) => {
    if (f.properties && typeof f.properties.shapeName === "string") {
      f.properties.shapeName = fixMojibake(f.properties.shapeName);
    }
  });
  return gj;
}

/* Country/region borders essentially never change, and GitHub's unauthenticated  */
/* API is rate-limited per CALLING IP across ALL of api.github.com — not per-app  */
/* — so every uncached fetch here spends a slice of a real visitor's shared quota */
/* on something that didn't need to change. Cache the fully-processed result     */
/* (post fixRingWinding/fixShapeNames) in localStorage indefinitely; no TTL, since*/
/* guessing a "correct" expiry is worse than just bumping BOUNDARY_CACHE_VERSION  */
/* by hand if the fetch/fix pipeline itself ever changes and old cached entries   */
/* need invalidating. Failure to read/write the cache is never fatal — it's a     */
/* nice-to-have, not a requirement, so every localStorage call is wrapped.        */
const BOUNDARY_CACHE_VERSION = 1;
const boundaryCacheKey = (iso3, level) => `boundary-cache-v${BOUNDARY_CACHE_VERSION}-${iso3}-${level}`;

function readBoundaryCache(iso3, level) {
  try {
    const raw = localStorage.getItem(boundaryCacheKey(iso3, level));
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function writeBoundaryCache(iso3, level, gj) {
  try {
    localStorage.setItem(boundaryCacheKey(iso3, level), JSON.stringify(gj));
  } catch {
    /* localStorage full, disabled, or unavailable (private browsing) — ignore. */
  }
}

async function fetchBoundary(iso3, level) {
  const cached = readBoundaryCache(iso3, level);
  if (cached) return cached;
  const metaRes = await fetch(`https://www.geoboundaries.org/api/current/gbOpen/${iso3}/${level}/`);
  if (!metaRes.ok) throw new Error("meta");
  const meta = await metaRes.json();
  const geomUrl = meta.simplifiedGeometryGeoJSON || meta.gjDownloadURL;
  if (!geomUrl) throw new Error("no-url");
  const parsed = toMediaGithubUsercontent(geomUrl);
  let finalUrl = geomUrl;
  if (parsed) {
    const shaRes = await fetch(`https://api.github.com/repos/${parsed.owner}/${parsed.repo}/commits/${parsed.ref}`);
    if (!shaRes.ok) throw new Error("sha");
    const { sha } = await shaRes.json();
    finalUrl = `https://media.githubusercontent.com/media/${parsed.owner}/${parsed.repo}/${sha}/${parsed.path}`;
  }
  const geomRes = await fetch(finalUrl);
  if (!geomRes.ok) throw new Error("geom");
  const gj = await geomRes.json();
  const fixed = fixRingWinding(fixShapeNames(gj));
  writeBoundaryCache(iso3, level, fixed);
  return fixed;
}

/* geoBoundaries' ADM0 files ship with every disjoint ring (mainland, each island)  */
/* wound clockwise — the opposite of GeoJSON's right-hand-rule spec, which d3-geo   */
/* follows strictly. A backwards ring reads to d3 as "the entire globe except this  */
/* landmass", so fitSize (and geoBounds/geoArea generally) zooms out to near-planet */
/* scale instead of the country. Confirmed empirically: Chile's ADM0 has 163 rings, */
/* and d3.geoArea(whole file) ≈ 163 × 4π steradians — i.e. every single ring reads  */
/* as "the whole sphere minus itself". Fix each ring independently (some countries' */
/* holes, if any, are correctly the opposite orientation of their exterior, so a    */
/* per-ring area check — not a per-feature one — is what's actually safe here).    */
function fixRingWinding(gj) {
  if (!gj || !gj.features) return gj;
  const fixRings = (rings) => rings.map((ring) =>
    geoArea({ type: "Polygon", coordinates: [ring] }) > 2 * Math.PI ? ring.slice().reverse() : ring);
  return {
    ...gj,
    features: gj.features.map((f) => {
      const g = f.geometry;
      if (!g) return f;
      if (g.type === "Polygon") return { ...f, geometry: { ...g, coordinates: fixRings(g.coordinates) } };
      if (g.type === "MultiPolygon") return { ...f, geometry: { ...g, coordinates: g.coordinates.map(fixRings) } };
      return f;
    }),
  };
}

/* Picks the largest polygon ring (by bbox area) out of a Feature/FeatureCollection, */
/* to use as the fit target for the map scale — see comment at the call site.       */
function mainlandRing(gj) {
  if (!gj) return null;
  let best = null, bestArea = -1;
  (gj.features || [gj]).forEach((f) => {
    const g = f && f.geometry;
    if (!g) return;
    const polys = g.type === "Polygon" ? [g.coordinates] : g.type === "MultiPolygon" ? g.coordinates : [];
    polys.forEach((coords) => {
      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
      coords[0].forEach(([x, y]) => { if (x < minX) minX = x; if (x > maxX) maxX = x; if (y < minY) minY = y; if (y > maxY) maxY = y; });
      const area = (maxX - minX) * (maxY - minY);
      if (area > bestArea) { bestArea = area; best = coords; }
    });
  });
  return best ? { type: "Feature", properties: {}, geometry: { type: "Polygon", coordinates: best } } : null;
}

/* [minX, minY, maxX, maxY] of a Polygon/MultiPolygon geometry — used as a cheap  */
/* pre-filter in front of the expensive geoContains() ray-cast (see regionCounts  */
/* in CountryMapCard). A plain flat coordinate scan, deliberately not going       */
/* through d3.geoBounds — that's the same function whose backwards-ring-winding   */
/* interpretation caused the original planet-scale map bug, and it's not needed   */
/* here anyway since a bbox check doesn't care about a ring's winding direction.  */
function geometryBBox(geometry) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  const walk = (coords, depth) => {
    if (depth === 0) { const [x, y] = coords; if (x < minX) minX = x; if (x > maxX) maxX = x; if (y < minY) minY = y; if (y > maxY) maxY = y; return; }
    coords.forEach((c) => walk(c, depth - 1));
  };
  const depth = geometry.type === "Polygon" ? 2 : geometry.type === "MultiPolygon" ? 3 : -1;
  if (depth >= 0) walk(geometry.coordinates, depth);
  return [minX, minY, maxX, maxY];
}

/* ---------------------------------------------------------------------- */
/* Utilidades de formato                                                   */
/* ---------------------------------------------------------------------- */
function fmtLocalTime(ms, id, lang) {
  const cfg = COUNTRY_REGISTRY[id];
  return new Date(ms).toLocaleString(lang === "en" ? "en-US" : cfg.locale, { timeZone: cfg.tz, day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
}
function fmtAxisTime(ms, granularity, lang) {
  const d = new Date(ms);
  const loc = lang === "en" ? "en-US" : "es-ES";
  if (granularity === "hour") return d.toLocaleTimeString(loc, { hour: "2-digit", minute: "2-digit" });
  return d.toLocaleDateString(loc, { day: "2-digit", month: "short" });
}

/* ---------------------------------------------------------------------- */
/* Estilos y componentes compartidos                                       */
/* ---------------------------------------------------------------------- */
function getGlassCard(C) {
  return { background: C.cardTint, backdropFilter: "blur(18px)", WebkitBackdropFilter: "blur(18px)", border: `1px solid ${C.border}`, borderRadius: 20, padding: "20px 20px 12px", boxShadow: "0 2px 16px rgba(0,0,0,0.15)" };
}

function SectionGroup({ eyebrow, title, children }) {
  const C = React.useContext(ThemeContext);
  return (
    <div className="fadeUp" style={{ display: "flex", flexDirection: "column", gap: 18 }}>
      <div>
        <div style={{ fontSize: 10.5, letterSpacing: 2.5, color: C.rose, fontFamily: "'JetBrains Mono', monospace", marginBottom: 4, textTransform: "uppercase" }}>{eyebrow}</div>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <h2 style={{ margin: 0, fontFamily: "'Chakra Petch', sans-serif", fontSize: 19, color: C.text, fontWeight: 600 }}>{title}</h2>
          <div style={{ flex: 1, height: 1, background: `linear-gradient(90deg, ${C.rose}66, transparent)` }} />
        </div>
      </div>
      {children}
    </div>
  );
}

function ChartCard({ title, subtitle, children, wide }) {
  const C = React.useContext(ThemeContext);
  return (
    <div className="glassHover" style={{ ...getGlassCard(C), gridColumn: wide ? "1 / -1" : undefined }}>
      <div style={{ marginBottom: 8 }}>
        <h3 style={{ margin: 0, fontFamily: "'Chakra Petch', sans-serif", fontSize: 16, letterSpacing: 0.4, color: C.text, textTransform: "uppercase" }}>{title}</h3>
        {subtitle && <p style={{ margin: "4px 0 0", fontSize: 12.5, color: C.textDim, maxWidth: 640 }}>{subtitle}</p>}
      </div>
      {children}
    </div>
  );
}

function SegmentedControl({ options, value, onChange }) {
  const C = React.useContext(ThemeContext);
  const idx = Math.max(0, options.findIndex(([k]) => k === value));
  return (
    <div className="segTrack" style={{ borderColor: C.border }}>
      <div className="segThumb" style={{ left: `calc(${(idx / options.length) * 100}% + 3px)`, width: `calc(${100 / options.length}% - 6px)`, background: `linear-gradient(135deg, ${C.bloodRed}, ${C.rose})`, boxShadow: `0 0 10px ${withAlpha(C.bloodRed, 0.5)}` }} />
      {options.map(([k, l]) => (
        <button key={k} type="button" className={`segBtn${value === k ? " active" : ""}`} style={{ color: value === k ? "#fff" : C.textDim }} onClick={() => onChange(k)}>{l}</button>
      ))}
    </div>
  );
}

function SeismicTrace() {
  const C = React.useContext(ThemeContext);
  return (
    <svg viewBox="0 0 600 28" preserveAspectRatio="none" style={{ width: "100%", height: 22, display: "block", opacity: 0.55 }}>
      <path className="traceLine" fill="none" stroke={C.rose} strokeWidth="1.2"
        d="M0,14 L20,14 L28,4 L36,24 L44,10 L52,14 L90,14 L98,6 L104,22 L110,14 L160,14 L168,2 L176,26 L182,14 L230,14 L236,9 L242,19 L250,14 L320,14 L328,3 L336,25 L344,14 L400,14 L408,7 L414,21 L420,14 L480,14 L488,1 L496,27 L504,14 L560,14 L568,8 L574,20 L580,14 L600,14" />
    </svg>
  );
}

function DayNightToggle({ mode, onToggle }) {
  const C = React.useContext(ThemeContext);
  const t = React.useContext(LangContext);
  const isDay = mode === "light";
  return (
    <button type="button" onClick={onToggle} title={t.themeToggleHint} aria-label={isDay ? t.nightMode : t.dayMode}
      style={{
        display: "flex", alignItems: "center", gap: 8, padding: "6px 12px", borderRadius: 999, cursor: "pointer",
        border: `1px solid ${C.borderHover}`, background: "rgba(128,128,128,0.06)", color: C.text,
        fontFamily: "'JetBrains Mono', monospace", fontSize: 12,
      }}>
      <span style={{ width: 16, height: 16, borderRadius: "50%", position: "relative", background: isDay ? "#E8B23A" : "#0B0C10", border: `1px solid ${C.borderHover}`, boxShadow: isDay ? "0 0 8px #E8B23A99" : "inset 3px -2px 0 0 rgba(255,255,255,0.15)", flexShrink: 0 }} />
      {isDay ? t.dayMode : t.nightMode}
    </button>
  );
}

function StatChip({ label, value, accent }) {
  const C = React.useContext(ThemeContext);
  return (
    <div className="chipHover" style={{ background: "rgba(128,128,128,0.06)", border: `1px solid ${C.border}`, borderRadius: 12, padding: "10px 14px", minWidth: 118, flex: "1 1 118px", display: "flex", flexDirection: "column" }}>
      {/* minHeight reserves room for a 2-line label (e.g. "MAX. MAGNITUDE") so the  */}
      {/* value below starts at the same Y across every card in the row, regardless */}
      {/* of whether THIS card's own label happens to wrap to 1 line or 2.          */}
      <div style={{ fontSize: 11, color: C.textDim, textTransform: "uppercase", letterSpacing: 0.5, minHeight: 28, display: "flex", alignItems: "flex-start" }}>{label}</div>
      <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 19, color: accent || C.text, marginTop: 2 }}>{value}</div>
    </div>
  );
}

function StatusBadge({ status }) {
  const C = React.useContext(ThemeContext);
  const t = React.useContext(LangContext);
  const map = {
    loading: { label: t.statusLoading, color: C.textDim, pulse: false },
    live: { label: t.statusLive, color: C.palette[0], pulse: true },
    fallback: { label: t.statusFallback, color: C.alertYellow, pulse: false },
  };
  const s = map[status] || map.loading;
  return (
    <span style={{ fontSize: 11.5, color: s.color, fontFamily: "'JetBrains Mono', monospace", display: "inline-flex", alignItems: "center", gap: 6 }}>
      <span className={s.pulse ? "liveDot" : undefined} style={{ width: 7, height: 7, borderRadius: "50%", background: s.color, display: "inline-block" }} />
      {s.label}
    </span>
  );
}

function getTooltipStyle(C) {
  return { background: C.surface, border: `1px solid ${C.surfaceBorder}`, borderRadius: 10, fontSize: 12.5, color: C.text, padding: "8px 12px", boxShadow: `0 8px 24px ${C.surfaceShadow}` };
}

/* Foreground colors for alert-level text on the tooltip's own C.surface —   */
/* distinct from C.alert* (tuned as badge/marker fills against the page bg), */
/* verified separately so labels stay legible against the elevated surface   */
/* in both themes.                                                          */
const ALERT_SURFACE_TEXT = {
  crimson: { green: "#7CE3A6", yellow: "#E8D577", orange: "#F2A366", red: "#FF6B6B", none: "#FFFFFF" },
  atlas: { green: "#2F6B38", yellow: "#8C6D1F", orange: "#A34E1C", red: "#8B2318", none: "#5C5346" },
};

function AlertTooltip({ active, payload }) {
  const C = React.useContext(ThemeContext);
  const alertText = ALERT_SURFACE_TEXT[C.mode === "light" ? "atlas" : "crimson"];
  if (!active || !payload || !payload.length) return null;
  const p = payload[0].payload;
  return (
    <div style={getTooltipStyle(C)}>
      <span style={{ color: alertText[p.key], fontWeight: 600 }}>{p.name}</span>
      <span style={{ color: C.textDim }}> — {p.value}</span>
    </div>
  );
}

/* Real geographic density surface — a 2D kernel density estimate (KDE) over    */
/* the event points, rendered as filled contour bands (same technique real      */
/* mapping tools use for point-density heatmaps). Each point gets ITS OWN       */
/* kernel radius (from `feltRadiusKm` via magnitude — see `projected` in        */
/* CountryMapCard), which `d3.contourDensity()` can't do (one global bandwidth  */
/* for every point). So this computes the density grid by hand: splat each      */
/* point's own Gaussian onto a coarse grid (only within its own reach, not the  */
/* whole grid — keeps this to O(points x own kernel area), not O(points x grid) */
/* ), then hands the raw grid to `d3.contours()` (the lower-level generator     */
/* that operates on a value array; `contourDensity` is the point-input wrapper  */
/* around it that always uses one shared bandwidth). Contours are in ascending  */
/* threshold order, so painting them low-to-high naturally layers smaller,      */
/* hotter regions on top of larger, cooler ones with no extra work. Colored     */
/* with densityRamp() (the Density surface's own violet/magenta palette, see   */
/* the token comment near its definition) so band-to-band steps are real       */
/* computed intensity, not visual noise from overlapping shapes.               */
/* Pulled out of DensitySurface so CountryMapCard can memoize it at ITS OWN      */
/* level (see densityData there) instead of DensitySurface's own useMemo, which */
/* only lives as long as DensitySurface stays mounted — since it's only mounted */
/* while mapView === "density", switching tabs away and back was unmounting and */
/* remounting it, throwing away the memo and recomputing this whole KDE grid    */
/* from scratch every single time, even with unchanged events. That's the real  */
/* cause of the "Density tab freezes on switch" symptom — regionCounts doesn't  */
/* have this problem because it already lives in CountryMapCard directly.       */
/* Pre-clusters events close enough their Gaussians would heavily overlap anyway  */
/* under the max()-combine rule below — a tight swarm of many small events        */
/* (aftershock sequences are exactly this) otherwise costs one full splat per      */
/* individual point even though max() means their combined contribution is        */
/* visually near-identical to just the strongest one among them once they         */
/* overlap that much. Binning to a small FIXED grid (independent of the main      */
/* density grid, and not scaled per point) only merges points that are genuinely  */
/* close in screen space — an isolated/large event rarely shares a bin with       */
/* anything and comes through untouched. This cuts computational point count      */
/* roughly in proportion to how clustered the real data is, without dropping a    */
/* single real event from the underlying data: bubbles/lists elsewhere still show */
/* every individual event, only this internal density-estimation step simplifies. */
function clusterDensityPoints(pts) {
  const binPx = 6;
  const bins = new Map();
  pts.forEach((p) => {
    const key = `${Math.round(p.x / binPx)},${Math.round(p.y / binPx)}`;
    const existing = bins.get(key);
    if (!existing) { bins.set(key, { x: p.x, y: p.y, r: p.r, w: p.w, n: 1, sx: p.x, sy: p.y }); return; }
    existing.n += 1;
    existing.sx += p.x; existing.sy += p.y;
    existing.x = existing.sx / existing.n; existing.y = existing.sy / existing.n;
    existing.r = Math.max(existing.r, p.r);
    existing.w = Math.max(existing.w, p.w);
  });
  return Array.from(bins.values());
}

const DENSITY_CELL_PX = 3;
function computeDensityContours(rawPts, w, h) {
  const cellPx = DENSITY_CELL_PX;
  if (rawPts.length < 1) return { contours: [], padCells: 0 };
  const pts = clusterDensityPoints(rawPts);
  const maxR = Math.max(20, ...pts.map((p) => p.r || 20));
    /* Same reasoning as before: pad past any single point's own kernel reach so */
    /* it fades near-zero before the true edge, instead of getting hard-cut.     */
    const padCells = Math.ceil((maxR * 2.5) / cellPx);
    const nx = Math.max(1, Math.ceil(w / cellPx)), ny = Math.max(1, Math.ceil(h / cellPx));
    const gridW = nx + padCells * 2, gridH = ny + padCells * 2;
    const grid = new Float64Array(gridW * gridH);
    /* SUM, not max — reversed on explicit request (2026-08-21): two epicenters     */
    /* close together should visibly connect, brightening where their fields        */
    /* overlap, like water mixing or a metaball/neuron-bridge effect — max() can't   */
    /* produce that structurally, it only ever shows whichever single point is       */
    /* locally strongest, never their combination. The earlier max()-based version   */
    /* existed specifically because a naive uncapped sum blew a tight cluster out    */
    /* to one flat saturated blob with no internal shape (documented below at the    */
    /* compression step) — the fix for THAT problem is compressing the accumulated   */
    /* value afterward, not avoiding accumulation altogether.                        */
    pts.forEach((p) => {
      /* Widened back toward the original 0.45 (was tightened to 0.35 specifically   */
      /* to stop bridging under max()-combine, which read as an unwanted "instant    */
      /* merge" back then). Now that bridging between close points is the explicit   */
      /* goal, a narrower kernel would prevent the visible connecting bridge from     */
      /* forming between moderately-close (not just touching) events.                */
      const sigmaPx = Math.max(3, (p.r || 20) * 0.45);
      const sigmaCells = sigmaPx / cellPx;
      const weight = Math.min(0.9, 0.55 + (p.w || 0) * 0.35);
      const cx = p.x / cellPx + padCells, cy = p.y / cellPx + padCells;
      const reach = Math.ceil(sigmaCells * 3);
      const x0 = Math.max(0, Math.floor(cx - reach)), x1 = Math.min(gridW - 1, Math.ceil(cx + reach));
      const y0 = Math.max(0, Math.floor(cy - reach)), y1 = Math.min(gridH - 1, Math.ceil(cy + reach));
      const denom = 2 * sigmaCells * sigmaCells;
      for (let gy = y0; gy <= y1; gy++) {
        const dy = gy - cy;
        const rowOff = gy * gridW;
        for (let gx = x0; gx <= x1; gx++) {
          const dx = gx - cx;
          const contribution = weight * Math.exp(-(dx * dx + dy * dy) / denom);
          grid[rowOff + gx] += contribution;
        }
      }
    });
    /* Compress the accumulated field (sqrt, i.e. gamma=0.5) so a genuinely dense    */
    /* swarm still reads as brighter than a lone event — satisfying "the more        */
    /* concentrated, the brighter" — WITHOUT the naive-sum failure mode: raw linear   */
    /* addition across a 20-event swarm would push that whole area to many multiples */
    /* of a single point's peak, and since color/alpha map against this render's OWN  */
    /* max (below), that swarm would fill nearly its whole footprint at max intensity */
    /* with no visible internal shape left — the same "flat solid blob" problem the   */
    /* original max()-only version was built to avoid. sqrt is monotonic (relative    */
    /* ordering — and therefore the internal texture within a cluster — is fully      */
    /* preserved), it just tames how fast the value climbs as more events overlap.    */
    for (let i = 0; i < grid.length; i++) grid[i] = Math.sqrt(grid[i]);
    /* Many thresholds (not the earlier 8) so bands step in fine enough           */
    /* increments to read as a smooth continuous gradient rather than visible     */
    /* rings — this is the "blend more" fix; it's a resolution knob, not a       */
    /* different technique.                                                      */
    /* Explicit threshold VALUES, not a bare count: passing a count lets d3      */
    /* auto-pick "nice" round numbers across [min,max], and since most of this   */
    /* grid is untouched exact 0 (nothing splatted there), that nice-number      */
    /* sequence can include 0 itself — a "density >= 0" contour is true          */
    /* everywhere, so it fills the ENTIRE grid as one solid block. Building the  */
    /* thresholds ourselves, strictly greater than 0, avoids that entirely.      */
    let maxVal = 0;
    for (let i = 0; i < grid.length; i++) if (grid[i] > maxVal) maxVal = grid[i];
    if (maxVal <= 0) return { contours: [], padCells, maxVal: 0 };
    /* Threshold spacing is sqrt-scaled (gamma < 1), not linear: a big magnitude   */
    /* event's peak sets maxVal, and a much weaker/isolated event's own peak might */
    /* only be a small fraction of that. Evenly-LINEAR thresholds from 0 to maxVal */
    /* would then cross that weak event's whole range in just 1-2 steps — it reads */
    /* as a single flat-colored disc with no internal gradient, and its edge just  */
    /* disappears rather than fading. Packing more thresholds into the low end     */
    /* gives every event, strong or weak, enough bands to show a real soft falloff */
    /* — this is the "make them blend and fade" fix.                              */
    /* Also needs fine resolution at the HIGH end (near t=1) — that's where        */
    /* densityColor() blends to yellow, and a Gaussian is flattest right at its    */
    /* own peak, so without enough thresholds there, only one or two huge bands    */
    /* cover that whole region and yellow ends up covering way more area than      */
    /* intended. A cosine ease (dense at both ends, sparse in the middle, where    */
    /* the extra resolution isn't needed) covers both cases with one formula.      */
    /* Fewer bands, not more: every contour band is a NESTED shape painted over the */
    /* ones below it, and even a low-alpha band still adds SOME opacity wherever it */
    /* covers — with dozens of bands all overlapping at any given point, that       */
    /* stacks into much higher effective opacity than any single band's alpha       */
    /* value suggests (compositing N thin layers approaches 1-(1-a)^N, not just a). */
    /* That's what made moderate-density areas stay "bright" despite a steep alpha  */
    /* curve — more thresholds didn't mean smoother, it meant more compounding.     */
    const levels = 22;
    const thresholds = Array.from({ length: levels }, (_, i) => maxVal * (0.5 - 0.5 * Math.cos(Math.PI * (i + 1) / levels)));
    const cs = d3contours().size([gridW, gridH]).thresholds(thresholds)(grid);
    return { contours: cs, padCells, maxVal };
}

/* Pure rendering — no computation here. contours/padCells now come in as props, */
/* computed once by CountryMapCard's own densityData useMemo (see there) so this */
/* component's own mount/unmount lifecycle (tied to mapView === "density") can't */
/* throw the expensive part away. See computeDensityContours() above for why.    */
function DensitySurface({ contours, padCells, maxVal, w, h }) {
  const C = React.useContext(ThemeContext);
  const cellPx = DENSITY_CELL_PX;
  if (!contours.length) return null;
  const contourPath = geoPath();
  const uid = `${Math.round(w)}-${Math.round(h)}`;
  const clipId = `dclip-${uid}`;
  const maskId = `dmask-${uid}`;
  const blurId = `dblur-${uid}`;
  const smoothId = `dsmooth-${uid}`;
  const padPx = padCells * cellPx;
  /* Tied to padPx (which itself scales with the largest point's own kernel      */
  /* radius), not just a fixed fraction of the card — a wide-felt-radius event   */
  /* near the edge needs a proportionally wider fade zone than the card-size-    */
  /* only formula gave it, or the vignette's blur doesn't reach far enough to    */
  /* actually soften that specific crossing.                                    */
  const fadeWidth = Math.max(24, Math.min(w, h) * 0.1, padPx * 0.6);

  /* No nested <svg> here — a nested SVG's percentage width/height resolves      */
  /* against an ambient viewport that this browser sizes unpredictably small,    */
  /* so content drawn inside it can overflow its own box and bleed past the      */
  /* visible card edge. Bubbles and region paths never hit this because they     */
  /* draw straight into the shared coordinate space; do the same here.          */
  /* The hard rect clip alone isn't sufficient: an event genuinely located near  */
  /* the edge of the country's bounding box (real example — an offshore Japan    */
  /* Trench earthquake right at Japan's east edge) has a hot CORE that legitimately */
  /* extends past the visible frame, not just a decayed tail — no amount of KDE  */
  /* padding fixes that, since the padding only helps the falloff, not the peak. */
  /* A soft mask that fades opacity to zero within the last ~10% of each edge    */
  /* turns that unavoidable crossing into a vignette instead of a hard slice —   */
  /* built the standard way: a blurred black frame-stroke subtracted from a      */
  /* white field, used as a luminance mask.                                     */
  return (
    <>
      <defs>
        <clipPath id={clipId}><rect x="0" y="0" width={w} height={h} /></clipPath>
        <filter id={blurId} x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation={fadeWidth * 0.4} /></filter>
        {/* Smooths the blocky/angular polygon edges marching-squares produces at the */}
        {/* small, coarse-grid contour bands near the hot core (each grid cell here   */}
        {/* is cellPx=3 real pixels — a tight, few-cell-wide band literally can't      */}
        {/* trace a smooth circle at that resolution). Cheaper than raising grid       */}
        {/* resolution, and fixes the actual artifact (jagged polygon edges), not      */}
        {/* just its symptom.                                                         */}
        <filter id={smoothId} x="-30%" y="-30%" width="160%" height="160%"><feGaussianBlur stdDeviation="0.6" /></filter>
        <mask id={maskId} maskUnits="userSpaceOnUse" x="0" y="0" width={w} height={h}>
          <rect x="0" y="0" width={w} height={h} fill="white" />
          <rect x="0" y="0" width={w} height={h} fill="none" stroke="black" strokeWidth={fadeWidth} filter={`url(#${blurId})`} />
        </mask>
      </defs>
      <g clipPath={`url(#${clipId})`} mask={`url(#${maskId})`} filter={`url(#${smoothId})`}>
        <g transform={`translate(${-padPx},${-padPx}) scale(${cellPx})`}>
          {contours.map((c, i) => {
            /* Normalized against THIS RENDER'S OWN maxVal now, not a fixed ceiling —      */
            /* deliberately reversed from the old fixed-ceiling design (2026-08-21): the    */
            /* whole point of switching the grid combine from max() to a compressed sum      */
            /* (see computeDensityContours) was to make "more concentrated = visibly         */
            /* brighter" actually show up. A fixed ceiling of 1 would have defeated that —    */
            /* a genuinely dense cluster's compressed sum can exceed what any single point    */
            /* alone reaches, and comparing it against a flat 1 (rather than the map's own    */
            /* peak) would clip everything above that ceiling to the same "hottest" color,     */
            /* losing exactly the differentiation this change exists to create.               */
            const t = maxVal > 0 ? Math.min(1, c.value / maxVal) : 0;
            /* REPLACED the old pow(t,6)*0.65 curve (2026-08-21) — it was tuned for a          */
            /* completely different goal (a soft glow where only the hot core should read as   */
            /* solid, everything else dissipates) that no longer applies now that the field is  */
            /* meant to look like a real multi-band heatmap (distinct visible color at every    */
            /* density level, matching real KDE/contour tools). That exponent-6 curve was so     */
            /* steep it made every band except the very peak nearly invisible — verified         */
            /* numerically, accounting for how the 22 nested threshold bands actually composite  */
            /* together (effective opacity = 1 - product(1-alpha) across every band whose        */
            /* threshold the point clears): the old curve gave ~1.6% effective opacity at t=0.5   */
            /* and ~8% at t=0.7 — exactly "I don't see the other colors, just a stain with a      */
            /* halo". This curve was tuned the same way (composited, not just the raw per-band    */
            /* value) to land near 18%/40%/64%/85% effective opacity at t=0.2/0.5/0.85/1.0 —      */
            /* every band clearly visible, peak strong but still short of fully solid so          */
            /* epicenter markers stay the highest-contrast thing on top of it.                    */
            const alpha = 0.025 + Math.pow(t, 1.1) * 0.11;
            return <path key={i} d={contourPath(c)} fill={densityRamp(C, t)} fillOpacity={alpha} stroke="none" />;
          })}
        </g>
      </g>
    </>
  );
}

function hexToRgb(hex) { const m = hex.replace("#", ""); return { r: parseInt(m.substring(0, 2), 16), g: parseInt(m.substring(2, 4), 16), b: parseInt(m.substring(4, 6), 16) }; }
function withAlpha(hex, a) { const { r, g, b } = hexToRgb(hex); return `rgba(${r},${g},${b},${a})`; }

/* Perceptually-uniform sequential scale, built from REAL published colormap    */
/* data (matplotlib/ParaView), not hand-picked hex values — per Kenneth         */
/* Moreland's color-advice guidance (kennethmoreland.com/color-advice), which   */
/* recommends Inferno/Magma/Black Body for 2D data like this over plain         */
/* Viridis, which it specifically flags as having "not as much discrimination"  */
/* between levels — the opposite of what a density map needs.                  */
/* Two SEPARATE token sets, both run through this same HCL ramp — they used to */
/* share one (heatLow/Mid/High), which meant changing the Density palette      */
/* silently reskinned Regions too, without anyone asking for that. Interpolated */
/* in HCL (cylindrical Lab) rather than raw RGB, so equal steps in value        */
/* correspond to equal steps in perceived intensity instead of the muddy       */
/* midpoints a straight RGB lerp produces.                                     */
/* - regionLow/Mid/High: the Regions choropleth's own palette (dark red/brown  */
/*   -> escalating red/orange -> hot pink/gold) — this is the original ramp    */
/*   from before the Density rework and should stay that way unless asked.     */
/* - densityStops: the Density surface's own 5-stop cool->hot palette, superseding */
/*   the earlier 3-stop violet/magenta-only version at the user's explicit request */
/*   for a richer ramp (referencing real KDE/metaball heatmap tools) once true      */
/*   accumulation (see computeDensityContours) made a wider range of values worth   */
/*   distinguishing.                                                               */
function colorRamp(low, mid, high, t) {
  const tc = Math.min(1, Math.max(0, t));
  const lo = interpolateHcl(low, mid);
  const hi = interpolateHcl(mid, high);
  return tc < 0.5 ? lo(tc / 0.5) : hi((tc - 0.5) / 0.5);
}
/* N-stop version of colorRamp above, for densityStops (5 colors) instead of a     */
/* fixed low/mid/high triple — walks the segment the given t falls into and         */
/* interpolates in HCL within just that segment, same equal-perceptual-step         */
/* reasoning as colorRamp.                                                          */
function multiColorRamp(stops, t) {
  const tc = Math.min(1, Math.max(0, t));
  const segments = stops.length - 1;
  const scaled = tc * segments;
  const i = Math.min(segments - 1, Math.floor(scaled));
  const localT = scaled - i;
  return interpolateHcl(stops[i], stops[i + 1])(localT);
}
function densityRamp(C, t) {
  return multiColorRamp(C.densityStops, t);
}
function regionColor(C, v, max) {
  const t = Math.min(1, v / max);
  if (t === 0) return "rgba(128,128,128,0.06)";
  return colorRamp(C.regionLow, C.regionMid, C.regionHigh, t);
}


/* Shared docked list panel — same component, same position/sizing/styling, used  */
/* by all 3 map tabs so switching between them doesn't change the card's height   */
/* or jump the layout around. title/count/events vary per tab (Regiones passes    */
/* the currently-selected region's own list; Epicentros/Densidad pass every event */
/* currently on the map); the sort toggle and collapse behavior are identical     */
/* everywhere, not three separate implementations of the same idea.               */
/* A country like Chile/Japan/Indonesia over "Último año" can have 500+ events —  */
/* nobody wants to scroll a 130px box through that many, and it's a real DOM-node */
/* cost for no benefit once you're well past what anyone will actually scroll to. */
/* Capped, not hidden silently: shows exactly how many are cut off, and the cap   */
/* applies AFTER sorting, so "top 100 by magnitude" or "100 most recent" is still */
/* the true top 100 — this only trims the list widget, never the map itself      */
/* (bubbles/density still render every real event, this is a display-only cap).  */
const EVENT_LIST_DISPLAY_CAP = 100;

function EventListPanel({ id, C, t, title, count, totalCount, events, collapsed, onToggleCollapse, sortMode, onSortChange, emptyText, hint, onEventClick, forceCollapsed, placeholderHint }) {
  const isCollapsed = collapsed;
  const sorted = useMemo(() => sortEvents(events, sortMode), [events, sortMode]);
  const visible = sorted.length > EVENT_LIST_DISPLAY_CAP ? sorted.slice(0, EVENT_LIST_DISPLAY_CAP) : sorted;
  return (
    <div style={{
      position: "absolute", left: 8, bottom: 8, width: 200,
      display: "flex", flexDirection: "column", background: C.surface, border: `1px solid ${C.surfaceBorder}`,
      borderRadius: 10, boxShadow: `0 8px 24px ${C.surfaceShadow}`, zIndex: 4, overflow: "hidden",
    }}>
      <button onClick={onToggleCollapse} disabled={!onToggleCollapse}
        aria-label={isCollapsed ? t.epicenterListExpand : t.epicenterListCollapse}
        style={{
          display: "flex", alignItems: "center", justifyContent: "space-between", width: "100%",
          padding: "8px 10px", background: "none", border: "none", cursor: onToggleCollapse ? "pointer" : "default", textAlign: "left",
        }}>
        <span style={{ fontSize: 10, fontWeight: 600, letterSpacing: 0.4, textTransform: "uppercase", color: C.textDim }}>
          {title}{count !== null && count !== undefined ? ` · ${count}` : ""}
        </span>
        {onToggleCollapse && <span style={{ color: C.textFaint, fontSize: 16, lineHeight: 1 }}>{isCollapsed ? "▸" : "▾"}</span>}
      </button>
      {/* forceCollapsed (e.g. Regiones with no region picked yet) always shows its   */}
      {/* placeholder hint even though there's no list/toggle — a real "nothing to    */}
      {/* show yet" state, distinct from the user manually collapsing a real list.    */}
      {forceCollapsed && placeholderHint && (
        <div style={{ fontSize: 10.5, color: C.textFaint, padding: "0 10px 12px" }}>{placeholderHint}</div>
      )}
      {!forceCollapsed && !isCollapsed && (
        sorted.length > 0 ? (
          <>
            <div style={{ display: "flex", gap: 4, padding: "0 10px 5px" }}>
              {/* Solid C.bloodRed, not the selected-tab bloodRed->rose gradient — same red    */
              /* family, but at this size (9px text) the gradient's lighter "rose" end        */
              /* only just clears WCAG AAA in crimson (7.08:1) and misses it in atlas          */
              /* (5.81:1). Solid bloodRed + white text computes to 8.9-10:1 in both themes,    */
              /* verified, not eyeballed — comfortably AAA regardless of theme.               */}
              {[["time", t.sortByTime], ["magnitude", t.sortByMagnitude]].map(([mode, label]) => (
                <button key={mode} onClick={() => onSortChange(mode)}
                  style={{
                    fontSize: 9, padding: "2px 7px", borderRadius: 999, cursor: "pointer",
                    border: `1px solid ${sortMode === mode ? C.bloodRed : C.surfaceBorder}`,
                    background: sortMode === mode ? C.bloodRed : "none",
                    color: sortMode === mode ? "#fff" : C.textFaint,
                  }}>{label}</button>
              ))}
            </div>
            {hint && <div style={{ fontSize: 9, color: C.textFaint, padding: "0 10px 5px" }}>{hint}</div>}
            <div style={{ height: 130, overflowY: "auto", padding: "0 6px 8px", display: "flex", flexDirection: "column", gap: 1 }}>
              {visible.map((p, i) => (
                <button key={p.id || i} onClick={() => onEventClick(p)}
                  style={{ display: "block", textAlign: "left", background: "none", border: "none", cursor: "pointer", borderRadius: 6, padding: "5px 4px", width: "100%" }}
                  onMouseEnter={(ev) => { ev.currentTarget.style.background = withAlpha(C.text, 0.06); }}
                  onMouseLeave={(ev) => { ev.currentTarget.style.background = "transparent"; }}>
                  <div style={{ fontSize: 10.5, color: C.text, lineHeight: 1.3 }}>{p.place}</div>
                  <div style={{ fontSize: 9.5, color: C.textDim }}>
                    M <b style={{ color: C.dotRed }}>{p.mag}</b>{p.time ? ` · ${fmtLocalTime(p.time, id, "es")}` : ""}
                  </div>
                </button>
              ))}
            </div>
            {/* totalCount is set when the MAP itself is already capped upstream         */}
            {/* (capEventsForMap, top-100-strongest) — show that as "strongest of N"      */}
            {/* rather than the generic list-only truncation note, since that's the       */}
            {/* actually-true reason fewer than the full count are shown here. Falls back */}
            {/* to the plain list-only cap (Regiones, which isn't capped upstream) when    */}
            {/* totalCount isn't provided.                                                */}
            {totalCount !== undefined && totalCount > count ? (
              <div style={{ fontSize: 9, color: C.textFaint, padding: "0 10px 8px", fontStyle: "italic" }}>
                {t.epicenterListCappedByMagnitude(count, totalCount)}
              </div>
            ) : sorted.length > EVENT_LIST_DISPLAY_CAP && (
              <div style={{ fontSize: 9, color: C.textFaint, padding: "0 10px 8px", fontStyle: "italic" }}>
                {t.epicenterListTruncated(EVENT_LIST_DISPLAY_CAP, sorted.length)}
              </div>
            )}
          </>
        ) : (
          <div style={{ fontSize: 10.5, color: C.textFaint, padding: "0 10px 12px" }}>{emptyText}</div>
        )
      )}
    </div>
  );
}

/* ---------------------------------------------------------------------- */
/* Sección de mapa unificada — Epicentros / Densidad / Regiones           */
/* Usa geoBoundaries en vivo (ADM0 para el contorno, ADM1 para regiones)  */
/* proyectadas con d3-geo; los límites se piden solo bajo demanda.        */
/* ---------------------------------------------------------------------- */
function CountryMapCard({ id, events, mapView, rowHeight }) {
  const C = React.useContext(ThemeContext);
  const t = React.useContext(LangContext);
  const cfg = COUNTRY_REGISTRY[id];
  const [adm0, setAdm0] = useState(null);
  const [adm0Status, setAdm0Status] = useState("loading");
  const [adm1, setAdm1] = useState(null);
  const [adm1Status, setAdm1Status] = useState("idle");
  const [popup, setPopup] = useState(null);
  /* A pinned region/event popup used to linger visually after switching tabs      */
  /* (mapView didn't clear it) — a stale "Región X selected" popup floating over   */
  /* the Density surface makes no sense once you've left the Regions tab.         */
  useEffect(() => { setPopup(null); }, [mapView]);
  /* Closed by default on all 3 tabs — the panel opening on its own (whether on   */
  /* first mount or from a click) was flagged as wrong; it should stay exactly    */
  /* where the user last left it, closed until THEY choose to open it.           */
  const [listCollapsed, setListCollapsed] = useState(true);
  const [sortMode, setSortMode] = useState("time");
  const svgRef = useRef(null);
  const zoomBehaviorRef = useRef(null);
  const [transform, setTransform] = useState(zoomIdentity);

  useEffect(() => {
    let alive = true;
    setAdm0Status("loading");
    fetchBoundary(cfg.iso3, "ADM0").then((gj) => { if (alive) { setAdm0(gj); setAdm0Status("ready"); } })
      .catch(() => { if (alive) setAdm0Status("error"); });
    return () => { alive = false; };
  }, [id]);

  useEffect(() => {
    if (mapView !== "regions" || adm1 || adm1Status === "loading") return;
    let alive = true;
    setAdm1Status("loading");
    fetchBoundary(cfg.iso3, "ADM1").then((gj) => { if (alive) { setAdm1(gj); setAdm1Status("ready"); } })
      .catch(() => { if (alive) setAdm1Status("error"); });
    return () => { alive = false; };
  }, [mapView, id]);

  const W = cfg.tall ? 300 : 420, H = cfg.tall ? 640 : 340;

  /* Pan/zoom — a swarm/aftershock sequence can pack dozens of epicenters into  */
  /* a few pixels, making individual events unclickable. Lets the user zoom in */
  /* to separate them, and slightly out past the default fit too (0.8x-8x)     */
  /* without touching the underlying geo projection — zoom is a pure view      */
  /* transform layered on top.                                                */
  /* translateExtent is deliberately LARGER than the content box (extent) —    */
  /* if they were equal, d3-zoom would never let panned content pull away from */
  /* fully covering the viewport, which means an edge/corner feature can never */
  /* be centered (there's nowhere for the empty space around it to go), and    */
  /* panning near a boundary "snaps" hard against that wall, which is what     */
  /* read as janky. The margin here is how far past the content edge you can   */
  /* drag before hitting the (still-real, just farther out) limit.            */
  /* A callback ref, not a plain ref + useEffect: this component early-returns */
  /* a plain loading <div> (no <svg> at all) while adm0Status is "loading", so */
  /* an effect keyed on [W,H] (which never changes) would fire once during     */
  /* that loading render — while the ref is still null — and never fire again  */
  /* once the real <svg> mounts, since its dependencies never change. A        */
  /* callback ref instead runs exactly when the DOM node itself appears.       */
  const attachZoom = useCallback((node) => {
    if (node) {
      svgRef.current = node;
      const zb = d3zoom()
        .scaleExtent([0.8, 8])
        .extent([[0, 0], [W, H]])
        .translateExtent([[-W * 0.5, -H * 0.5], [W * 1.5, H * 1.5]])
        .on("zoom", (event) => setTransform(event.transform));
      zoomBehaviorRef.current = zb;
      d3select(node).call(zb);
    } else if (svgRef.current) {
      d3select(svgRef.current).on(".zoom", null);
      svgRef.current = null;
    }
  }, [W, H]);

  /* Plain .call(), no .transition(): d3-transition's driver doesn't reliably tick */
  /* forward in this environment — verified directly, a fresh zoom behavior + a    */
  /* fresh transition import still never reaches its target transform, while the   */
  /* exact same call without .transition() applies instantly and correctly every   */
  /* time. Losing the animated glide is a smaller cost than the buttons/list not   */
  /* actually working.                                                            */
  const zoomBy = useCallback((factor) => {
    if (!svgRef.current || !zoomBehaviorRef.current) return;
    d3select(svgRef.current).call(zoomBehaviorRef.current.scaleBy, factor);
  }, []);
  const zoomReset = useCallback(() => {
    if (!svgRef.current || !zoomBehaviorRef.current) return;
    d3select(svgRef.current).call(zoomBehaviorRef.current.transform, zoomIdentity);
  }, []);
  /* Centers and zooms the map on a specific event's projected (pre-zoom) x/y —   */
  /* used by the epicenter list so tapping an entry actually takes you there,     */
  /* not just to a popup. Builds the target transform directly: solving           */
  /* "8 + k*px + tx = W/2" (the same formula the popup's own position math uses,  */
  /* in reverse) for tx, ty at a fixed, comfortably-zoomed-in k.                  */
  const zoomToEvent = useCallback((p) => {
    if (!svgRef.current || !zoomBehaviorRef.current) return;
    const targetK = 4;
    const tx = W / 2 - 8 - targetK * p.x;
    const ty = H / 2 - 8 - targetK * p.y;
    const target = zoomIdentity.translate(tx, ty).scale(targetK);
    d3select(svgRef.current).call(zoomBehaviorRef.current.transform, target);
  }, [W, H]);

  const projection = useMemo(() => {
    if (!adm0) return null;
    try {
      /* ADM0 files often bundle far-flung outlying territories (Chile ships    */
      /* with Easter Island 3700km off the mainland, Spain with the Canaries)   */
      /* — fitting to the WHOLE geometry zooms out to fit those too, shrinking  */
      /* the mainland (what people actually came to look at) to a sliver. Fit   */
      /* the scale to the largest contiguous polygon instead; the full         */
      /* geometry still gets drawn, just at the mainland's zoom level.         */
      /* fitExtent (not fitSize) with an inset box: fitSize scales the mainland */
      /* to touch the box edges exactly, so a thin extremity right at the edge */
      /* (e.g. Chile's southern archipelago) sits flush against the frame with */
      /* zero margin — easy to misread as clipped/missing. A small inset gives */
      /* every edge breathing room without changing what's actually rendered.  */
      const pad = 10;
      return geoMercator().fitExtent([[pad, pad], [W - 16 - pad, H - 16 - pad]], mainlandRing(adm0) || adm0);
    } catch { return null; }
  }, [adm0, W, H]);

  const path = useMemo(() => (projection ? geoPath(projection) : null), [projection]);

  /* Ordered cap (see capEventsForMap above) — everything the map actually renders */
  /* (bubbles, density markers/pulsar, region containment) uses this capped set,   */
  /* not the raw events prop. Period-summary stats/charts elsewhere in the app     */
  /* still use the true filtered[id] directly, unaffected.                        */
  const mapEvents = useMemo(() => capEventsForMap(events, MAP_EVENT_CAP), [events]);

  const projected = useMemo(() => {
    if (!projection) return [];
    return mapEvents.map((e) => {
      const p = projection([e.lon, e.lat]);
      if (!p) return null;
      /* Felt-radius in real km, converted to THIS projection's pixels by       */
      /* actually projecting a point that far away (due east) and measuring    */
      /* the pixel distance — correct regardless of latitude or which          */
      /* country's fitted scale is in play.                                    */
      const edge = projection(destinationPoint(e.lon, e.lat, feltRadiusKm(e.mag), 90));
      const radiusPx = edge ? Math.hypot(edge[0] - p[0], edge[1] - p[1]) : 20;
      return { ...e, x: p[0] + 8, y: p[1] + 8, radiusPx };
    }).filter(Boolean);
  }, [projection, mapEvents]);

  const maxMag = Math.max(1, ...mapEvents.map((e) => e.mag));

  /* Same "compute once, keep across tab switches" fix as regionCounts below —   */
  /* densityVisited mirrors what adm1 does for Regions: adm1 only gets populated */
  /* once the Regions tab's fetch effect actually runs, so regionCounts' useMemo */
  /* naturally skips the expensive work until then, and is never thrown away by  */
  /* a tab switch since it lives here, not inside a conditionally-mounted child. */
  /* Density has no fetch to gate on (it's pure client-side computation from     */
  /* events already in hand), so a plain "have we ever shown this tab" flag      */
  /* does the same job.                                                         */
  const [densityVisited, setDensityVisited] = useState(mapView === "density");
  useEffect(() => { if (mapView === "density") setDensityVisited(true); }, [mapView]);

  const densityPts = useMemo(() =>
    projected.map((p) => ({ x: p.x, y: p.y, r: p.radiusPx, w: p.mag / maxMag })),
    [projected, maxMag]);

  const densityData = useMemo(() => {
    if (!densityVisited) return { contours: [], padCells: 0, maxVal: 0 };
    return computeDensityContours(densityPts, W - 16, H - 16);
  }, [densityVisited, densityPts, W, H]);

  /* Deliberately the FULL events here, not the capped mapEvents — a choropleth's  */
  /* whole point is showing accurate regional distribution, and capping to the    */
  /* top-100-strongest nationally would make a region full of small aftershocks   */
  /* look empty just because none of them individually crack the national top     */
  /* 100. The per-region event LIST (via the docked panel) still has its own      */
  /* separate, smaller safety-net cap (EVENT_LIST_DISPLAY_CAP) if a single region */
  /* somehow has 100+ events of its own, which is far less likely than a whole    */
  /* country doing so.                                                            */
  /* Cheap bbox check before the expensive geoContains() ray-cast — most events    */
  /* aren't anywhere near most regions, so a bbox reject avoids the costly check    */
  /* almost entirely. Measured on Japan's real "Último año" dataset (1314 events,   */
  /* 47 prefectures, 61758 combinations): 5545ms naive -> 83ms with this filter,    */
  /* only 1.2% of combinations actually needed the real geoContains call. This is   */
  /* very likely what was behind the near-1-minute freeze switching into Regiones   */
  /* with a high-activity country active — the FULL uncapped event set is kept     */
  /* (see the comment above about why capping this would break the choropleth),    */
  /* this only makes the SAME correct computation faster, no accuracy tradeoff.    */
  const regionCounts = useMemo(() => {
    if (!adm1 || !path) return null;
    return adm1.features.map((f) => {
      const [minX, minY, maxX, maxY] = geometryBBox(f.geometry);
      const regionEvents = events.filter((e) => {
        if (e.lon < minX || e.lon > maxX || e.lat < minY || e.lat > maxY) return false;
        return geoContains(f, [e.lon, e.lat]);
      });
      const c = path.centroid(f);
      return { feature: f, count: regionEvents.length, events: regionEvents, d: path(f), cx: c[0] + 8, cy: c[1] + 8 };
    });
  }, [adm1, events, path]);
  const maxRegionCount = regionCounts ? Math.max(1, ...regionCounts.map((r) => r.count)) : 1;
  /* Its own state, deliberately NOT derived from the hover popup — a click used to */
  /* "pin" the floating popup open (stick around after the mouse left), which the   */
  /* user correctly flagged as wrong: hover should ONLY ever show the small         */
  /* floating card, and clicking should ONLY ever affect the docked list panel      */
  /* below, never leave the floating card stuck on screen. So there's no more       */
  /* "pinned" concept at all — the floating popup is purely a hover preview now,    */
  /* and region selection (which drives the docked panel) is tracked separately.   */
  const [selectedRegion, setSelectedRegion] = useState(null);

  if (adm0Status === "loading") {
    return <div style={{ height: H * 0.5, display: "flex", alignItems: "center", justifyContent: "center", color: C.textFaint, fontSize: 12.5 }}>{t.loadingBoundary}</div>;
  }
  if (adm0Status === "error" || !path) {
    return <div style={{ height: H * 0.5, display: "flex", alignItems: "center", justifyContent: "center", color: C.textFaint, fontSize: 12.5, textAlign: "center", padding: 20 }}>{t.boundaryError}</div>;
  }

  const k = transform.k;

  const cssHeight = rowHeight || (cfg.tall ? 420 : 300);

  return (
    <div style={{ position: "relative" }}>
      <div style={{ position: "relative" }}>
      <svg ref={attachZoom} viewBox={`0 0 ${W} ${H}`} style={{ width: "100%", height: cssHeight, background: "rgba(128,128,128,0.04)", borderRadius: 10, touchAction: "none", cursor: k > 1.001 ? "grab" : "default" }}>
        <g transform="translate(8,8)">
          <g transform={transform.toString()}>
            {mapView === "regions" && regionCounts && regionCounts.map((r, i) => {
              const name = r.feature.properties?.shapeName || "?";
              const isHovered = popup && popup.kind === "region" && popup.region.name === name;
              return (
                <path key={i} d={r.d} fill={regionColor(C, r.count, maxRegionCount)}
                  stroke={isHovered ? C.text : withAlpha(C.text, 0.5)} strokeWidth={(isHovered ? 1.6 : 0.9) / k}
                  style={{ cursor: "pointer" }}
                  onMouseEnter={() => setPopup({ kind: "region", region: { name, count: r.count, events: r.events }, x: r.cx, y: r.cy })}
                  onMouseLeave={() => setPopup(null)}
                  onClick={(ev) => { ev.stopPropagation(); setSelectedRegion({ name, count: r.count, events: r.events }); }} />
              );
            })}
            {mapView === "regions" && adm1Status === "loading" && (
              <text x={(W - 16) / 2} y={(H - 16) / 2} textAnchor="middle" fontSize={11 / k} fill={C.textFaint}>{t.loadingBoundary}</text>
            )}
            {mapView !== "regions" && path(adm0) && (
              <path d={path(adm0)} fill="none" stroke={C.text} strokeWidth={1.5 / k} opacity={0.55} />
            )}
            {mapView === "bubbles" && projected.map((p, i) => {
              const r = (2 + (p.mag / maxMag) * 7) / k;
              return (
                <circle key={i} cx={p.x} cy={p.y} r={r} fill={C.dotRed} fillOpacity={0.85} stroke={withAlpha(C.bg, 0.6)} strokeWidth={0.6 / k}
                  style={{ cursor: "pointer" }}
                  onMouseEnter={() => setPopup({ kind: "event", event: p, x: p.x, y: p.y })}
                  onMouseLeave={() => setPopup(null)}
                  onClick={(ev) => { ev.stopPropagation(); if (p.id) window.open(usgsEventUrl(p.id), "_blank", "noopener,noreferrer"); }} />
              );
            })}
            {mapView === "density" && (
              <>
                <DensitySurface contours={densityData.contours} padCells={densityData.padCells} maxVal={densityData.maxVal} w={W - 16} h={H - 16} />
                {/* A weak/isolated event on a large, elongated map (Chile: same physical  */}
                {/* felt-radius in km projects to fewer pixels than on a compact country's  */}
                {/* map, since the projection's pixels-per-km ratio is smaller) can render  */}
                {/* as a barely-visible speck. A subtle pulsing ring — reusing the same     */}
                {/* "breathe" animation the live-status dot already uses — draws the eye to */}
                {/* every epicenter regardless of how small its glow computed to be,        */}
                {/* without permanently enlarging anything (which would clutter a swarm).   */}
                {/* Yellow hot-core, back to being its own marker AT THE REAL EPICENTER —  */}
                {/* not derived from the merged density field's peak, which (for a cluster */}
                {/* of several close events) can sit somewhere between them that isn't any  */}
                {/* single actual epicenter. Using the exact same p.x/p.y as the pulsar     */}
                {/* ring guarantees they always line up. Kept deliberately small and         */}
                {/* magnitude-INSENSITIVE (a tight clamp, not a fraction of felt-radius)     */}
                {/* so it can't balloon the way the first attempt at a separate marker did.  */}
                {/* Per-theme marker gradient: crimson is single-hue gold (Core === Edge, a   */}
                {/* confirmed-good look, don't retune it), atlas is the original two-tone     */}
                {/* magenta-to-orange from the palette's settled final call. NOT divided by   */}
                {/* k, deliberately — should grow somewhat as you zoom in, not stay pinned to  */}
                {/* a constant screen size like the pulse ring does. The small base clamp      */}
                {/* (1.5–3.2 local units) keeps it readable at 100% and reasonably sized at    */}
                {/* high zoom without a separate min/max-by-k rule. Gradient fill (not flat)   */}
                {/* so overlapping markers blend softly at the edges instead of fusing into    */}
                {/* a hard blob.                                                               */}
                <defs>
                  <radialGradient id={`epicenter-${id}`}>
                    <stop offset="0%" stopColor={C.epicenterCore} stopOpacity="1" />
                    <stop offset="30%" stopColor={C.epicenterCore} stopOpacity="0.65" />
                    <stop offset="100%" stopColor={C.epicenterEdge} stopOpacity="0" />
                  </radialGradient>
                </defs>
                {/* Same hover-preview / click-to-open popup as the Epicentros bubbles — this  */}
                {/* previously had no interaction at all. Only on the primary dot, not the     */}
                {/* pulse ring (pointerEvents: none there) so hover doesn't double-fire.        */}
                {projected.map((p, i) => (
                  <circle key={`ep-${i}`} cx={p.x} cy={p.y} r={Math.min(3.2, Math.max(1.5, (p.radiusPx || 20) * 0.055))}
                    fill={`url(#epicenter-${id})`} stroke={C.text} strokeWidth={0.5 / k} strokeOpacity={0.5}
                    style={{ cursor: "pointer" }}
                    onMouseEnter={() => setPopup({ kind: "event", event: p, x: p.x, y: p.y })}
                    onMouseLeave={() => setPopup(null)}
                    onClick={(ev) => { ev.stopPropagation(); if (p.id) window.open(usgsEventUrl(p.id), "_blank", "noopener,noreferrer"); }} />
                ))}
                {/* Only the hovered marker pulses, not all of them — up to 100 events per   */}
                {/* country meant up to 100 (or 300 with 3 countries active) simultaneously   */}
                {/* CSS-animating rings, a real, confirmed compositor cost even with GPU-      */}
                {/* friendly opacity/transform properties, just from sheer animated-layer      */}
                {/* count. Reference equality against popup.event works because it's the      */}
                {/* exact same object set by this marker's own onMouseEnter below, from the    */}
                {/* same (memoized, so stable) projected array.                               */}
                {popup && popup.kind === "event" && (() => {
                  const p = projected.find((ev) => ev === popup.event);
                  if (!p) return null;
                  return (
                    <circle className="liveDot" cx={p.x} cy={p.y} r={3.5 / k}
                      fill="none" stroke={C.epicenterCore} strokeWidth={0.9 / k} strokeOpacity={0.6}
                      style={{ transformBox: "fill-box", transformOrigin: "center", pointerEvents: "none" }} />
                  );
                })()}
              </>
            )}
          </g>
        </g>
      </svg>
      <div style={{ position: "absolute", top: 8, right: 8, display: "flex", flexDirection: "column", alignItems: "center", gap: 4, zIndex: 4 }}>
        <button onClick={() => zoomBy(1.6)} aria-label={t.zoomIn} title={t.zoomIn} style={zoomBtnStyle(C)}>+</button>
        <div style={{ fontSize: 9.5, color: C.textFaint, fontFamily: "'JetBrains Mono', monospace" }}>{Math.round(k * 100)}%</div>
        <button onClick={() => zoomBy(1 / 1.6)} aria-label={t.zoomOut} title={t.zoomOut} style={zoomBtnStyle(C)}>−</button>
        {k > 1.001 && <button onClick={zoomReset} aria-label={t.zoomReset} title={t.zoomReset} style={zoomBtnStyle(C)}>⟲</button>}
      </div>
      {popup && (
        <div style={{
          position: "absolute",
          left: `${((8 + transform.applyX(popup.x)) / W) * 100}%`,
          top: `${((8 + transform.applyY(popup.y)) / H) * 100}%`,
          transform: "translate(-50%, -115%)", background: C.surface, border: `1px solid ${C.surfaceBorder}`,
          borderRadius: 10, padding: "10px 12px", minWidth: 190, maxWidth: 260, boxShadow: `0 8px 24px ${C.surfaceShadow}`, zIndex: 5,
          pointerEvents: "none",
        }}>
          {popup.kind === "region" ? (
            /* Just name + count here — the full event list lives in the docked   */
            /* EventListPanel below now (see "the region popup BECOMES this tab's */
            /* version of the panel" in PLAN.md §6), not duplicated in both.      */
            <div style={{ fontSize: 12.5, color: C.text, fontWeight: 600, paddingRight: 14 }}>
              {popup.region.name}
              <div style={{ fontSize: 11.5, color: C.textDim, fontWeight: 400, marginTop: 2 }}>{t.regionEventsCount(popup.region.count)}</div>
            </div>
          ) : (
            <>
              <div style={{ fontSize: 12.5, color: C.text, fontWeight: 600, paddingRight: 14 }}>{popup.event.place}</div>
              <div style={{ fontSize: 11.5, color: C.textDim, marginTop: 4, display: "flex", flexDirection: "column", gap: 2 }}>
                <span>M <b style={{ color: C.dotRed }}>{popup.event.mag}</b> · {popup.event.depth} km</span>
                {popup.event.time && <span>{fmtLocalTime(popup.event.time, id, "es")}</span>}
              </div>
              {popup.event.id && (
                <div style={{ marginTop: 6, paddingTop: 6, borderTop: `1px solid ${C.surfaceBorder}` }}>
                  <div style={{ fontSize: 10, color: C.textFaint, marginBottom: 2 }}>{t.clickEventForReport}</div>
                  <a href={usgsEventUrl(popup.event.id)} target="_blank" rel="noopener noreferrer"
                    style={{ display: "block", fontSize: 11, color: C.dotRed, textDecoration: "none" }}>{t.viewOnUsgs}</a>
                </div>
              )}
            </>
          )}
        </div>
      )}
      {(mapView === "density" || mapView === "bubbles") && (
        <EventListPanel id={id} C={C} t={t}
          title={t.epicenterListTitle} count={projected.length} totalCount={events.length} events={projected}
          collapsed={listCollapsed} onToggleCollapse={() => setListCollapsed((v) => !v)}
          sortMode={sortMode} onSortChange={setSortMode}
          emptyText={t.epicenterListEmpty} hint={t.epicenterListHint} onEventClick={zoomToEvent} />
      )}
      {mapView === "regions" && (
        <EventListPanel id={id} C={C} t={t}
          title={selectedRegion ? selectedRegion.name : t.regionListTitlePlaceholder}
          count={selectedRegion ? selectedRegion.count : null} events={selectedRegion ? selectedRegion.events : []}
          collapsed={listCollapsed} onToggleCollapse={selectedRegion ? () => setListCollapsed((v) => !v) : undefined}
          forceCollapsed={!selectedRegion} placeholderHint={t.regionListPlaceholderHint}
          sortMode={sortMode} onSortChange={setSortMode}
          emptyText={t.epicenterListEmpty} hint={t.epicenterListHint}
          onEventClick={zoomToEvent} />
      )}
      </div>
      {mapView === "bubbles" && (
        /* Bubbles are sized by magnitude, not colored on a gradient, so a literal   */
        /* gradient-bar legend (like Regiones/Densidad below) wouldn't mean anything */
        /* here — two actual differently-sized dots showing the real min/max         */
        /* magnitude on this map is the honest equivalent, not a filler row just to  */
        /* match height. Row height still matches the other two legends so switching */
        /* tabs doesn't change the card's total height.                             */
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 8, fontSize: 11, color: C.textDim }}>
          <span>{t.bubblesLegendLabel}</span>
          <span style={{ width: 4, height: 4, borderRadius: "50%", background: C.dotRed, flexShrink: 0 }} />
          <span>M{mapEvents.length ? Math.min(...mapEvents.map((e) => e.mag)).toFixed(1) : "–"}</span>
          <span style={{ width: 9, height: 9, borderRadius: "50%", background: C.dotRed, flexShrink: 0 }} />
          <span>M{mapEvents.length ? maxMag.toFixed(1) : "–"}</span>
        </div>
      )}
      {mapView === "regions" && regionCounts && (
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 8, fontSize: 11, color: C.textDim }}>
          <span>{t.regionLegendLabel}</span>
          <span>0</span>
          <div style={{ flex: 1, maxWidth: 140, height: 8, borderRadius: 4, background: `linear-gradient(90deg, ${C.regionLow}, ${C.regionMid}, ${C.regionHigh})` }} />
          <span>{maxRegionCount}</span>
        </div>
      )}
      {mapView === "density" && (
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 8, fontSize: 11, color: C.textDim }}>
          <span>{t.densityLegendLabel}</span>
          <span>{t.densityLegendLow}</span>
          <div style={{ flex: 1, maxWidth: 140, height: 8, borderRadius: 4, background: `linear-gradient(90deg, ${C.densityStops.join(", ")})` }} />
          <span>{t.densityLegendHigh}</span>
        </div>
      )}
    </div>
  );
}

/* ---------------------------------------------------------------------- */
/* Selector de países                                                      */
/* ---------------------------------------------------------------------- */
function CountryPicker({ active, focus, colorFor, onToggleFocus, onRemove, onAdd }) {
  const C = React.useContext(ThemeContext);
  const t = React.useContext(LangContext);
  const [open, setOpen] = useState(false);
  const available = Object.keys(COUNTRY_REGISTRY).filter((id) => !active.includes(id));
  const atCap = active.length >= MAX_COUNTRIES;
  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center", position: "relative" }}>
      {active.map((id) => (
        <button key={id} onClick={() => onToggleFocus(id)}
          style={{
            display: "flex", alignItems: "center", gap: 7, padding: "6px 8px 6px 12px", borderRadius: 999, cursor: "pointer",
            border: `1px solid ${focus === id ? colorFor(id) : C.border}`,
            background: focus === id ? `${colorFor(id)}22` : "rgba(128,128,128,0.05)",
            fontFamily: "'Inter', sans-serif", fontSize: 12.5, color: focus === id ? C.text : C.textDim,
          }}>
          <span style={{ width: 8, height: 8, borderRadius: "50%", background: colorFor(id) }} />
          {countryLabel(id, t.lang)}
          {active.length > 1 && (
            <span onClick={(ev) => { ev.stopPropagation(); onRemove(id); }} aria-label={t.removeCountry(countryLabel(id, t.lang))}
              style={{ marginLeft: 2, color: C.textFaint, fontSize: 13, lineHeight: 1, padding: "0 2px" }}>×</span>
          )}
        </button>
      ))}
      <div style={{ position: "relative" }}>
        <button onClick={() => setOpen((o) => !o)}
          style={{ padding: "6px 13px", borderRadius: 999, cursor: "pointer", border: `1px dashed ${C.borderHover}`, background: "transparent", color: C.textDim, fontFamily: "'JetBrains Mono', monospace", fontSize: 12 }}>
          {t.addCountry}
        </button>
        {open && (
          <div style={{ position: "absolute", top: "calc(100% + 6px)", left: 0, zIndex: 20, minWidth: 200, background: "#141117", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 12, padding: 6, boxShadow: "0 12px 32px rgba(0,0,0,0.55)", maxHeight: 260, overflowY: "auto" }}>
            {atCap ? (
              <div style={{ padding: "8px 10px", fontSize: 11.5, color: "#84807B", maxWidth: 220, lineHeight: 1.5 }}>{t.maxCountriesNote(MAX_COUNTRIES)}</div>
            ) : available.length === 0 ? (
              <div style={{ padding: "8px 10px", fontSize: 11.5, color: "#84807B" }}>{t.noMoreCountries}</div>
            ) : available.map((id) => (
              <button key={id} onClick={() => { onAdd(id); setOpen(false); }}
                style={{ display: "block", width: "100%", textAlign: "left", padding: "7px 10px", borderRadius: 8, border: "none", background: "transparent", color: "#EDEAE7", fontSize: 12.5, cursor: "pointer" }}
                onMouseEnter={(e) => (e.currentTarget.style.background = "rgba(255,255,255,0.06)")}
                onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}>
                {countryLabel(id, t.lang)}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------------- */
/* Componente principal                                                    */
/* ---------------------------------------------------------------------- */
export default function App() {
  const [lang] = useState(detectLang());
  const t = STRINGS[lang];

  const [systemMode, setSystemMode] = useState(typeof window !== "undefined" && window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");
  const [override, setOverride] = useState(null); // null = seguir sistema
  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return;
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const handler = (e) => setSystemMode(e.matches ? "dark" : "light");
    if (mq.addEventListener) mq.addEventListener("change", handler); else mq.addListener(handler);
    return () => { if (mq.removeEventListener) mq.removeEventListener("change", handler); else mq.removeListener(handler); };
  }, []);
  const mode = override || systemMode;
  const themeId = mode === "light" ? "atlas" : "crimson";
  const C = THEMES[themeId];
  const tooltipStyle = getTooltipStyle(C);
  const tooltipItemStyle = { color: C.text };
  const ALERT_COLOR = { green: C.alertGreen, yellow: C.alertYellow, orange: C.alertOrange, red: C.alertRed, none: C.alertNone };
  const ALERT_LABEL = { green: t.alertGreen, yellow: t.alertYellow, orange: t.alertOrange, red: t.alertRed, none: t.alertNone };
  const RANGE_LABEL = { day: t.rangeDay, week: t.rangeWeek, month: t.rangeMonth, year: t.rangeYear };

  const [activeCountries, setActiveCountries] = useState(DEFAULT_ACTIVE);
  const [focus, setFocus] = useState(null);
  const [data, setData] = useState({});
  const [status, setStatus] = useState({});
  const [range, setRange] = useState("week");
  const [updatedAt, setUpdatedAt] = useState(null);
  const [magTab, setMagTab] = useState("chile");
  const [mapView, setMapView] = useState("bubbles"); // 'bubbles' | 'density' | 'regions'
  const [isDesktop, setIsDesktop] = useState(typeof window !== "undefined" ? window.matchMedia("(min-width: 900px)").matches : true);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const mq = window.matchMedia("(min-width: 900px)");
    const handler = (e) => setIsDesktop(e.matches);
    if (mq.addEventListener) mq.addEventListener("change", handler); else mq.addListener(handler);
    return () => { if (mq.removeEventListener) mq.removeEventListener("change", handler); else mq.removeListener(handler); };
  }, []);

  const load = useCallback(async (id) => {
    setStatus((s) => ({ ...s, [id]: "loading" }));
    try {
      const events = await fetchCountryData(id);
      setData((d) => ({ ...d, [id]: events }));
      setStatus((s) => ({ ...s, [id]: "live" }));
    } catch (e) {
      setData((d) => ({ ...d, [id]: generateFallback(id, lang) }));
      setStatus((s) => ({ ...s, [id]: "fallback" }));
    }
  }, [lang]);

  useEffect(() => { DEFAULT_ACTIVE.forEach(load); setUpdatedAt(new Date()); }, [load]);

  const colorFor = useCallback((id) => C.palette[activeCountries.indexOf(id) % C.palette.length] || C.textDim, [activeCountries, C]);

  const handleAdd = (id) => { if (activeCountries.includes(id) || activeCountries.length >= MAX_COUNTRIES) return; setActiveCountries((a) => [...a, id]); load(id); };
  const handleRemove = (id) => { setActiveCountries((a) => a.filter((x) => x !== id)); if (focus === id) setFocus(null); if (magTab === id) setMagTab(null); };
  const handleToggleFocus = (id) => setFocus((f) => (f === id ? null : id));
  const visibleCountries = focus ? [focus] : activeCountries;
  /* When a "tall" country (Chile) shares the map grid row with a default-      */
  /* height one (Spain), CSS Grid stretches the shorter country's CARD to match */
  /* the row anyway — but its <svg> used to stay at its own fixed height,       */
  /* leaving that extra stretched space empty below the map. Sizing every map   */
  /* in the row to the tallest active country's height puts that space to use.  */
  const mapRowHeight = Math.max(...visibleCountries.map((id) => (COUNTRY_REGISTRY[id].tall ? 420 : 300)));

  useEffect(() => { if (!visibleCountries.includes(magTab) && magTab !== "comparacion") setMagTab(visibleCountries[0]); }, [visibleCountries.join(","), magTab]);

  /* Memoized on [range] only — NOT recomputed fresh every render. It used to be a  */
  /* plain `Date.now() - RANGE_MS[range]`, which produced a new value on nearly     */
  /* every render (different millisecond timestamp) regardless of whether `range`   */
  /* actually changed. Since filtered's useMemo depends on cutoff, that meant ANY   */
  /* App-level state change at all — toggling focus, opening the country picker,    */
  /* anything — forced a full re-filter of every active country's events and        */
  /* cascaded into the same expensive downstream recompute (KDE, region counts)     */
  /* the activeCountries fix above addressed, just triggered more broadly. This is  */
  /* the likely explanation for "the dashboard gets slower the longer the session   */
  /* runs" — every interaction anywhere adds to that cost, not just map-specific    */
  /* actions.                                                                       */
  const cutoff = useMemo(() => Date.now() - RANGE_MS[range], [range]);
  const granularity = range === "day" ? "hour" : range === "year" ? "week" : "day";

  /* Deliberately NOT keyed on activeCountries: filtering over Object.keys(data)   */
  /* instead means adding/removing a country never invalidates the filtered arrays */
  /* for every OTHER already-loaded country. It used to be keyed on activeCountries,*/
  /* which meant removing one country rebuilt brand-new event arrays for every      */
  /* remaining one (even though their underlying data hadn't changed) — those new   */
  /* references then cascaded into CountryMapCard's own memoization (projected,     */
  /* densityData, regionCounts), forcing the whole per-country pipeline, KDE        */
  /* included, to recompute on a completely unrelated removal. That's the real      */
  /* cause of "removing a country freezes the page." data[] itself already only     */
  /* holds countries that have been loaded (via handleAdd's load(id)) and is never  */
  /* pruned on remove, so this costs a little unused memory for a removed-but-      */
  /* still-loaded country, not extra fetches or recomputation elsewhere.            */
  const filtered = useMemo(() => {
    const out = {};
    Object.keys(data).forEach((id) => { out[id] = (data[id] || []).filter((e) => e.time >= cutoff).sort((a, b) => a.time - b.time); });
    return out;
  }, [data, cutoff]);

  const lineData = (id) => (filtered[id] || []).map((e) => ({ x: e.time, mag: e.mag, place: e.place }));

  const stackedArea = useMemo(() => {
    const buckets = {};
    const bucketSize = granularity === "hour" ? 3600000 : granularity === "week" ? 7 * 86400000 : 86400000;
    visibleCountries.forEach((id) => (filtered[id] || []).forEach((e) => {
      const b = Math.floor(e.time / bucketSize) * bucketSize;
      buckets[b] = buckets[b] || { x: b, ...Object.fromEntries(visibleCountries.map((c) => [c, 0])) };
      buckets[b][id] = Math.max(buckets[b][id] || 0, e.mag);
    }));
    return Object.values(buckets).sort((a, b) => a.x - b.x);
  }, [filtered, granularity, visibleCountries.join(",")]);

  const histogram = useMemo(() => {
    const bins = ["2.5–3", "3–3.5", "3.5–4", "4–4.5", "4.5–5", "5–5.5", "5.5–6", "6+"];
    const edges = [2.5, 3, 3.5, 4, 4.5, 5, 5.5, 6, 99];
    return bins.map((b, i) => {
      const row = { bin: b };
      visibleCountries.forEach((id) => { row[id] = (filtered[id] || []).filter((e) => e.mag >= edges[i] && e.mag < edges[i + 1]).length; });
      return row;
    });
  }, [filtered, visibleCountries.join(",")]);

  const depthScatter = (id) => (filtered[id] || []).map((e) => ({ depth: e.depth, mag: e.mag, alert: e.alert, place: e.place }));

  const alertBreakdown = (id) => {
    const counts = { green: 0, yellow: 0, orange: 0, red: 0, none: 0 };
    (filtered[id] || []).forEach((e) => { counts[e.alert] = (counts[e.alert] || 0) + 1; });
    return Object.entries(counts).filter(([, v]) => v > 0).map(([k, v]) => ({ name: ALERT_LABEL[k], value: v, key: k }));
  };

  const cumulative = useMemo(() => {
    const counters = Object.fromEntries(visibleCountries.map((id) => [id, 0]));
    const all = visibleCountries.flatMap((id) => (filtered[id] || []).map((e) => ({ time: e.time, country: id }))).sort((a, b) => a.time - b.time);
    return all.map((e) => { counters[e.country] += 1; return { x: e.time, ...counters }; });
  }, [filtered, visibleCountries.join(",")]);

  const summary = (id) => {
    const arr = filtered[id] || [];
    if (!arr.length) return { total: 0, max: "—", maxPlace: "—", avg: "—", felt: 0 };
    const max = arr.reduce((a, b) => (b.mag > a.mag ? b : a));
    const avg = (arr.reduce((s, e) => s + e.mag, 0) / arr.length).toFixed(2);
    const felt = arr.reduce((s, e) => s + (e.felt || 0), 0);
    return { total: arr.length, max: max.mag.toFixed(1), maxPlace: max.place, avg, felt };
  };

  const gridClass = visibleCountries.length >= 3 ? "grid3" : visibleCountries.length === 2 ? "grid2" : "";
  const overallStatus = activeCountries.every((id) => status[id] === "live") ? "live"
    : activeCountries.some((id) => status[id] === "loading" || !status[id]) ? "loading" : "fallback";
  const titleLabels = visibleCountries.map((id) => countryLabel(id, lang));

  return (
    <ThemeContext.Provider value={C}>
    <LangContext.Provider value={t}>
    <div style={{ minHeight: "100vh", background: C.bg, color: C.text, fontFamily: "'Inter', sans-serif", padding: "28px 18px 60px", position: "relative" }}>
      <div className="ambientGlow" style={{
        position: "fixed", inset: 0, zIndex: 0, pointerEvents: "none",
        background: `radial-gradient(ellipse 900px 700px at 50% -5%, ${withAlpha(C.bloodRed, C.glowAlpha[0])}, transparent 60%), radial-gradient(ellipse 800px 500px at 100% 100%, ${withAlpha(C.rose, C.glowAlpha[1])}, transparent 60%)`,
      }} />
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Chakra+Petch:wght@500;600;700&family=Inter:wght@400;500;600&family=JetBrains+Mono:wght@400;500&display=swap');
        * { box-sizing: border-box; }
        html, body { margin: 0; background: ${C.bg}; }
        ::selection { background: ${C.bloodRed}; color: #fff; }
        .grid2 { display: grid; grid-template-columns: 1fr; gap: 18px; }
        @media (min-width: 900px) { .grid2 { grid-template-columns: 1fr 1fr; } }
        .grid3 { display: grid; grid-template-columns: 1fr; gap: 18px; }
        @media (min-width: 900px) { .grid3 { grid-template-columns: repeat(3, 1fr); } }
        @keyframes breathe { 0%, 100% { opacity: 0.55; transform: scale(0.85); } 50% { opacity: 1; transform: scale(1.15); } }
        @keyframes traceScroll { from { stroke-dashoffset: 0; } to { stroke-dashoffset: -240; } }
        @keyframes fadeUp { from { opacity: 0; transform: translateY(14px); } to { opacity: 1; transform: translateY(0); } }
        @keyframes ambientPulse { 0%, 100% { opacity: 0.9; } 50% { opacity: 1.15; } }
        @keyframes fadeIn { from { opacity: 0; } to { opacity: 1; } }
        .liveDot { animation: breathe 2.2s ease-in-out infinite; }
        .traceLine { stroke-dasharray: 3 5; animation: traceScroll 6s linear infinite; }
        .ambientGlow { animation: ambientPulse 8s ease-in-out infinite; }
        .fadeUp { animation: fadeUp 0.6s ease both; }
        .fadeIn { animation: fadeIn 0.35s ease both; }
        @media (prefers-reduced-motion: reduce) { .liveDot, .traceLine, .ambientGlow, .fadeUp, .fadeIn { animation: none !important; } }
        .segTrack { position: relative; display: inline-flex; flex-wrap: wrap; padding: 3px; border-radius: 18px; background: rgba(128,128,128,0.05); border: 1px solid ${C.border}; width: 100%; }
        .segBtn { position: relative; z-index: 1; flex: 1 1 auto; min-width: 0; padding: 8px 10px; border: none; background: transparent; cursor: pointer; font-size: 12px; font-family: 'JetBrains Mono', monospace; letter-spacing: 0.3px; color: ${C.textDim}; transition: color .2s ease; text-align: center; white-space: normal; line-height: 1.25; }
        .segBtn.active { color: #fff; }
        .segThumb { position: absolute; top: 3px; bottom: 3px; border-radius: 14px; transition: left .25s cubic-bezier(.4,0,.2,1), width .25s cubic-bezier(.4,0,.2,1); }
        .glassHover { transition: transform .25s ease, border-color .25s ease, background .25s ease; }
        .glassHover:hover { transform: translateY(-3px); border-color: ${C.borderHover} !important; }
        .chipHover { transition: transform .2s ease, border-color .2s ease; }
        .chipHover:hover { transform: translateY(-2px); border-color: ${C.borderHover}; }
      `}</style>

      <div style={{ position: "relative", zIndex: 1 }}>
        <div style={{ maxWidth: 1180, margin: "0 auto 22px" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 12 }}>
            <div style={{ fontSize: 11, letterSpacing: 3, color: C.rose, fontFamily: "'JetBrains Mono', monospace" }}>{t.eyebrow}</div>
            <DayNightToggle mode={mode} onToggle={() => setOverride(mode === "light" ? "dark" : "light")} />
          </div>
          <h1 style={{ margin: "6px 0 0", fontFamily: "'Chakra Petch', sans-serif", fontWeight: 700, fontSize: "clamp(22px, 4vw, 32px)", letterSpacing: 0.5 }}>
            {t.titlePrefix}{" "}
            {titleLabels.map((l, i) => (
              <span key={l}>
                <span style={{ color: colorFor(visibleCountries[i]) }}>{l}</span>
                {i < titleLabels.length - 1 ? (i === titleLabels.length - 2 ? ` ${t.joinAnd} ` : ", ") : ""}
              </span>
            ))}
          </h1>
          <div style={{ display: "flex", flexDirection: "column", gap: 4, alignItems: "flex-start", fontSize: 12, marginTop: 8 }}>
            <StatusBadge status={overallStatus} />
            {updatedAt && <span style={{ color: C.textFaint }}>{t.updated} {updatedAt.toLocaleTimeString(lang === "en" ? "en-US" : "es-ES")}</span>}
          </div>

          <p style={{ maxWidth: 760, color: C.textDim, fontSize: 13, lineHeight: 1.5, marginTop: 10 }}>{t.intro}</p>

          <div style={{ margin: "16px 0 4px" }}><SeismicTrace /></div>

          <div style={{ display: "flex", flexDirection: "column", gap: 10, marginTop: 6 }}>
            <SegmentedControl options={Object.entries(RANGE_LABEL)} value={range} onChange={setRange} />
            <CountryPicker active={activeCountries} focus={focus} colorFor={colorFor} onToggleFocus={handleToggleFocus} onRemove={handleRemove} onAdd={handleAdd} />
            {focus && (
              <div style={{ fontSize: 11.5, color: C.textFaint }}>
                {t.focusNote()}<b style={{ color: colorFor(focus) }}>{countryLabel(focus, lang)}</b>{t.focusNoteEnd}
              </div>
            )}
          </div>
        </div>

        <div style={{ maxWidth: 1180, margin: "0 auto", display: "flex", flexDirection: "column", gap: 40 }}>

          <SectionGroup eyebrow={t.grp1Eyebrow} title={t.grp1Title}>
            <div className={gridClass || undefined} style={!gridClass ? { maxWidth: 480 } : undefined}>
              {visibleCountries.map((id) => {
                const s = summary(id);
                return (
                  <div key={id} className="glassHover" style={getGlassCard(C)}>
                    <h3 style={{ margin: "0 0 10px", fontFamily: "'Chakra Petch', sans-serif", color: colorFor(id), fontSize: 15, textTransform: "uppercase", letterSpacing: 0.5 }}>{countryLabel(id, lang)} · {RANGE_LABEL[range]}</h3>
                    <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                      <StatChip label={t.statEvents} value={s.total} />
                      <StatChip label={t.statMaxMag} value={s.max} accent={C.bloodRed} />
                      <StatChip label={t.statAvgMag} value={s.avg} />
                      <StatChip label={t.statFelt} value={s.felt} />
                    </div>
                    {s.total > 0 && <div style={{ marginTop: 10, fontSize: 12, color: C.textFaint }}>{t.biggestEvent} {s.maxPlace}</div>}
                  </div>
                );
              })}
            </div>
          </SectionGroup>

          <SectionGroup eyebrow={t.grp2Eyebrow} title={t.grp2Title}>
            <ChartCard title={t.mapSectionTitle} subtitle={mapView === "bubbles" ? t.bubblesSubtitle : mapView === "density" ? t.densitySubtitle : t.regionsSubtitle} wide>
              <div style={{ marginBottom: 14 }}>
                <SegmentedControl options={[["bubbles", t.tabBubbles], ["density", t.tabDensity], ["regions", t.tabRegions]]} value={mapView} onChange={setMapView} />
              </div>
              <div className={gridClass || undefined}>
                {visibleCountries.map((id) => (
                  <div key={id}>
                    <div style={{ fontSize: 11.5, color: colorFor(id), fontFamily: "'JetBrains Mono', monospace", marginBottom: 6 }}>{countryLabel(id, lang)}</div>
                    <CountryMapCard id={id} events={filtered[id] || []} mapView={mapView} rowHeight={mapRowHeight} />
                  </div>
                ))}
              </div>
            </ChartCard>
          </SectionGroup>

          <SectionGroup eyebrow={t.grp3Eyebrow} title={t.grp3Title}>
            {isDesktop ? (
              <>
                <div className={gridClass || undefined}>
                  {visibleCountries.map((id) => (
                    <ChartCard key={id} title={`${t.magTimeTitle} — ${countryLabel(id, lang)}`} subtitle={t.magTimeSubtitleDesktop}>
                      <ResponsiveContainer width="100%" height={240}>
                        <LineChart data={lineData(id)} margin={{ top: 4, right: 10, left: -18, bottom: 0 }}>
                          <CartesianGrid stroke={C.grid} vertical={false} />
                          <XAxis dataKey="x" type="number" domain={["dataMin", "dataMax"]} tickFormatter={(v) => fmtAxisTime(v, granularity, lang)} stroke={C.textFaint} fontSize={11} />
                          <YAxis domain={[0, "dataMax + 1"]} stroke={C.textFaint} fontSize={11} />
                          <Tooltip contentStyle={tooltipStyle} itemStyle={tooltipItemStyle} labelFormatter={(v) => fmtLocalTime(v, id, lang)} formatter={(v) => [v, t.magAxis]} isAnimationActive={false} />
                          <Line type="monotone" dataKey="mag" stroke={colorFor(id)} strokeWidth={2.8} dot={false} isAnimationActive={false} />
                        </LineChart>
                      </ResponsiveContainer>
                    </ChartCard>
                  ))}
                </div>
                {visibleCountries.length > 1 && (
                  <ChartCard title={t.comparisonTitle} subtitle={t.comparisonSubtitle} wide>
                    <ResponsiveContainer width="100%" height={300}>
                      <AreaChart data={stackedArea} margin={{ top: 4, right: 10, left: -18, bottom: 0 }}>
                        <defs>{visibleCountries.map((id) => (
                          <linearGradient key={id} id={`gradD-${id}`} x1="0" y1="0" x2="0" y2="1">
                            <stop offset="0%" stopColor={colorFor(id)} stopOpacity={0.55} />
                            <stop offset="100%" stopColor={colorFor(id)} stopOpacity={0.03} />
                          </linearGradient>
                        ))}</defs>
                        <CartesianGrid stroke={C.grid} vertical={false} />
                        <XAxis dataKey="x" type="number" domain={["dataMin", "dataMax"]} tickFormatter={(v) => fmtAxisTime(v, granularity, lang)} stroke={C.textFaint} fontSize={11} />
                        <YAxis stroke={C.textFaint} fontSize={11} />
                        <Tooltip contentStyle={tooltipStyle} itemStyle={tooltipItemStyle} labelFormatter={(v) => fmtAxisTime(v, granularity, lang)} isAnimationActive={false} />
                        <Legend wrapperStyle={{ fontSize: 12 }} formatter={(v) => countryLabel(v, lang) || v} />
                        {visibleCountries.map((id) => <Area key={id} type="monotone" dataKey={id} stroke={colorFor(id)} strokeWidth={2.5} fill={`url(#gradD-${id})`} isAnimationActive={false} />)}
                      </AreaChart>
                    </ResponsiveContainer>
                  </ChartCard>
                )}
              </>
            ) : (
              <ChartCard title={t.magTimeTitle} subtitle={t.magTimeSubtitleMobile} wide>
                <div style={{ marginBottom: 12 }}>
                  <SegmentedControl options={[...visibleCountries.map((id) => [id, countryLabel(id, lang)]), ...(visibleCountries.length > 1 ? [["comparacion", t.comparacion]] : [])]} value={magTab || visibleCountries[0]} onChange={setMagTab} />
                </div>
                <div className="fadeIn" key={magTab}>
                  {magTab !== "comparacion" ? (
                    <ResponsiveContainer width="100%" height={280}>
                      <LineChart data={lineData(magTab || visibleCountries[0])} margin={{ top: 4, right: 10, left: -18, bottom: 0 }}>
                        <CartesianGrid stroke={C.grid} vertical={false} />
                        <XAxis dataKey="x" type="number" domain={["dataMin", "dataMax"]} tickFormatter={(v) => fmtAxisTime(v, granularity, lang)} stroke={C.textFaint} fontSize={11} />
                        <YAxis domain={[0, "dataMax + 1"]} stroke={C.textFaint} fontSize={11} />
                        <Tooltip contentStyle={tooltipStyle} itemStyle={tooltipItemStyle} labelFormatter={(v) => fmtLocalTime(v, magTab || visibleCountries[0], lang)} formatter={(v) => [v, t.magAxis]} isAnimationActive={false} />
                        <Line type="monotone" dataKey="mag" stroke={colorFor(magTab || visibleCountries[0])} strokeWidth={2.8} dot={false} isAnimationActive={false} />
                      </LineChart>
                    </ResponsiveContainer>
                  ) : (
                    <ResponsiveContainer width="100%" height={300}>
                      <AreaChart data={stackedArea} margin={{ top: 4, right: 10, left: -18, bottom: 0 }}>
                        <defs>{visibleCountries.map((id) => (
                          <linearGradient key={id} id={`gradM-${id}`} x1="0" y1="0" x2="0" y2="1">
                            <stop offset="0%" stopColor={colorFor(id)} stopOpacity={0.55} />
                            <stop offset="100%" stopColor={colorFor(id)} stopOpacity={0.03} />
                          </linearGradient>
                        ))}</defs>
                        <CartesianGrid stroke={C.grid} vertical={false} />
                        <XAxis dataKey="x" type="number" domain={["dataMin", "dataMax"]} tickFormatter={(v) => fmtAxisTime(v, granularity, lang)} stroke={C.textFaint} fontSize={11} />
                        <YAxis stroke={C.textFaint} fontSize={11} />
                        <Tooltip contentStyle={tooltipStyle} itemStyle={tooltipItemStyle} labelFormatter={(v) => fmtAxisTime(v, granularity, lang)} isAnimationActive={false} />
                        <Legend wrapperStyle={{ fontSize: 12 }} formatter={(v) => countryLabel(v, lang) || v} />
                        {visibleCountries.map((id) => <Area key={id} type="monotone" dataKey={id} stroke={colorFor(id)} strokeWidth={2.5} fill={`url(#gradM-${id})`} isAnimationActive={false} />)}
                      </AreaChart>
                    </ResponsiveContainer>
                  )}
                </div>
              </ChartCard>
            )}

            <ChartCard title={t.cumulativeTitle} subtitle={t.cumulativeSubtitle} wide>
              <ResponsiveContainer width="100%" height={260}>
                <LineChart data={cumulative} margin={{ top: 4, right: 10, left: -18, bottom: 0 }}>
                  <CartesianGrid stroke={C.grid} vertical={false} />
                  <XAxis dataKey="x" type="number" domain={["dataMin", "dataMax"]} tickFormatter={(v) => fmtAxisTime(v, granularity, lang)} stroke={C.textFaint} fontSize={11} />
                  <YAxis stroke={C.textFaint} fontSize={11} />
                  <Tooltip contentStyle={tooltipStyle} itemStyle={tooltipItemStyle} labelFormatter={(v) => fmtAxisTime(v, granularity, lang)} isAnimationActive={false} />
                  <Legend wrapperStyle={{ fontSize: 12 }} formatter={(v) => countryLabel(v, lang) || v} />
                  {visibleCountries.map((id) => <Line key={id} type="stepAfter" dataKey={id} stroke={colorFor(id)} strokeWidth={2.8} dot={false} isAnimationActive={false} />)}
                </LineChart>
              </ResponsiveContainer>
            </ChartCard>
          </SectionGroup>

          <SectionGroup eyebrow={t.grp4Eyebrow} title={t.grp4Title}>
            <ChartCard title={t.histTitle} subtitle={t.histSubtitle} wide>
              <ResponsiveContainer width="100%" height={260}>
                <BarChart data={histogram} margin={{ top: 4, right: 10, left: -18, bottom: 0 }}>
                  <CartesianGrid stroke={C.grid} vertical={false} />
                  <XAxis dataKey="bin" stroke={C.textFaint} fontSize={11} />
                  <YAxis stroke={C.textFaint} fontSize={11} />
                  <Tooltip contentStyle={tooltipStyle} itemStyle={tooltipItemStyle} isAnimationActive={false} />
                  <Legend wrapperStyle={{ fontSize: 12 }} formatter={(v) => countryLabel(v, lang) || v} />
                  {visibleCountries.map((id) => <Bar key={id} dataKey={id} fill={colorFor(id)} radius={[4, 4, 0, 0]} isAnimationActive={false} />)}
                </BarChart>
              </ResponsiveContainer>
            </ChartCard>

            <div className={gridClass || undefined}>
              {visibleCountries.map((id) => (
                <ChartCard key={id} title={`${t.depthTitle} ${countryLabel(id, lang)}`} subtitle={t.depthSubtitle}>
                  <ResponsiveContainer width="100%" height={240}>
                    <ScatterChart margin={{ top: 4, right: 10, left: -18, bottom: 0 }}>
                      <CartesianGrid stroke={C.grid} />
                      <XAxis dataKey="depth" name={t.depthAxis} unit=" km" stroke={C.textFaint} fontSize={11} />
                      <YAxis dataKey="mag" name={t.magAxis} stroke={C.textFaint} fontSize={11} />
                      <ZAxis range={[30, 30]} />
                      <Tooltip contentStyle={tooltipStyle} itemStyle={tooltipItemStyle} cursor={{ stroke: C.textFaint }} formatter={(v, n) => [v, n === "depth" ? `${t.depthAxis} (km)` : t.magAxis]} isAnimationActive={false} />
                      <Scatter data={depthScatter(id)} isAnimationActive={false}>
                        {depthScatter(id).map((e, i) => <Cell key={i} fill={ALERT_COLOR[e.alert]} fillOpacity={0.85} />)}
                      </Scatter>
                    </ScatterChart>
                  </ResponsiveContainer>
                  <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginTop: 4, fontSize: 11, color: C.textDim }}>
                    {Object.entries(ALERT_LABEL).map(([k, l]) => (
                      <span key={k} style={{ display: "flex", alignItems: "center", gap: 4 }}><span style={{ width: 8, height: 8, borderRadius: "50%", background: ALERT_COLOR[k], display: "inline-block" }} />{l}</span>
                    ))}
                  </div>
                </ChartCard>
              ))}
            </div>

            <div className={gridClass || undefined}>
              {visibleCountries.map((id) => (
                <ChartCard key={id} title={`${t.alertTitle} ${countryLabel(id, lang)}`} subtitle={t.alertSubtitle}>
                  <ResponsiveContainer width="100%" height={220}>
                    <PieChart>
                      <Pie data={alertBreakdown(id)} dataKey="value" nameKey="name" innerRadius={52} outerRadius={80} paddingAngle={2} isAnimationActive={false}>
                        {alertBreakdown(id).map((e, i) => <Cell key={i} fill={ALERT_COLOR[e.key]} />)}
                      </Pie>
                      <Tooltip content={<AlertTooltip />} isAnimationActive={false} />
                      <Legend wrapperStyle={{ fontSize: 12 }} />
                    </PieChart>
                  </ResponsiveContainer>
                </ChartCard>
              ))}
            </div>
          </SectionGroup>

          <div style={{ textAlign: "center", fontSize: 11, color: C.textFaint, padding: "10px 0 0" }}>{t.footer(MAX_COUNTRIES)}</div>
        </div>
      </div>
    </div>
    </LangContext.Provider>
    </ThemeContext.Provider>
  );
}
