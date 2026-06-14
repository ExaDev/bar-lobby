<!--
SPDX-FileCopyrightText: 2025 The BAR Lobby Authors

SPDX-License-Identifier: CC0-1.0
-->

# Bundled macOS engine staging directory

The macOS build bundles a patched Recoil engine inside the app rather than
fetching it from the CDN (which only serves Windows and Linux builds). At build
time the engine tree is staged here, and electron-builder ships it via the
`mac.extraResources` entry to `Contents/Resources/engine-macos` inside the
`.app`. On first run `ensureBundledMacEngine` (see
`src/main/content/engine/macos-engine-install.ts`) copies it into the versioned
engine directory under `~/Library/Application Support/BeyondAllReason/assets/engine/<version>/`,
normalising the layout so it mirrors the Linux archive.

The binaries are large and are **not** committed (see `.gitignore`); only this
README is tracked. Populate this directory from the ExaDev engine artifact
before running `npm run buildall:mac`. CI does this with a download-artifact (or
Git LFS) step.

## Expected layout

```
buildResources/engine-macos/
  bin/spring                              # the engine binary
  bin/pr-downloader                       # REQUIRED: lobby spawns this for content downloads
  lib/                                    # Mesa + Vulkan + engine dylibs
  share/vulkan/icd.d/kosmickrisp.json     # KosmicKrisp Vulkan ICD
  AI/                                     # optional: Skirmish AI definitions
  game/fonts/FreeSansBold.otf             # REQUIRED: engine default font (cont/fonts)
  game/games/springcontent.sdz            # REQUIRED: engine base content (cont base)
  game/games/{bitmaps,maphelper,cursors}.sdz
```

Every binary in `bin/` is promoted to the version-dir root, so `pr-downloader`
MUST be present there (the lobby spawns `<version>/pr-downloader`; without it,
content downloads fail with `spawn ... ENOENT`). It must be the macOS-patched
fork (HTTP/1.1) or the per-file rapid transfer stalls.

The `game/` payload is folded into `<assets>/` (so `game/fonts` ->
`<assets>/fonts`, `game/games` -> `<assets>/games`). The engine's loose default
font (`fonts/FreeSansBold.otf` from the engine's `cont/fonts/`) and base content
archives (`springcontent.sdz` etc.) are REQUIRED — without them the engine
aborts at startup with `Failed to load FontFile "fonts/FreeSansBold.otf", did
you forget to run make install?`. These are engine `cont/`-derived content, not
the downloadable game; the multi-GB game itself is fetched via pr-downloader.

After the first-run copy the version directory ends up as:

```
<assets>/engine/<version>/
  spring                                  # bin/spring promoted to the root
  lib/                                    # sibling of the binary
  share/...
  AI/Skirmish/...                         # if shipped
```

The `kosmickrisp.json` ICD uses a relative `library_path` (`../../../lib/...`)
that resolves correctly once `share/vulkan/icd.d/` sits with `lib/` as a
version-dir sibling.
