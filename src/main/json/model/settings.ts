// SPDX-FileCopyrightText: 2025 The BAR Lobby Authors
//
// SPDX-License-Identifier: MIT

import { Type } from "@sinclair/typebox";

export const settingsSchema = Type.Object({
    fullscreen: Type.Boolean({ default: true }),
    size: Type.Number({ default: 900 }),
    displayIndex: Type.Number({ default: 0 }),
    skipIntro: Type.Boolean({ default: false }),
    sfxVolume: Type.Number({ default: 5, minimum: 0, maximum: 100 }),
    musicVolume: Type.Number({ default: 5, minimum: 0, maximum: 100 }),
    loginAutomatically: Type.Boolean({ default: true }),
    // Default on in this fork: bar-lobby gates the entire online surface (login,
    // server status, online routes) behind devMode, so without it there is no way
    // to reach multiplayer at all. Upstream keeps it false because online play is
    // unfinished; we enable it so the fork can actually attempt it.
    devMode: Type.Boolean({ default: true }),
    battlesHideInProgress: Type.Boolean({ default: false }),
    battlesHidePvE: Type.Boolean({ default: false }),
    battlesHideLocked: Type.Boolean({ default: false }),
    battlesHideEmpty: Type.Boolean({ default: true }),
    logUploadUrl: Type.String({ default: "https://log.beyondallreason.dev/" }),
    // Default to the dev lobby server: the hardcoded OAuth client "generic_lobby"
    // (config/server.ts) is only registered there, not on production server4/5,
    // so login can only complete against dev until BAR registers the client on
    // production.
    lobbyServer: Type.String({ default: "wss://lobby-server-dev.beyondallreason.dev" }),
    customServerList: Type.Array(Type.String(), { default: [] }),
    endedNormallyFilter: Type.Union([Type.Literal("true"), Type.Literal("false"), Type.Literal("null")], { default: "null" }),
    assetsPath: Type.String({ default: "" }),
});
