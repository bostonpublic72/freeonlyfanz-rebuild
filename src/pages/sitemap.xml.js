import { absoluteUrl } from "../lib/site.mjs";
import { getCategoryDefinitions, loadCreators } from "../lib/creators.mjs";

const GUIDE_URLS = [
  "/free-onlyfans/",
  "/free-trial-onlyfans/",
  "/best-free-onlyfans-creators/",
  "/free-onlyfans-accounts/",
  "/onlyfans-free-vs-paid/",
];

export async function GET() {
  const urls = [
    "/",
    "/categories/",
    "/creators/",
    ...GUIDE_URLS,
    ...getCategoryDefinitions().map((category) => `/category/${category.slug}/`),
    ...loadCreators().map((creator) => `/creator/${creator.slug}/`),
  ];

  const body = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls
  .map(
    (url) => `  <url>
    <loc>${absoluteUrl(url)}</loc>
  </url>`
  )
  .join("\n")}
</urlset>`;

  return new Response(body, {
    headers: {
      "Content-Type": "application/xml; charset=utf-8",
    },
  });
}
