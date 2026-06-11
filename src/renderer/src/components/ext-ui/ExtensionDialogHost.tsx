import React, { useCallback, useEffect, useRef, useState } from "react";
import { useSessionsStore } from "../../stores/sessions-store.js";
import type { SessionId } from "@shared/ids.js";
import type { DialogUiRequest } from "@shared/pi-protocol/extension-ui.js";
import "./ExtensionDialogHost.css";

interface ExtensionDialogHostProps {
  sessionId: SessionId;
}

interface DialogProps {
  request: DialogUiRequest;
  onRespond: (requestId: string, response: Record<string, unknown>) => void;
}

function SelectDialog({ request, onRespond }: DialogProps): React.ReactElement {
  const req = request as { id: string; method: "select"; title: string; options: string[]; timeout?: number };
  return (
    <div className="ext-dialog">
      <div className="ext-dialog__title">{req.title}</div>
      <div className="ext-dialog__options">
        {req.options.map((opt) => (
          <button
            key={opt}
            className="ext-dialog__option"
            onClick={() => onRespond(req.id, { value: opt })}
          >
            {opt}
          </button>
        ))}
      </div>
      <button className="ext-dialog__cancel" onClick={() => onRespond(req.id, { cancelled: true })}>
        Cancel
      </button>
    </div>
  );
}

function ConfirmDialog({ request, onRespond }: DialogProps): React.ReactElement {
  const req = request as { id: string; method: "confirm"; title: string; message?: string };
  return (
    <div className="ext-dialog">
      <div className="ext-dialog__title">{req.title}</div>
      {req.message && <div className="ext-dialog__message">{req.message}</div>}
      <div className="ext-dialog__actions">
        <button className="ext-dialog__btn ext-dialog__btn--confirm" onClick={() => onRespond(req.id, { confirmed: true })}>
          Confirm
        </button>
        <button className="ext-dialog__btn ext-dialog__btn--cancel" onClick={() => onRespond(req.id, { confirmed: false })}>
          Cancel
        </button>
      </div>
    </div>
  );
}

function InputDialog({ request, onRespond }: DialogProps): React.ReactElement {
  const req = request as { id: string; method: "input"; title: string; placeholder?: string };
  const [value, setValue] = useState("");
  return (
    <div className="ext-dialog">
      <div className="ext-dialog__title">{req.title}</div>
      <input
        className="ext-dialog__input"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder={req.placeholder ?? ""}
        onKeyDown={(e) => {
          if (e.key === "Enter") onRespond(req.id, { value });
          if (e.key === "Escape") onRespond(req.id, { cancelled: true });
        }}
        autoFocus
      />
      <div className="ext-dialog__actions">
        <button className="ext-dialog__btn ext-dialog__btn--confirm" onClick={() => onRespond(req.id, { value })}>
          OK
        </button>
        <button className="ext-dialog__btn ext-dialog__btn--cancel" onClick={() => onRespond(req.id, { cancelled: true })}>
          Cancel
        </button>
      </div>
    </div>
  );
}

function EditorDialog({ request, onRespond }: DialogProps): React.ReactElement {
  const req = request as { id: string; method: "editor"; title: string; prefill?: string };
  const [value, setValue] = useState(req.prefill ?? "");
  return (
    <div className="ext-dialog ext-dialog--editor">
      <div className="ext-dialog__title">{req.title}</div>
      <textarea
        className="ext-dialog__editor"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        autoFocus
      />
      <div className="ext-dialog__actions">
        <button className="ext-dialog__btn ext-dialog__btn--confirm" onClick={() => onRespond(req.id, { value })}>
          OK
        </button>
        <button className="ext-dialog__btn ext-dialog__btn--cancel" onClick={() => onRespond(req.id, { cancelled: true })}>
          Cancel
        </button>
      </div>
    </div>
  );
}

export function ExtensionDialogHost({ sessionId }: ExtensionDialogHostProps): React.ReactElement | null {
  const sessions = useSessionsStore((s) => s.sessions);
  const dismissUiRequest = useSessionsStore((s) => s.dismissUiRequest);
  const session = sessions.get(sessionId);
  const current = session?.pendingDialogs[0] as DialogUiRequest | undefined;
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleRespond = useCallback(
    async (requestId: string, response: Record<string, unknown>) => {
      dismissUiRequest(sessionId, requestId);
      if (timerRef.current) clearTimeout(timerRef.current);

      const payload = {
        type: "extension_ui_response" as const,
        id: requestId,
        ...response,
      };

      await window.pivis.invoke("session.respondToUiRequest", {
        sessionId,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        response: payload as any,
      });
    },
    [sessionId, dismissUiRequest],
  );

  // Auto-cancel on timeout
  useEffect(() => {
    if (!current) return;
    const timeout = (current as { timeout?: number }).timeout;
    if (!timeout) return;

    timerRef.current = setTimeout(() => {
      void handleRespond(current.id, { cancelled: true });
    }, timeout * 1000);

    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [current, handleRespond]);

  if (!current) return null;

  return (
    <div className="ext-dialog-overlay">
      {current.method === "select" && <SelectDialog request={current} onRespond={handleRespond} />}
      {current.method === "confirm" && <ConfirmDialog request={current} onRespond={handleRespond} />}
      {current.method === "input" && <InputDialog request={current} onRespond={handleRespond} />}
      {current.method === "editor" && <EditorDialog request={current} onRespond={handleRespond} />}
    </div>
  );
}

export function ToastHost({ sessionId }: { sessionId: SessionId }): React.ReactElement | null {
  const sessions = useSessionsStore((s) => s.sessions);
  const dismissToast = useSessionsStore((s) => s.dismissToast);
  const session = sessions.get(sessionId);
  const toasts = session?.toasts ?? [];

  useEffect(() => {
    if (toasts.length === 0) return;
    const timer = setTimeout(() => {
      const oldest = toasts[0];
      if (oldest) dismissToast(sessionId, oldest.id);
    }, 4000);
    return () => clearTimeout(timer);
  }, [toasts, sessionId, dismissToast]);

  if (toasts.length === 0) return null;

  return (
    <div className="toast-host">
      {toasts.map((toast) => (
        <div
          key={toast.id}
          className={`toast toast--${toast.type ?? "info"}`}
          onClick={() => dismissToast(sessionId, toast.id)}
        >
          {toast.message}
        </div>
      ))}
    </div>
  );
}
