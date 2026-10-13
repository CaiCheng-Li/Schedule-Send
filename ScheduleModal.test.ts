/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, test } from "node:test";
import { runInNewContext } from "node:vm";

import { transformSync } from "esbuild";

import * as timeParser from "./timeParser";
import type { ScheduledMessage } from "./types";

const { code } = transformSync(readFileSync(new URL("./components/ScheduleModal.tsx", import.meta.url), "utf8"), {
    loader: "tsx",
    format: "cjs",
    jsxFactory: "createElement",
    jsxFragment: "Fragment",
});

interface HarnessOptions {
    editing?: ScheduledMessage;
    saveError?: Error;
    toastError?: Error;
    formatError?: Error;
}

function createModal(options: HarnessOptions = {}) {
    // Run the real modal and its submit handler without mounting Discord or sending messages.
    const state: any[] = [];
    const saved: { id?: string; content: string; sendAt: number; }[] = [];
    const toastCalls: { message: string; type: string; }[] = [];
    const events: string[] = [];
    const warnings: unknown[][] = [];
    let closed = false;
    let draftCleared = false;
    let modal: any;
    const createElement = (type: any, props: any, ...children: any[]) => ({ type, props: { ...props, children } });

    const save = async (content: string, sendAt: number, id?: string) => {
        if (options.saveError) throw options.saveError;
        saved.push({ id, content, sendAt });
        events.push("saved");
    };

    const modules: Record<string, any> = {
        "@components/Button": { Button: "Button" },
        "@components/ErrorBoundary": { default: "ErrorBoundary", __esModule: true },
        "@components/Heading": { HeadingSecondary: "HeadingSecondary" },
        "@components/Paragraph": { Paragraph: "Paragraph" },
        "@utils/discord": { getTheme: () => "dark", Theme: { Light: "light" } },
        "@webpack/common": {
            ChannelStore: { getChannel: () => ({ id: "channel" }) },
            Modal: "Modal",
            TextArea: "TextArea",
            TextInput: "TextInput",
            // Current Vencord exposes show/pop; there is no Toasts.Type enum.
            Toasts: { show() { }, pop() { } },
            useState(initial: any) {
                const index = state.length;
                state.push(index === 1 ? "30m" : typeof initial === "function" ? initial() : initial);
                return [state[index], (value: any) => { state[index] = value; }];
            },
            openModal(render: (props: any) => any) {
                const boundary = render({ onClose() { closed = true; events.push("closed"); } });
                const component = boundary.props.children[0];
                modal = component.type(component.props);
            },
            showToast(message: string, type: string) {
                toastCalls.push({ message, type });
                events.push("toast");
                if (options.toastError) throw options.toastError;
            },
        },
        "../scheduler": {
            scheduleMessage: (_channelId: string, content: string, sendAt: number) => save(content, sendAt),
            rescheduleMessage: (id: string, content: string, sendAt: number) => save(content, sendAt, id),
        },
        "../settings": { settings: { store: { clearChatBoxAfterScheduling: true } } },
        "../timeParser": timeParser,
        "../utils": {
            canSendIn: () => true,
            cl: (name: string) => name,
            clearChatInput() { draftCleared = true; },
            describeChannel: () => "Direct message",
            formatTime(sendAt: number) {
                if (options.formatError) throw options.formatError;
                return String(sendAt);
            },
            renderTime: String,
            toDateTimeInput: () => "",
            toWhenText: () => "30m",
            logger: { warn: (...args: unknown[]) => warnings.push(args) },
        },
    };
    const module = { exports: {} as { openScheduleModal(options: any): void; } };
    runInNewContext(code, {
        module,
        exports: module.exports,
        createElement,
        Fragment: "Fragment",
        Date,
        Error,
        require(id: string) {
            assert.ok(Object.hasOwn(modules, id), `Unexpected import: ${id}`);
            return modules[id];
        },
    });
    module.exports.openScheduleModal({ channelId: "channel", initialContent: "test", fromMainChat: true, editing: options.editing });
    const action = modal.props.actions.find((item: { text: string; }) => item.text === (options.editing ? "Save" : "Schedule"));
    assert.equal(action.disabled, false);

    return {
        submit: action.onClick as () => Promise<void>,
        saved,
        toastCalls,
        events,
        warnings,
        get closed() { return closed; },
        get draftCleared() { return draftCleared; },
        get error() { return state[2]; },
        get busy() { return state[3]; },
    };
}

describe("ScheduleModal submission", () => {
    test("saves and closes when Toasts.Type is absent", async () => {
        const modal = createModal();
        await modal.submit();
        assert.equal(modal.saved.length, 1);
        assert.equal(modal.error, null);
        assert.equal(modal.closed, true);
        assert.equal(modal.draftCleared, true);
        assert.equal(modal.toastCalls[0].type, "success");
    });

    test("a broken toast cannot turn a saved message into a retryable failure", async () => {
        const modal = createModal({ toastError: new TypeError("Toast API unavailable") });
        await modal.submit();
        assert.equal(modal.saved.length, 1);
        assert.equal(modal.closed, true);
        assert.equal(modal.error, null);
        assert.equal(modal.busy, true);
        assert.deepEqual(modal.events, ["saved", "closed", "toast"]);
        assert.equal(modal.warnings.length, 1);
    });

    test("a broken time formatter cannot leave a saved message open for retry", async () => {
        const modal = createModal({ formatError: new Error("Formatter unavailable") });
        await modal.submit();
        assert.equal(modal.saved.length, 1);
        assert.equal(modal.closed, true);
        assert.equal(modal.error, null);
        assert.equal(modal.warnings.length, 1);
    });

    test("an edit stays saved and closes even if its toast fails", async () => {
        const editing: ScheduledMessage = {
            id: "existing", channelId: "channel", authorId: "user", content: "test",
            sendAt: Date.now() + 60_000, createdAt: Date.now(), status: "pending",
        };
        const modal = createModal({ editing, toastError: new Error("Toast API unavailable") });
        await modal.submit();
        assert.equal(modal.saved.length, 1);
        assert.equal(modal.saved[0].id, "existing");
        assert.equal(modal.closed, true);
        assert.equal(modal.error, null);
        assert.equal(modal.draftCleared, false);
    });

    test("a save failure leaves the draft and dialog intact and allows a retry", async () => {
        const options: HarnessOptions = { saveError: new Error("Couldn't save scheduled message") };
        const modal = createModal(options);
        await modal.submit();
        assert.equal(modal.saved.length, 0);
        assert.equal(modal.closed, false);
        assert.equal(modal.draftCleared, false);
        assert.equal(modal.error, options.saveError!.message);
        assert.equal(modal.busy, false);
        assert.equal(modal.toastCalls.length, 0);

        options.saveError = undefined;
        await modal.submit();
        assert.equal(modal.saved.length, 1);
        assert.equal(modal.closed, true);
        assert.equal(modal.error, null);
        assert.equal(modal.draftCleared, true);
    });
});
