import { describe, expect, it } from "vitest";
import {
  AgentRuntimeStatuses,
  CeryxErrorCodes,
  CeryxEventTypes,
  CeryxPermissions,
  CodexWindowStatuses,
  ProtectedApiRoutes,
  PublicApiRoutes
} from "./index";

describe("v0.3 protocol constants", () => {
  it("includes required security errors", () => {
    expect(CeryxErrorCodes).toContain("E_NOT_PAIRED");
    expect(CeryxErrorCodes).toContain("E_TOKEN_INVALID");
    expect(CeryxErrorCodes).toContain("E_PERMISSION_DENIED");
    expect(CeryxErrorCodes).toContain("E_CLIPBOARD_INVALID_REQUEST");
    expect(CeryxErrorCodes).toContain("E_CLIPBOARD_TOO_LARGE");
    expect(CeryxErrorCodes).toContain("E_CLIPBOARD_EMPTY");
  });

  it("includes required control permissions", () => {
    expect(CeryxPermissions).toContain("control_input");
    expect(CeryxPermissions).toContain("send_prompt");
    expect(CeryxPermissions).toContain("manage_agent");
  });

  it("exposes the Codex window states used by Agent and clients", () => {
    expect(CodexWindowStatuses).toEqual([
      "not_found",
      "found",
      "focused",
      "minimized",
      "closed",
      "multiple_candidates",
      "permission_issue"
    ]);
  });

  it("keeps public routes limited to health and pairing endpoints", () => {
    expect(PublicApiRoutes).toEqual([
      "GET /api/v1/health",
      "POST /api/v1/pairing/request",
      "POST /api/v1/pairing/desktop-confirm"
    ]);
    expect(ProtectedApiRoutes).toContain("POST /api/v1/prompt/send");
    expect(ProtectedApiRoutes).toContain("POST /api/v1/clipboard/send");
    expect(ProtectedApiRoutes).toContain("GET /api/v1/clipboard/receive");
    expect(ProtectedApiRoutes).toContain("POST /api/v1/clipboard/clear");
    expect(ProtectedApiRoutes).toContain("GET /api/v1/codex/windows");
  });

  it("defines runtime statuses and event names for connection flow", () => {
    expect(AgentRuntimeStatuses).toContain("running");
    expect(AgentRuntimeStatuses).toContain("paused");
    expect(CeryxEventTypes).toContain("connection.ready");
    expect(CeryxEventTypes).toContain("prompt.failed");
  });
});
