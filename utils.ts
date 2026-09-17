/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { classNameFactory } from "@utils/css";
import { Logger } from "@utils/Logger";
import { Channel } from "@vencord/discord-types";
import { findByPropsLazy } from "@webpack";
import { ChannelRouter, ChannelStore, ComponentDispatch, DraftStore, DraftType, GuildStore, moment, Parser, PermissionsBits, PermissionStore, SelectedChannelStore, UserStore } from "@webpack/common";

export const logger = new Logger("ScheduleSend", "#b9a6f5");
export const cl = classNameFactory("vc-schedulesend-");

// Not exported by @webpack/common; the crashHandler plugin finds it the same way
const DraftManager = findByPropsLazy("clearDraft", "saveDraft");

export const currentUserId = (): string | undefined => UserStore.getCurrentUser()?.id;

export function describeChannel(channelId: string): string {
    const channel = ChannelStore.getChannel(channelId);
    if (!channel) return "unknown channel";
    if (channel.isDM()) {
        const user = UserStore.getUser(channel.getRecipientId()!);
        return user ? `@${user.username}` : "Direct message";
    }
    if (channel.isGroupDM()) return channel.name || "Group DM";
    const guild = GuildStore.getGuild(channel.guild_id);
    return guild ? `#${channel.name} (${guild.name})` : `#${channel.name}`;
}

/** Best-effort check before sending. Discord has the final say and rejects the send if not allowed. */
export function canSendIn(channel: Channel): boolean {
    if (channel.isPrivate()) return true;
    const permission = channel.isThread() ? PermissionsBits.SEND_MESSAGES_IN_THREADS : PermissionsBits.SEND_MESSAGES;
    return PermissionStore.can(permission, channel);
}

export function jumpToChannel(channelId: string) {
    ChannelRouter.transitionToChannel(channelId);
}

export const getChatDraft = (channelId: string) => DraftStore.getDraft(channelId, DraftType.ChannelMessage) ?? "";

/**
 * Empties the message box after its text went into the schedule.
 *
 * Discord's chat box empties itself (and its draft) on the CLEAR_TEXT component event, but that
 * event goes to the most recently mounted chat box. Only fire it for the open channel's main chat;
 * otherwise just clear the saved draft.
 */
export function clearChatInput(channelId: string, fromMainChat: boolean) {
    try {
        if (fromMainChat && SelectedChannelStore.getChannelId() === channelId)
            ComponentDispatch.dispatchToLastSubscribed("CLEAR_TEXT");
        DraftManager.clearDraft(channelId, DraftType.ChannelMessage);
    } catch (error) {
        logger.warn("Couldn't clear the message box", error);
    }
}

export const toUnix = (ms: number) => Math.floor(ms / 1000);

/** Discord timestamp markdown: rendered in the viewer's locale and timezone */
export const timestampMarkdown = (ms: number) => `<t:${toUnix(ms)}:f> (<t:${toUnix(ms)}:R>)`;
export const renderTime = (ms: number) => Parser.parse(timestampMarkdown(ms));

/** Plain text for toasts and notifications, e.g. "Tomorrow at 9:00 AM" */
export const formatTime = (ms: number) => moment(ms).calendar();

/** Value format of <input type="datetime-local"> */
export const toDateTimeInput = (ms: number) => moment(ms).format("YYYY-MM-DDTHH:mm");

/** Format that parseWhen accepts */
export const toWhenText = (ms: number) => moment(ms).format("YYYY-MM-DD HH:mm");
