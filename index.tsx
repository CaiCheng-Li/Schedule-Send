/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { ChatBarButton, ChatBarButtonFactory } from "@api/ChatButtons";
import { ApplicationCommandInputType, ApplicationCommandOptionType, findOption, sendBotMessage } from "@api/Commands";
import { findGroupChildrenByChildId, NavContextMenuPatchCallback } from "@api/ContextMenu";
import ErrorBoundary from "@components/ErrorBoundary";
import { HeadingSecondary } from "@components/Heading";
import { Paragraph } from "@components/Paragraph";
import definePlugin from "@utils/types";
import { Channel } from "@vencord/discord-types";
import { Menu } from "@webpack/common";

import { ClockIcon } from "./components/icons";
import { QueueList } from "./components/QueueList";
import { openQueueModal } from "./components/QueueModal";
import { openScheduleModal } from "./components/ScheduleModal";
import { findByShortId, previewText, shortId } from "./queueLogic";
import { cancelMessage, onConnectionOpen, scheduleMessage, startScheduler, stopScheduler } from "./scheduler";
import { settings } from "./settings";
import { getItems, useQueue } from "./store";
import managedStyle from "./styles.css?managed";
import { parseWhen, TIME_EXAMPLES } from "./timeParser";
import { cl, getChatDraft, timestampMarkdown } from "./utils";

const errorText = (error: unknown) => error instanceof Error ? error.message : String(error);

const ScheduleChatBarButton: ChatBarButtonFactory = ({ isAnyChat, isMainChat, channel }) => {
    const items = useQueue();
    if (!isAnyChat) return null;

    const here = items.filter(item => item.channelId === channel.id && item.status === "pending").length;
    const tooltip = here
        ? `Schedule message (${here} scheduled here, right-click for all)`
        : "Schedule message (right-click for all scheduled)";

    return (
        <ChatBarButton
            tooltip={tooltip}
            onClick={() => openScheduleModal({ channelId: channel.id, initialContent: getChatDraft(channel.id), fromMainChat: isMainChat })}
            onContextMenu={e => {
                e.preventDefault();
                e.stopPropagation();
                openQueueModal();
            }}
            buttonProps={{ "aria-haspopup": "dialog" }}
        >
            <ClockIcon className={cl("chatbar-icon", { "chatbar-icon-active": here > 0 })} />
        </ChatBarButton>
    );
};

const textAreaMenuPatch: NavContextMenuPatchCallback = (children, props?: { channel?: Channel; }) => {
    const group = findGroupChildrenByChildId("submit-button", children);
    if (!group) return;

    // Only offer scheduling when the menu says which message box it belongs to. Guessing from the
    // selected channel would pick the wrong one for a thread open in the sidebar.
    const channel = props?.channel;
    const items = [
        <Menu.MenuItem
            id="vc-schedulesend-list"
            key="vc-schedulesend-list"
            label="Scheduled messages"
            action={openQueueModal}
        />
    ];
    if (channel?.id) {
        items.unshift(
            <Menu.MenuItem
                id="vc-schedulesend-schedule"
                key="vc-schedulesend-schedule"
                label="Schedule message…"
                action={() => openScheduleModal({ channelId: channel.id, initialContent: getChatDraft(channel.id) })}
            />
        );
    }

    const index = group.findIndex(child => child?.props?.id === "submit-button");
    group.splice(index + 1, 0, ...items);
};

export default definePlugin({
    name: "ScheduleSend",
    description: "Write a message now and have Discord send it at a time you pick. Only sends while Discord is running.",
    authors: [{ name: "CaiCheng-Li", id: 0n }],
    tags: ["Chat", "Utility"],
    searchTerms: ["schedule", "send later", "timer", "delay"],

    settings,
    managedStyle,

    chatBarButton: {
        icon: ClockIcon,
        render: ScheduleChatBarButton,
    },

    contextMenus: {
        "textarea-context": textAreaMenuPatch,
    },

    commands: [
        {
            name: "schedule",
            description: "Send a message later",
            inputType: ApplicationCommandInputType.BUILT_IN,
            options: [
                {
                    name: "message",
                    description: "What to send",
                    type: ApplicationCommandOptionType.STRING,
                    required: true,
                },
                {
                    name: "time",
                    description: "When: 10m, 1h30m, 15:45, 9pm, tomorrow 9am, fri 17:00",
                    type: ApplicationCommandOptionType.STRING,
                    required: true,
                },
            ],
            async execute(args, ctx) {
                const content = findOption<string>(args, "message", "");
                const sendAt = parseWhen(findOption<string>(args, "time", ""), new Date());
                try {
                    const item = await scheduleMessage(ctx.channel.id, content, sendAt);
                    sendBotMessage(ctx.channel.id, {
                        content: `Scheduled for ${timestampMarkdown(item.sendAt)}. ID \`${shortId(item.id)}\`, cancel with \`/unschedule\`.`,
                    });
                } catch (error) {
                    sendBotMessage(ctx.channel.id, { content: `Not scheduled: ${errorText(error)}` });
                }
            },
        },
        {
            name: "scheduled",
            description: "List messages scheduled in this channel",
            inputType: ApplicationCommandInputType.BUILT_IN,
            execute(_args, ctx) {
                const lines = getItems()
                    .filter(item => item.channelId === ctx.channel.id)
                    .sort((a, b) => a.sendAt - b.sendAt)
                    .map(item => {
                        const status = item.status === "pending" ? "" : ` **${item.status}**`;
                        return `\`${shortId(item.id)}\` <t:${Math.floor(item.sendAt / 1000)}:f>${status}: ${previewText(item.content, 60)}`;
                    });

                sendBotMessage(ctx.channel.id, {
                    content: lines.length
                        ? `${lines.join("\n")}\n-# Right-click the clock button next to the message box to see every channel.`
                        : "Nothing scheduled in this channel.",
                });
            },
        },
        {
            name: "unschedule",
            description: "Cancel a scheduled message",
            inputType: ApplicationCommandInputType.BUILT_IN,
            options: [
                {
                    name: "id",
                    description: "The ID shown by /scheduled",
                    type: ApplicationCommandOptionType.STRING,
                    required: true,
                },
            ],
            async execute(args, ctx) {
                const match = findByShortId(getItems(), findOption<string>(args, "id", ""));
                if (match === null) return void sendBotMessage(ctx.channel.id, { content: "No scheduled message has that ID. See `/scheduled`." });
                if (match === "ambiguous") return void sendBotMessage(ctx.channel.id, { content: "More than one scheduled message starts with that. Use more of the ID." });

                try {
                    await cancelMessage(match.id);
                    sendBotMessage(ctx.channel.id, { content: `Cancelled: ${previewText(match.content, 80)}` });
                } catch (error) {
                    sendBotMessage(ctx.channel.id, { content: `Not cancelled: ${errorText(error)}` });
                }
            },
        },
    ],

    flux: {
        CONNECTION_OPEN() {
            onConnectionOpen();
        },
    },

    toolboxActions: {
        "Scheduled messages": openQueueModal,
    },

    settingsAboutComponent: () => (
        <ErrorBoundary>
            <Paragraph>
                Click the clock button next to the message box or use <code>/schedule</code>. Times like {TIME_EXAMPLES} work.
                Messages are sent by this Discord app, so it has to be running (minimized is fine) when they're due.
            </Paragraph>
            <HeadingSecondary className={cl("settings-heading")}>Scheduled messages</HeadingSecondary>
            <QueueList />
        </ErrorBoundary>
    ),

    start() {
        void startScheduler();
    },

    stop() {
        stopScheduler();
    },
});
