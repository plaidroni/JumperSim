import { defineConfig, loadEnv } from "vite";
import { resolve } from "path";

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  const mapboxToken =
    env.VITE_MAPBOX_TOKEN || env.VITE_MAPBOX || env.MAPBOX_TOKEN || "";

  return {
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
    plugins: [],
    define: {
      "import.meta.env.VITE_MAPBOX_TOKEN": JSON.stringify(mapboxToken),
      "import.meta.env.VITE_MAPBOX": JSON.stringify(mapboxToken),
      "import.meta.env.VITE_CESIUM_ION_TOKEN": JSON.stringify(
        env.VITE_CESIUM_ION_TOKEN || env.CESIUM_ION_TOKEN || "",
      ),
    },
  };
});
