<!--
SPDX-FileCopyrightText: 2025 The BAR Lobby Authors

SPDX-License-Identifier: MIT
-->

<template>
    <Modal :title="t('lobby.navbar.serverSettings.title')">
        <div class="gridform">
            <div>{{ t("lobby.navbar.serverSettings.activeServer") }}</div>
            <Select
                v-model="settingsStore.lobbyServer"
                :options="serversList"
                optionGroupLabel="label"
                optionGroupChildren="items"
                :optionDisabled="isProductionServer"
            />
            <div>{{ t("lobby.navbar.serverSettings.customServer") }}</div>
            <Textbox
                type="text"
                v-model="serverInput"
                :placeholder="t('lobby.navbar.serverSettings.placeholder')"
                @keyup.enter="addServerToList()"
                class="textbox"
            />
            <div></div>
            <div class="gridform">
                <Button @click="addServerToList()">{{ t("lobby.navbar.serverSettings.add") }}</Button>
                <Button @click="removeServerFromList()" :disabled="disableRemoveButton">{{
                    t("lobby.navbar.serverSettings.remove")
                }}</Button>
            </div>
            <OverlayPanel ref="op">
                <div class="container">
                    {{ tooltipMessage }}
                </div>
            </OverlayPanel>
        </div>
        <div class="margin-md server-notice">{{ t("lobby.navbar.serverSettings.productionServerNotice") }}</div>
        <div class="margin-md">{{ t("lobby.navbar.serverSettings.info") }}</div>
    </Modal>
</template>

<script lang="ts" setup>
import { ref, computed } from "vue";
import Modal from "@renderer/components/common/Modal.vue";
import Select from "@renderer/components/controls/Select.vue";
import Button from "@renderer/components/controls/Button.vue";
import OverlayPanel from "primevue/overlaypanel";
import { settingsStore } from "@renderer/store/settings.store";
import Textbox from "@renderer/components/controls/Textbox.vue";
import { useTypedI18n } from "@renderer/i18n";
const { t } = useTypedI18n();

const serverInput = ref("");

const op = ref();
const tooltipMessage = ref("");

const defaultServers: string[] = [
    "wss://server4.beyondallreason.info",
    "wss://server5.beyondallreason.info",
    "wss://lobby-server-dev.beyondallreason.dev",
    "ws://localhost:4000",
];

// bar-lobby speaks the Tachyon/OAuth2 protocol, which is only available on the dev
// lobby server. Production servers (server4/5) run the legacy Spring protocol that
// this client cannot authenticate against, so they're shown disabled rather than
// removed — for production multiplayer, use the Chobby client instead.
const DEV_SERVER = "wss://lobby-server-dev.beyondallreason.dev";
const PRODUCTION_SERVERS = ["wss://server4.beyondallreason.info", "wss://server5.beyondallreason.info"];

function isProductionServer(url: string) {
    return PRODUCTION_SERVERS.includes(url);
}

const disableRemoveButton = computed(() => {
    return defaultServers.includes(settingsStore.lobbyServer);
});

const serversList = ref([
    {
        label: t("lobby.navbar.serverSettings.labelDefault"),
        items: defaultServers,
    },
    {
        label: t("lobby.navbar.serverSettings.labelCustom"),
        items: settingsStore.customServerList,
    },
]);

function addServerToList() {
    //Disallow empty strings
    if (serverInput.value == "") {
        return;
    }
    //disallow duplicates of the default servers
    if (defaultServers.includes(serverInput.value)) {
        return;
    }
    settingsStore.customServerList.push(serverInput.value);
    serversList.value = [
        {
            label: t("lobby.navbar.serverSettings.labelDefault"),
            items: defaultServers,
        },
        {
            label: t("lobby.navbar.serverSettings.labelCustom"),
            items: settingsStore.customServerList,
        },
    ];
    serverInput.value = "";
}

function removeServerFromList() {
    const index = settingsStore.customServerList.indexOf(settingsStore.lobbyServer);
    settingsStore.customServerList.splice(index, 1);
    //Bounce back to the dev server when an entry is deleted. defaultServers[0] is a
    //production server, which bar-lobby (Tachyon) cannot authenticate against.
    settingsStore.lobbyServer = DEV_SERVER;
}
</script>

<style lang="scss" scoped>
.container {
    background-color: rgba(0, 0, 0, 0.3);
    backdrop-filter: blur(5px);
}
.textbox {
    justify-self: normal;
}
.server-notice {
    color: rgba(255, 255, 255, 0.6);
    font-size: 0.9em;
}
</style>
