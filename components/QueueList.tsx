/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { Button } from "@components/Button";
import { Paragraph } from "@components/Paragraph";
import { Clickable, showToast, useState } from "@webpack/common";

import { cancelMessage, sendNow } from "../scheduler";
import { useQueue } from "../store";
import type { ItemStatus, ScheduledMessage } from "../types";
import { cl, currentUserId, describeChannel, jumpToChannel, renderTime } from "../utils";
import { openScheduleModal } from "./ScheduleModal";

const STATUS_LABELS: Record<ItemStatus, string> = {
    pending: "Scheduled",
    sending: "Sending…",
    failed: "Not sent",
    missed: "Missed",
};

const needsAttention = (item: ScheduledMessage) => item.status === "failed" || item.status === "missed";

function QueueRow({ item, ownedByOther, onNavigate }: { item: ScheduledMessage; ownedByOther: boolean; onNavigate?(): void; }) {
    const [busy, setBusy] = useState(false);
    const attention = needsAttention(item);
    const sending = item.status === "sending";

    async function run(action: () => Promise<unknown>) {
        setBusy(true);
        try {
            await action();
        } catch (error) {
            showToast({ text: error instanceof Error ? error.message : String(error), variant: "critical" });
        } finally {
            setBusy(false);
        }
    }

    return (
        <div className={cl("row", { "row-attention": attention })}>
            <div className={cl("row-header")}>
                <span className={cl("status", `status-${item.status}`)}>{STATUS_LABELS[item.status]}</span>
                <Clickable
                    tag="span"
                    className={cl("channel")}
                    onClick={() => {
                        jumpToChannel(item.channelId);
                        onNavigate?.();
                    }}
                >
                    {describeChannel(item.channelId)}
                </Clickable>
                <span className={cl("time")}>{renderTime(item.sendAt)}</span>
            </div>

            <Paragraph size="sm" className={cl("content")}>{item.content}</Paragraph>
            {item.error && <Paragraph size="xs" className={cl("error")}>{item.error}</Paragraph>}
            {ownedByOther && (
                <Paragraph size="xs" className={cl("note")}>
                    Scheduled from another account. Only that account can send it.
                </Paragraph>
            )}

            {!sending && (
                <div className={cl("actions")}>
                    {!ownedByOther && (
                        <>
                            <Button size="small" variant={attention ? "primary" : "secondary"} disabled={busy} onClick={() => run(() => sendNow(item.id))}>
                                Send now
                            </Button>
                            <Button size="small" variant="secondary" disabled={busy} onClick={() => openScheduleModal({ channelId: item.channelId, editing: item })}>
                                {attention ? "Reschedule" : "Edit"}
                            </Button>
                        </>
                    )}
                    <Button size="small" variant="dangerSecondary" disabled={busy} onClick={() => run(() => cancelMessage(item.id))}>
                        {attention ? "Discard" : "Cancel"}
                    </Button>
                </div>
            )}
        </div>
    );
}

export function QueueList({ onNavigate }: { onNavigate?(): void; }) {
    const items = useQueue();
    const me = currentUserId();

    if (!items.length) {
        return (
            <Paragraph className={cl("empty")}>
                Nothing scheduled. Use the clock button next to the message box, or the /schedule command.
            </Paragraph>
        );
    }

    // Anything needing a decision first, then by send time
    const sorted = [...items].sort((a, b) => Number(needsAttention(b)) - Number(needsAttention(a)) || a.sendAt - b.sendAt);

    return (
        <div className={cl("list")}>
            {sorted.map(item => (
                <QueueRow key={item.id} item={item} ownedByOther={item.authorId !== me} onNavigate={onNavigate} />
            ))}
        </div>
    );
}
