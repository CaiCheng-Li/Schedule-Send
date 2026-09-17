/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { describeSendError, findByShortId, INTERRUPTED_ERROR, isValidItem, nextWakeDelay, partitionDue, previewText, recoverInterrupted } from "./queueLogic";
import type { ScheduledMessage } from "./types";

const ME = "111";
const OTHER = "222";
const NOW = 1_800_000_000_000;

let counter = 0;
function item(overrides: Partial<ScheduledMessage> = {}): ScheduledMessage {
    counter++;
    return {
        id: `id-${counter}`,
        channelId: "c1",
        authorId: ME,
        content: `message ${counter}`,
        sendAt: NOW,
        createdAt: NOW - 3_600_000,
        status: "pending",
        ...overrides,
    };
}

describe("nextWakeDelay", () => {
    test("nothing pending means no timer", () => {
        assert.equal(nextWakeDelay([], NOW, 30_000), null);
        assert.equal(nextWakeDelay([item({ status: "failed" }), item({ status: "missed" })], NOW, 30_000), null);
    });

    test("waits for the earliest pending item, capped", () => {
        const items = [item({ sendAt: NOW + 20_000 }), item({ sendAt: NOW + 5_000 })];
        assert.equal(nextWakeDelay(items, NOW, 30_000), 5_000);
        assert.equal(nextWakeDelay([item({ sendAt: NOW + 40 * 86_400_000 })], NOW, 30_000), 30_000, "no setTimeout overflow");
    });

    test("already-due items wait the full interval instead of spinning", () => {
        assert.equal(nextWakeDelay([item({ sendAt: NOW - 5_000 })], NOW, 30_000), 30_000);
        assert.equal(nextWakeDelay([item({ sendAt: NOW })], NOW, 30_000), 30_000);
    });

    test("ignores other accounts' items once the user is known", () => {
        const items = [item({ authorId: OTHER, sendAt: NOW + 1_000 }), item({ sendAt: NOW + 9_000 })];
        assert.equal(nextWakeDelay(items, NOW, 30_000, ME), 9_000);
        assert.equal(nextWakeDelay(items, NOW, 30_000, null), 1_000);
    });
});

describe("partitionDue", () => {
    test("splits due items by lateness and sorts them", () => {
        const late = item({ sendAt: NOW - 10 * 60_000 });
        const onTimeB = item({ sendAt: NOW - 1_000 });
        const onTimeA = item({ sendAt: NOW - 2 * 60_000 });
        const result = partitionDue([onTimeB, late, onTimeA], NOW, ME, 5 * 60_000);
        assert.deepEqual(result.onTime.map(i => i.id), [onTimeA.id, onTimeB.id]);
        assert.deepEqual(result.late.map(i => i.id), [late.id]);
    });

    test("skips future, non-pending, and other accounts' items", () => {
        const items = [
            item({ sendAt: NOW + 1 }),
            item({ status: "sending" }),
            item({ status: "failed" }),
            item({ status: "missed" }),
            item({ authorId: OTHER }),
        ];
        const result = partitionDue(items, NOW, ME, 60_000);
        assert.equal(result.onTime.length + result.late.length, 0);
    });

    test("grace of zero makes anything overdue late", () => {
        const result = partitionDue([item({ sendAt: NOW }), item({ sendAt: NOW - 1 })], NOW, ME, 0);
        assert.equal(result.onTime.length, 1);
        assert.equal(result.late.length, 1);
    });
});

describe("recoverInterrupted", () => {
    test("marks leftover sends failed, leaves in-flight ones and others alone", () => {
        const stuck = item({ status: "sending" });
        const inFlight = item({ status: "sending" });
        const pending = item();
        const result = recoverInterrupted([stuck, inFlight, pending], new Set([inFlight.id]));
        assert.equal(result[0].status, "failed");
        assert.equal(result[0].error, INTERRUPTED_ERROR);
        assert.equal(result[1], inFlight);
        assert.equal(result[2], pending);
    });
});

describe("findByShortId", () => {
    const items = [item({ id: "abc123-x" }), item({ id: "abd999-y" })];

    test("unique prefix, ambiguous prefix, no match", () => {
        assert.equal(findByShortId(items, "abc1"), items[0]);
        assert.equal(findByShortId(items, " ABD "), items[1]);
        assert.equal(findByShortId(items, "ab"), "ambiguous");
        assert.equal(findByShortId(items, "zzz"), null);
        assert.equal(findByShortId(items, ""), null);
    });
});

describe("isValidItem", () => {
    test("accepts stored items and rejects junk", () => {
        assert.equal(isValidItem(item()), true);
        assert.equal(isValidItem({ ...item(), status: "done" }), false);
        assert.equal(isValidItem({ ...item(), sendAt: "soon" }), false);
        assert.equal(isValidItem(null), false);
        assert.equal(isValidItem("item"), false);
    });
});

describe("describeSendError", () => {
    test("Discord HTTP failures", () => {
        assert.equal(
            describeSendError({ ok: false, status: 403, body: { code: 50013, message: "Missing Permissions" } }),
            "Missing Permissions (HTTP 403)"
        );
        assert.equal(describeSendError({ ok: false, status: 502 }), "Discord returned HTTP 502.");
        assert.equal(describeSendError({ ok: false, hasErr: true, err: { code: "ABORTED" } }), "Discord cancelled the request.");
        assert.equal(describeSendError({ ok: false, hasErr: true, err: { message: "Network request failed" } }), "Network request failed");
    });

    test("ordinary errors and junk", () => {
        assert.equal(describeSendError(new Error("boom")), "boom");
        assert.equal(describeSendError("plain"), "plain");
        assert.equal(describeSendError(undefined), "Unknown error.");
        assert.equal(describeSendError({}), "Unknown error.");
    });
});

describe("previewText", () => {
    test("flattens whitespace and truncates", () => {
        assert.equal(previewText("a\n\n b   c"), "a b c");
        assert.equal(previewText("x".repeat(100), 10), "xxxxxxxxx…");
    });
});
