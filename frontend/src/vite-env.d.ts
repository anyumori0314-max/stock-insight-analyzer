/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Optional base URL for the backend API (production / separate host). */
  readonly VITE_API_BASE_URL?: string;
  /** Optional client-side request timeout in milliseconds. */
  readonly VITE_API_TIMEOUT_MS?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
