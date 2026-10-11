"use client";
import { useState } from "react";
import { MessageSquare, Loader2 } from "lucide-react";
import type { Role } from "@/lib/model";
import type { Navigate } from "./landing";
import { chatRequest } from "@/lib/chat-client";
import { FeedbackDialog } from "./feedback-dialog";
export function ChatLaunch({
  role,
  invitationId,
  applicationId,
  nav,
}: {
  role: Role;
  invitationId?: string;
  applicationId?: string;
  nav?: Navigate;
}) {
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  return (
    <>
      <button
        type="button"
        className="btn secondary chat-launch"
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          try {
            const { id } = await chatRequest<{ id: string }>(role, "", {
              invitationId,
              applicationId,
            });
            const url = `/demo/${role}/messages?conversation=${id}`;
            if (nav) nav(url);
            else window.location.assign(url);
          } catch (e) {
            setError((e as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        {busy ? (
          <Loader2 size={17} className="spin" />
        ) : (
          <MessageSquare size={17} />
        )}
        Открыть чат
      </button>
      <FeedbackDialog
        message={error}
        open={!!error}
        onOpenChange={(open) => {
          if (!open) setError("");
        }}
      />
    </>
  );
}
