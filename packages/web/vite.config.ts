import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig({
  plugins: [react(), VitePWA({
    registerType: "autoUpdate",
    manifest: {
      name: "TRS Compteur",
      short_name: "TRS",
      description: "Suivi de performance des équipements de production",
      theme_color: "#1d4ed8",
      background_color: "#f9fafb",
      display: "standalone",
      start_url: "/",
      icons: [],
    },
    workbox: {
      navigateFallback: "/index.html",
      runtimeCaching: [{
        urlPattern: /\/api\/ref\//,
        handler: "StaleWhileRevalidate",
        options: { cacheName: "trs-reference-data", expiration: { maxEntries: 30, maxAgeSeconds: 86400 } },
      }],
    },
  })],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  server: {
    port: 5173,
    proxy: {
      "/api": "http://localhost:3001",
    },
  },
});
