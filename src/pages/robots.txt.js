import { absoluteUrl } from "../lib/site.mjs";

export async function GET() {
  return new Response(`User-agent: *
Allow: /

Sitemap: ${absoluteUrl("/sitemap.xml")}
`, {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
    },
  });
}
