import path from "node:path";
import { fileURLToPath } from "node:url";

let rootOverride: string | undefined;

export function setPackageRoot(root: string): void {
  rootOverride = path.resolve(root);
}

export function packageRoot(): string {
  if (rootOverride) return rootOverride;
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
}
