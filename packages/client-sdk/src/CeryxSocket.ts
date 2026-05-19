export interface CeryxSocketOptions {
  url: string;
  getToken?: () => string | undefined;
  webSocketFactory?: (url: string) => WebSocket;
}

export class CeryxSocket {
  private socket?: WebSocket;

  constructor(private readonly options: CeryxSocketOptions) {}

  connect(onMessage?: (event: MessageEvent) => void): WebSocket {
    const token = this.options.getToken?.();
    const url = token ? withQuery(this.options.url, "token", token) : this.options.url;
    const factory = this.options.webSocketFactory ?? ((value) => new WebSocket(value));
    const socket = factory(url);

    if (onMessage) {
      socket.addEventListener("message", onMessage);
    }

    this.socket = socket;
    return socket;
  }

  disconnect(code = 1000, reason = "normal closure"): void {
    this.socket?.close(code, reason);
  }
}

function withQuery(url: string, key: string, value: string): string {
  const parsed = new URL(url);
  parsed.searchParams.set(key, value);
  return parsed.toString();
}
