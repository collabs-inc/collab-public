interface ImportMetaEnv {
  readonly DEV: boolean;
  readonly MAIN_VITE_POSTHOG_KEY: string;
  readonly MAIN_VITE_POSTHOG_HOST: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
