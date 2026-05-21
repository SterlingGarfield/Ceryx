const PromptDraftStorageKey = "ceryx.promptDraft.v1";

export interface PromptDraftStorage {
  read(): string;
  write(value: string): void;
  clear(): void;
}

export function createPromptDraftStorage(
  key: string = PromptDraftStorageKey,
  storage?: Storage
): PromptDraftStorage {
  return {
    read(): string {
      try {
        const target = storage ?? getGlobalStorage();
        return target?.getItem(key) ?? "";
      } catch {
        return "";
      }
    },
    write(value: string): void {
      try {
        const target = storage ?? getGlobalStorage();
        target?.setItem(key, value);
      } catch {
        // no-op in environments where Storage is unavailable.
      }
    },
    clear(): void {
      try {
        const target = storage ?? getGlobalStorage();
        target?.removeItem(key);
      } catch {
        // no-op in environments where Storage is unavailable.
      }
    }
  };
}

function getGlobalStorage(): Storage | undefined {
  if (typeof globalThis === "undefined") {
    return undefined;
  }

  return globalThis.localStorage;
}
