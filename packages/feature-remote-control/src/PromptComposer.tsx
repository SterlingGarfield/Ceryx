import { ceryxColors } from "@ceryx/design-tokens";
import { Button, Panel, TextArea } from "@ceryx/ui";
import type { PromptHistoryItem, PromptTemplate } from "./stores/usePromptStore";

export interface PromptComposerProps {
  size?: "desktop" | "ipad";
  title?: string;
  draft: string;
  templates: PromptTemplate[];
  history: PromptHistoryItem[];
  isSending: boolean;
  lastError?: string;
  disabled?: boolean;
  onDraftChange: (value: string) => void;
  onTemplateSelect: (templateId: string) => void;
  onSend: (submit: boolean) => void;
  onClearHistory?: () => void;
}

export function PromptComposer({
  size = "desktop",
  title = "Prompt Composer",
  draft,
  templates,
  history,
  isSending,
  lastError,
  disabled = false,
  onDraftChange,
  onTemplateSelect,
  onSend,
  onClearHistory
}: PromptComposerProps) {
  return (
    <Panel size={size} style={{ display: "grid", gap: 14 }}>
      <div
        style={{
          alignItems: "center",
          display: "flex",
          justifyContent: "space-between"
        }}
      >
        <strong style={{ fontSize: size === "ipad" ? 20 : 18 }}>{title}</strong>
        {onClearHistory ? (
          <Button size={size} variant="ghost" disabled={disabled} onClick={onClearHistory}>
            Clear History
          </Button>
        ) : null}
      </div>

      <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
        {templates.map((template) => (
          <Button
            key={template.id}
            size={size}
            variant="secondary"
            disabled={disabled}
            onClick={() => onTemplateSelect(template.id)}
          >
            {template.label}
          </Button>
        ))}
      </div>

      <TextArea
        label="Prompt Draft"
        value={draft}
        disabled={disabled}
        hint="Use templates for common commands, then edit before sending."
        error={lastError}
        onChange={(event) => onDraftChange(event.target.value)}
        style={{
          minHeight: size === "ipad" ? 156 : 132
        }}
      />

      <div style={{ display: "flex", flexWrap: "wrap", gap: 10 }}>
        <Button size={size} disabled={disabled || isSending || !draft.trim()} onClick={() => onSend(true)}>
          {isSending ? "Sending..." : "Send Prompt"}
        </Button>
        <Button
          size={size}
          variant="secondary"
          disabled={disabled || isSending || !draft.trim()}
          onClick={() => onSend(false)}
        >
          Queue Draft
        </Button>
      </div>

      <div style={{ display: "grid", gap: 8 }}>
        <strong style={{ fontSize: 14 }}>Recent Prompts</strong>
        {history.length === 0 ? (
          <p style={{ color: ceryxColors.onSurfaceVariant, margin: 0 }}>
            Prompt history is empty.
          </p>
        ) : (
          history.slice(0, 5).map((item) => (
            <div
              key={item.id}
              style={{
                borderTop: `1px solid ${ceryxColors.outlineVariant}`,
                display: "grid",
                gap: 4,
                paddingTop: 8
              }}
            >
              <div
                style={{
                  alignItems: "center",
                  display: "flex",
                  justifyContent: "space-between"
                }}
              >
                <strong style={{ fontSize: 13 }}>{item.submit ? "sent" : "queued"}</strong>
                <span style={{ color: ceryxColors.onSurfaceVariant, fontSize: 12 }}>
                  {item.status}
                </span>
              </div>
              <div style={{ color: ceryxColors.onSurfaceVariant, fontSize: 13 }}>
                {item.prompt}
              </div>
            </div>
          ))
        )}
      </div>
    </Panel>
  );
}
