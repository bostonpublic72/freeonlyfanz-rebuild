export const SITE_URL = normalizeSiteUrl(process.env.SITE_URL || "https://freeonlyfanz.com");
export const SITE_NAME = "FreeOnlyFanz";
export const GA_ID = process.env.PUBLIC_GA4_ID || process.env.GA4_ID || "";

function normalizeSiteUrl(value) {
  return String(value || "https://freeonlyfanz.com").replace(/\/+$/, "");
}

export function absoluteUrl(pathname = "/") {
  const cleanPath = pathname.startsWith("/") ? pathname : `/${pathname}`;
  return `${SITE_URL}${cleanPath}`;
}
