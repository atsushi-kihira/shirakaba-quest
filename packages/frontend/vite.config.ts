import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "path";

// 公開のたびに変わる版の目印。画面に埋め込み、/version.json にも書き出す。
// 画面を開いたままの人に「新しい版があります」と知らせるために使う（src/components/update-notice.tsx）
const BUILD_ID = Date.now().toString(36);

export default defineConfig(({ command }) => ({
  define: { __BUILD_ID__: JSON.stringify(command === "build" ? BUILD_ID : "dev") },
  plugins: [
    react(),
    tailwindcss(),
    {
      name: "emit-version-json",
      generateBundle() {
        this.emitFile({ type: "asset", fileName: "version.json", source: JSON.stringify({ id: BUILD_ID }) });
      },
    },
  ],
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
}));
