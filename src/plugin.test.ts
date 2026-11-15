import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, it } from "node:test";

const directories: string[] = [];
const script = path.resolve("scripts/plugin.mjs");

function tempDir(name: string): string {
  const directory = mkdtempSync(path.join(tmpdir(), name));
  directories.push(directory);
  return directory;
}

function run(command: string, pluginDir: string, backupDir: string, packageDir = ""): { status: number | null; stdout: string; stderr: string } {
  const result = spawnSync(process.execPath, [script, command], {
    encoding: "utf8",
    env: {
      ...process.env,
      PRAXIS_PLUGIN_DIR: pluginDir,
      PRAXIS_BACKUP_DIR: backupDir,
      PRAXIS_PACKAGE_DIR: packageDir,
    },
  });
  return { status: result.status, stdout: result.stdout, stderr: result.stderr };
}

afterEach(() => {
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

describe("local plugin install", () => {
  it("warns, installs the current version, rolls back, and uninstalls", () => {
    const pluginDir = tempDir("praxis-plugin-");
    const backupDir = tempDir("praxis-backup-");
    const packageDir = tempDir("praxis-package-");

    const installed = run("install", pluginDir, backupDir);
    assert.equal(installed.status, 0, installed.stderr);
    assert.match(installed.stdout, /Praxis can block project edits while a learning decision is open/);
    assert.match(installed.stdout, /Installed Praxis 0\.1\.0/);
    assert.equal(existsSync(path.join(pluginDir, "node_modules")), false);
    assert.equal(existsSync(path.join(pluginDir, ".git")), false);
    const manifest = path.join(pluginDir, ".cursor-plugin", "plugin.json");
    assert.match(readFileSync(manifest, "utf8"), /"version": "0.1.0"/);

    const current = run("status", pluginDir, backupDir);
    assert.match(current.stdout, /Praxis 0\.1\.0 is current/);

    const packaged = run("package", pluginDir, backupDir, packageDir);
    assert.equal(packaged.status, 0, packaged.stderr);
    assert.match(readFileSync(path.join(packageDir, ".cursor-plugin", "plugin.json"), "utf8"), /"version": "0.1.0"/);
    assert.equal(existsSync(path.join(packageDir, "node_modules")), false);

    const manifestText = readFileSync(manifest, "utf8").replace("\"version\": \"0.1.0\"", "\"version\": \"9.9.9\"");
    writeFileSync(manifest, manifestText);
    const updated = run("update", pluginDir, backupDir);
    assert.match(updated.stdout, /can block project edits/);
    assert.match(run("status", pluginDir, backupDir).stdout, /Praxis 0\.1\.0 is current/);

    const restored = run("rollback", pluginDir, backupDir);
    assert.equal(restored.status, 0, restored.stderr);
    assert.match(run("status", pluginDir, backupDir).stdout, /Installed 9\.9\.9, source 0\.1\.0/);

    const removed = run("uninstall", pluginDir, backupDir);
    assert.equal(removed.status, 0, removed.stderr);
    assert.equal(existsSync(pluginDir), false);
    assert.match(run("status", pluginDir, backupDir).stdout, /Praxis is not installed/);
    assert.equal(existsSync(path.join(backupDir, ".cursor-plugin", "plugin.json")), true);
  });
});
