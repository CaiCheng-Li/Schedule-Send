/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import * as DataStore from "@api/DataStore";
import { useEffect, useReducer } from "@webpack/common";

import { isValidItem } from "./queueLogic";
import type { ScheduledMessage } from "./types";
import { logger } from "./utils";

const STORAGE_KEY = "ScheduleSend_queue";

// The in-memory list is the source of truth once loaded. Every change goes through mutate(),
// which persists a snapshot; writes are chained so they land in the order they were made.
let items: readonly ScheduledMessage[] = [];
let loadPromise: Promise<void> | null = null;
let writeChain: Promise<void> = Promise.resolve();
const listeners = new Set<() => void>();

export const getItems = () => items;
export const getItem = (id: string) => items.find(item => item.id === id);

function emitChange() {
    listeners.forEach(listener => listener());
}

/** Loads once per page. Safe to call repeatedly. Rejects if storage can't be read. */
export function loadQueue(): Promise<void> {
    loadPromise ??= writeChain
        .then(() => DataStore.get<unknown>(STORAGE_KEY))
        .then(stored => {
            const list = Array.isArray(stored) ? stored : [];
            const valid = list.filter(isValidItem);
            if (valid.length !== list.length) logger.warn(`Ignored ${list.length - valid.length} unreadable stored item(s)`);
            items = valid;
            emitChange();
        })
        .catch(error => {
            // Allow a retry on the next start. Nothing may be written until a load succeeds,
            // otherwise an empty list would overwrite the saved one.
            loadPromise = null;
            throw error;
        });
    return loadPromise;
}

/** Applies a change in memory right away and resolves once it's saved. Rejects if saving fails. */
export async function mutate(change: (list: readonly ScheduledMessage[]) => readonly ScheduledMessage[]): Promise<void> {
    await loadQueue();
    items = change(items);
    emitChange();

    const snapshot = items;
    const write = writeChain.then(() => DataStore.set(STORAGE_KEY, snapshot));
    writeChain = write.catch(() => { });
    try {
        await write;
    } catch (error) {
        logger.error("Couldn't save scheduled messages", error);
        throw error;
    }
}

export const addItem = (item: ScheduledMessage) => mutate(list => [...list, item]);

export const patchItem = (id: string, patch: Partial<ScheduledMessage>) =>
    mutate(list => list.map(item => item.id === id ? { ...item, ...patch } : item));

export const removeItems = (ids: ReadonlySet<string>) => mutate(list => list.filter(item => !ids.has(item.id)));

/** Re-renders the calling component whenever the queue changes */
export function useQueue(): readonly ScheduledMessage[] {
    const [, forceUpdate] = useReducer((n: number) => n + 1, 0);
    useEffect(() => {
        const listener = () => forceUpdate();
        listeners.add(listener);
        return () => void listeners.delete(listener);
    }, []);
    return items;
}
