# Actividad Sísmica — Monitor USGS

Real-time seismic activity dashboard for Chile, Spain, and 12 other countries, built on live USGS earthquake data and geoBoundaries administrative boundary data.

- Live data: USGS FDSN Event Web Service
- Boundaries: [geoBoundaries](https://www.geoboundaries.org) (CC-BY 4.0)
- Auto light/dark theme (follows system preference, manual override available)
- Auto Spanish/English (follows browser language)
- Up to 3 countries compared simultaneously

## Local development

```bash
npm install
npm run dev
```

## Build

```bash
npm run build
```

Outputs a static site to `dist/`.

## Deploy to Cloudflare Pages

1. Push this repo to GitHub (see below).
2. In the Cloudflare dashboard: **Workers & Pages → Create → Pages → Connect to Git**.
3. Select this repo.
4. Build settings:
   - Framework preset: **Vite**
   - Build command: `npm run build`
   - Build output directory: `dist`
5. Deploy. Every push to `main` redeploys automatically.

## Push to GitHub (first time)

```bash
git init
git add .
git commit -m "Initial commit"
git branch -M main
git remote add origin https://github.com/<your-username>/<repo-name>.git
git push -u origin main
```
