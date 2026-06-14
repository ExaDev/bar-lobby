// SPDX-FileCopyrightText: 2025 The BAR Lobby Authors
//
// SPDX-License-Identifier: MIT

import path from "path";
import os from "os";

/**
 * Build the environment overrides the patched Recoil engine needs to render on
 * macOS. The engine ships a Mesa/Vulkan stack rather than relying on the OS GL
 * driver, so it has to be pointed at the bundled KosmicKrisp Vulkan ICD and,
 * on capable systems, told to drive GL through Mesa's Zink (GL-on-Vulkan)
 * layer.
 *
 * The Zink hardware path is gated on the macOS version: it depends on the
 * KosmicKrisp ICD and Mesa Zink dylibs that only function on macOS 26 (Tahoe)
 * and later. On older releases we omit the Zink overrides and let the engine
 * fall back to its software rasteriser (llvmpipe).
 *
 * `DYLD_FALLBACK_LIBRARY_PATH` (rather than `DYLD_LIBRARY_PATH`) is set only on
 * the Zink path: it lets the dynamic loader find the bundled `lib/` for Zink's
 * runtime `dlopen` of `libvulkan.1.dylib` without overriding system libraries,
 * which avoids the SIGBUS the engine work hit when the search order was forced.
 *
 * @param enginePath Absolute path to the engine version directory (the dir
 *   containing the `spring` binary, with `lib/` and `share/` as siblings).
 * @returns Environment overrides to merge into the engine's launch env.
 */
export function buildMacOsEngineEnv(enginePath: string): NodeJS.ProcessEnv {
    const icd = path.join(enginePath, "share", "vulkan", "icd.d", "kosmickrisp.json");
    const env: NodeJS.ProcessEnv = {
        EGL_PLATFORM: "surfaceless",
        VULKAN_SDK: enginePath,
        VK_ICD_FILENAMES: icd,
        VK_DRIVER_FILES: icd,
    };

    // os.release() returns the Darwin kernel version; its major component maps
    // to the macOS release (Darwin 25 ~ macOS 26 Tahoe). Below the threshold,
    // the Zink hardware path is unsupported and we keep the software fallback.
    const darwinMajor = Number(os.release().split(".")[0]);
    const ZINK_MIN_DARWIN_MAJOR = 25; // macOS 26 (Tahoe); below this use llvmpipe fallback
    if (darwinMajor >= ZINK_MIN_DARWIN_MAJOR) {
        env.GALLIUM_DRIVER = "zink";
        env.MESA_LOADER_DRIVER_OVERRIDE = "zink";
        env.MESA_GL_VERSION_OVERRIDE = "4.6";
        env.DYLD_FALLBACK_LIBRARY_PATH = path.join(enginePath, "lib");
    }

    return env;
}
