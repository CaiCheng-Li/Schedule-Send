/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { MAX_CONTENT_LENGTH, parseClock, parseDuration, parseWhen, validateSchedule } from "./timeParser";

// Local-time constructors keep these tests independent of the machine's timezone.
// 2026-09-17 is a Thursday.
const NOW = new Date(2026, 8, 17, 14, 0, 0, 0);
const at = (month: number, day: number, hours: number, minutes = 0, year = 2026) =>
    new Date(year, month - 1, day, hours, minutes).getTime();

describe("parseDuration", () => {
    test("compact and spelled-out units", () => {
        assert.equal(parseDuration("90s"), 90_000);
        assert.equal(parseDuration("10m"), 600_000);
        assert.equal(parseDuration("1h30m"), 5_400_000);
        assert.equal(parseDuration("2d 4h"), 187_200_000);
        assert.equal(parseDuration("1w"), 604_800_000);
        assert.equal(parseDuration("in 2 hours and 15 mins"), 8_100_000);
        assert.equal(parseDuration("+45 min"), 2_700_000);
        assert.equal(parseDuration("1 Hour, 5 Minutes"), 3_900_000);
    });

    test("rejects anything that isn't purely a duration", () => {
        for (const input of ["", "banana", "10", "1h30", "3pm", "15:45", "5 months", "10m and stuff", "0m", "tomorrow"])
            assert.equal(parseDuration(input), null, input);
    });
});

describe("parseClock", () => {
    test("24-hour and 12-hour forms", () => {
        assert.deepEqual(parseClock("15:45"), { hours: 15, minutes: 45 });
        assert.deepEqual(parseClock("0:05"), { hours: 0, minutes: 5 });
        assert.deepEqual(parseClock("9pm"), { hours: 21, minutes: 0 });
        assert.deepEqual(parseClock("9:30 AM"), { hours: 9, minutes: 30 });
        assert.deepEqual(parseClock("12am"), { hours: 0, minutes: 0 });
        assert.deepEqual(parseClock("12pm"), { hours: 12, minutes: 0 });
        assert.deepEqual(parseClock("7 p.m."), { hours: 19, minutes: 0 });
    });

    test("rejects ambiguous or impossible times", () => {
        for (const input of ["15", "24:00", "13pm", "0am", "9:60", "9:5", "noon"])
            assert.equal(parseClock(input), null, input);
    });
});

describe("parseWhen", () => {
    test("durations are relative to now", () => {
        assert.equal(parseWhen("10m", NOW), NOW.getTime() + 600_000);
        assert.equal(parseWhen("  in 1h30m ", NOW), NOW.getTime() + 5_400_000);
    });

    test("a bare time means its next occurrence", () => {
        assert.equal(parseWhen("15:45", NOW), at(9, 17, 15, 45));
        assert.equal(parseWhen("9am", NOW), at(9, 18, 9));
        assert.equal(parseWhen("14:00", NOW), at(9, 18, 14), "exactly now rolls to tomorrow");
        assert.equal(parseWhen("at 5pm", NOW), at(9, 17, 17));
    });

    test("today and tomorrow, in either order", () => {
        assert.equal(parseWhen("today 8am", NOW), at(9, 17, 8), "explicit today may be in the past");
        assert.equal(parseWhen("tomorrow 9am", NOW), at(9, 18, 9));
        assert.equal(parseWhen("tomorrow at 9:30 pm", NOW), at(9, 18, 21, 30));
        assert.equal(parseWhen("9:30 am tomorrow", NOW), at(9, 18, 9, 30));
        assert.equal(parseWhen("tmrw 7:00", NOW), at(9, 18, 7));
    });

    test("weekdays pick the next occurrence", () => {
        assert.equal(parseWhen("friday 17:00", NOW), at(9, 18, 17));
        assert.equal(parseWhen("mon 9am", NOW), at(9, 21, 9));
        assert.equal(parseWhen("thu 15:00", NOW), at(9, 17, 15), "later today");
        assert.equal(parseWhen("thursday 13:00", NOW), at(9, 24, 13), "earlier today means next week");
        assert.equal(parseWhen("5pm on sat", NOW), at(9, 19, 17));
    });

    test("month and year rollover", () => {
        const endOfYear = new Date(2026, 11, 31, 23, 0);
        assert.equal(parseWhen("tomorrow 9am", endOfYear), at(1, 1, 9, 0, 2027));
        assert.equal(parseWhen("22:00", endOfYear), at(1, 1, 22, 0, 2027));
    });

    test("ISO dates", () => {
        assert.equal(parseWhen("2026-12-31 23:59", NOW), at(12, 31, 23, 59));
        assert.equal(parseWhen("2026-12-31T23:59", NOW), at(12, 31, 23, 59));
        assert.equal(parseWhen("2026-10-01 at 9am", NOW), at(10, 1, 9));
        assert.equal(parseWhen("2026-02-30 10:00", NOW), null, "no such day");
        assert.equal(parseWhen("2026-12-31", NOW), null, "date without time");
    });

    test("nonsense", () => {
        for (const input of ["", "   ", "soon", "tomorrow", "monday", "th 9am", "next week", "15"])
            assert.equal(parseWhen(input, NOW), null, input);
    });
});

describe("validateSchedule", () => {
    const now = NOW.getTime();

    test("accepts a normal message", () => {
        assert.equal(validateSchedule("hello", now + 60_000, now), null);
    });

    test("rejects bad content and times", () => {
        assert.match(validateSchedule("   ", now + 60_000, now)!, /empty/);
        assert.match(validateSchedule("x".repeat(MAX_CONTENT_LENGTH + 1), now + 60_000, now)!, /limit/);
        assert.match(validateSchedule("hi", null, now)!, /Couldn't read/);
        assert.match(validateSchedule("hi", now + 5_000, now)!, /already passed/);
        assert.match(validateSchedule("hi", now - 60_000, now)!, /already passed/);
        assert.match(validateSchedule("hi", now + 400 * 86_400_000, now)!, /year/);
    });
});
