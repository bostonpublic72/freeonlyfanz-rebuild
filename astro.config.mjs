import { defineConfig } from "astro/config";

const site = process.env.SITE_URL || "https://freeonlyfanz.com";

export default defineConfig({
  site,
  output: "static",
  devToolbar: {
    enabled: false,
  },
});
