import { Configuration } from "electron-builder";

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

    publish: { provider: "github" },
    fileAssociations: [
        {
            ext: "sdfz",
            description: "BAR Replay File",
            role: "Viewer",
            // Base name without extension so electron-builder resolves the
            // platform-appropriate icon: icon.ico on Windows, icon.icns on macOS.
            icon: "icon",
            name: "SDFZ NAME HERE",
        },
    ],

    // Windows
    win: {
        target: ["nsis"],
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
        // Notarisation stays inert until an Apple Team ID is provided via the
        // environment/CI secret; without it electron-builder skips notarisation.
        notarize: process.env["APPLE_TEAM_ID"] ? { teamId: process.env["APPLE_TEAM_ID"] } : false,
        // Ship the bundled patched engine outside the asar so it lands at
        // process.resourcesPath/engine-macos for the first-run install copy.
        extraResources: [{ from: "buildResources/engine-macos", to: "engine-macos" }],
    },
    dmg: {
        artifactName: "${productName}-${version}-mac-arm64.${ext}",
    },
};

export default config;
