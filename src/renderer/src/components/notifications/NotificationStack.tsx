import type { SessionId } from "@shared/ids.js";
import type React from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useEscapeClaim } from "../../hooks/useEscapeClaim.js";
import { useSessionsStore } from "../../stores/sessions-store.js";
import { ScrollFadeFrame } from "../common/ScrollFadeFrame.js";
import { IconBell, IconClose } from "../common/icons.js";
import "./NotificationStack.css";

interface NotificationStackProps {
  sessionId: SessionId;
}

const PREVIEW_VISIBLE_MS = 6_500;
const PREVIEW_AFTER_HOVER_MS = 2_000;
const PREVIEW_EXIT_MS = 180;

type PreviewPhase = "hidden" | "visible" | "exiting";
type NotificationType = "info" | "success" | "warning" | "error";

function notificationType(type: string | undefined): NotificationType {
  switch (type) {
    case "success":
    case "warning":
    case "error":
      return type;
    default:
      return "info";
  }
}

function notificationTypeLabel(type: NotificationType): string {
  switch (type) {
    case "success":
      return "Success";
    case "warning":
      return "Warning";
    case "error":
      return "Error";
    case "info":
      return "Info";
  }
}

export function NotificationBellButton({
  sessionId,
}: NotificationStackProps): React.ReactElement | null {
  const count = useSessionsStore((s) => s.sessions.get(sessionId)?.toasts.length ?? 0);
  const panelOpen = useSessionsStore((s) => !!s.sessions.get(sessionId)?.notificationPanelOpen);
  const setNotificationPanelOpen = useSessionsStore((s) => s.setNotificationPanelOpen);

  if (count === 0) return null;

  const label = panelOpen ? "Hide notifications" : "Show notifications";

  return (
    <button
      type="button"
      className={`notification-bell session-header__picker-btn${panelOpen ? " notification-bell--open" : ""}`}
      onClick={() => setNotificationPanelOpen(sessionId, !panelOpen)}
      aria-label={label}
      aria-expanded={panelOpen}
      title={label}
    >
      <IconBell size="0.95em" />
      <span className="notification-bell__count">{count}</span>
    </button>
  );
}

export function NotificationStack({
  sessionId,
}: NotificationStackProps): React.ReactElement | null {
  const session = useSessionsStore((s) => s.sessions.get(sessionId));
  const dismissToast = useSessionsStore((s) => s.dismissToast);
  const clearToasts = useSessionsStore((s) => s.clearToasts);
  const setNotificationPanelOpen = useSessionsStore((s) => s.setNotificationPanelOpen);
  const [previewPhase, setPreviewPhase] = useState<PreviewPhase>("hidden");
  const lastSeenToastIdRef = useRef<string | undefined>(undefined);
  const lastSessionIdRef = useRef<SessionId | undefined>(undefined);
  const previewTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const exitTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const previewHoveredRef = useRef(false);
  const stackRef = useRef<HTMLElement | null>(null);
  const toasts = session?.toasts ?? [];
  const panelOpen = !!session?.notificationPanelOpen;
  const latestId = toasts[toasts.length - 1]?.id;

  const notifications = useMemo(() => [...toasts].reverse(), [toasts]);
  const previewNotification = notifications[0];
  const previewStackDepth = Math.min(notifications.length, 3);

  useEscapeClaim(panelOpen);

  useEffect(() => {
    if (!panelOpen) return;
    const onKeyDown = (e: KeyboardEvent): void => {
      if (e.key !== "Escape") return;
      if (e.metaKey || e.ctrlKey || e.altKey || e.shiftKey) return;
      if (e.isComposing || e.keyCode === 229) return;
      e.preventDefault();
      e.stopImmediatePropagation();
      setNotificationPanelOpen(sessionId, false);
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [panelOpen, sessionId, setNotificationPanelOpen]);

  useEffect(() => {
    if (!panelOpen) return;
    const onMouseDown = (e: MouseEvent): void => {
      if (stackRef.current?.contains(e.target as Node)) return;
      setNotificationPanelOpen(sessionId, false);
    };
    document.addEventListener("mousedown", onMouseDown, true);
    return () => document.removeEventListener("mousedown", onMouseDown, true);
  }, [panelOpen, sessionId, setNotificationPanelOpen]);

  const clearPreviewTimers = useCallback((): void => {
    if (previewTimerRef.current) {
      clearTimeout(previewTimerRef.current);
      previewTimerRef.current = null;
    }
    if (exitTimerRef.current) {
      clearTimeout(exitTimerRef.current);
      exitTimerRef.current = null;
    }
  }, []);

  const hidePreview = useCallback((): void => {
    clearPreviewTimers();
    setPreviewPhase("exiting");
    exitTimerRef.current = setTimeout(() => {
      exitTimerRef.current = null;
      setPreviewPhase("hidden");
    }, PREVIEW_EXIT_MS);
  }, [clearPreviewTimers]);

  const schedulePreviewHide = useCallback(
    (delay: number): void => {
      if (previewTimerRef.current) {
        clearTimeout(previewTimerRef.current);
        previewTimerRef.current = null;
      }
      if (previewHoveredRef.current) return;
      previewTimerRef.current = setTimeout(() => {
        previewTimerRef.current = null;
        if (!previewHoveredRef.current) hidePreview();
      }, delay);
    },
    [hidePreview],
  );

  const handlePreviewMouseEnter = useCallback((): void => {
    previewHoveredRef.current = true;
    if (previewTimerRef.current) {
      clearTimeout(previewTimerRef.current);
      previewTimerRef.current = null;
    }
  }, []);

  const handlePreviewMouseLeave = useCallback((): void => {
    previewHoveredRef.current = false;
    if (!panelOpen && previewPhase === "visible") {
      schedulePreviewHide(PREVIEW_AFTER_HOVER_MS);
    }
  }, [panelOpen, previewPhase, schedulePreviewHide]);

  useEffect(() => {
    if (lastSessionIdRef.current !== sessionId) {
      clearPreviewTimers();
      lastSessionIdRef.current = sessionId;
      lastSeenToastIdRef.current = latestId;
      setPreviewPhase("hidden");
      return;
    }

    if (toasts.length === 0) {
      clearPreviewTimers();
      lastSeenToastIdRef.current = undefined;
      setPreviewPhase("hidden");
      return;
    }

    if (panelOpen) {
      clearPreviewTimers();
      lastSeenToastIdRef.current = latestId;
      setPreviewPhase("hidden");
      return;
    }

    if (latestId && latestId !== lastSeenToastIdRef.current) {
      clearPreviewTimers();
      lastSeenToastIdRef.current = latestId;
      setPreviewPhase("visible");
      schedulePreviewHide(PREVIEW_VISIBLE_MS);
    }
  }, [clearPreviewTimers, latestId, panelOpen, schedulePreviewHide, sessionId, toasts.length]);

  useEffect(() => () => clearPreviewTimers(), [clearPreviewTimers]);

  if (notifications.length === 0 || (!panelOpen && previewPhase === "hidden")) return null;

  return (
    <aside
      ref={stackRef}
      className={`notification-stack${panelOpen ? " notification-stack--expanded" : ""}${previewPhase === "exiting" ? " notification-stack--exiting" : ""}`}
      aria-label="Notifications"
      onMouseEnter={panelOpen ? undefined : handlePreviewMouseEnter}
      onMouseLeave={panelOpen ? undefined : handlePreviewMouseLeave}
    >
      <div className="notification-stack__inner">
        {panelOpen ? (
          <>
            <div className="notification-stack__header">
              <button
                type="button"
                className="notification-stack__clear"
                onClick={() => clearToasts(sessionId)}
              >
                Clear all
              </button>
            </div>
            <ScrollFadeFrame
              frameClassName="notification-stack__list-wrap"
              className="notification-stack__list"
              fill
            >
              {notifications.map((toast) => {
                const type = notificationType(toast.type);
                return (
                  <article
                    key={toast.id}
                    className={`notification-card notification-card--${type}`}
                    aria-label={`${notificationTypeLabel(type)} notification`}
                  >
                    <span className="notification-card__marker" aria-hidden="true" />
                    <div className="notification-card__message">{toast.message}</div>
                    <button
                      type="button"
                      className="notification-card__dismiss icon-btn"
                      onClick={() => dismissToast(sessionId, toast.id)}
                      aria-label="Dismiss notification"
                    >
                      <IconClose size="0.857em" />
                    </button>
                  </article>
                );
              })}
            </ScrollFadeFrame>
          </>
        ) : previewNotification ? (
          <div
            className="notification-stack__pile"
            style={
              { "--stack-extra": `${(previewStackDepth - 1) * 0.5}rem` } as React.CSSProperties
            }
          >
            {Array.from({ length: Math.max(0, previewStackDepth - 1) }, (_, i) => {
              const layer = previewStackDepth - i - 1;
              return (
                <div
                  key={`backplate-${layer}`}
                  className="notification-stack__backplate"
                  style={
                    {
                      "--backplate-offset": `${layer * 0.5}rem`,
                      "--backplate-scale": String(1 - layer * 0.028),
                      "--backplate-opacity": String(1 - layer * 0.18),
                      "--backplate-z": String(10 - layer),
                    } as React.CSSProperties
                  }
                  aria-hidden="true"
                />
              );
            })}
            <article
              className={`notification-card notification-card--${notificationType(previewNotification.type)} notification-stack__pile-card`}
              aria-label={`${notificationTypeLabel(notificationType(previewNotification.type))} notification`}
            >
              <button
                type="button"
                className="notification-stack__pile-open"
                onClick={() => {
                  setPreviewPhase("hidden");
                  setNotificationPanelOpen(sessionId, true);
                }}
                aria-expanded="false"
              >
                <span className="notification-card__marker" aria-hidden="true" />
                <span className="notification-card__message">{previewNotification.message}</span>
              </button>
              <button
                type="button"
                className="notification-card__dismiss notification-card__dismiss--pile icon-btn"
                aria-label="Dismiss notification"
                onClick={(e) => {
                  e.stopPropagation();
                  dismissToast(sessionId, previewNotification.id);
                }}
              >
                <IconClose size="0.857em" />
              </button>
            </article>
          </div>
        ) : null}
      </div>
    </aside>
  );
}
