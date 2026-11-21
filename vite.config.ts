import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "node:path";

export default defineConfig({
  root: path.resolve("frontend"),
  plugins: [
    react(),
    {
      name: "playpulse-spa-routes",
      configureServer(server) {
        server.middlewares.use((req, _res, next) => {
          const route = req.url?.split("?")[0];
          if (route === "/login" || route === "/admin" || route === "/portal" || route === "/visitor") {
            const query = req.url?.includes("?") ? req.url.slice(req.url.indexOf("?")) : "";
            req.url = `/index.html${query}`;
          }
          next();
        });
      },
    },
  ],
  build: {
    outDir: path.resolve("dist/frontend"),
    emptyOutDir: true,
  },
  server: {
    port: 5173,
    proxy: {
      "/api": process.env.API_PROXY_TARGET ?? "http://localhost:3000",
      "/health": process.env.API_PROXY_TARGET ?? "http://localhost:3000",
      "/ready": process.env.API_PROXY_TARGET ?? "http://localhost:3000",
    },
  },
});
