// SPDX-FileCopyrightText: 2025 The BAR Lobby Authors
//
// SPDX-License-Identifier: MIT

import { CONFIG_PATH } from "@main/config/app";
import { FileStore } from "@main/json/file-store";
import { settingsSchema } from "@main/json/model/settings";

import { ipcMain } from "@main/typed-ipc";
import { logger } from "@main/utils/logger";
import path from "path";

const log = logger("settings.service.ts");

// bar-lobby uses the Tachyon/OAuth2 protocol, available only on the dev lobby
// server. Production servers run the legacy Spring protocol this client cannot
// authenticate against; a persisted production lobbyServer surfaces as an opaque
// "invalid client_id" login failure, so migrate it back to the dev server on load.
const DEV_SERVER = "wss://lobby-server-dev.beyondallreason.dev";
const PRODUCTION_SERVERS = ["wss://server4.beyondallreason.info", "wss://server5.beyondallreason.info"];

const settingsStore = new FileStore<typeof settingsSchema>(path.join(CONFIG_PATH, "settings.json"), settingsSchema);

async function init() {
    await settingsStore.init();
    if (PRODUCTION_SERVERS.includes(settingsStore.model.lobbyServer)) {
        log.info(`Migrating non-functional lobbyServer "${settingsStore.model.lobbyServer}" to ${DEV_SERVER}`);
        await settingsStore.update({ lobbyServer: DEV_SERVER });
    }
}

function getSettings() {
    return settingsStore.model;
}

async function updateSettings(data: Partial<typeof settingsSchema>) {
    return await settingsStore.update(data);
}

function toggleFullscreen() {
    settingsStore.update({ fullscreen: !settingsStore.model.fullscreen });
}

function registerIpcHandlers() {
    ipcMain.handle("settings:get", () => getSettings());
    ipcMain.handle("settings:update", (_, data: Partial<Settings>) => updateSettings(data));
    ipcMain.handle("settings:toggleFullscreen", () => toggleFullscreen());
}

export type Settings = typeof settingsStore.model;
export const settingsService = {
    init,
    registerIpcHandlers,
    getSettings,
    updateSettings,
};
