import { ceryxColors } from "@ceryx/design-tokens";
import type { PairingState } from "@ceryx/client-sdk";
import {
  useConnectionStore,
  usePairingStore
} from "@ceryx/feature-remote-control";
import { Button, Panel, StatusChip } from "@ceryx/ui";
import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import {
  confirmPairing,
  desktopConfirmPairing,
  requestPairing
} from "../platform/ipad/agentGateway";
import {
  normalizeAgentBaseUrl,
  resolveDefaultAgentBaseUrl
} from "../platform/ipad/defaultAgentBaseUrl";

const digitCount = 6;

export function PairRoute() {
  const { deviceId } = useParams<{ deviceId: string }>();
  const navigate = useNavigate();
  const setCurrentDevice = useConnectionStore((state) => state.setCurrentDevice);
  const setTokenState = useConnectionStore((state) => state.setTokenState);
  const markConnected = useConnectionStore((state) => state.markConnected);
  const pairingStore = usePairingStore();
  const [clientName, setClientName] = useState("Ceryx iPad");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const inputRefs = useRef<Array<HTMLInputElement | null>>([]);

  const baseUrl = useMemo(() => {
    if (!deviceId) {
      return resolveDefaultAgentBaseUrl();
    }

    return normalizeAgentBaseUrl(decodeURIComponent(deviceId)) ?? resolveDefaultAgentBaseUrl();
  }, [deviceId]);

  const code = pairingStore.code.padEnd(digitCount, " ").slice(0, digitCount);

  useEffect(() => {
    setCurrentDevice({
      deviceId: `device:${baseUrl}`,
      deviceName: "Windows Agent",
      platform: "windows",
      baseUrl
    });
  }, [baseUrl, setCurrentDevice]);

  const canConfirm = pairingStore.pairingId && pairingStore.code.length === digitCount;

  async function onRequestPairing() {
    setIsSubmitting(true);
    pairingStore.beginRequest({
      clientName,
      clientType: "ipad",
      platform: "ios"
    });

    try {
      const result = await requestPairing(baseUrl, {
        clientName,
        clientType: "ipad",
        platform: "ios"
      });

      if (result.ok) {
        pairingStore.setRequestAccepted({
          pairingId: result.pairingId,
          expiresAt: result.expiresAt,
          state: result.state
        });

        const approval = await desktopConfirmPairing(baseUrl, {
          pairingId: result.pairingId
        });

        if (!approval.ok) {
          pairingStore.markRejected({
            rejectedReason: "desktop_confirm_rejected",
            state: coercePairingState(approval.state)
          });
          return;
        }

        pairingStore.setCode((approval.code ?? "").replace(/\D/g, "").slice(0, digitCount));
        pairingStore.markCodeInput();
      } else {
        pairingStore.markRejected({
          rejectedReason: result.rejectedReason ?? "request_rejected",
          state: coercePairingState(result.state)
        });
      }
    } catch (error) {
      pairingStore.markNetworkError(
        error instanceof Error ? error.message : "Failed to request pairing."
      );
    } finally {
      setIsSubmitting(false);
    }
  }

  async function onConfirmPairing() {
    if (!pairingStore.pairingId || pairingStore.code.length !== digitCount) {
      return;
    }

    setIsSubmitting(true);
    pairingStore.markVerifying();

    try {
      const result = await confirmPairing(baseUrl, {
        pairingId: pairingStore.pairingId,
        code: pairingStore.code
      });

      if (result.ok) {
        pairingStore.markSuccess(result.deviceId);
        setTokenState("valid");
        markConnected();
        navigate("/connections");
      } else {
        pairingStore.markRejected({
          rejectedReason: result.rejectedReason ?? "confirm_rejected",
          failedAttempts: result.failedAttempts,
          isLocked: result.isLocked,
          state: coercePairingState(result.state)
        });
      }
    } catch (error) {
      pairingStore.markNetworkError(
        error instanceof Error ? error.message : "Failed to confirm pairing."
      );
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <section style={{ margin: "0 auto", maxWidth: 960, padding: 24 }}>
      <header style={{ marginBottom: 16 }}>
        <h1 style={{ fontSize: 30, margin: "0 0 10px" }}>Pair iPad</h1>
        <p style={{ color: ceryxColors.onSurfaceVariant, margin: 0 }}>
          Target Agent: <strong>{baseUrl}</strong>
        </p>
      </header>

      <Panel size="ipad" style={{ display: "grid", gap: 14 }}>
        <div
          style={{
            alignItems: "center",
            display: "flex",
            gap: 10,
            justifyContent: "space-between"
          }}
        >
          <span>Pairing State</span>
          <StatusChip tone={toneForPairingState(pairingStore.state)}>
            {pairingStore.state}
          </StatusChip>
        </div>

        <p style={{ color: ceryxColors.onSurfaceVariant, margin: 0 }}>
          {messageForPairingState(
            pairingStore.state,
            pairingStore.rejectedReason,
            pairingStore.code
          )}
        </p>

        <label style={{ display: "grid", gap: 6 }}>
          <span>Client Name</span>
          <input
            value={clientName}
            onChange={(event) => setClientName(event.target.value)}
            style={{
              border: `1px solid ${ceryxColors.outlineVariant}`,
              borderRadius: 12,
              font: "inherit",
              minHeight: 44,
              padding: "0 12px"
            }}
          />
        </label>

        <div style={{ display: "grid", gap: 8 }}>
          <span>6-digit confirmation code</span>
          <div style={{ display: "flex", gap: 8 }}>
            {Array.from({ length: digitCount }).map((_, index) => (
              <input
                key={`code-digit-${index + 1}`}
                aria-label={`code-digit-${index + 1}`}
                ref={(element) => {
                  inputRefs.current[index] = element;
                }}
                value={code[index] === " " ? "" : code[index]}
                inputMode="numeric"
                maxLength={1}
                onChange={(event) => {
                  const digit = event.target.value.replace(/\D/g, "").slice(0, 1);
                  const next = code
                    .split("")
                    .map((char, charIndex) =>
                      charIndex === index ? (digit || " ") : char
                    )
                    .join("")
                    .replace(/ /g, "");

                  pairingStore.setCode(next);
                  if (digit && index < digitCount - 1) {
                    inputRefs.current[index + 1]?.focus();
                  }
                }}
                onKeyDown={(event) => {
                  if (event.key === "Backspace" && !code[index] && index > 0) {
                    inputRefs.current[index - 1]?.focus();
                  }
                }}
                style={{
                  border: `1px solid ${ceryxColors.outlineVariant}`,
                  borderRadius: 12,
                  fontSize: 22,
                  fontWeight: 700,
                  height: 52,
                  textAlign: "center",
                  width: 52
                }}
              />
            ))}
          </div>
        </div>

        {pairingStore.lastError ? (
          <p style={{ color: ceryxColors.error, margin: 0 }}>{pairingStore.lastError}</p>
        ) : null}

        <div style={{ display: "flex", gap: 10 }}>
          <Button
            size="ipad"
            style={{ minWidth: 180 }}
            disabled={isSubmitting || !clientName.trim()}
            onClick={() => void onRequestPairing()}
          >
            Request Pairing
          </Button>
          <Button
            size="ipad"
            variant="secondary"
            style={{ minWidth: 180 }}
            disabled={isSubmitting || !canConfirm}
            onClick={() => void onConfirmPairing()}
          >
            Confirm Code
          </Button>
          <Button
            size="ipad"
            variant="ghost"
            style={{ minWidth: 120 }}
            onClick={() => navigate("/connections")}
          >
            Back
          </Button>
        </div>
      </Panel>
    </section>
  );
}

function messageForPairingState(state: string, reason: string, code = ""): string {
  switch (state) {
    case "requesting":
      return "Sending pairing request to Agent...";
    case "waiting_desktop_confirm":
      return "Waiting for desktop-side pairing approval.";
    case "code_input":
      return code.length === digitCount
        ? "Confirmation code received. Tap Confirm Code to finish pairing."
        : "Enter the 6-digit code shown on desktop.";
    case "verifying":
      return "Verifying code with Agent...";
    case "success":
      return "Pairing successful. Returning to connections.";
    case "expired":
      return "Pairing session expired. Request a new pairing session.";
    case "rejected":
      return `Pairing rejected${reason ? `: ${reason}` : "."}`;
    case "network_error":
      return "Network error while pairing. Check connectivity and retry.";
    default:
      return "Start pairing request, then enter the 6-digit code.";
  }
}

function toneForPairingState(state: string): "neutral" | "success" | "warning" | "error" {
  if (state === "success") {
    return "success";
  }

  if (state === "network_error" || state === "rejected" || state === "expired") {
    return "error";
  }

  if (state === "requesting" || state === "waiting_desktop_confirm" || state === "verifying") {
    return "warning";
  }

  return "neutral";
}

function coercePairingState(state: string): PairingState | undefined {
  switch (state) {
    case "idle":
    case "waiting_desktop_confirm":
    case "code_input":
    case "verifying":
    case "success":
    case "expired":
    case "rejected":
    case "network_error":
      return state;
    default:
      return undefined;
  }
}
