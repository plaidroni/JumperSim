/// <reference types="vite/client" />

interface ViteTypeOptions {
  // By adding this line, you can make the type of ImportMetaEnv strict
  // to disallow unknown keys.
  // strictImportMetaEnv: unknown
}

interface ImportMetaEnv {
  readonly VITE_APP_TITLE: string;
  readonly VITE_CESIUM_ION_TOKEN?: string;
  readonly VITE_MAPBOX_TOKEN?: string;
  readonly VITE_MAPBOX?: string;
  // more env variables...
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
