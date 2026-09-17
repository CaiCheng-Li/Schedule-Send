/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// No Discord or Vencord imports in this file, so it runs under `tsx --test`.

const SECOND = 1000;
const MINUTE = 60 * SECOND;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

export const MAX_CONTENT_LENGTH = 2000;
export const MIN_LEAD_MS = 10 * SECOND;
export const MAX_HORIZON_MS = 366 * DAY;

export const TIME_EXAMPLES = "10m, 1h30m, 15:45, 9pm, tomorrow 9am, fri 17:00, 2026-12-31 23:59";

const UNIT_MS: Record<string, number> = {
    s: SECOND, sec: SECOND, secs: SECOND, second: SECOND, seconds: SECOND,
    m: MINUTE, min: MINUTE, mins: MINUTE, minute: MINUTE, minutes: MINUTE,
    h: HOUR, hr: HOUR, hrs: HOUR, hour: HOUR, hours: HOUR,
    d: DAY, day: DAY, days: DAY,
    w: 7 * DAY, week: 7 * DAY, weeks: 7 * DAY,
};

const DURATION_PART = /(\d+)\s*([a-z]+)/g;

const WEEKDAYS = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];

export interface Clock {
    hours: number;
    minutes: number;
}

/** "90s", "10m", "1h30m", "in 2 hours and 15 min" -> milliseconds, or null if any part isn't a duration */
export function parseDuration(input: string): number | null {
    const text = input.trim().toLowerCase().replace(/^(?:in\s+|\+\s*)/, "");
    if (!text) return null;

    let total = 0;
    let matched = false;
    for (const [, amount, unit] of text.matchAll(DURATION_PART)) {
        const unitMs = UNIT_MS[unit];
        if (unitMs === undefined) return null;
        total += Number(amount) * unitMs;
        matched = true;
    }

    const leftover = text.replace(DURATION_PART, "").replace(/\band\b|[\s,]/g, "");
    return matched && leftover === "" && total > 0 ? total : null;
}

/** "15:45", "9pm", "9:30 am", "12am" -> 24-hour clock. A bare "15" is rejected as ambiguous. */
export function parseClock(input: string): Clock | null {
    const match = input.trim().toLowerCase().match(/^(\d{1,2})(?::(\d{2}))?\s*(am|pm|a\.m\.|p\.m\.)?$/);
    if (!match) return null;

    const [, hourText, minuteText, meridiem] = match;
    if (minuteText === undefined && meridiem === undefined) return null;

    let hours = Number(hourText);
    const minutes = minuteText === undefined ? 0 : Number(minuteText);
    if (minutes > 59) return null;

    if (meridiem) {
        if (hours < 1 || hours > 12) return null;
        hours = (hours % 12) + (meridiem.startsWith("p") ? 12 : 0);
    } else if (hours > 23) {
        return null;
    }

    return { hours, minutes };
}

function weekdayIndex(word: string) {
    if (word.length < 3) return -1;
    return WEEKDAYS.findIndex(day => day.startsWith(word));
}

function isDayWord(word: string) {
    return word === "today" || word === "tomorrow" || word === "tmrw" || word === "tmr" || weekdayIndex(word) !== -1;
}

function atDayOffset(now: Date, days: number, clock: Clock) {
    // The Date constructor rolls over month/year ends and applies the local DST offset for that day
    return new Date(now.getFullYear(), now.getMonth(), now.getDate() + days, clock.hours, clock.minutes).getTime();
}

/**
 * Turns user input into an epoch-ms send time relative to `now`, or null if it isn't understood.
 *
 * A bare clock time ("9am") means its next occurrence. An explicit day ("today 8am") is taken
 * literally and can be in the past, so always run the result through {@link validateSchedule}.
 */
export function parseWhen(input: string, now: Date): number | null {
    const text = input.trim().toLowerCase().replace(/\s+/g, " ");
    if (!text) return null;

    const duration = parseDuration(text);
    if (duration !== null) return now.getTime() + duration;

    const iso = text.match(/^(\d{4})-(\d{2})-(\d{2})(?: at |t| )(.+)$/);
    if (iso) {
        const [, yearText, monthText, dayText, clockText] = iso;
        const clock = parseClock(clockText);
        if (!clock) return null;

        const year = Number(yearText), month = Number(monthText) - 1, day = Number(dayText);
        const date = new Date(year, month, day, clock.hours, clock.minutes);
        // Date silently turns 2026-02-30 into March 2nd; reject that instead
        if (date.getFullYear() !== year || date.getMonth() !== month || date.getDate() !== day) return null;
        return date.getTime();
    }

    let dayWord: string | null = null;
    let clockText = text;
    const leading = text.match(/^([a-z]+) (?:at )?(.+)$/);
    const trailing = text.match(/^(.+?) (?:on )?([a-z]+)$/);
    if (leading && isDayWord(leading[1])) {
        [, dayWord, clockText] = leading;
    } else if (trailing && isDayWord(trailing[2])) {
        [, clockText, dayWord] = trailing;
    }

    const clock = parseClock(clockText.replace(/^at /, ""));
    if (!clock) return null;

    const today = atDayOffset(now, 0, clock);
    switch (dayWord) {
        case null:
            return today > now.getTime() ? today : atDayOffset(now, 1, clock);
        case "today":
            return today;
        case "tomorrow":
        case "tmrw":
        case "tmr":
            return atDayOffset(now, 1, clock);
        default: {
            let offset = (weekdayIndex(dayWord) - now.getDay() + 7) % 7;
            if (offset === 0 && today <= now.getTime()) offset = 7;
            return atDayOffset(now, offset, clock);
        }
    }
}

export function validateContent(content: string): string | null {
    if (!content.trim()) return "The message is empty.";
    if (content.length > MAX_CONTENT_LENGTH)
        return `The message is ${content.length} characters long. The limit is ${MAX_CONTENT_LENGTH}.`;
    return null;
}

export function validateSendAt(sendAt: number | null, now: number): string | null {
    if (sendAt === null || Number.isNaN(sendAt)) return `Couldn't read that time. Try ${TIME_EXAMPLES}.`;
    if (sendAt < now + MIN_LEAD_MS) return "That time has already passed. Pick one at least 10 seconds from now.";
    if (sendAt > now + MAX_HORIZON_MS) return "That's more than a year away.";
    return null;
}

/** Returns a message for the user, or null if the message can be scheduled */
export function validateSchedule(content: string, sendAt: number | null, now: number): string | null {
    return validateContent(content) ?? validateSendAt(sendAt, now);
}
