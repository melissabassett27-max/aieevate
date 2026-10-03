// @ts-check

import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'astro/config';
import react from '@astrojs/react';
import sitemap from '@astrojs/sitemap';
const vercelProductionUrl = process.env.VERCEL_PROJECT_PRODUCTION_URL
  ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`
  : undefined;
const vercelDeploymentUrl = process.env.VERCEL_URL
  ? `https://${process.env.VERCEL_URL}`
  : undefined;
const site = vercelProductionUrl || process.env.DEPLOY_PRIME_URL || process.env.URL || vercelDeploymentUrl || process.env.PUBLIC_SITE_URL;

// https://astro.build/config
const config = {
  integrations: [
    react(),
  ],
  vite: {
      plugins: [tailwindcss()],
  },
  ...(site ? { site } : {}),
};
if (site) {
  config.integrations.push(sitemap(
    {
      lastmod: new Date(),
    }
  ));
}

// https://astro.build/config
export default defineConfig(config)
