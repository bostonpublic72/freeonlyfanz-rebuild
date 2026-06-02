const fs = require("node:fs");
const path = require("node:path");

const ROOT = process.cwd();
const DIST_DIR = path.join(ROOT, "dist");
const REPORT_PATH = path.join(ROOT, "data", "reports", "offer-analysis.json");
const GUIDE_URLS = [
  "/free-onlyfans/",
  "/free-trial-onlyfans/",
  "/best-free-onlyfans-creators/",
  "/free-onlyfans-accounts/",
  "/onlyfans-free-vs-paid/",
];
const IMPORTANT_URLS = [
  "/",
  "/tq/",
  "/creators/",
  "/categories/",
  "/category/free/",
  "/category/free-trial/",
  "/category/new/",
  "/category/featured/",
  ...GUIDE_URLS,
];
const PUBLIC_SCAN_FILES = [
  "index.html",
  "tq/index.html",
  "creators/index.html",
  "categories/index.html",
  "category/free/index.html",
  "category/free-trial/index.html",
  "category/new/index.html",
  "category/featured/index.html",
  "free-onlyfans/index.html",
  "free-trial-onlyfans/index.html",
  "best-free-onlyfans-creators/index.html",
  "free-onlyfans-accounts/index.html",
  "onlyfans-free-vs-paid/index.html",
];

function readText(filePath) {
  return fs.readFileSync(filePath, "utf8");
}

function routeToDistFile(route) {
  if (route === "/") {
    return path.join(DIST_DIR, "index.html");
  }

  return path.join(DIST_DIR, route.replace(/^\/|\/$/g, ""), "index.html");
}

function collectHtmlFiles(dir, output = []) {
  if (!fs.existsSync(dir)) {
    return output;
  }

  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      collectHtmlFiles(fullPath, output);
    } else if (entry.isFile() && entry.name.endsWith(".html")) {
      output.push(fullPath);
    }
  }

  return output;
}

function relativeDistPath(filePath) {
  return path.relative(DIST_DIR, filePath).replace(/\\/g, "/");
}

function main() {
  const errors = [];
  const report = JSON.parse(readText(REPORT_PATH));
  const premiumCreators = report.creators.filter((creator) => creator.isPremiumOnly);
  const premiumSlugs = premiumCreators.map((creator) => creator.slug).filter(Boolean);
  const htmlFiles = collectHtmlFiles(DIST_DIR);
  const sitemapPath = path.join(DIST_DIR, "sitemap.xml");
  const robotsPath = path.join(DIST_DIR, "robots.txt");
  const sitemap = fs.existsSync(sitemapPath) ? readText(sitemapPath) : "";
  const robots = fs.existsSync(robotsPath) ? readText(robotsPath) : "";

  for (const route of IMPORTANT_URLS) {
    if (!fs.existsSync(routeToDistFile(route))) {
      errors.push(`Missing built route: ${route}`);
    }
  }

  for (const guideUrl of GUIDE_URLS) {
    const guideOwnFile = relativeDistPath(routeToDistFile(guideUrl));
    const inboundFiles = htmlFiles.filter((filePath) => {
      const relativePath = relativeDistPath(filePath);
      if (relativePath === guideOwnFile) {
        return false;
      }

      return readText(filePath).includes(`href="${guideUrl}"`) || readText(filePath).includes(`href='${guideUrl}'`);
    });

    if (inboundFiles.length === 0) {
      errors.push(`Guide page appears orphaned: ${guideUrl}`);
    }
  }

  if (!sitemap) {
    errors.push("dist/sitemap.xml is missing.");
  }
  if (!robots) {
    errors.push("dist/robots.txt is missing.");
  }
  if (sitemap && !sitemap.includes("https://freeonlyfanz.com/")) {
    errors.push("sitemap.xml does not appear to use https://freeonlyfanz.com URLs.");
  }
  if (robots && /disallow:\s*\/\s*$/im.test(robots)) {
    errors.push("robots.txt appears to disallow the whole site.");
  }

  for (const route of GUIDE_URLS) {
    if (!sitemap.includes(`https://freeonlyfanz.com${route}`)) {
      errors.push(`Guide route missing from sitemap: ${route}`);
    }

    const filePath = routeToDistFile(route);
    if (!fs.existsSync(filePath)) {
      continue;
    }

    const html = readText(filePath);
    if (/name=["']robots["'][^>]+content=["'][^"']*noindex/i.test(html)) {
      errors.push(`Guide page is noindex: ${route}`);
    }
    if (!html.includes(`rel="canonical" href="https://freeonlyfanz.com${route}"`)) {
      errors.push(`Guide canonical mismatch: ${route}`);
    }
  }

  const publicHtml = PUBLIC_SCAN_FILES.map((file) => {
    const filePath = path.join(DIST_DIR, file);
    return fs.existsSync(filePath) ? readText(filePath) : "";
  }).join("\n");

  for (const slug of premiumSlugs) {
    if (fs.existsSync(path.join(DIST_DIR, "creator", slug, "index.html"))) {
      errors.push(`Premium-only creator route generated: /creator/${slug}/`);
    }
    if (sitemap.includes(`/creator/${slug}/`)) {
      errors.push(`Premium-only creator appears in sitemap: /creator/${slug}/`);
    }
    if (publicHtml.includes(`/creator/${slug}/`)) {
      errors.push(`Premium-only creator linked from public page: /creator/${slug}/`);
    }
  }

  console.log("Public site audit complete.");
  console.log(`Guide pages checked: ${GUIDE_URLS.length}`);
  console.log(`Premium-only creators checked: ${premiumSlugs.length}`);
  console.log(`Important routes checked: ${IMPORTANT_URLS.length}`);

  if (errors.length > 0) {
    console.error("\nAudit errors:");
    for (const error of errors) {
      console.error(`- ${error}`);
    }
    process.exit(1);
  }

  console.log("Guide pages are internally linked, SEO basics look correct, and premium-only creator URLs are not public.");
}

main();
