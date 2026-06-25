import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** Index directory — override with OASIS_DIST_DIR for pinned verification. */
export function oasisDistDir(): string {
  const raw = process.env.OASIS_DIST_DIR;
  if (raw) {
    return path.isAbsolute(raw) ? raw : path.resolve(__dirname, "..", "..", raw);
  }
  return path.join(__dirname, "..", "..", "dist");
}

export function oasisDistIndex(): string {
  return path.join(oasisDistDir(), "index.json");
}

export const SKIP_NO_INDEX = "dist/index.json missing — run pnpm run build first";

export const SKIP_PINNED_CORPUS =
  "skipped on OASIS_PINNED=1 — requires full x402scan/mppscan corpus";

export function skipIfPinned(t: { skip: (msg: string) => void }): boolean {
  if (process.env.OASIS_PINNED === "1") {
    t.skip(SKIP_PINNED_CORPUS);
    return true;
  }
  return false;
}