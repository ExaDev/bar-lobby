// SPDX-FileCopyrightText: 2025 The BAR Lobby Authors
//
// SPDX-License-Identifier: MIT

import { app } from "electron";
import fs from "fs";
import path from "path";

import { getAssetsPath } from "@main/config/app";
import { logger } from "@main/utils/logger";

const log = logger("macos-engine-install.ts");

/**
 * Name of the directory the engine tree is staged under, both inside the packaged
 * app's resources (`process.resourcesPath/engine-macos`, placed there by the
 * electron-builder `extraResources` entry) and in the dev-time fallback location.
 */
const BUNDLE_DIR_NAME = "engine-macos";

/**
 * Resolve the directory holding the bundled macOS engine tree.
 *
 * When packaged, electron-builder copies `buildResources/engine-macos` to
 * `process.resourcesPath/engine-macos`. In development (`!app.isPackaged`) there
 * is no resources dir, so fall back to the staged tree under the repo's
 * `buildResources`.
 */
function getBundledEngineDir(): string {
    if (app.isPackaged) {
        return path.join(process.resourcesPath, BUNDLE_DIR_NAME);
    }
    return path.join(process.cwd(), "buildResources", BUNDLE_DIR_NAME);
}

async function pathExists(p: string): Promise<boolean> {
    try {
        await fs.promises.access(p);
        return true;
    } catch {
        return false;
    }
}

/**
 * Copy the contents of a directory into a destination directory, merging into
 * any existing tree. Used to fold the bundled `game/` payload into the assets
 * directory without clobbering sibling content.
 */
async function mergeDir(src: string, dest: string): Promise<void> {
    await fs.promises.mkdir(dest, { recursive: true });
    const entries = await fs.promises.readdir(src);
    for (const entry of entries) {
        await fs.promises.cp(path.join(src, entry), path.join(dest, entry), { recursive: true, verbatimSymlinks: true });
    }
}

/**
 * Ensure the bundled macOS engine is installed into the given version directory.
 *
 * The bundled artifact ships as `bin/spring`, `lib/`, `share/` and (optionally)
 * `game/`. The lobby's engine model expects the binary at the version-dir root
 * with `lib/` and `share/` as siblings and `cwd` set to the version dir, so this
 * normalises the layout once at copy time: the macOS version dir ends up
 * mirroring the Linux archive, leaving game.ts, pr-downloader.ts and the AI
 * parsing untouched bar the launch-env injection.
 *
 * The copy is idempotent: it is skipped once both `versionDir/spring` and
 * `versionDir/pr-downloader` exist, so subsequent launches reuse the discovered
 * version dir while a partial install is still repaired.
 *
 * @param versionDir Absolute path to the engine version directory to populate
 *   (e.g. `<ASSETS_PATH>/engine/<DEFAULT_ENGINE_VERSION>`).
 */
export async function ensureBundledMacEngine(versionDir: string): Promise<void> {
    const springPath = path.join(versionDir, "spring");
    const prDownloaderPath = path.join(versionDir, "pr-downloader");
    // Consider the engine installed only when BOTH the engine binary and the
    // pr-downloader (which the lobby spawns for content downloads) are present,
    // so a partial or older install missing pr-downloader is repaired on the
    // next launch rather than silently leaving content downloads broken.
    if ((await pathExists(springPath)) && (await pathExists(prDownloaderPath))) {
        log.info(`Bundled macOS engine already installed at ${versionDir}`);
        return;
    }

    const bundleDir = getBundledEngineDir();
    const bundledBinDir = path.join(bundleDir, "bin");
    const bundledBinary = path.join(bundledBinDir, "spring");
    if (!(await pathExists(bundledBinary))) {
        throw new Error(`Bundled macOS engine not found at ${bundledBinary}; cannot install engine for macOS`);
    }

    log.info(`Installing bundled macOS engine from ${bundleDir} into ${versionDir}`);
    await fs.promises.mkdir(versionDir, { recursive: true });

    // Normalise the layout: every binary in bin/ (spring, pr-downloader, and any
    // others such as spring-headless) goes to the version-dir root, with lib/ and
    // share/ as siblings, matching the Linux archive the lobby's paths assume.
    for (const entry of await fs.promises.readdir(bundledBinDir)) {
        const dest = path.join(versionDir, entry);
        await fs.promises.cp(path.join(bundledBinDir, entry), dest, { recursive: true, verbatimSymlinks: true });
        await fs.promises.chmod(dest, 0o755);
    }
    // verbatimSymlinks keeps the unversioned dylib links relative (e.g.
    // libvulkan.dylib -> libvulkan.1.dylib). Without it, Node's cp resolves
    // them to absolute paths in the bundle's source dir, breaking the version
    // dir's self-containment the moment the app is moved.
    await fs.promises.cp(path.join(bundleDir, "lib"), path.join(versionDir, "lib"), { recursive: true, verbatimSymlinks: true });
    await fs.promises.cp(path.join(bundleDir, "share"), path.join(versionDir, "share"), { recursive: true, verbatimSymlinks: true });

    // Some engine layouts ship AI definitions alongside the binary; copy them
    // through if present so parseAis finds <versionDir>/AI/Skirmish as on Linux.
    const bundledAi = path.join(bundleDir, "AI");
    if (await pathExists(bundledAi)) {
        await fs.promises.cp(bundledAi, path.join(versionDir, "AI"), { recursive: true, verbatimSymlinks: true });
    }

    // Fold the optional bundled game payload (games, fonts, chobby_config.json)
    // into the assets dir, matching the paths getGamePaths() reads from. When the
    // bundle omits game content the lobby downloads it via pr-downloader instead.
    const bundledGame = path.join(bundleDir, "game");
    if (await pathExists(bundledGame)) {
        await mergeDir(bundledGame, getAssetsPath());
    }

    log.info(`Installed bundled macOS engine into ${versionDir}`);
}
