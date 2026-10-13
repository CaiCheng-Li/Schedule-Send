/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { Button } from "@components/Button";
import ErrorBoundary from "@components/ErrorBoundary";
import { HeadingSecondary } from "@components/Heading";
import { Paragraph } from "@components/Paragraph";
import { getTheme, Theme } from "@utils/discord";
import { RenderModalProps } from "@vencord/discord-types";
import { ChannelStore, Modal, openModal, showToast, TextArea, TextInput, useState } from "@webpack/common";

import { rescheduleMessage, scheduleMessage } from "../scheduler";
import { settings } from "../settings";
import { MAX_CONTENT_LENGTH, parseWhen, TIME_EXAMPLES, validateContent, validateSendAt } from "../timeParser";
import type { ScheduledMessage } from "../types";
import { canSendIn, cl, clearChatInput, describeChannel, formatTime, logger, renderTime, toDateTimeInput, toWhenText } from "../utils";

export interface ScheduleModalOptions {
    channelId: string;
    /** Text from the message box, moved into the schedule */
    initialContent?: string;
    editing?: ScheduledMessage;
    /** Opened from the open channel's main message box, so that box may be cleared afterwards */
    fromMainChat?: boolean;
}

const QUICK_PICKS = [
    { label: "In 30 min", when: "30m" },
    { label: "In 1 hour", when: "1h" },
    { label: "In 3 hours", when: "3h" },
    { label: "Tomorrow 9:00", when: "tomorrow 9:00" },
];

function ScheduleModal({ channelId, initialContent = "", editing, fromMainChat = false, ...modalProps }: RenderModalProps & ScheduleModalOptions) {
    const [content, setContent] = useState(editing?.content ?? initialContent);
    const [whenText, setWhenText] = useState(() =>
        editing && editing.sendAt > Date.now() ? toWhenText(editing.sendAt) : ""
    );
    const [submitError, setSubmitError] = useState<string | null>(null);
    const [busy, setBusy] = useState(false);

    const now = Date.now();
    const hasWhen = whenText.trim() !== "";
    const sendAt = hasWhen ? parseWhen(whenText, new Date(now)) : null;
    const timeError = hasWhen ? validateSendAt(sendAt, now) : null;
    const contentError = validateContent(content);

    const channel = ChannelStore.getChannel(channelId);
    const channelError = !channel
        ? "This channel no longer exists."
        : !canSendIn(channel) ? "You don't have permission to send messages in this channel." : null;

    const canSubmit = !busy && hasWhen && !timeError && !contentError && !channelError;

    async function submit() {
        // Re-parse so "30m" counts from the click, not from when it was typed
        const at = parseWhen(whenText, new Date());
        setBusy(true);
        setSubmitError(null);
        try {
            if (editing) {
                await rescheduleMessage(editing.id, content, at);
            } else {
                await scheduleMessage(channelId, content, at);
            }
        } catch (error) {
            setSubmitError(error instanceof Error ? error.message : String(error));
            setBusy(false);
            return;
        }

        // The queue is saved. A confirmation failure must not offer to schedule it a second time.
        if (!editing && initialContent && settings.store.clearChatBoxAfterScheduling) clearChatInput(channelId, fromMainChat);
        modalProps.onClose();
        try {
            showToast(`Scheduled for ${formatTime(at!)}`, "success");
        } catch (error) {
            logger.warn("Message saved, but couldn't show the scheduling confirmation", error);
        }
    }

    const notice = channelError ?? submitError;

    return (
        <Modal
            {...modalProps}
            size="md"
            title={editing ? "Edit scheduled message" : "Schedule message"}
            subtitle={describeChannel(channelId)}
            notice={notice ? { message: notice, type: "critical" } : undefined}
            actions={[
                { text: "Cancel", variant: "secondary", onClick: modalProps.onClose },
                { text: editing ? "Save" : "Schedule", variant: "primary", onClick: submit, disabled: !canSubmit, loading: busy },
            ]}
        >
            <div className={cl("form")}>
                <section>
                    <HeadingSecondary>Message</HeadingSecondary>
                    <TextArea
                        value={content}
                        onChange={setContent}
                        placeholder="What should be sent?"
                        rows={4}
                        autoFocus={!initialContent && !editing}
                    />
                    <Paragraph size="xs" className={cl("counter", { "counter-over": content.length > MAX_CONTENT_LENGTH })}>
                        {content.length}/{MAX_CONTENT_LENGTH}
                    </Paragraph>
                </section>

                <section>
                    <HeadingSecondary>Send</HeadingSecondary>
                    <TextInput
                        value={whenText}
                        onChange={setWhenText}
                        placeholder="e.g. 1h30m, 15:45, tomorrow 9am"
                        error={timeError ?? undefined}
                        autoFocus={!!initialContent || !!editing}
                        onKeyDown={e => {
                            if (e.key === "Enter" && canSubmit) void submit();
                        }}
                    />
                    <div className={cl("quick-picks")}>
                        {QUICK_PICKS.map(pick => (
                            <Button key={pick.when} size="small" variant="secondary" onClick={() => setWhenText(pick.when)}>
                                {pick.label}
                            </Button>
                        ))}
                        <input
                            className={cl("picker")}
                            type="datetime-local"
                            aria-label="Pick a date and time"
                            value={sendAt !== null ? toDateTimeInput(sendAt) : ""}
                            onChange={e => {
                                const { value } = e.currentTarget;
                                if (value) setWhenText(value.replace("T", " "));
                            }}
                            style={{ colorScheme: getTheme() === Theme.Light ? "light" : "dark" }}
                        />
                    </div>
                    <Paragraph size="sm" className={cl("preview")}>
                        {sendAt !== null && !timeError
                            ? <>Sends {renderTime(sendAt)}</>
                            : `Examples: ${TIME_EXAMPLES}`}
                    </Paragraph>
                </section>
            </div>
        </Modal>
    );
}

export function openScheduleModal(options: ScheduleModalOptions) {
    openModal(modalProps => (
        <ErrorBoundary>
            <ScheduleModal {...modalProps} {...options} />
        </ErrorBoundary>
    ));
}
