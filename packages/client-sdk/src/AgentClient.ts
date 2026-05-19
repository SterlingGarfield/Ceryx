import type { AgentStatus } from "@ceryx/protocol";

export interface AgentClientOptions {
  baseUrl: string;
  getToken?: () => string | undefined;
  fetchImpl?: typeof fetch;
}

interface RequestConfig {
  auth: boolean;
  method?: "GET" | "POST";
  body?: unknown;
}

export class AgentClient {
  private readonly fetchImpl: typeof fetch;

  constructor(private readonly options: AgentClientOptions) {
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  async health(): Promise<{ ok: true }> {
    return this.request<{ ok: true }>("/api/v1/health", { auth: false });
  }

  async agentStatus(): Promise<AgentStatus> {
    return this.request<AgentStatus>("/api/v1/agent/status", { auth: true });
  }

  private async request<T>(path: string, config: RequestConfig): Promise<T> {
    const headers: Record<string, string> = {
      Accept: "application/json"
    };

    if (config.body !== undefined) {
      headers["Content-Type"] = "application/json";
    }

    if (config.auth) {
      const token = this.options.getToken?.();
      if (!token) {
        throw new Error(`Missing device token for authenticated request: ${path}`);
      }
      headers.Authorization = `Bearer ${token}`;
    }

    const response = await this.fetchImpl(`${stripTrailingSlash(this.options.baseUrl)}${path}`, {
      body: config.body === undefined ? undefined : JSON.stringify(config.body),
      headers,
      method: config.method ?? "GET"
    });

    return response.json() as Promise<T>;
  }
}

function stripTrailingSlash(input: string): string {
  return input.endsWith("/") ? input.slice(0, -1) : input;
}
