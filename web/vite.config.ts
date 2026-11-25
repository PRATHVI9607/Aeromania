import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import { viteStaticCopy } from "vite-plugin-static-copy";

const cs = "node_modules/cesium/Build/Cesium";
export default defineConfig({
  plugins: [
    react(),
    viteStaticCopy({
      targets: [
        { src: `${cs}/Workers`, dest: "cesium", rename: { stripBase: 4 } },
        { src: `${cs}/ThirdParty`, dest: "cesium", rename: { stripBase: 4 } },
        { src: `${cs}/Assets/approximateTerrainHeights.json`, dest: "cesium/Assets", rename: { stripBase: 5 } },
        { src: `${cs}/Assets/Textures/NaturalEarthII`, dest: "cesium", rename: { stripBase: 4 } },
        // earth-orientation tables (sun lighting / ICRF) and widget images; vite preview hid their 404s by serving index.html
        { src: `${cs}/Assets/IAU2006_XYS`, dest: "cesium", rename: { stripBase: 4 } },
        { src: `${cs}/Assets/Images`, dest: "cesium", rename: { stripBase: 4 } },
      ],
    }),
  ],
  define: { CESIUM_BASE_URL: JSON.stringify("/cesium") },
  build: { chunkSizeWarningLimit: 6000, target: "es2022" },
  test: { environment: "node", include: ["src/**/*.test.ts"] },
});
