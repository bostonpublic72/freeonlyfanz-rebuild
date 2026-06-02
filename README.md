# FreeOnlyFanz Rebuild

FreeOnlyFanz is a static Astro site backed by OnlyTraffic campaign data: import, analyze, build, then publish to cPanel.

## Setup

Use Node.js 18 or newer.

Install dependencies:

```bash
npm install
```

Create a local `.env` file:

```bash
ONLYTRAFFIC_API_KEY=your_onlytraffic_api_key_here
```

Do not commit `.env`. It is intentionally ignored by git.

## Data pipeline

Import OnlyTraffic campaigns and generate normalized creator data:

```bash
npm run import:onlytraffic
```

Import OnlyTraffic transactions:

```bash
npm run import:transactions
```

Analyze normalized creators and generate reports:

```bash
npm run analyze:offers
```

Refresh the full data pipeline:

```bash
npm run refresh:data
```

Manual curation overrides live in `data/manual-curation.json` (for example `forceFeatureNewInventory`).

## Build the site

```bash
npm run analyze:offers
npm run build
```

Output is written to `dist/`.

Preview locally:

```bash
npm run preview
```

## Deploy to production (manual upload)

There is no automatic deploy configured by default. After each build, upload the site to cPanel yourself.

1. Run `npm run build` so `dist/` is up to date.
2. Zip the **contents** of `dist/` (not the `dist` folder itself), so `index.html` is at the root of the zip.
   - On Windows PowerShell from the project root:
     ```powershell
     Compress-Archive -Path dist\* -DestinationPath freeonlyfanz-site.zip -Force
     ```
3. In cPanel **File Manager**, open `public_html` (or your site root).
4. Upload `freeonlyfanz-site.zip` and **Extract** into that folder.
5. Confirm `index.html` sits directly in `public_html`, not inside `public_html/dist/`.
6. Hard refresh the live site (Ctrl+F5).

Extracting over the old site updates matching files but may leave orphan folders under `creator/` from previous uploads. Delete any extra creator directories if you want the live site to match the current build exactly.

### Optional: FTP deploy script

`npm run deploy` / `npm run deploy:upload` can upload `dist/` via FTP if you add `FTP_HOST`, `FTP_USER`, and `FTP_PASSWORD` to `.env`. Until those are set, use the manual zip flow above.

## Data outputs

The importer writes:

- `data/raw/onlytraffic-campaigns.json`
- `data/raw/onlytraffic-transactions.json`
- `data/raw/import-meta.json`
- `data/raw/transactions-meta.json`
- `data/creators.json`

The analyzer writes:

- `data/reports/offer-analysis.json`
- `data/reports/offer-analysis.csv`

## Traffic-source notes

Warm Snapchat/Instagram traffic goes directly to OnlyFans affiliate links, not through FreeOnlyFanz. Known warm-social revshare winners are preserved as direct winners and are not automatically promoted for SEO pages.

FreeOnlyFanz SEO traffic should be evaluated separately and should generally favor free and free-trial revshare offers with usable images, reasonable country availability, and conversion evidence.

TwerkQueens popunder/nav-tab traffic is colder and should also be evaluated separately, usually favoring low-friction free-trial offers.

CPL commission campaigns are excluded from the public FreeOnlyFanz directory in `src/lib/creators.mjs`.
