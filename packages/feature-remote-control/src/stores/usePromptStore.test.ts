import { describe, expect, it } from "vitest";
import { createPromptStore } from "./usePromptStore";
import type { PromptDraftStorage } from "./promptDraftStorage";

class MemoryPromptDraftStorage implements PromptDraftStorage {
  private value = "";

  constructor(initialValue: string = "") {
    this.value = initialValue;
  }

  read(): string {
    return this.value;
  }

  write(value: string): void {
    this.value = value;
  }

  clear(): void {
    this.value = "";
  }
}

describe("usePromptStore", () => {
  it("hydrates and persists draft", () => {
    const storage = new MemoryPromptDraftStorage("seed prompt");
    const store = createPromptStore(storage);

    expect(store.getState().draft).toBe("seed prompt");
    store.getState().setDraft("updated prompt");
    expect(storage.read()).toBe("updated prompt");
  });

  it("tracks send lifecycle and template application", () => {
    const storage = new MemoryPromptDraftStorage();
    const store = createPromptStore(storage);

    const firstTemplate = store.getState().templates[0];
    store.getState().applyTemplate(firstTemplate.id);
    expect(store.getState().draft).toBe(firstTemplate.text);

    const historyId = store.getState().beginSend(true);
    expect(store.getState().isSending).toBe(true);
    expect(store.getState().history[0]?.status).toBe("pending");

    store.getState().markSendSuccess(historyId);
    expect(store.getState().history[0]?.status).toBe("sent");
    expect(store.getState().isSending).toBe(false);

    store.getState().setDraft("retry prompt");
    const secondId = store.getState().beginSend(false);
    store.getState().markSendFailure(secondId, "network timeout");
    expect(store.getState().history[0]?.status).toBe("failed");
    expect(store.getState().history[0]?.errorMessage).toBe("network timeout");
    expect(store.getState().lastError).toBe("network timeout");
  });
});
