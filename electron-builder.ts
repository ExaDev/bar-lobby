import { Configuration } from "electron-builder";

// Notarisation is scaffolded but inert until Apple credentials are supplied.
// Setting APPLE_TEAM_ID (alongside APPLE_ID + APPLE_APP_SPECIFIC_PASSWORD)
// flips it on; electron-builder reads the credentials from the environment at
// build time. mac.notarize is a boolean here, so gate on the env var presence.
const notarizeEnabled = Boolean(process.env["APPLE_TEAM_ID"]);

/**
 * @see https://www.electron.build/configuration
 */
const config: Configuration = {
    appId: "info.beyondallreason.lobby",
    // Should be the same as APP_NAME in src/main/config/app.ts and in
    // workaround in installer.nsh.
    productName: "BeyondAllReason",

    asar: true,
    disableDefaultIgnoredFiles: true,
    files: ["./.vite/**", "!node_modules", "./node_modules/7zip-bin/**"],
    directories: { buildResources: "buildResources" },
    asarUnpack: ["resources/**"],

    // Explicit owner/repo: without it electron-builder infers the target from
    // package.json's repository field, which still points at the upstream
    // beyond-all-reason/bar-lobby, so releases 403'd against the wrong repo.
    // releaseType: electron-builder defaults to "draft", which isn't downloadable
    // anonymously (so the cask can't consume it). Publish branch auto-releases as
    // prereleases and deliberate v* tags as full releases.
    publish: {
        provider: "github",
        owner: "ExaDev",
        repo: "bar-lobby",
        releaseType: process.env["GITHUB_REF_TYPE"] === "tag" ? "release" : "prerelease",
    },
    fileAssociations: [
        {
            ext: "sdfz",
            description: "BAR Replay File",
            role: "Viewer",
            // NOTE: no per-association icon. Pointing it at the app's icon.icns
            // made electron-builder link the same file into the .app twice
            // (app icon + association icon) and race to EEXIST on macOS. Omitting
            // it lets the association inherit the app icon: one link, no race.
            name: "SDFZ NAME HERE",
        },
    ],

    // Windows
    win: {
        // nsis = installer for direct downloads; zip = portable build for the
        // Scoop bucket (ExaDev/scoop-bar). nsis keeps its own artifactName
        // (below); the zip uses this win-level one.
        target: ["nsis", "zip"],
        artifactName: "${productName}-${version}-win-${arch}.${ext}",
        extraResources: [
            {
                from: "buildResources/cacert.pem",
                to: "cacert.pem",
            },
        ],
    },
    nsis: {
        artifactName: "${productName}-${version}-setup.${ext}",
        uninstallDisplayName: "Beyond All Reason",
        shortcutName: "Beyond All Reason",
        oneClick: true,
        perMachine: false,
        allowToChangeInstallationDirectory: false,
        include: "build/installer.nsh",
    },

    // Linux
    linux: {
        target: ["AppImage"],
        category: "Game",
    },
    appImage: {},

    // macOS (Apple Silicon)
    mac: {
        target: [{ target: "dmg", arch: ["arm64"] }],
        category: "public.app-category.games",
        // Ad-hoc signing for now (equivalent to `codesign --sign -`). Switch to
        // a Developer ID identity + hardenedRuntime + entitlements once signing
        // credentials are available.
        identity: null,
        hardenedRuntime: false,
        gatekeeperAssess: false,
        // Inert without Apple credentials; see notarizeEnabled above.
        notarize: notarizeEnabled,
        // The patched macOS engine is no longer bundled in the DMG: the lobby
        // downloads the latest engine-macos-arm64 release from the public
        // ExaDev/RecoilEngine repo on first run (see macos-engine-install.ts).
    },
    dmg: {
        artifactName: "${productName}-${version}-mac-arm64.${ext}",
    },
};

export default config;
