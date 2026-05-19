export const CeryxEventTypes = [
  "connection.ready",
  "connection.closed",
  "agent.status.changed",
  "codex.window.found",
  "codex.window.closed",
  "codex.window.minimized",
  "capture.started",
  "capture.stopped",
  "capture.resized",
  "input.accepted",
  "input.rejected",
  "prompt.sent",
  "prompt.failed",
  "project.diff.changed",
  "media.screenshot.created",
  "media.recording.started",
  "media.recording.stopped",
  "notification.created",
  "audit.created",
  "error.occurred"
] as const;

export type CeryxEventType = (typeof CeryxEventTypes)[number];

export interface CeryxEvent<
  TType extends string = CeryxEventType,
  TPayload = unknown
> {
  eventId: string;
  type: TType;
  sessionId?: string;
  timestamp: string;
  payload: TPayload;
}
