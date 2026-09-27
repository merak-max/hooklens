import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  base: process.env.VITE_DEMO === "true" ? "/hooklens/" : "/",
  plugins: [react()],
  server: {
    port: 5173,
    proxy: process.env.VITE_DEMO === "true" ? undefined : {
      "/api": { target: "http://127.0.0.1:8787", changeOrigin: false },
      "/hook/": { target: "http://127.0.0.1:8787", changeOrigin: false },
    },
  },
});
