import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    host: "0.0.0.0",
    port: 5174,
    strictPort: true,
    proxy: {
      "/api": {
        target: "https://127.0.0.1:41527",
        changeOrigin: true,
        secure: false,
        configure(proxy) {
          proxy.on("error", (error, req) => {
            console.error(
              `[ipad proxy error] ${req.method} ${req.url} -> ${error.message}`
            );
          });
          proxy.on("proxyRes", (proxyRes, req) => {
            console.log(
              `[ipad proxy] ${req.method} ${req.url} -> ${proxyRes.statusCode}`
            );
          });
        }
      }
    }
  }
});
