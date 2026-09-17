/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { definePluginSettings } from "@api/Settings";
import { OptionType } from "@utils/types";

export const settings = definePluginSettings({
    missedBehavior: {
        type: OptionType.SELECT,
        displayName: "Missed messages",
        description: "Messages that came due while Discord was closed or the computer was asleep",
        options: [
            { label: "Ask me what to do", value: "ask", default: true },
            { label: "Send them late", value: "send" },
            { label: "Discard them", value: "discard" },
        ],
    },
    missedGraceMinutes: {
        type: OptionType.NUMBER,
        displayName: "Grace period (minutes)",
        description: "Still send automatically if no more than this many minutes late (at least 2)",
        default: 5,
        isValid: (value: number) => (Number.isFinite(value) && value >= 2) || "Must be 2 or more",
    },
    notifyOnSend: {
        type: OptionType.BOOLEAN,
        displayName: "Notify when sent",
        description: "Show a notification when a scheduled message is sent",
        default: true,
    },
    clearChatBoxAfterScheduling: {
        type: OptionType.BOOLEAN,
        displayName: "Empty the message box after scheduling",
        description: "Empty the message box after scheduling what was typed in it",
        default: true,
    },
});
