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
  lib/                                    # Mesa + Vulkan + engine dylibs
  share/vulkan/icd.d/kosmickrisp.json     # KosmicKrisp Vulkan ICD
  AI/                                     # optional: Skirmish AI definitions
  game/                                   # optional: games, fonts, chobby_config.json
```

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
