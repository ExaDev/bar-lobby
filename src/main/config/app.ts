// SPDX-FileCopyrightText: 2025 The BAR Lobby Authors
//
// SPDX-License-Identifier: MIT

import path from "path";
import fs from "fs";
import { env } from "process";
import { app } from "electron";
import { homedir } from "os";

// Should be the same as `productName` in electron-builder.ts
// and in workaround in installer.nsh.
export const APP_NAME = "BeyondAllReason";

// Name of the shared content store used by the chobby launcher. On macOS the
// engine and downloaded game/maps/pool content live here so the lobby and the
// chobby launcher share a single copy (chobby uses this exact path). It is
// deliberately distinct from APP_NAME ("BeyondAllReason"): the lobby keeps its
// own config/state/logs under APP_NAME, only the bulky shared content moves to
// SHARED_CONTENT_NAME ("Beyond All Reason", with spaces, matching chobby).
//
// CONCURRENT-WRITE CAVEAT: because the lobby and chobby share this store, two
// processes may write here at once (e.g. both downloading or extracting engine
// or game content simultaneously). There is no cross-process lock. Running both
// clients concurrently while either is fetching content can interleave writes
// and corrupt the shared tree. Treat the shared store as single-writer at a
// time; do not run a content download in both clients at once.
export const SHARED_CONTENT_NAME = "Beyond All Reason";

/**
 * The function returns default base directories for the application data.
 *
 * There are multiple different installation methods of lobby:
 * - Windows installer
 * - Linux AppImage
 * - Linux Flatpak
 * - Windows/Linux development setup
 * - In the future Windows/Linux steam
 * - Maybe in the future Windows/Linux portable distribution
 *
 * For now we try to categorize the data into 3 categories:
 * - Application binary: AppImage file, installed location on Windows, etc.
 *   We don't really control this, but can use it as base location for some
 *   platforms.
 * - Game assets: It's the engine, maps, game files that are rather static
 *   aren't per-user.
 * - State files: It's combination of configuration, replays, logs, caches,
 *   IndexedDB and other per user configuration.
 *
 * It's hard to split the state files into more categories that have well
 * defined standard locations under Linux (cache, config) because Electron
 * and Recoil engine don't support it: that data is mixed together.
 *
 * In short, simplifying the logic, we put data into:
 * - Under development (npm run start):
 *   - Assets: ./assets
 *   - State: ./state
 * - Windows:
 *   - Assets: AppData\Local\Programs\BeyondAllReason\assets
 *   - State: AppData\Roaming\BeyondAllReason
 * - Linux:
 *   - Assets: ~/.local/share/BeyondAllReason
 *   - State: ~/.local/state/BeyondAllReason
 */
function getDefaultLocations(): { state: string; assets: string } {
    // We separate the developlment installation from production installation
    // in the system.
    if (!app.isPackaged) {
        return {
            assets: path.join(process.cwd(), "assets"),
            state: path.join(process.cwd(), "state"),
        };
    }
    if (process.platform === "win32") {
        // With the default electron builder, under user install, this
        // directory is `%LOCALAPPDATA%\Programs\${productName}`.
        // We don't build the path ourselves but depend on the location of
        // main executable.
        const appplicationBinaryDir = path.dirname(app.getPath("exe"));
        const appData = env.APPDATA || path.join(homedir(), "AppData", "Roaming");
        return {
            assets: path.join(appplicationBinaryDir, "assets"),
            state: path.join(appData, APP_NAME),
        };
    }
    if (process.platform === "linux") {
        const xdgStateHome = process.env.XDG_STATE_HOME || path.join(homedir(), ".local/state");
        const xdgDataHome = process.env.XDG_DATA_HOME || path.join(homedir(), ".local/share");
        return {
            // The `assets` prefix isn't really needed under Linux, but we add
            // it for consistency.
            assets: path.join(xdgDataHome, APP_NAME, "assets"),
            state: path.join(xdgStateHome, APP_NAME),
        };
    }
    if (process.platform === "darwin") {
        // macOS has no separate state/data roots like XDG. The lobby keeps its
        // own config/state/logs under ~/Library/Application Support/<APP_NAME>,
        // but the engine and downloaded game/maps/pool content go into the
        // SHARED content store at ~/Library/Application Support/<SHARED_CONTENT_NAME>
        // so the lobby and the chobby launcher share a single copy (chobby uses
        // this exact path). See the SHARED_CONTENT_NAME concurrent-write caveat.
        //
        // The assets dir is the shared store root itself (not a nested "assets"
        // subdir) because chobby reads engine/games/maps/pool directly under the
        // store root. validateAssetsPath (paths.service.ts) rejects an assets
        // dir nested inside the state dir; here the two roots are independent
        // top-level directories, so that check is satisfied.
        const stateBase = path.join(homedir(), "Library", "Application Support", APP_NAME);
        const sharedContentBase = path.join(homedir(), "Library", "Application Support", SHARED_CONTENT_NAME);
        return {
            assets: sharedContentBase,
            state: path.join(stateBase, "state"),
        };
    }

    console.error("Unsupported platform");
    process.exit(1);
}

export function setAssetsPath(p: string) {
    ASSETS_PATH = path.resolve(p);
}

export function getAssetsPath() {
    return ASSETS_PATH;
}

/**
 * The macOS assets/content directory used before the move to the shared chobby
 * store. Existing users have their engine plus multi-GB pool/maps/games tree
 * under this path; on upgrade it must be migrated into SHARED_CONTENT_NAME
 * rather than re-downloaded from scratch. See migrateMacAssetsToSharedStore.
 */
const LEGACY_MACOS_ASSETS_PATH = path.join(homedir(), "Library", "Application Support", APP_NAME, "assets");

/**
 * One-time migration for the macOS shared-store move.
 *
 * Earlier macOS builds kept downloaded content (engine, pool, maps, games)
 * under `~/Library/Application Support/BeyondAllReason/assets`. The shared store
 * move relocated that to `~/Library/Application Support/Beyond All Reason`. On
 * the first launch after upgrade an existing user would otherwise find an empty
 * shared store and silently re-download multiple GB, abandoning their existing
 * content. This moves the legacy tree into the shared store instead.
 *
 * Only runs when ALL of the following hold, so it never touches a deliberate
 * user choice and never overwrites an already-populated shared store:
 * - platform is darwin;
 * - the user has NOT set a custom assets path (a custom path is left untouched);
 * - the legacy default dir exists;
 * - the shared store does not yet exist.
 *
 * Idempotent: once the shared store exists (because a previous run moved it, or
 * because content was downloaded fresh) this is a no-op. A failed move fails
 * loudly rather than falling through to a silent multi-GB re-download.
 *
 * @param hasCustomAssetsPath Whether the user has configured a non-default
 *   assets path (settings or BAR_ASSETS_PATH). When true, no migration occurs.
 */
export async function migrateMacAssetsToSharedStore(hasCustomAssetsPath: boolean): Promise<void> {
    if (process.platform !== "darwin") {
        return;
    }
    if (hasCustomAssetsPath) {
        console.log("Custom assets path set; skipping legacy macOS assets migration");
        return;
    }

    const sharedStore = path.join(homedir(), "Library", "Application Support", SHARED_CONTENT_NAME);

    const legacyExists = fs.existsSync(LEGACY_MACOS_ASSETS_PATH);
    const sharedExists = fs.existsSync(sharedStore);

    if (!legacyExists) {
        return;
    }
    if (sharedExists) {
        console.log(`Shared content store already exists at ${sharedStore}; leaving legacy assets at ${LEGACY_MACOS_ASSETS_PATH} untouched`);
        return;
    }

    console.log(`Migrating legacy macOS assets from ${LEGACY_MACOS_ASSETS_PATH} to shared store ${sharedStore}`);
    await fs.promises.mkdir(path.dirname(sharedStore), { recursive: true });
    try {
        await fs.promises.rename(LEGACY_MACOS_ASSETS_PATH, sharedStore);
    } catch (err) {
        const reason = err instanceof Error ? err.message : String(err);
        throw new Error(
            `Failed to migrate legacy macOS assets from ${LEGACY_MACOS_ASSETS_PATH} to ${sharedStore}: ${reason}. ` +
                "Refusing to continue, as proceeding would silently re-download multiple GB of engine and content. " +
                "Move the directory manually and relaunch."
        );
    }
    console.log(`Migrated legacy macOS assets into shared store ${sharedStore}`);
}

const defaultLocations = getDefaultLocations();
// Allow overriding the paths using env variables.
let ASSETS_PATH: string = path.resolve(process.env.BAR_ASSETS_PATH || defaultLocations.assets);
export const STATE_PATH = path.resolve(process.env.BAR_STATE_PATH || defaultLocations.state);

// We set the `userData` property for Electron to also create files in correct
// locations, not only our own code.
app.setPath("userData", STATE_PATH);

console.log(`ASSETS_PATH: ${ASSETS_PATH}`);
console.log(`STATE_PATH: ${STATE_PATH}`);

export const CONFIG_PATH = path.join(STATE_PATH, "config");
export const LOGS_PATH = path.join(STATE_PATH, "logs");

// We will point engine at ASSETS_PATH as a base data directory to only read
// data from, and at WRITE_DATA_PATH as data directory it can write to.
export const WRITE_DATA_PATH = path.join(STATE_PATH, "data");

export const getEnginePath = () => path.join(ASSETS_PATH, "engine");
export const getPackagePath = () => path.join(ASSETS_PATH, "packages");
export const getPoolPath = () => path.join(ASSETS_PATH, "pool");
export const getRapidIndexPath = () => path.join(ASSETS_PATH, "rapid");
export const getMapsPaths = (): readonly string[] => [path.join(WRITE_DATA_PATH, "maps"), path.join(ASSETS_PATH, "maps")];
export const getGamePaths = (): readonly string[] => [path.join(WRITE_DATA_PATH, "games"), path.join(ASSETS_PATH, "games")];
export const REPLAYS_PATH = path.join(WRITE_DATA_PATH, "demos");

// Lobby specific cache path for scenario images. Maybe remove from here?
export const SCENARIO_IMAGE_PATH = path.join(STATE_PATH, "scenario-images");

/**
 * Get the path to the bundled CA certificate file for pr-downloader.
 * This is a workaround for a bug where pr-downloader's OpenSSL/curl doesn't
 * properly resolve certificates from the Windows certificate store on fresh
 * installations. On Linux, system certificates work fine and should be
 * preferred (they also support system-level MITM proxies).
 * See: https://github.com/beyond-all-reason/pr-downloader/issues/48
 */
export function getCaCertPath(): string | undefined {
    if (process.platform !== "win32") {
        return undefined;
    }
    if (!app.isPackaged) {
        const devPath = path.join(process.cwd(), "buildResources", "cacert.pem");
        return fs.existsSync(devPath) ? devPath : undefined;
    }
    const prodPath = path.join(process.resourcesPath, "cacert.pem");
    return fs.existsSync(prodPath) ? prodPath : undefined;
}
