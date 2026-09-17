/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { showNotification } from "@api/Notifications";
import { sendMessage } from "@utils/discord";
import { sleep } from "@utils/misc";
import { ChannelStore } from "@webpack/common";

import { openQueueModal } from "./components/QueueModal";
import { bySendAt, describeSendError, nextWakeDelay, partitionDue, previewText, recoverInterrupted } from "./queueLogic";
import { settings } from "./settings";
import { addItem, getItem, getItems, loadQueue, mutate, patchItem, removeItems } from "./store";
import { validateSchedule } from "./timeParser";
import type { MissedBehavior, ScheduledMessage } from "./types";
import { canSendIn, currentUserId, describeChannel, jumpToChannel, logger } from "./utils";

/** Longest single wait. Keeps setTimeout from overflowing and catches up quickly after sleep. */
const MAX_WAIT_MS = 30_000;
/** A send Discord hasn't answered by now is reported as failed with an unknown outcome */
const SEND_TIMEOUT_MS = 90_000;
const GAP_BETWEEN_SENDS_MS = 1_500;
/**
 * Normal timer delay must never count as "missed". Chromium can hold timers in a hidden window
 * for up to a minute, on top of the 30 s wait cap.
 */
const MIN_GRACE_MS = 2 * 60_000;

const MISSED_ERROR = "Discord wasn't running, or the computer was asleep, when this was due.";

let running = false;
/** Bumped on every start and stop so async work from an older run can tell it's stale */
let generation = 0;
let timer: ReturnType<typeof setTimeout> | undefined;
let connected = false;
let checking = false;
let recheckRequested = false;
const inFlight = new Set<string>();

class SendTimeoutError extends Error { }

// Lifecycle

export async function startScheduler() {
    const run = ++generation;
    running = true;

    try {
        await loadQueue();
    } catch (error) {
        logger.error("Couldn't load scheduled messages", error);
        void showNotification({
            title: "ScheduleSend couldn't load your scheduled messages",
            body: "Nothing will be sent until they load. Reload Discord to try again.",
            color: "var(--status-danger)",
            permanent: true,
        });
        return;
    }
    if (run !== generation) return;

    const interrupted = getItems().filter(item => item.status === "sending" && !inFlight.has(item.id));
    if (interrupted.length) {
        await mutate(list => recoverInterrupted(list, inFlight)).catch(() => { });
        notifyNeedsAttention(
            interrupted.length === 1 ? "A scheduled message may not have been sent" : `${interrupted.length} scheduled messages may not have been sent`,
            "Discord closed while sending. Check the channel, then send again or discard."
        );
    }
    if (run !== generation) return;

    // Enabled mid-session, after CONNECTION_OPEN already fired
    if (currentUserId()) connected = true;

    document.addEventListener("visibilitychange", checkSoon);
    window.addEventListener("online", checkSoon);
    void checkDue();
}

export function stopScheduler() {
    generation++;
    running = false;
    clearTimeout(timer);
    timer = undefined;
    document.removeEventListener("visibilitychange", checkSoon);
    window.removeEventListener("online", checkSoon);
    // The stored queue is deliberately left untouched: disabling the plugin must not lose messages.
}

export function onConnectionOpen() {
    connected = true;
    checkSoon();
}

function checkSoon() {
    void checkDue();
}

// Loop

function arm() {
    clearTimeout(timer);
    timer = undefined;
    if (!running) return;

    const delay = nextWakeDelay(getItems(), Date.now(), MAX_WAIT_MS, currentUserId());
    if (delay !== null) timer = setTimeout(checkSoon, delay);
}

/** Call after changing the queue from outside the loop */
function rearm() {
    if (running && !checking) arm();
}

async function checkDue() {
    if (!running) return;
    if (checking) {
        recheckRequested = true;
        return;
    }

    checking = true;
    const run = generation;
    try {
        if (!connected || !navigator.onLine) return;
        const me = currentUserId();
        if (!me) return;

        const graceMs = Math.max(MIN_GRACE_MS, (Number(settings.store.missedGraceMinutes) || 0) * 60_000);
        const { onTime, late } = partitionDue(getItems(), Date.now(), me, graceMs);
        const toSend = late.length ? [...onTime, ...await handleLate(late)].sort(bySendAt) : onTime;

        let sentOne = false;
        for (const candidate of toSend) {
            if (sentOne) await sleep(GAP_BETWEEN_SENDS_MS);
            if (run !== generation) break;

            // Re-read with no await before sendItem: it may have been cancelled, edited, or sent from the list meanwhile
            const item = getItem(candidate.id);
            if (item?.status !== "pending" || item.sendAt > Date.now()) continue;

            await sendItem(item);
            sentOne = true;
        }

        // Sending takes time; look again right away for anything that came due meanwhile
        if (sentOne && run === generation) recheckRequested = true;
    } catch (error) {
        logger.error("Checking scheduled messages failed", error);
    } finally {
        checking = false;
        if (running) {
            if (recheckRequested) {
                recheckRequested = false;
                checkSoon();
            } else {
                arm();
            }
        }
    }
}

async function handleLate(late: ScheduledMessage[]): Promise<ScheduledMessage[]> {
    const behavior = settings.store.missedBehavior as MissedBehavior;
    if (behavior === "send") return late;

    const ids = new Set(late.map(item => item.id));
    const count = late.length === 1 ? "A scheduled message" : `${late.length} scheduled messages`;

    if (behavior === "discard") {
        await removeItems(ids);
        void showNotification({
            title: `${count} discarded`,
            body: `${MISSED_ERROR} Change "missed messages" in the ScheduleSend settings to keep them next time.`,
        });
        return [];
    }

    await mutate(list => list.map(item => ids.has(item.id) ? { ...item, status: "missed" as const, error: MISSED_ERROR } : item));
    notifyNeedsAttention(`${count} missed ${late.length === 1 ? "its" : "their"} time`, `${MISSED_ERROR} Click to send or discard.`);
    return [];
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
    let handle: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_, reject) => {
        handle = setTimeout(() => reject(new SendTimeoutError()), ms);
    });
    return Promise.race([promise, timeout]).finally(() => clearTimeout(handle));
}

async function markFailed(item: ScheduledMessage, error: string) {
    await patchItem(item.id, { status: "failed", error }).catch(() => { });
    notifyNeedsAttention("Scheduled message not sent", `${describeChannel(item.channelId)}: ${error}`);
}

/** Sends one item now. Resolves true if Discord accepted it. */
async function sendItem(item: ScheduledMessage): Promise<boolean> {
    if (inFlight.has(item.id)) return false;
    if (item.authorId !== currentUserId())
        throw new Error("This message was scheduled from another account. Switch to that account to send it.");

    inFlight.add(item.id);
    try {
        const channel = ChannelStore.getChannel(item.channelId);
        if (!channel) {
            await markFailed(item, "The channel no longer exists, or you're no longer in that server.");
            return false;
        }
        if (!canSendIn(channel)) {
            await markFailed(item, "You don't have permission to send messages in that channel.");
            return false;
        }

        try {
            // Saved before the network call, so a crash mid-send can't lead to a second copy
            await patchItem(item.id, { status: "sending", error: undefined });
        } catch {
            await markFailed(item, "Couldn't save to Discord's local storage, so it wasn't sent.");
            return false;
        }

        try {
            // waitForChannelReady=false: Discord otherwise waits for the channel's messages to load,
            // which never happens for a channel that isn't open.
            await withTimeout(sendMessage(item.channelId, { content: item.content }, false), SEND_TIMEOUT_MS);
        } catch (error) {
            logger.error(`Sending ${item.id} failed`, error);
            await markFailed(item, error instanceof SendTimeoutError
                ? "Discord didn't confirm the send within 90 seconds. It may have been sent, so check the channel before sending it again."
                : describeSendError(error));
            return false;
        }

        await removeItems(new Set([item.id]))
            .catch(error => logger.error("Sent, but couldn't remove it from storage", error));
        notifySent(item);
        return true;
    } finally {
        inFlight.delete(item.id);
    }
}

// Notifications

function notifySent(item: ScheduledMessage) {
    if (!settings.store.notifyOnSend) return;
    void showNotification({
        title: "Scheduled message sent",
        body: `${describeChannel(item.channelId)}: ${previewText(item.content, 120)}`,
        onClick: () => jumpToChannel(item.channelId),
    });
}

function notifyNeedsAttention(title: string, body: string) {
    void showNotification({
        title,
        body,
        color: "var(--status-warning)",
        permanent: true,
        onClick: () => openQueueModal(),
    });
}

// Actions used by the UI and commands. They throw an Error with a user-facing message.

export async function scheduleMessage(channelId: string, content: string, sendAt: number | null): Promise<ScheduledMessage> {
    const authorId = currentUserId();
    if (!authorId) throw new Error("Discord hasn't finished logging in yet.");

    const now = Date.now();
    const problem = validateSchedule(content, sendAt, now);
    if (problem) throw new Error(problem);

    const channel = ChannelStore.getChannel(channelId);
    if (!channel) throw new Error("Channel not found.");
    if (!canSendIn(channel)) throw new Error("You don't have permission to send messages in this channel.");

    const item: ScheduledMessage = {
        id: crypto.randomUUID(),
        channelId,
        authorId,
        content,
        sendAt: sendAt!,
        createdAt: now,
        status: "pending",
    };
    await addItem(item);
    rearm();
    return item;
}

export async function rescheduleMessage(id: string, content: string, sendAt: number | null) {
    const item = getItem(id);
    if (!item) throw new Error("That scheduled message no longer exists.");
    if (inFlight.has(id)) throw new Error("It's being sent right now.");

    const problem = validateSchedule(content, sendAt, Date.now());
    if (problem) throw new Error(problem);

    await patchItem(id, { content, sendAt: sendAt!, status: "pending", error: undefined });
    rearm();
}

export async function cancelMessage(id: string) {
    if (inFlight.has(id)) throw new Error("It's being sent right now and can't be cancelled.");
    await removeItems(new Set([id]));
    rearm();
}

export async function sendNow(id: string): Promise<boolean> {
    const item = getItem(id);
    if (!item) throw new Error("That scheduled message no longer exists.");
    if (!connected) throw new Error("Discord isn't connected yet.");
    return sendItem(item);
}

export const isInFlight = (id: string) => inFlight.has(id);
