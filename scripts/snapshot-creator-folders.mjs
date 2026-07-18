import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";
import { absoluteUrl } from "../src/lib/site.mjs";

const ROOT = process.cwd();
const DIST_CREATOR_DIR = path.join(ROOT, "dist", "creator");
const SNAPSHOT_PATH = path.join(ROOT, "data", "creator-folder-snapshot.json");
const SITEMAP_CREATOR_PATTERN = /<loc>[^<]*\/creator\/([^/<]+)\/?<\/loc>/gi;

function readSnapshot() {
  try {
    return JSON.parse(fs.readFileSync(SNAPSHOT_PATH, "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") {
      return { slugs: [] };
    }
    throw error;
  }
}

function listDistCreatorFolders() {
  if (!fs.existsSync(DIST_CREATOR_DIR)) {
    return [];
  }

  return fs
    .readdirSync(DIST_CREATOR_DIR, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .filter(Boolean);
}

function slugFromCreatorIndexPath(entryPath) {
  const normalized = String(entryPath || "").trim().replace(/\\/g, "/");
  const match = normalized.match(/creator\/([^/]+)\/index\.html$/i);
  return match ? match[1] : "";
}

function listZipCreatorSlugs(zipPath) {
  if (!fs.existsSync(zipPath)) {
    return [];
  }

  const escapedPath = zipPath.replace(/'/g, "''");
  const command = [
    "Add-Type -AssemblyName System.IO.Compression.FileSystem",
    `$zip=[IO.Compression.ZipFile]::OpenRead('${escapedPath}')`,
    "$paths = $zip.Entries | Where-Object { $_.FullName -match '(^|[\\\\/])creator[\\\\/][^\\\\/]+[\\\\/]index\\.html$' } | ForEach-Object { $_.FullName }",
    "$zip.Dispose()",
    "$paths",
  ].join("; ");

  try {
    const output = execSync(`powershell -NoProfile -Command "${command}"`, {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    });

    return output
      .split(/\r?\n/)
      .map((line) => slugFromCreatorIndexPath(line.trim()))
      .filter(Boolean);
  } catch (_error) {
    return [];
  }
}

function listDeployZipSlugs() {
  const slugs = new Set();

  for (const entry of fs.readdirSync(ROOT)) {
    if (!/^freeonlyfanz-site.*\.zip$/i.test(entry)) {
      continue;
    }

    for (const slug of listZipCreatorSlugs(path.join(ROOT, entry))) {
      slugs.add(slug);
    }
  }

  return [...slugs];
}

async function listLiveCreatorSlugs(candidateSlugs) {
  const liveSlugs = [];

  for (const slug of candidateSlugs) {
    try {
      const response = await fetch(absoluteUrl(`/creator/${slug}/`), {
        method: "HEAD",
        redirect: "manual",
        headers: { "user-agent": "FreeOnlyFanzBuild/1.0" },
      });

      if (response.status === 200) {
        liveSlugs.push(slug);
      }
    } catch (_error) {
      // Ignore unreachable live URLs during local builds.
    }
  }

  return liveSlugs;
}

async function listLiveSitemapCreatorSlugs() {
  try {
    const response = await fetch(absoluteUrl("/sitemap.xml"), {
      headers: { "user-agent": "FreeOnlyFanzBuild/1.0" },
    });
    if (!response.ok) {
      return [];
    }

    const xml = await response.text();
    const slugs = new Set();

    for (const match of xml.matchAll(SITEMAP_CREATOR_PATTERN)) {
      const slug = String(match[1] || "").trim();
      if (slug) {
        slugs.add(slug);
      }
    }

    return [...slugs];
  } catch (_error) {
    return [];
  }
}

async function main() {
  const previous = readSnapshot();
  const distSlugs = listDistCreatorFolders();
  const zipSlugs = listDeployZipSlugs();
  const sitemapSlugs = await listLiveSitemapCreatorSlugs();
  const seedSlugs = [...new Set([...(previous.slugs || []), ...distSlugs, ...zipSlugs, ...sitemapSlugs])];
  const liveProbeSlugs = await listLiveCreatorSlugs(seedSlugs);
  const merged = new Set([...seedSlugs, ...liveProbeSlugs]);

  const slugs = [...merged].sort();
  const snapshot = {
    updatedAt: new Date().toISOString(),
    sources: {
      previous: (previous.slugs || []).length,
      dist: distSlugs.length,
      zip: zipSlugs.length,
      liveSitemap: sitemapSlugs.length,
      liveProbe: liveProbeSlugs.length,
    },
    slugs,
  };

  fs.writeFileSync(SNAPSHOT_PATH, `${JSON.stringify(snapshot, null, 2)}\n`, "utf8");
  console.log(`Creator folder snapshot updated: ${slugs.length} slug(s)`);
  console.log(snapshot.sources);
}

main();
