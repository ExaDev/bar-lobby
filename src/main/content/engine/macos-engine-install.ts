// SPDX-FileCopyrightText: 2025 The BAR Lobby Authors
//
// SPDX-License-Identifier: MIT

import { spawn } from "child_process";
import fs from "fs";
import os from "os";
import path from "path";

import { getAssetsPath } from "@main/config/app";
import { DEFAULT_ENGINE_VERSION } from "@main/config/default-versions";
import { acquireSharedStoreLock } from "@main/content/engine/shared-store-lock";
import { logger } from "@main/utils/logger";

const log = logger("macos-engine-install.ts");

/**
 * Public, token-free GitHub repository that publishes the patched macOS engine
 * as `engine-macos-arm64-*.tar.gz` release assets. Both this repo and the lobby
 * fork are public, so the GitHub REST API and the asset download URLs are
 * reachable anonymously (no PAT, no GITHUB_TOKEN at runtime).
 */
const ENGINE_RELEASE_OWNER = "ExaDev";
const ENGINE_RELEASE_REPO = "RecoilEngine";

/**
 * Tag and asset name prefix for the Apple Silicon engine build. Candidates are
 * releases whose tag starts with this and that carry a matching `.tar.gz`
 * asset; resolveEngineAsset then prefers the one matching DEFAULT_ENGINE_VERSION.
 */
const ENGINE_ASSET_PREFIX = "engine-macos-arm64-";

/** How many recent releases to scan when resolving the matching build. */
const RELEASE_LIST_PAGE_SIZE = 30;

interface GitHubReleaseAsset {
    name: string;
    browser_download_url: string;
}

interface GitHubRelease {
    tag_name: string;
    published_at: string;
    assets: GitHubReleaseAsset[];
}

function isGitHubReleaseArray(value: unknown): value is GitHubRelease[] {
    if (!Array.isArray(value)) return false;
    return value.every((entry) => {
        if (typeof entry !== "object" || entry === null) return false;
        if (!("tag_name" in entry) || typeof entry.tag_name !== "string") return false;
        if (!("published_at" in entry) || typeof entry.published_at !== "string") return false;
        if (!("assets" in entry) || !Array.isArray(entry.assets)) return false;
        return entry.assets.every((asset) => {
            if (typeof asset !== "object" || asset === null) return false;
            if (!("name" in asset) || typeof asset.name !== "string") return false;
            if (!("browser_download_url" in asset) || typeof asset.browser_download_url !== "string") return false;
            return true;
        });
    });
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
 * any existing tree. Used to fold the engine's `game/` payload into the assets
 * directory without clobbering sibling content.
 */
async function mergeDir(src: string, dest: string): Promise<void> {
    await fs.promises.mkdir(dest, { recursive: true });
    const entries = await fs.promises.readdir(src);
    for (const entry of entries) {
        await fs.promises.cp(path.join(src, entry), path.join(dest, entry), { recursive: true, verbatimSymlinks: true });
    }
}

interface EngineAssetCandidate {
    tag: string;
    publishedAt: string;
    assetName: string;
    url: string;
}

/**
 * Resolve the download URL for the macOS engine release asset to install.
 *
 * The lobby installs whatever it downloads as DEFAULT_ENGINE_VERSION, so the
 * download must correspond to that version rather than to whichever build was
 * published most recently. Always grabbing the newest release races the pinned
 * default: a freshly published engine would be installed under the default
 * version's directory name, mismatching the version the lobby actually runs.
 *
 * Queries the public GitHub releases list (token-free) and selects a release
 * whose tag or asset name carries DEFAULT_ENGINE_VERSION. Only when no such
 * release exists does it fall back to the most recently published matching
 * build, logging a clear warning so the version mismatch is visible.
 */
async function resolveEngineAsset(): Promise<{ tag: string; assetName: string; url: string }> {
    const apiUrl = `https://api.github.com/repos/${ENGINE_RELEASE_OWNER}/${ENGINE_RELEASE_REPO}/releases?per_page=${RELEASE_LIST_PAGE_SIZE}`;
    const response = await fetch(apiUrl, {
        headers: {
            Accept: "application/vnd.github+json",
            // GitHub requires a User-Agent on API requests; without it the
            // request is rejected with 403.
            "User-Agent": "bar-lobby",
        },
    });
    if (!response.ok) {
        throw new Error(`Failed to list ${ENGINE_RELEASE_OWNER}/${ENGINE_RELEASE_REPO} releases: HTTP ${response.status}`);
    }
    const body: unknown = await response.json();
    if (!isGitHubReleaseArray(body)) {
        throw new Error("Unexpected GitHub releases response shape while resolving the macOS engine asset");
    }

    const candidates: EngineAssetCandidate[] = body
        .filter((release) => release.tag_name.startsWith(ENGINE_ASSET_PREFIX))
        .map((release) => {
            const asset = release.assets.find((a) => a.name.startsWith(ENGINE_ASSET_PREFIX) && a.name.endsWith(".tar.gz"));
            return asset ? { tag: release.tag_name, publishedAt: release.published_at, assetName: asset.name, url: asset.browser_download_url } : undefined;
        })
        .filter((candidate): candidate is EngineAssetCandidate => candidate !== undefined)
        .sort((a, b) => b.publishedAt.localeCompare(a.publishedAt));

    if (candidates.length === 0) {
        throw new Error(`No ${ENGINE_ASSET_PREFIX}*.tar.gz release asset found on ${ENGINE_RELEASE_OWNER}/${ENGINE_RELEASE_REPO}`);
    }

    const pinned = candidates.find((candidate) => candidate.tag.includes(DEFAULT_ENGINE_VERSION) || candidate.assetName.includes(DEFAULT_ENGINE_VERSION));
    if (pinned !== undefined) {
        return { tag: pinned.tag, assetName: pinned.assetName, url: pinned.url };
    }

    const latest = candidates[0];
    log.warn(
        `No ${ENGINE_RELEASE_OWNER}/${ENGINE_RELEASE_REPO} release matched DEFAULT_ENGINE_VERSION ${DEFAULT_ENGINE_VERSION}; ` +
            `falling back to most recently published build ${latest.tag} (${latest.assetName}). ` +
            "The installed engine will be recorded as the default version but may not match it."
    );
    return { tag: latest.tag, assetName: latest.assetName, url: latest.url };
}

/** Download a URL to a local file path, streaming the body to disk. */
async function downloadFile(url: string, destPath: string): Promise<void> {
    const response = await fetch(url, { headers: { "User-Agent": "bar-lobby" } });
    if (!response.ok || response.body === null) {
        throw new Error(`Failed to download engine asset from ${url}: HTTP ${response.status}`);
    }
    const buffer = Buffer.from(await response.arrayBuffer());
    await fs.promises.writeFile(destPath, buffer);
}

/**
 * Extract a `.tar.gz` archive into a destination directory using the system
 * `tar`. macOS ships bsdtar at /usr/bin/tar, so no bundled tar dependency is
 * needed; the lobby only takes this path on darwin.
 */
function extractTarGz(archivePath: string, destDir: string): Promise<void> {
    return new Promise((resolve, reject) => {
        const child = spawn("tar", ["-xzf", archivePath, "-C", destDir], { stdio: ["ignore", "ignore", "pipe"] });
        let stderr = "";
        child.stderr.on("data", (chunk: Buffer) => {
            stderr += chunk.toString();
        });
        child.on("error", reject);
        child.on("close", (code) => {
            if (code === 0) {
                resolve();
            } else {
                reject(new Error(`tar exited with code ${code} extracting ${archivePath}: ${stderr.trim()}`));
            }
        });
    });
}

/**
 * Ensure the macOS engine is installed into the given version directory.
 *
 * The engine is no longer bundled inside the app. On first run, if it is not
 * already present in the shared content store, this downloads the
 * `engine-macos-arm64-*.tar.gz` release asset matching DEFAULT_ENGINE_VERSION
 * from the public ExaDev/RecoilEngine repository (token-free) and unpacks it
 * into the version dir, falling back to the latest build only when no release
 * matches (see resolveEngineAsset).
 *
 * The release tarball ships as `bin/spring`, `lib/`, `share/` and (optionally)
 * `game/`. The lobby's engine model expects the binary at the version-dir root
 * with `lib/` and `share/` as siblings and `cwd` set to the version dir, so this
 * normalises the layout once at install time: the macOS version dir ends up
 * mirroring the Linux archive, leaving game.ts, pr-downloader.ts and the AI
 * parsing untouched bar the launch-env injection.
 *
 * The install is idempotent: it is skipped once both `versionDir/spring` and
 * `versionDir/pr-downloader` exist, so subsequent launches reuse the discovered
 * version dir while a partial install is still repaired.
 *
 * @param versionDir Absolute path to the engine version directory to populate
 *   (e.g. `<ASSETS_PATH>/engine/<DEFAULT_ENGINE_VERSION>`).
 */
export async function ensureMacEngine(versionDir: string): Promise<void> {
    const springPath = path.join(versionDir, "spring");
    const prDownloaderPath = path.join(versionDir, "pr-downloader");
    // Consider the engine installed only when BOTH the engine binary and the
    // pr-downloader (which the lobby spawns for content downloads) are present,
    // so a partial or older install missing pr-downloader is repaired on the
    // next launch rather than silently leaving content downloads broken.
    if ((await pathExists(springPath)) && (await pathExists(prDownloaderPath))) {
        log.info(`macOS engine already installed at ${versionDir}`);
        return;
    }

    const asset = await resolveEngineAsset();
    log.info(`Downloading macOS engine ${asset.tag} (${asset.assetName}) from ${asset.url}`);

    // Stage the download and extraction in a temp dir so a failure mid-extract
    // never leaves a half-populated version dir that the idempotency check would
    // wrongly treat as installed.
    const stagingDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "bar-engine-"));
    try {
        const archivePath = path.join(stagingDir, asset.assetName);
        await downloadFile(asset.url, archivePath);

        const extractDir = path.join(stagingDir, "extracted");
        await fs.promises.mkdir(extractDir, { recursive: true });
        await extractTarGz(archivePath, extractDir);

        const bundledBinDir = path.join(extractDir, "bin");
        const bundledBinary = path.join(bundledBinDir, "spring");
        if (!(await pathExists(bundledBinary))) {
            throw new Error(`Downloaded macOS engine asset ${asset.assetName} did not contain bin/spring`);
        }

        log.info(`Installing macOS engine from ${extractDir} into ${versionDir}`);

        // Everything below writes into the shared content store (the version dir
        // under getEnginePath(), and the game payload merged into getAssetsPath()).
        // The lobby and chobby share that store with no kernel-level lock, so take
        // the advisory write lock around the whole install and release it in the
        // nested finally. The download/extract above stages into a temp dir and
        // does not touch the store, so it stays outside the lock.
        const releaseLock = await acquireSharedStoreLock();
        try {
            await fs.promises.mkdir(versionDir, { recursive: true });

            // Normalise the layout: every binary in bin/ (spring, pr-downloader, and
            // any others such as spring-headless) goes to the version-dir root, with
            // lib/ and share/ as siblings, matching the Linux archive the lobby's
            // paths assume.
            for (const entry of await fs.promises.readdir(bundledBinDir)) {
                const dest = path.join(versionDir, entry);
                await fs.promises.cp(path.join(bundledBinDir, entry), dest, { recursive: true, verbatimSymlinks: true });
                await fs.promises.chmod(dest, 0o755);
            }
            // verbatimSymlinks keeps the unversioned dylib links relative (e.g.
            // libvulkan.dylib -> libvulkan.1.dylib). Without it, Node's cp resolves
            // them to absolute paths in the staging dir, breaking the version dir's
            // self-containment the moment the staging dir is removed.
            await fs.promises.cp(path.join(extractDir, "lib"), path.join(versionDir, "lib"), { recursive: true, verbatimSymlinks: true });
            await fs.promises.cp(path.join(extractDir, "share"), path.join(versionDir, "share"), { recursive: true, verbatimSymlinks: true });

            // Some engine layouts ship AI definitions alongside the binary; copy them
            // through if present so parseAis finds <versionDir>/AI/Skirmish as on Linux.
            const bundledAi = path.join(extractDir, "AI");
            if (await pathExists(bundledAi)) {
                await fs.promises.cp(bundledAi, path.join(versionDir, "AI"), { recursive: true, verbatimSymlinks: true });
            }

            // Fold the optional bundled game payload (games, fonts, chobby_config.json)
            // into the assets dir, matching the paths getGamePaths() reads from. When
            // the asset omits game content the lobby downloads it via pr-downloader.
            const bundledGame = path.join(extractDir, "game");
            if (await pathExists(bundledGame)) {
                await mergeDir(bundledGame, getAssetsPath());
            }

            log.info(`Installed macOS engine ${asset.tag} into ${versionDir}`);
        } finally {
            await releaseLock();
        }
    } finally {
        await fs.promises.rm(stagingDir, { recursive: true, force: true });
    }
}
