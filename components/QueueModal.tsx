/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import ErrorBoundary from "@components/ErrorBoundary";
import { RenderModalProps } from "@vencord/discord-types";
import { Modal, openModal } from "@webpack/common";

import { useQueue } from "../store";
import { QueueList } from "./QueueList";

function QueueModal(modalProps: RenderModalProps) {
    const items = useQueue();
    const pending = items.filter(item => item.status === "pending").length;
    const attention = items.filter(item => item.status === "failed" || item.status === "missed").length;

    const parts = [`${pending} scheduled`];
    if (attention) parts.push(`${attention} need${attention === 1 ? "s" : ""} attention`);

    return (
        <Modal
            {...modalProps}
            size="lg"
            title="Scheduled messages"
            subtitle={parts.join(" · ")}
            actions={[{ text: "Close", variant: "secondary", onClick: modalProps.onClose }]}
        >
            <ErrorBoundary>
                <QueueList onNavigate={modalProps.onClose} />
            </ErrorBoundary>
        </Modal>
    );
}

export function openQueueModal() {
    openModal(modalProps => <QueueModal {...modalProps} />);
}
