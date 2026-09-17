/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

/**
 * pending: waiting for its time
 * sending: handed to Discord, no answer yet
 * failed:  Discord refused it, or the outcome is unknown
 * missed:  was due while Discord wasn't running; waiting for the user to decide
 */
export type ItemStatus = "pending" | "sending" | "failed" | "missed";

export interface ScheduledMessage {
    id: string;
    channelId: string;
    /** Account that scheduled it. Only that account sends it. */
    authorId: string;
    content: string;
    sendAt: number;
    createdAt: number;
    status: ItemStatus;
    error?: string;
}

export type MissedBehavior = "ask" | "send" | "discard";
