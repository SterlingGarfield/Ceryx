import { create } from "zustand";
import {
  createPromptDraftStorage,
  type PromptDraftStorage
} from "./promptDraftStorage";

export interface PromptTemplate {
  id: string;
  label: string;
  text: string;
}

export interface PromptHistoryItem {
  id: string;
  prompt: string;
  submit: boolean;
  status: "pending" | "sent" | "failed";
  createdAt: string;
  errorMessage: string;
}

export interface PromptState {
  draft: string;
  history: PromptHistoryItem[];
  templates: PromptTemplate[];
  isSending: boolean;
  lastSentAt: string;
  lastError: string;
}

export interface PromptActions {
  setDraft(value: string): void;
  applyTemplate(templateId: string): void;
  addTemplate(template: PromptTemplate): void;
  removeTemplate(templateId: string): void;
  beginSend(submit?: boolean): string;
  markSendSuccess(historyId: string): void;
  markSendFailure(historyId: string, errorMessage: string): void;
  clearHistory(): void;
  reset(): void;
}

export type PromptStore = PromptState & PromptActions;

const defaultTemplates: PromptTemplate[] = [
  {
    id: "explain-current-error",
    label: "Explain Current Error",
    text: "Please explain the current error and propose a minimal fix."
  },
  {
    id: "run-targeted-tests",
    label: "Run Targeted Tests",
    text: "Run the targeted tests for the changed modules and summarize failures."
  },
  {
    id: "summarize-diff",
    label: "Summarize Diff",
    text: "Summarize the current diff by risk and suggest follow-up checks."
  }
];

function createInitialState(storage: PromptDraftStorage): PromptState {
  return {
    draft: storage.read(),
    history: [],
    templates: [...defaultTemplates],
    isSending: false,
    lastSentAt: "",
    lastError: ""
  };
}

export function createPromptStore(
  storage: PromptDraftStorage = createPromptDraftStorage()
) {
  return create<PromptStore>()((set, get) => ({
    ...createInitialState(storage),
    setDraft(value) {
      storage.write(value);
      set({
        draft: value
      });
    },
    applyTemplate(templateId) {
      const template = get().templates.find((item) => item.id === templateId);
      if (!template) {
        return;
      }

      storage.write(template.text);
      set({
        draft: template.text
      });
    },
    addTemplate(template) {
      set((state) => ({
        templates: [...state.templates, template]
      }));
    },
    removeTemplate(templateId) {
      set((state) => ({
        templates: state.templates.filter((item) => item.id !== templateId)
      }));
    },
    beginSend(submit = true) {
      const prompt = get().draft.trim();
      if (!prompt) {
        throw new Error("Prompt draft cannot be empty.");
      }

      const historyId = `prompt_${Date.now()}_${Math.random().toString(16).slice(2, 8)}`;
      const createdAt = new Date().toISOString();
      const item: PromptHistoryItem = {
        id: historyId,
        prompt,
        submit,
        status: "pending",
        createdAt,
        errorMessage: ""
      };

      set((state) => ({
        history: [item, ...state.history],
        isSending: true,
        lastError: ""
      }));

      return historyId;
    },
    markSendSuccess(historyId) {
      set((state) => ({
        history: state.history.map((item) =>
          item.id === historyId
            ? {
                ...item,
                status: "sent",
                errorMessage: ""
              }
            : item
        ),
        isSending: false,
        lastSentAt: new Date().toISOString(),
        lastError: ""
      }));
    },
    markSendFailure(historyId, errorMessage) {
      set((state) => ({
        history: state.history.map((item) =>
          item.id === historyId
            ? {
                ...item,
                status: "failed",
                errorMessage
              }
            : item
        ),
        isSending: false,
        lastError: errorMessage
      }));
    },
    clearHistory() {
      set({
        history: [],
        isSending: false,
        lastError: ""
      });
    },
    reset() {
      storage.clear();
      set(createInitialState(storage));
    }
  }));
}

export const usePromptStore = createPromptStore();
