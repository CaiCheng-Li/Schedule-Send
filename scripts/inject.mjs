/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// Makes Discord desktop on Windows load your own Vencord build, the same way Vencord Installer does.
//
// `pnpm inject` should do this, but Vencord Installer CLI v1.4.1 prints "Success!" for local builds
// without changing anything: its CLI InstallLatestBuilds() is missing the dev-install check the GUI
// has, the download it attempts fails, and patch() ignores the error.
//
// Run from the Vencord folder, with Discord fully closed:
//   node src/userplugins/scheduleSend/scripts/inject.mjs                patch Discord Stable
//   node src/userplugins/scheduleSend/scripts/inject.mjs --branch ptb   or canary
//   node src/userplugins/scheduleSend/scripts/inject.mjs --status       show what's installed, change nothing
//   node src/userplugins/scheduleSend/scripts/inject.mjs --uninject     put Discord's original app.asar back
//   --patcher <path>   use a different dist/patcher.js

import { execFileSync } from "child_process";
import { existsSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "fs";
import { dirname, join, resolve } from "path";
import { fileURLToPath } from "url";

const BRANCH_DIRS = { stable: "Discord", ptb: "DiscordPTB", canary: "DiscordCanary" };

const args = process.argv.slice(2);
const hasFlag = name => args.includes(name);
const option = name => {
    const index = args.indexOf(name);
    return index === -1 ? undefined : args[index + 1];
};

// scripts -> scheduleSend -> userplugins -> src -> Vencord
const vencordDir = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "..");
const branch = option("--branch") ?? "stable";
const patcherPath = resolve(option("--patcher") ?? join(vencordDir, "dist", "patcher.js"));

function die(message) {
    console.error(`ERROR: ${message}`);
    process.exit(1);
}

if (process.platform !== "win32") die("This script is for Windows. Elsewhere, use Vesktop or `pnpm inject`.");
if (!BRANCH_DIRS[branch]) die(`--branch must be one of: ${Object.keys(BRANCH_DIRS).join(", ")}`);

const discordDir = join(process.env.LOCALAPPDATA ?? "", BRANCH_DIRS[branch]);
if (!existsSync(discordDir)) die(`Discord ${branch} isn't installed at ${discordDir}`);

const versionParts = name => name.slice(4).split(".").map(Number);
function isNewer(a, b) {
    const [x, y] = [versionParts(a), versionParts(b)];
    for (let i = 0; i < Math.max(x.length, y.length); i++) {
        if ((x[i] ?? 0) !== (y[i] ?? 0)) return (x[i] ?? 0) > (y[i] ?? 0);
    }
    return false;
}

const appDir = readdirSync(discordDir)
    .filter(name => name.startsWith("app-") && existsSync(join(discordDir, name, "resources")))
    .reduce((best, name) => (!best || isNewer(name, best) ? name : best), null);
if (!appDir) die(`No app-*\\resources folder in ${discordDir}. Start Discord once so it finishes installing.`);

const resources = join(discordDir, appDir, "resources");
const appAsar = join(resources, "app.asar");
const originalAsar = join(resources, "_app.asar");
const isPatched = existsSync(originalAsar);

function patchTarget() {
    const match = readFileSync(appAsar, "latin1").match(/require\(("(?:[^"\\]|\\.)*")\)/);
    return match ? JSON.parse(match[1]) : "(unrecognised app.asar)";
}

console.log(`Discord ${branch}: ${join(discordDir, appDir)}`);
console.log(`Patched: ${isPatched ? `yes, loading ${patchTarget()}` : "no"}`);
if (hasFlag("--status")) process.exit(0);

const exe = `${BRANCH_DIRS[branch]}.exe`;
const tasks = execFileSync("tasklist", ["/FI", `IMAGENAME eq ${exe}`, "/NH"], { encoding: "utf8" });
if (tasks.toLowerCase().includes(exe.toLowerCase()))
    die(`${exe} is running. Quit Discord from its tray icon (right-click, Quit Discord) and run this again.`);

if (hasFlag("--uninject")) {
    if (!isPatched) die("Discord isn't patched, so there's nothing to undo.");
    rmSync(appAsar);
    renameSync(originalAsar, appAsar);
    console.log("Restored Discord's original app.asar.");
    process.exit(0);
}

if (!existsSync(patcherPath)) die(`${patcherPath} doesn't exist. Run \`pnpm build\` in the Vencord folder first.`);

// Same bytes as WriteAppAsar in Vencord Installer's app_asar.go: an asar holding index.js,
// which requires the patcher, and a package.json pointing at it
function buildAppAsar(patcher) {
    const indexJs = `require(${JSON.stringify(patcher)})`;
    const packageJson = '{\n\t"name": "discord",\n\t"main": "index.js"\n}';
    const indexSize = Buffer.byteLength(indexJs);

    const header = JSON.stringify({
        files: {
            "index.js": { size: indexSize, offset: "0" },
            "package.json": { size: Buffer.byteLength(packageJson), offset: String(indexSize) },
        },
    });
    const headerSize = Buffer.byteLength(header);
    const aligned = (headerSize + 3) & ~3;

    const sizes = Buffer.alloc(16);
    sizes.writeInt32LE(4, 0);
    sizes.writeInt32LE(aligned + 8, 4);
    sizes.writeInt32LE(aligned + 4, 8);
    sizes.writeInt32LE(headerSize, 12);

    return Buffer.concat([
        sizes,
        Buffer.from(header + "0".repeat(aligned - headerSize)),
        Buffer.from(indexJs + packageJson),
    ]);
}

if (!isPatched) {
    renameSync(appAsar, originalAsar);
    console.log("Renamed app.asar to _app.asar");
}
writeFileSync(appAsar, buildAppAsar(patcherPath));
console.log(`Wrote app.asar, which loads ${patcherPath}`);
console.log("Done. Start Discord.");
