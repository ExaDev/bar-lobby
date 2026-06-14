// SPDX-FileCopyrightText: 2025 The BAR Lobby Authors
//
// SPDX-License-Identifier: MIT

import axios from "axios";

export const contentSources = {
    rapid: {
        host: "repos-cdn.beyondallreason.dev",
        game: "byar",
    },
    gameGithub: {
        owner: "beyond-all-reason",
        repo: "Beyond-All-Reason",
    },
    engineGitHub: {
        owner: "beyond-all-reason",
        repo: "spring",
    },
};

export interface EngineReleaseInfo {
    filename: string;
    springname: string;
    md5: string;
    category: string;
    version: string;
    path: string;
    tags: string[];
    size: number;
    timestamp: string;
    mirrors: string[];
}

const findEngineReleaseUrl = (engineVersion: string) => {
    // The macOS engine is bundled with the app and copied into the version dir
    // on first run (see macos-engine-install.ts); it is never fetched from the
    // CDN, which only serves Windows and Linux builds. Reaching here on darwin
    // means the bundled-engine install failed, so fail loudly rather than
    // silently requesting an incompatible engine_linux64 archive.
    if (process.platform === "darwin") {
        throw new Error("macOS engine is bundled, not downloaded from the CDN");
    }
    const archStr = process.platform === "win32" ? "engine_windows64" : "engine_linux64";
    const url = new URL("https://files-cdn.beyondallreason.dev/find");
    url.searchParams.set("category", archStr);
    url.searchParams.set("springname", engineVersion);
    return url;
};

export const getEngineReleaseInfo = async (engineVersion: string) => {
    const engineReleaseUrl = findEngineReleaseUrl(engineVersion);
    const engineResponse = await axios.get(engineReleaseUrl.toString());
    const engineInfo: EngineReleaseInfo = engineResponse.data[0];
    return engineInfo;
};
