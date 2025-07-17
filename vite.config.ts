import { defineConfig } from "vite";
import { resolve } from "path";

export default defineConfig({
  base: "/",
  resolve: {
    alias: {
      src: resolve(__dirname, "src"),
    },
  },
  plugins: [],
});
