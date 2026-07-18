import fs from "node:fs";
import path from "node:path";
import { getOrphanCreatorSlugs } from "../src/lib/creators.mjs";
import { SITE_NAME, absoluteUrl } from "../src/lib/site.mjs";

const ROOT = process.cwd();
const DIST = path.join(ROOT, "dist");
const PUBLIC_HTACCESS = path.join(ROOT, "public", ".htaccess");

function blockedCreatorHtml() {
  const creatorsUrl = absoluteUrl("/creators/");

  return `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Creator Unavailable | ${SITE_NAME}</title>
    <meta name="robots" content="noindex, nofollow" />
    <meta http-equiv="refresh" content="0; url=${creatorsUrl}" />
    <link rel="canonical" href="${creatorsUrl}" />
  </head>
  <body>
    <p>This creator profile is no longer listed on ${SITE_NAME}.</p>
    <p><a href="${creatorsUrl}">Browse current creators</a></p>
  </body>
</html>
`;
}

function writeHtaccess(slugs) {
  const baseRules = fs.existsSync(PUBLIC_HTACCESS)
    ? fs
        .readFileSync(PUBLIC_HTACCESS, "utf8")
        .split(/\r?\n/)
        .filter((line) => {
          const trimmed = line.trim();
          if (!trimmed) return false;
          // Drop generated orphan rules; keep manual Redirect / DirectoryIndex lines.
          if (trimmed.startsWith("RedirectMatch 410")) return false;
          return true;
        })
        .join("\n")
    : "DirectoryIndex index.html";

  const redirectRule =
    slugs.length > 0
      ? `RedirectMatch 410 ^/creator/(${slugs.map((slug) => slug.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})(?:/index\\.html)?/?$`
      : "";

  const contents = [baseRules, redirectRule].filter(Boolean).join("\n") + "\n";
  fs.writeFileSync(path.join(DIST, ".htaccess"), contents, "utf8");
}

function main() {
  if (!fs.existsSync(DIST)) {
    console.error("No dist/ folder. Run: npm run build");
    process.exit(1);
  }

  const slugs = getOrphanCreatorSlugs();
  let written = 0;

  for (const slug of slugs) {
    const dir = path.join(DIST, "creator", slug);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, "index.html"), blockedCreatorHtml(), "utf8");
    written += 1;
  }

  writeHtaccess(slugs);

  console.log(`Orphan creator pages blocked: ${written}`);
  if (written > 0) {
    console.log(slugs.map((slug) => `/creator/${slug}/`).join("\n"));
  }
}

main();
