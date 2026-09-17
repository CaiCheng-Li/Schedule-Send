/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// Pure queue decisions. No Discord or Vencord imports, so it runs under `tsx --test`.

import type { ItemStatus, ScheduledMessage } from "./types";

export const INTERRUPTED_ERROR =
    "Discord closed or reloaded while this was sending. It may have been sent, so check the channel before sending it again.";

const STATUSES: readonly ItemStatus[] = ["pending", "sending", "failed", "missed"];

export const bySendAt = (a: ScheduledMessage, b: ScheduledMessage) => a.sendAt - b.sendAt;

/** Guards against corrupted or hand-edited storage */
export function isValidItem(value: unknown): value is ScheduledMessage {
    if (!value || typeof value !== "object") return false;
    const item = value as Record<string, unknown>;
    return typeof item.id === "string"
        && typeof item.channelId === "string"
        && typeof item.authorId === "string"
        && typeof item.content === "string"
        && typeof item.sendAt === "number"
        && typeof item.createdAt === "number"
        && STATUSES.includes(item.status as ItemStatus);
}

/**
 * How long to wait before checking the queue again. Capped so a long wait never overflows
 * setTimeout, and so the loop notices wall-clock jumps after sleep or timer throttling.
 *
 * Items that are already due when this runs are ones the last check couldn't send (not connected,
 * offline). Waiting 0 ms for them would spin; they get the full interval, and the connection and
 * online events wake the loop sooner.
 */
export function nextWakeDelay(
    items: readonly ScheduledMessage[],
    now: number,
    maxWaitMs: number,
    userId?: string | null
): number | null {
    let next = Infinity;
    for (const item of items) {
        if (item.status !== "pending") continue;
        if (userId && item.authorId !== userId) continue;
        if (item.sendAt < next) next = item.sendAt;
    }
    if (next === Infinity) return null;
    if (next <= now) return maxWaitMs;
    return Math.min(next - now, maxWaitMs);
}

/** Pending items of `userId` that are due, split by whether they're later than the grace period */
export function partitionDue(items: readonly ScheduledMessage[], now: number, userId: string, graceMs: number) {
    const onTime: ScheduledMessage[] = [];
    const late: ScheduledMessage[] = [];
    for (const item of [...items].sort(bySendAt)) {
        if (item.status !== "pending" || item.authorId !== userId || item.sendAt > now) continue;
        (now - item.sendAt > graceMs ? late : onTime).push(item);
    }
    return { onTime, late };
}

/** Items left in "sending" by a previous session. Never resend them automatically. */
export function recoverInterrupted(items: readonly ScheduledMessage[], inFlight: ReadonlySet<string>): ScheduledMessage[] {
    return items.map(item =>
        item.status === "sending" && !inFlight.has(item.id)
            ? { ...item, status: "failed" as const, error: INTERRUPTED_ERROR }
            : item
    );
}

export const shortId = (id: string) => id.slice(0, 6);

export function findByShortId(items: readonly ScheduledMessage[], query: string): ScheduledMessage | "ambiguous" | null {
    const prefix = query.trim().toLowerCase();
    if (!prefix) return null;
    const matches = items.filter(item => item.id.toLowerCase().startsWith(prefix));
    if (matches.length > 1) return "ambiguous";
    return matches[0] ?? null;
}

export function previewText(content: string, maxLength = 80) {
    const flat = content.replace(/\s+/g, " ").trim();
    return flat.length > maxLength ? flat.slice(0, maxLength - 1) + "…" : flat;
}

interface DiscordSendFailure {
    status?: number;
    body?: { message?: string; };
    hasErr?: boolean;
    err?: { code?: string; message?: string; };
    message?: string;
}

/**
 * Discord's MessageActions.sendMessage rejects with its HTTP response object
 * ({ ok: false, status, body: { code, message }, hasErr, err }), not an Error.
 */
export function describeSendError(error: unknown): string {
    if (error && typeof error === "object") {
        const failure = error as DiscordSendFailure;
        if (failure.hasErr && failure.err?.code === "ABORTED") return "Discord cancelled the request.";
        if (failure.body?.message)
            return typeof failure.status === "number" ? `${failure.body.message} (HTTP ${failure.status})` : failure.body.message;
        if (failure.hasErr && failure.err?.message) return failure.err.message;
        if (typeof failure.status === "number") return `Discord returned HTTP ${failure.status}.`;
        if (typeof failure.message === "string" && failure.message) return failure.message;
    }
    if (typeof error === "string" && error) return error;
    return "Unknown error.";
}
