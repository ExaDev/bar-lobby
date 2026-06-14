// SPDX-FileCopyrightText: 2026 The BAR Lobby Authors
//
// SPDX-License-Identifier: MIT

import fs from "fs";
import path from "path";

import { getAssetsPath } from "@main/config/app";
import { logger } from "@main/utils/logger";

const log = logger("shared-store-lock.ts");

/**
 * Name of the advisory lockfile placed in the shared content store root. The
 * lobby and the chobby launcher share the store at SHARED_CONTENT_NAME and there
 * is no kernel-level lock, so writers coordinate through this file. See the
 * concurrent-write caveat in config/app.ts.
 */
const LOCK_FILENAME = ".bar-lobby-write.lock";

/**
 * A held lock older than this is treated as stale and reclaimable. A writer that
 * crashes or is force-killed cannot run its `finally` release, so without a
 * staleness window the store would be permanently locked. The window is sized
 * well above the longest legitimate write (a multi-GB engine download and
 * extract), so a lock this old reflects a dead writer rather than a slow one.
 */
const STALE_LOCK_MS = 60 * 60 * 1000; // 1 hour

interface LockBody {
    pid: number;
    timestamp: number;
}

function isLockBody(value: unknown): value is LockBody {
    if (typeof value !== "object" || value === null) return false;
    if (!("pid" in value) || typeof value.pid !== "number") return false;
    if (!("timestamp" in value) || typeof value.timestamp !== "number") return false;
    return true;
}

function lockPath(): string {
    return path.join(getAssetsPath(), LOCK_FILENAME);
}

/**
 * Read and validate an existing lockfile. Returns undefined when no lock is
 * present or the file is unreadable/corrupt (a corrupt lock is treated as no
 * lock so a garbage file cannot wedge the store forever).
 */
async function readLock(file: string): Promise<LockBody | undefined> {
    let raw: string;
    try {
        raw = await fs.promises.readFile(file, "utf8");
    } catch (err) {
        if ((err as NodeJS.ErrnoException).code === "ENOENT") {
            return undefined;
        }
        throw err;
    }
    let parsed: unknown;
    try {
        parsed = JSON.parse(raw);
    } catch {
        log.warn(`Ignoring corrupt shared-store lockfile at ${file}`);
        return undefined;
    }
    if (!isLockBody(parsed)) {
        log.warn(`Ignoring malformed shared-store lockfile at ${file}`);
        return undefined;
    }
    return parsed;
}

/**
 * Acquire the advisory write lock on the shared content store.
 *
 * If a fresh lock is already held (younger than STALE_LOCK_MS), throws loudly
 * rather than interleaving writes into the shared tree. A stale lock is
 * reclaimed. Returns a release function that must be called in a `finally` to
 * remove the lock.
 */
export async function acquireSharedStoreLock(): Promise<() => Promise<void>> {
    const file = lockPath();
    await fs.promises.mkdir(path.dirname(file), { recursive: true });

    const existing = await readLock(file);
    if (existing !== undefined) {
        const age = Date.now() - existing.timestamp;
        if (age < STALE_LOCK_MS) {
            throw new Error(
                `Shared content store is locked by another writer (pid ${existing.pid}, held for ${Math.round(age / 1000)}s) at ${file}. ` +
                    "Refusing to write concurrently, which would corrupt the shared engine/content tree. " +
                    "Close the other client (lobby or chobby) that is downloading content and retry."
            );
        }
        log.warn(`Reclaiming stale shared-store lock (pid ${existing.pid}, age ${Math.round(age / 1000)}s) at ${file}`);
    }

    const body: LockBody = { pid: process.pid, timestamp: Date.now() };
    await fs.promises.writeFile(file, JSON.stringify(body), "utf8");
    log.info(`Acquired shared-store write lock at ${file}`);

    return async () => {
        try {
            await fs.promises.rm(file, { force: true });
            log.info(`Released shared-store write lock at ${file}`);
        } catch (err) {
            log.error(`Failed to release shared-store write lock at ${file}`, err);
        }
    };
}
