import React, { useState, useEffect, useMemo, useCallback } from "react";
import {
  LineChart, Line, AreaChart, Area, BarChart, Bar, ScatterChart, Scatter,
  PieChart, Pie, Cell, XAxis, YAxis, ZAxis, CartesianGrid, Tooltip, Legend,
  ResponsiveContainer,
} from "recharts";
import { geoMercator, geoPath, geoContains } from "d3-geo";
import { STRINGS, detectLang } from "./i18n.js";

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
    heatLow: "#3A0A0A", heatMid: "#B2231F", heatHigh: "#FF1F8F",
    alertGreen: "#3FD17A", alertYellow: "#D8B93A", alertOrange: "#E0722A", alertRed: "#8B0000", alertNone: "#8C8680",
    palette: ["#2DD8C9", "#B860F5", "#E8A23A"], cardTint: "rgba(255,255,255,0.012)", glowAlpha: [0.28, 0.10],
  },
  atlas: {
    name: "Atlas de Campo", mode: "light",
    bg: "#F2ECDC", border: "rgba(36,31,26,0.10)", borderHover: "rgba(36,31,26,0.22)", grid: "#D9CFB8",
    text: "#241F1A", textDim: "#5C5346", textFaint: "#655D4D",
    bloodRed: "#8B2318", rose: "#A8481F", dotRed: "#6B3A56",
    heatLow: "#2A1608", heatMid: "#A8481F", heatHigh: "#E8B23A",
    alertGreen: "#2F6B38", alertYellow: "#8C6D1F", alertOrange: "#A34E1C", alertRed: "#8B2318", alertNone: "#9C9187",
    palette: ["#2E4374", "#A8481F", "#7A6624"], cardTint: "rgba(36,31,26,0.035)", glowAlpha: [0.07, 0.04],
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
  spain:     { label: "España", iso3: "ESP", bbox: { minlatitude: 27, maxlatitude: 44, minlongitude: -19, maxlongitude: 5 }, matches: ["spain"], tz: "Europe/Madrid", locale: "es-ES", activity: "medium", depthProfile: "shallow" },
  mexico:    { label: "México", iso3: "MEX", bbox: { minlatitude: 14, maxlatitude: 33, minlongitude: -118, maxlongitude: -86 }, matches: ["mexico"], tz: "America/Mexico_City", locale: "es-ES", activity: "high", depthProfile: "subduction" },
  peru:      { label: "Perú", iso3: "PER", bbox: { minlatitude: -19, maxlatitude: 0, minlongitude: -82, maxlongitude: -68 }, matches: ["peru"], tz: "America/Lima", locale: "es-ES", activity: "high", depthProfile: "subduction" },
  japan:     { label: "Japón", iso3: "JPN", bbox: { minlatitude: 24, maxlatitude: 46, minlongitude: 123, maxlongitude: 146 }, matches: ["japan"], tz: "Asia/Tokyo", locale: "es-ES", activity: "high", depthProfile: "subduction", tall: true },
  indonesia: { label: "Indonesia", iso3: "IDN", bbox: { minlatitude: -11, maxlatitude: 6, minlongitude: 95, maxlongitude: 141 }, matches: ["indonesia"], tz: "Asia/Jakarta", locale: "es-ES", activity: "high", depthProfile: "subduction" },
  turkey:    { label: "Turquía", iso3: "TUR", bbox: { minlatitude: 36, maxlatitude: 42, minlongitude: 26, maxlongitude: 45 }, matches: ["turkey"], tz: "Europe/Istanbul", locale: "es-ES", activity: "medium", depthProfile: "shallow" },
  italy:     { label: "Italia", iso3: "ITA", bbox: { minlatitude: 36, maxlatitude: 47, minlongitude: 6, maxlongitude: 19 }, matches: ["italy"], tz: "Europe/Rome", locale: "es-ES", activity: "medium", depthProfile: "shallow", tall: true },
  greece:    { label: "Grecia", iso3: "GRC", bbox: { minlatitude: 34, maxlatitude: 42, minlongitude: 19, maxlongitude: 30 }, matches: ["greece"], tz: "Europe/Athens", locale: "es-ES", activity: "medium", depthProfile: "shallow" },
  ecuador:   { label: "Ecuador", iso3: "ECU", bbox: { minlatitude: -5, maxlatitude: 2, minlongitude: -81, maxlongitude: -75 }, matches: ["ecuador"], tz: "America/Guayaquil", locale: "es-ES", activity: "medium", depthProfile: "subduction" },
  colombia:  { label: "Colombia", iso3: "COL", bbox: { minlatitude: -4, maxlatitude: 13, minlongitude: -79, maxlongitude: -66 }, matches: ["colombia"], tz: "America/Bogota", locale: "es-ES", activity: "medium", depthProfile: "subduction" },
  portugal:  { label: "Portugal", iso3: "PRT", bbox: { minlatitude: 36, maxlatitude: 42, minlongitude: -10, maxlongitude: -6 }, matches: ["portugal"], tz: "Europe/Lisbon", locale: "es-ES", activity: "low", depthProfile: "shallow" },
  iceland:   { label: "Islandia", iso3: "ISL", bbox: { minlatitude: 63, maxlatitude: 67, minlongitude: -25, maxlongitude: -13 }, matches: ["iceland"], tz: "Atlantic/Reykjavik", locale: "es-ES", activity: "medium", depthProfile: "mixed" },
  usa_ca:    { label: "EE. UU. (California)", iso3: "USA", bbox: { minlatitude: 32, maxlatitude: 42, minlongitude: -125, maxlongitude: -114 }, matches: [", ca", "california"], tz: "America/Los_Angeles", locale: "es-ES", activity: "medium", depthProfile: "shallow" },
};
const DEFAULT_ACTIVE = ["chile", "spain"];

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

function generateFallback(id) {
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
      place: `${cfg.label} (estimado)`, time: t, alert,
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

async function fetchBoundary(iso3, level) {
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
  return await geomRes.json();
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
    <div className="chipHover" style={{ background: "rgba(128,128,128,0.06)", border: `1px solid ${C.border}`, borderRadius: 12, padding: "10px 14px", minWidth: 118, flex: "1 1 118px" }}>
      <div style={{ fontSize: 11, color: C.textDim, textTransform: "uppercase", letterSpacing: 0.5 }}>{label}</div>
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

function getTooltipStyle() { return { background: "#161217", border: "1px solid rgba(255,255,255,0.12)", borderRadius: 10, fontSize: 12.5, color: "#EDEAE7", padding: "8px 12px" }; }

function AlertTooltip({ active, payload }) {
  const ALERT_TEXT = { green: "#7CE3A6", yellow: "#E8D577", orange: "#F2A366", red: "#FF6B6B", none: "#FFFFFF" };
  if (!active || !payload || !payload.length) return null;
  const p = payload[0].payload;
  return (
    <div style={getTooltipStyle()}>
      <span style={{ color: p.key === "none" ? "#FFFFFF" : ALERT_TEXT[p.key], fontWeight: 600 }}>{p.name}</span>
      <span style={{ color: "#9C9591" }}> — {p.value}</span>
    </div>
  );
}

function DensityField({ pts, w, h, uid, minR = 10, maxR = 30, blur = 9 }) {
  const C = React.useContext(ThemeContext);
  return (
    <svg viewBox={`0 0 ${w} ${h}`} style={{ width: "100%", height: "100%", display: "block" }}>
      <defs><filter id={`dblur-${uid}`} x="-60%" y="-60%" width="220%" height="220%"><feGaussianBlur stdDeviation={blur} /></filter></defs>
      <rect x="0" y="0" width={w} height={h} fill="rgba(255,255,255,0.015)" />
      <g filter={`url(#dblur-${uid})`} style={{ mixBlendMode: "screen" }}>
        {pts.map((p, i) => <circle key={i} cx={p.x} cy={p.y} r={minR + (p.w || 0.4) * (maxR - minR)} fill={C.heatHigh} fillOpacity={0.16} />)}
      </g>
      <g style={{ mixBlendMode: "screen" }}>
        {pts.map((p, i) => <circle key={`core-${i}`} cx={p.x} cy={p.y} r={2} fill={C.heatHigh} fillOpacity={0.35} />)}
      </g>
    </svg>
  );
}

function hexToRgb(hex) { const m = hex.replace("#", ""); return { r: parseInt(m.substring(0, 2), 16), g: parseInt(m.substring(2, 4), 16), b: parseInt(m.substring(4, 6), 16) }; }
function withAlpha(hex, a) { const { r, g, b } = hexToRgb(hex); return `rgba(${r},${g},${b},${a})`; }
function lerpColor(a, b, t) { const pa = hexToRgb(a), pb = hexToRgb(b); return `rgb(${Math.round(pa.r + (pb.r - pa.r) * t)},${Math.round(pa.g + (pb.g - pa.g) * t)},${Math.round(pa.b + (pb.b - pa.b) * t)})`; }
function heatColor(C, v, max) {
  const t = Math.min(1, v / max);
  if (t === 0) return "rgba(128,128,128,0.06)";
  if (t < 0.5) return lerpColor(C.heatLow, C.heatMid, t / 0.5);
  return lerpColor(C.heatMid, C.heatHigh, (t - 0.5) / 0.5);
}

/* ---------------------------------------------------------------------- */
/* Sección de mapa unificada — Epicentros / Densidad / Regiones           */
/* Usa geoBoundaries en vivo (ADM0 para el contorno, ADM1 para regiones)  */
/* proyectadas con d3-geo; los límites se piden solo bajo demanda.        */
/* ---------------------------------------------------------------------- */
function CountryMapCard({ id, events, mapView }) {
  const C = React.useContext(ThemeContext);
  const t = React.useContext(LangContext);
  const cfg = COUNTRY_REGISTRY[id];
  const [adm0, setAdm0] = useState(null);
  const [adm0Status, setAdm0Status] = useState("loading");
  const [adm1, setAdm1] = useState(null);
  const [adm1Status, setAdm1Status] = useState("idle");
  const [popup, setPopup] = useState(null);

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

  const projection = useMemo(() => {
    if (!adm0) return null;
    try {
      return geoMercator().fitSize([W - 16, H - 16], adm0);
    } catch { return null; }
  }, [adm0, W, H]);

  const path = useMemo(() => (projection ? geoPath(projection) : null), [projection]);

  const projected = useMemo(() => {
    if (!projection) return [];
    return events.map((e) => {
      const p = projection([e.lon, e.lat]);
      return p ? { ...e, x: p[0] + 8, y: p[1] + 8 } : null;
    }).filter(Boolean);
  }, [projection, events]);

  const maxMag = Math.max(1, ...events.map((e) => e.mag));

  const regionCounts = useMemo(() => {
    if (!adm1) return null;
    return adm1.features.map((f) => {
      let count = 0;
      events.forEach((e) => { if (geoContains(f, [e.lon, e.lat])) count += 1; });
      return { feature: f, count, d: path ? path(f) : "" };
    });
  }, [adm1, events, path]);
  const maxRegionCount = regionCounts ? Math.max(1, ...regionCounts.map((r) => r.count)) : 1;

  if (adm0Status === "loading") {
    return <div style={{ height: H * 0.5, display: "flex", alignItems: "center", justifyContent: "center", color: C.textFaint, fontSize: 12.5 }}>{t.loadingBoundary}</div>;
  }
  if (adm0Status === "error" || !path) {
    return <div style={{ height: H * 0.5, display: "flex", alignItems: "center", justifyContent: "center", color: C.textFaint, fontSize: 12.5, textAlign: "center", padding: 20 }}>{t.boundaryError}</div>;
  }

  return (
    <div style={{ position: "relative" }}>
      <svg viewBox={`0 0 ${W} ${H}`} style={{ width: "100%", height: cfg.tall ? 420 : 300, background: "rgba(128,128,128,0.04)", borderRadius: 10 }}
        onClick={() => setPopup((p) => (p && p.pinned ? null : p))}>
        <g transform="translate(8,8)">
          {mapView === "regions" && regionCounts && regionCounts.map((r, i) => (
            <path key={i} d={r.d} fill={heatColor(C, r.count, maxRegionCount)} stroke={withAlpha(C.text, 0.15)} strokeWidth={0.5}>
              <title>{`${r.feature.properties?.shapeName || "?"}: ${r.count}`}</title>
            </path>
          ))}
          {mapView === "regions" && adm1Status === "loading" && (
            <text x={(W - 16) / 2} y={(H - 16) / 2} textAnchor="middle" fontSize="11" fill={C.textFaint}>{t.loadingBoundary}</text>
          )}
          {mapView !== "regions" && path(adm0) && (
            <path d={path(adm0)} fill="none" stroke={C.textFaint} strokeWidth={0.8} opacity={0.6} />
          )}
          {mapView === "bubbles" && projected.map((p, i) => {
            const r = 2 + (p.mag / maxMag) * 7;
            return (
              <circle key={i} cx={p.x} cy={p.y} r={r} fill={C.dotRed} fillOpacity={0.85} stroke={withAlpha(C.bg, 0.6)} strokeWidth={0.6}
                style={{ cursor: "pointer" }}
                onMouseEnter={() => { if (!(popup && popup.pinned)) setPopup({ event: p, x: p.x, y: p.y, pinned: false }); }}
                onMouseLeave={() => setPopup((pp) => (pp && pp.pinned ? pp : null))}
                onClick={(ev) => { ev.stopPropagation(); setPopup({ event: p, x: p.x, y: p.y, pinned: true }); }} />
            );
          })}
          {mapView === "density" && (
            <DensityField pts={projected.map((p) => ({ x: p.x, y: p.y, w: p.mag / maxMag }))} w={W - 16} h={H - 16} uid={`${id}-dens`} minR={cfg.tall ? 22 : 14} maxR={cfg.tall ? 42 : 28} blur={cfg.tall ? 12 : 9} />
          )}
        </g>
      </svg>
      {popup && (
        <div style={{
          position: "absolute", left: `${(popup.x / W) * 100}%`, top: `${(popup.y / H) * 100}%`,
          transform: "translate(-50%, -115%)", background: "#161217", border: "1px solid rgba(255,255,255,0.12)",
          borderRadius: 10, padding: "10px 12px", minWidth: 190, boxShadow: "0 8px 24px rgba(0,0,0,0.5)", zIndex: 5,
          pointerEvents: popup.pinned ? "auto" : "none",
        }}>
          {popup.pinned && <button onClick={() => setPopup(null)} aria-label="Close" style={{ position: "absolute", top: 4, right: 6, background: "none", border: "none", color: "#9C9591", fontSize: 14, cursor: "pointer", lineHeight: 1 }}>×</button>}
          <div style={{ fontSize: 12.5, color: "#EDEAE7", fontWeight: 600, paddingRight: 14 }}>{popup.event.place}</div>
          <div style={{ fontSize: 11.5, color: "#9C9591", marginTop: 4, display: "flex", flexDirection: "column", gap: 2 }}>
            <span>M <b style={{ color: "#FF6B4C" }}>{popup.event.mag}</b> · {popup.event.depth} km</span>
            {popup.event.time && <span>{fmtLocalTime(popup.event.time, id, "es")}</span>}
          </div>
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
          {COUNTRY_REGISTRY[id].label}
          {active.length > 1 && (
            <span onClick={(ev) => { ev.stopPropagation(); onRemove(id); }} aria-label={t.removeCountry(COUNTRY_REGISTRY[id].label)}
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
                {COUNTRY_REGISTRY[id].label}
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
  const tooltipStyle = getTooltipStyle();
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
      setData((d) => ({ ...d, [id]: generateFallback(id) }));
      setStatus((s) => ({ ...s, [id]: "fallback" }));
    }
  }, []);

  useEffect(() => { DEFAULT_ACTIVE.forEach(load); setUpdatedAt(new Date()); }, [load]);

  const colorFor = useCallback((id) => C.palette[activeCountries.indexOf(id) % C.palette.length] || C.textDim, [activeCountries, C]);

  const handleAdd = (id) => { if (activeCountries.includes(id) || activeCountries.length >= MAX_COUNTRIES) return; setActiveCountries((a) => [...a, id]); load(id); };
  const handleRemove = (id) => { setActiveCountries((a) => a.filter((x) => x !== id)); if (focus === id) setFocus(null); if (magTab === id) setMagTab(null); };
  const handleToggleFocus = (id) => setFocus((f) => (f === id ? null : id));
  const visibleCountries = focus ? [focus] : activeCountries;

  useEffect(() => { if (!visibleCountries.includes(magTab) && magTab !== "comparacion") setMagTab(visibleCountries[0]); }, [visibleCountries.join(","), magTab]);

  const cutoff = Date.now() - RANGE_MS[range];
  const granularity = range === "day" ? "hour" : range === "year" ? "week" : "day";

  const filtered = useMemo(() => {
    const out = {};
    activeCountries.forEach((id) => { out[id] = (data[id] || []).filter((e) => e.time >= cutoff).sort((a, b) => a.time - b.time); });
    return out;
  }, [data, cutoff, activeCountries]);

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
  const titleLabels = visibleCountries.map((id) => COUNTRY_REGISTRY[id].label);

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
                {t.focusNote()}<b style={{ color: colorFor(focus) }}>{COUNTRY_REGISTRY[focus].label}</b>{t.focusNoteEnd}
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
                    <h3 style={{ margin: "0 0 10px", fontFamily: "'Chakra Petch', sans-serif", color: colorFor(id), fontSize: 15, textTransform: "uppercase", letterSpacing: 0.5 }}>{COUNTRY_REGISTRY[id].label} · {RANGE_LABEL[range]}</h3>
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
                    <div style={{ fontSize: 11.5, color: colorFor(id), fontFamily: "'JetBrains Mono', monospace", marginBottom: 6 }}>{COUNTRY_REGISTRY[id].label}</div>
                    <CountryMapCard id={id} events={filtered[id] || []} mapView={mapView} />
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
                    <ChartCard key={id} title={`${t.magTimeTitle} — ${COUNTRY_REGISTRY[id].label}`} subtitle={t.magTimeSubtitleDesktop}>
                      <ResponsiveContainer width="100%" height={240}>
                        <LineChart data={lineData(id)} margin={{ top: 4, right: 10, left: -18, bottom: 0 }}>
                          <CartesianGrid stroke={C.grid} vertical={false} />
                          <XAxis dataKey="x" type="number" domain={["dataMin", "dataMax"]} tickFormatter={(v) => fmtAxisTime(v, granularity, lang)} stroke={C.textFaint} fontSize={11} />
                          <YAxis domain={[0, "dataMax + 1"]} stroke={C.textFaint} fontSize={11} />
                          <Tooltip contentStyle={tooltipStyle} labelFormatter={(v) => fmtLocalTime(v, id, lang)} formatter={(v) => [v, t.magAxis]} />
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
                        <Tooltip contentStyle={tooltipStyle} labelFormatter={(v) => fmtAxisTime(v, granularity, lang)} />
                        <Legend wrapperStyle={{ fontSize: 12 }} formatter={(v) => COUNTRY_REGISTRY[v]?.label || v} />
                        {visibleCountries.map((id) => <Area key={id} type="monotone" dataKey={id} stroke={colorFor(id)} strokeWidth={2.5} fill={`url(#gradD-${id})`} isAnimationActive={false} />)}
                      </AreaChart>
                    </ResponsiveContainer>
                  </ChartCard>
                )}
              </>
            ) : (
              <ChartCard title={t.magTimeTitle} subtitle={t.magTimeSubtitleMobile} wide>
                <div style={{ marginBottom: 12 }}>
                  <SegmentedControl options={[...visibleCountries.map((id) => [id, COUNTRY_REGISTRY[id].label]), ...(visibleCountries.length > 1 ? [["comparacion", t.comparacion]] : [])]} value={magTab || visibleCountries[0]} onChange={setMagTab} />
                </div>
                <div className="fadeIn" key={magTab}>
                  {magTab !== "comparacion" ? (
                    <ResponsiveContainer width="100%" height={280}>
                      <LineChart data={lineData(magTab || visibleCountries[0])} margin={{ top: 4, right: 10, left: -18, bottom: 0 }}>
                        <CartesianGrid stroke={C.grid} vertical={false} />
                        <XAxis dataKey="x" type="number" domain={["dataMin", "dataMax"]} tickFormatter={(v) => fmtAxisTime(v, granularity, lang)} stroke={C.textFaint} fontSize={11} />
                        <YAxis domain={[0, "dataMax + 1"]} stroke={C.textFaint} fontSize={11} />
                        <Tooltip contentStyle={tooltipStyle} labelFormatter={(v) => fmtLocalTime(v, magTab || visibleCountries[0], lang)} formatter={(v) => [v, t.magAxis]} />
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
                        <Tooltip contentStyle={tooltipStyle} labelFormatter={(v) => fmtAxisTime(v, granularity, lang)} />
                        <Legend wrapperStyle={{ fontSize: 12 }} formatter={(v) => COUNTRY_REGISTRY[v]?.label || v} />
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
                  <Tooltip contentStyle={tooltipStyle} labelFormatter={(v) => fmtAxisTime(v, granularity, lang)} />
                  <Legend wrapperStyle={{ fontSize: 12 }} formatter={(v) => COUNTRY_REGISTRY[v]?.label || v} />
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
                  <Tooltip contentStyle={tooltipStyle} />
                  <Legend wrapperStyle={{ fontSize: 12 }} formatter={(v) => COUNTRY_REGISTRY[v]?.label || v} />
                  {visibleCountries.map((id) => <Bar key={id} dataKey={id} fill={colorFor(id)} radius={[4, 4, 0, 0]} isAnimationActive={false} />)}
                </BarChart>
              </ResponsiveContainer>
            </ChartCard>

            <div className={gridClass || undefined}>
              {visibleCountries.map((id) => (
                <ChartCard key={id} title={`${t.depthTitle} ${COUNTRY_REGISTRY[id].label}`} subtitle={t.depthSubtitle}>
                  <ResponsiveContainer width="100%" height={240}>
                    <ScatterChart margin={{ top: 4, right: 10, left: -18, bottom: 0 }}>
                      <CartesianGrid stroke={C.grid} />
                      <XAxis dataKey="depth" name={t.depthAxis} unit=" km" stroke={C.textFaint} fontSize={11} />
                      <YAxis dataKey="mag" name={t.magAxis} stroke={C.textFaint} fontSize={11} />
                      <ZAxis range={[30, 30]} />
                      <Tooltip contentStyle={tooltipStyle} cursor={{ stroke: C.textFaint }} formatter={(v, n) => [v, n === "depth" ? `${t.depthAxis} (km)` : t.magAxis]} />
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
                <ChartCard key={id} title={`${t.alertTitle} ${COUNTRY_REGISTRY[id].label}`} subtitle={t.alertSubtitle}>
                  <ResponsiveContainer width="100%" height={220}>
                    <PieChart>
                      <Pie data={alertBreakdown(id)} dataKey="value" nameKey="name" innerRadius={52} outerRadius={80} paddingAngle={2} isAnimationActive={false}>
                        {alertBreakdown(id).map((e, i) => <Cell key={i} fill={ALERT_COLOR[e.key]} />)}
                      </Pie>
                      <Tooltip content={<AlertTooltip />} />
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
