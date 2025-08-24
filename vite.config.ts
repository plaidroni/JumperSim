import { defineConfig } from "vite";
import { resolve } from "path";
import react from '@vitejs/plugin-react'

export default defineConfig({
  base: "/",
  resolve: {
    alias: {
      src: resolve(__dirname, "src"),
    },
  },
  // disables support for older browsers so we can use modern JS features
  build: {
    target: "esnext",
  },
  plugins: [react()],
});
