import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "path";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
      "@shared": path.resolve(__dirname, "../../shared"),
    },
  },
  server: {
    port: 5173,
    host: true,  // 0.0.0.0 でネットワーク公開（iPhone からアクセス可能）
    proxy: {
      "/api": {
        // 環境変数があれば使用（start-dev.sh からの指定）、なければ localhost
        target: process.env.VITE_API_HOST ?? "http://localhost:8787",
        changeOrigin: true,
      },
    },
  },
});
