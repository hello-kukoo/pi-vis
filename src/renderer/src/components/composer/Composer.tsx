import React, { useCallback, useEffect, useRef, useState } from "react";
import { useSessionsStore } from "../../stores/sessions-store.js";
import type { SessionId } from "@shared/ids.js";
import type { SlashCommandInfo } from "@shared/pi-protocol/responses.js";
import type { ImageContent } from "@shared/pi-protocol/commands.js";
import { AnsiText } from "../../lib/ansi.js";
import "./Composer.css";

const KNOWN_SLASH_COMMANDS = [
  "login", "model", "name", "session", "new", "resume", "compact", "export",
  "fork", "clone", "help", "settings",
];

interface ComposerProps {
  sessionId: SessionId;
}

export function Composer({ sessionId }: ComposerProps): React.ReactElement {
  const [text, setText] = useState("");
  const [slashSuggestions, setSlashSuggestions] = useState<string[]>([]);
  const [selectedSuggestion, setSelectedSuggestion] = useState(0);
  const [streamCommands, setStreamCommands] = useState<SlashCommandInfo[]>([]);
  const [attachments, setAttachments] = useState<{ name: string; dataUrl: string }[]>([]);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const sessions = useSessionsStore((s) => s.sessions);
  const addUserMessage = useSessionsStore((s) => s.addUserMessage);
  const addBashCommand = useSessionsStore((s) => s.addBashCommand);
  const finishBashCommand = useSessionsStore((s) => s.finishBashCommand);
  const setStreaming = useSessionsStore((s) => s.setStreaming);
  const addToast = useSessionsStore((s) => s.addToast);
  const session = sessions.get(sessionId);
  const isStreaming = session?.isStreaming ?? false;
  const live = session?.status === "starting" || session?.status === "ready";

  // Load available commands once
  useEffect(() => {
    if (!live) return;
    window.pivis.invoke("session.sendCommand", {
      sessionId,
      command: { type: "get_commands" },
    }).then((res) => {
      const raw = res.data as { commands?: unknown[] } | undefined;
      if (res.success && Array.isArray(raw?.commands)) {
        setStreamCommands(raw.commands as SlashCommandInfo[]);
      }
    }).catch(() => { /* ignore */ });
  }, [sessionId, live]);

  const allSlashCommands = [
    ...KNOWN_SLASH_COMMANDS,
    ...streamCommands.map((c) => c.name).filter((n) => !KNOWN_SLASH_COMMANDS.includes(n)),
  ];

  // ── File upload ────────────────────────────────────────────────────────
  const handleAttachClick = useCallback(() => {
    fileInputRef.current?.click();
  }, []);

  /**
   * Parse a data URL into an ImageContent object for the pi RPC protocol.
   * Example: "data:image/png;base64,iVBOR..." → { type: "image", data: "iVBOR...", mimeType: "image/png" }
   */
  function dataUrlToImageContent(dataUrl: string): ImageContent {
    const match = dataUrl.match(/^data:([^;]+);base64,(.+)$/);
    if (!match) {
      // Fallback: send as-is (handles unexpected formats)
      return { type: "image", data: dataUrl, mimeType: "application/octet-stream" };
    }
    return { type: "image", data: match[2]!, mimeType: match[1]! };
  }

  const handleFilesSelected = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    for (const file of Array.from(files)) {
      const reader = new FileReader();
      reader.onload = () => {
        const dataUrl = reader.result as string;
        setAttachments((prev) => [...prev, { name: file.name, dataUrl }]);
      };
      reader.readAsDataURL(file);
    }

    // Reset so the same file can be selected again
    e.target.value = "";
  }, []);

  const removeAttachment = useCallback((index: number) => {
    setAttachments((prev) => prev.filter((_, i) => i !== index));
  }, []);

  const updateSuggestions = useCallback((value: string) => {
    if (value.startsWith("/") && !value.includes(" ")) {
      const prefix = value.slice(1).toLowerCase();
      const matches = allSlashCommands.filter((c) => c.toLowerCase().startsWith(prefix));
      setSlashSuggestions(matches.slice(0, 8));
      setSelectedSuggestion(0);
    } else {
      setSlashSuggestions([]);
    }
  }, [allSlashCommands]);

  const sendPrompt = useCallback(async (content: string) => {
    if (!content.trim()) return;

    if (!session?.currentModel) {
      addToast(sessionId, "No model selected", "error");
      return;
    }

    // Convert data URLs to proper ImageContent objects for the pi RPC protocol
    const imageContents: ImageContent[] = attachments.map((a) => dataUrlToImageContent(a.dataUrl));

    if (content.startsWith("!")) {
      const command = content.slice(1).trim();
      addBashCommand(sessionId, command);
      window.pivis.invoke("session.sendCommand", {
        sessionId,
        command: { type: "bash", command },
      }).then((res) => {
        const data = res.data as { output?: string; exitCode?: number } | undefined;
        if (res.success) {
          finishBashCommand(sessionId, data?.output ?? "", data?.exitCode ?? 0);
        } else {
          finishBashCommand(sessionId, res.error ?? "Command failed", data?.exitCode ?? 1);
        }
      }).catch((err) => {
        finishBashCommand(sessionId, String(err), 1);
      });
    } else {
      addUserMessage(sessionId, content, attachments.length > 0 ? attachments.map((a) => a.dataUrl) : undefined);
      // Show the working indicator immediately — pi's agent_start can lag
      // behind the send by a noticeable beat.
      setStreaming(sessionId, true);
      const cmd = isStreaming
        ? { type: "prompt" as const, message: content, images: imageContents.length > 0 ? imageContents : undefined, streamingBehavior: "followUp" as const }
        : { type: "prompt" as const, message: content, images: imageContents.length > 0 ? imageContents : undefined };
      window.pivis.invoke("session.sendCommand", {
        sessionId,
        command: cmd,
      }).then((res) => {
        if (!res.success) {
          setStreaming(sessionId, false);
          addToast(sessionId, res.error ?? "Prompt failed", "error");
        }
      }).catch((err) => {
        setStreaming(sessionId, false);
        addToast(sessionId, `Failed to send: ${String(err)}`, "error");
      });
    }

    setText("");
    setAttachments([]);
    setSlashSuggestions([]);
  }, [sessionId, isStreaming, addUserMessage, addBashCommand, finishBashCommand, setStreaming, addToast, session?.currentModel, attachments]);

  const handleAbort = useCallback(() => {
    window.pivis.invoke("session.sendCommand", {
      sessionId,
      command: { type: "abort" },
    }).catch(console.error);
  }, [sessionId]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (slashSuggestions.length > 0) {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setSelectedSuggestion((s) => Math.min(s + 1, slashSuggestions.length - 1));
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setSelectedSuggestion((s) => Math.max(s - 1, 0));
        return;
      }
      if (e.key === "Tab" || (e.key === "Enter" && slashSuggestions.length > 0 && text.startsWith("/"))) {
        e.preventDefault();
        const chosen = slashSuggestions[selectedSuggestion];
        if (chosen) {
          setText(`/${chosen} `);
          setSlashSuggestions([]);
        }
        return;
      }
      if (e.key === "Escape") {
        setSlashSuggestions([]);
        return;
      }
    }

    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      void sendPrompt(text);
    }

    if (e.key === "Escape" && isStreaming) {
      handleAbort();
    }
  }, [text, slashSuggestions, selectedSuggestion, sendPrompt, isStreaming, handleAbort]);

  const handleChange = useCallback((e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const value = e.target.value;
    setText(value);
    updateSuggestions(value);
  }, [updateSuggestions]);

  const isBashMode = text.startsWith("!");
  const isSlashMode = text.startsWith("/");

  return (
    <div className="composer">
      {/* Image preview strip */}
      {attachments.length > 0 && (
        <div className="composer__attachments">
          {attachments.map((att, i) => (
            <div key={`${att.name}-${i}`} className="composer__attachment-item">
              <img src={att.dataUrl} alt={att.name} className="composer__attachment-thumb" />
              <button
                className="composer__attachment-remove"
                onClick={() => removeAttachment(i)}
                aria-label={`Remove ${att.name}`}
              >
                ×
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Widget strip */}
      {session && session.widgets.size > 0 && (
        <div className="composer__widget-strip">
          {Array.from(session.widgets.entries()).map(([key, lines]) => (
            <div key={key} className="widget-strip__item">
              {lines.map((line, i) => (
                // eslint-disable-next-line react/no-array-index-key
                <div key={i} className="widget-strip__line"><AnsiText text={line} /></div>
              ))}
            </div>
          ))}
        </div>
      )}

      {/* Slash suggestions */}
      {slashSuggestions.length > 0 && (
        <div className="composer__suggestions">
          {slashSuggestions.map((suggestion, i) => (
            <button
              key={suggestion}
              className={`composer__suggestion ${i === selectedSuggestion ? "composer__suggestion--selected" : ""}`}
              onClick={() => {
                setText(`/${suggestion} `);
                setSlashSuggestions([]);
                textareaRef.current?.focus();
              }}
            >
              /{suggestion}
            </button>
          ))}
        </div>
      )}

      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        multiple
        className="composer__file-input"
        onChange={handleFilesSelected}
      />
      <div className={`composer__input-row ${isBashMode ? "composer__input-row--bash" : ""} ${isSlashMode ? "composer__input-row--slash" : ""}`}>
        <div className="composer__input-box">
          <button
            className="composer__attach-btn"
            onClick={handleAttachClick}
            aria-label="Attach images"
            title="Attach images"
          >
            <svg viewBox="0 0 16 16" aria-hidden="true">
              <path
                d="M8 3.25v9.5M3.25 8h9.5"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
              />
            </svg>
          </button>
          <div className="composer__textarea-wrap">
            <textarea
              ref={textareaRef}
              className="composer__textarea"
              value={text}
              onChange={handleChange}
              onKeyDown={handleKeyDown}
              aria-label="Message pi"
            />
            {/* Custom placeholder overlay: a native placeholder participates in
                field-sizing and inflates the empty box once it wraps. */}
            {text === "" && (
              <div className="composer__placeholder" aria-hidden="true">
                {isStreaming
                  ? "Streaming… (Enter to queue, Esc to abort)"
                  : "Message pi… (Enter to send, !cmd for bash, /cmd for commands)"}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
