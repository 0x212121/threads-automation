export class ContainerCreationError extends Error {
  constructor(message: string, readonly retryable: boolean = false, readonly reason: 'meta_auth' | 'meta_rejected' | 'meta_unavailable' = 'meta_rejected') { super(message); }
}
export class PublicationUncertainError extends Error {}

// No retry is safe after a publish request may have left the process.
export class ThreadsPublisher {
  constructor(private readonly request: typeof fetch = fetch) {}

  async createTextContainer(token: string, text: string): Promise<string> {
    if (!token || !text.trim()) throw new ContainerCreationError('Konten atau token tidak valid.');
    const url = new URL('https://graph.threads.net/me/threads');
    url.search = new URLSearchParams({ media_type: 'TEXT', text }).toString();
    try {
      const response = await this.request(url.toString(), { method: 'POST', headers: { Authorization: `Bearer ${token}` }, redirect: 'error', signal: AbortSignal.timeout(15000) });
      if (!response.ok) throw new ContainerCreationError('Container Threads tidak dapat dibuat.', response.status === 429 || response.status >= 500, response.status === 401 || response.status === 403 ? 'meta_auth' : response.status === 429 || response.status >= 500 ? 'meta_unavailable' : 'meta_rejected');
      const value: unknown = await response.json();
      if (!value || typeof value !== 'object' || typeof (value as { id?: unknown }).id !== 'string' || !/^[0-9]+$/.test((value as { id: string }).id)) throw new ContainerCreationError('Respons container tidak valid.');
      return (value as { id: string }).id;
    } catch (error) { if (error instanceof ContainerCreationError) throw error; throw new ContainerCreationError('Container Threads tidak dapat dibuat.', true, 'meta_unavailable'); }
  }

  async publishContainer(token: string, containerId: string): Promise<string> {
    if (!token || !/^[0-9]+$/.test(containerId)) throw new PublicationUncertainError('Publikasi tidak dapat dipastikan.');
    try {
      const url = new URL('https://graph.threads.net/me/threads_publish');
      url.searchParams.set('creation_id', containerId);
      const response = await this.request(url.toString(), { method: 'POST', headers: { Authorization: `Bearer ${token}` }, redirect: 'error', signal: AbortSignal.timeout(15000) });
      if (!response.ok) throw new Error();
      const value: unknown = await response.json();
      if (!value || typeof value !== 'object' || typeof (value as { id?: unknown }).id !== 'string' || !/^[0-9]+$/.test((value as { id: string }).id)) throw new Error();
      return (value as { id: string }).id;
    } catch { throw new PublicationUncertainError('Hasil publikasi belum pasti. Periksa Threads sebelum mencoba ulang.'); }
  }
}
