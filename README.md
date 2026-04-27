# FreeOnlyFanz Rebuild

FreeOnlyFanz is being rebuilt as a clean SEO-focused creator discovery site powered by OnlyTraffic campaign data.

This phase does not build frontend pages. The current goal is to import OnlyTraffic inventory, normalize creator/campaign data, identify duplicates, separate traffic-source assumptions, and generate a human-reviewable recommendation report before any creator pages are created.

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

## Commands

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

## Outputs

The importer writes:

- `data/raw/onlytraffic-campaigns.json`
- `data/raw/onlytraffic-transactions.json`
- `data/raw/import-meta.json`
- `data/raw/transactions-meta.json`
- `data/creators.json`

The analyzer writes:

- `data/reports/offer-analysis.json`
- `data/reports/offer-analysis.csv`

## Traffic-Source Notes

Warm Snapchat/Instagram traffic goes directly to OnlyFans affiliate links, not through FreeOnlyFanz. Known warm-social revshare winners are preserved as direct winners and are not automatically promoted for SEO pages.

FreeOnlyFanz SEO traffic should be evaluated separately and should generally favor selective CPL, free, and free-trial offers with usable images, reasonable country availability, and conversion evidence.

TwerkQueens popunder/nav-tab traffic is colder and should also be evaluated separately, usually favoring low-friction CPL or free-trial offers.

## Current Stop Point

Homepage, category pages, creator pages, sitemap generation, and frontend components are intentionally not built yet.
