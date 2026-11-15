import { cpSync, existsSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const source = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const target = process.env.PRAXIS_PLUGIN_DIR && process.env.PRAXIS_PLUGIN_DIR.length > 0
  ? path.resolve(process.env.PRAXIS_PLUGIN_DIR)
  : path.join(homedir(), ".cursor", "plugins", "local", "praxis");
const backup = process.env.PRAXIS_BACKUP_DIR && process.env.PRAXIS_BACKUP_DIR.length > 0
  ? path.resolve(process.env.PRAXIS_BACKUP_DIR)
  : path.join(homedir(), ".local", "state", "praxis", "plugin-backup");
const packaged = process.env.PRAXIS_PACKAGE_DIR && process.env.PRAXIS_PACKAGE_DIR.length > 0
  ? path.resolve(process.env.PRAXIS_PACKAGE_DIR)
  : path.join(source, "dist", "praxis-plugin");

export const BLOCK_WARNING = "Praxis can block project edits while a learning decision is open.";

const command = process.argv[2] ?? "";

if (command === "install" || command === "update") {
  console.log(BLOCK_WARNING);
  if (existsSync(target)) {
    rmSync(backup, { recursive: true, force: true });
    cpSync(target, backup, { recursive: true });
  }
  copyTree(source, target);
  console.log(`Installed Praxis ${version(source)} to ${target}`);
} else if (command === "uninstall") {
  rmSync(target, { recursive: true, force: true });
  console.log(`Removed ${target}`);
} else if (command === "status") {
  if (!existsSync(target)) console.log("Praxis is not installed.");
  else if (version(target) === version(source)) console.log(`Praxis ${version(target)} is current.`);
  else console.log(`Installed ${version(target)}, source ${version(source)}.`);
} else if (command === "rollback") {
  if (!existsSync(backup)) {
    console.error("No backup to restore.");
    process.exit(1);
  }
  rmSync(target, { recursive: true, force: true });
  cpSync(backup, target, { recursive: true });
  console.log(`Restored Praxis ${version(target)} to ${target}`);
} else if (command === "package") {
  copyTree(source, packaged);
  console.log(`Packaged Praxis ${version(source)} at ${packaged}`);
} else {
  console.error("Use install, update, uninstall, status, rollback, or package.");
  process.exit(1);
}

function version(root) {
  try {
    const manifest = JSON.parse(readFileSync(path.join(root, ".cursor-plugin", "plugin.json"), "utf8"));
    return typeof manifest.version === "string" ? manifest.version : "unknown";
  } catch {
    return "unknown";
  }
}

function copyTree(from, to) {
  rmSync(to, { recursive: true, force: true });
  mkdirSync(path.dirname(to), { recursive: true });
  cpSync(from, to, {
    recursive: true,
    filter: (src) => included(from, src),
  });
}

function included(from, src) {
  const relative = path.relative(from, src);
  if (relative.length === 0) return true;
  return !relative.split(path.sep).some((part) => part === "node_modules" || part === ".git" || part === "dist");
}
