/**
 * Web shim for @tauri-apps/plugin-http — native fetch is already available.
 * The plugin's Response/Headers types are structurally compatible.
 */

export async function fetch(
  input: string | URL | Request,
  init?: RequestInit,
): Promise<Response> {
  return window.fetch(input, init);
}

export class Client {
  constructor(
    public options?: { proxy?: string; connectTimeout?: number; maxRedirections?: number },
  ) {}

  async get(url: string, options?: RequestInit): Promise<Response> {
    return window.fetch(url, options);
  }

  async post(url: string, options?: RequestInit): Promise<Response> {
    return window.fetch(url, { ...options, method: 'POST' });
  }

  async put(url: string, options?: RequestInit): Promise<Response> {
    return window.fetch(url, { ...options, method: 'PUT' });
  }

  async delete(url: string, options?: RequestInit): Promise<Response> {
    return window.fetch(url, { ...options, method: 'DELETE' });
  }
}

export async function getClient(options?: {
  proxy?: string;
  connectTimeout?: number;
  maxRedirections?: number;
}): Promise<Client> {
  return new Client(options);
}
