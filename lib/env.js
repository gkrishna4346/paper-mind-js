// Load the .env that sits next to server.js, whichever folder you start from.
// Imported first by server.js so every other module sees the variables.
import { config } from "dotenv";
import { fileURLToPath } from "node:url";
import path from "node:path";
import fs from "node:fs";

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const ENV_PATH = path.join(ROOT, ".env");
export const ENV_FOUND = fs.existsSync(ENV_PATH);
config({ path: ENV_PATH, quiet: true });
