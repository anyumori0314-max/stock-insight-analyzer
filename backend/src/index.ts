import path from "path";
import dotenv from "dotenv";

import { createApp } from "./app";
import { loadEnv } from "./config/env";

// Load the single root .env regardless of the current working directory or
// whether we run from src (tsx) or dist (node).
dotenv.config({ path: path.resolve(__dirname, "..", "..", ".env") });

const env = loadEnv();
const app = createApp({ env });

app.listen(env.PORT, () => {
  // Never log secrets — only the bind URL.
  console.log(`Backend server running on http://localhost:${env.PORT}`);
});
