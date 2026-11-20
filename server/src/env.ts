// Loads settings before any other module reads process.env. Imported first by index.ts.
// Order: server/.env (local dev), then ./.env in the working directory (e.g. repo root).
// Variables already set in the environment (AI Studio secrets, Cloud Run) always win.
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";

dotenv.config({ path: [fileURLToPath(new URL("../.env", import.meta.url)), ".env"], quiet: true });
