export class ContainerCreationError extends Error {
  constructor(message: string, readonly retryable: boolean = false, readonly reason: 'meta_auth' | 'meta_rejected' | 'meta_unavailable' = 'meta_rejected') { super(message); }
}
export class PublicationUncertainError extends Error {}

// No retry is safe after a publish request may have left the process.
export class ThreadsPublisher {
  constructor(private readonly request: typeof fetch = fetch) {}

  async createTextContainer(token: string, text: string, replyTo?: string | null): Promise<string> {
    if (!text.trim()) throw new ContainerCreationError('Konten tidak valid.');
    if (replyTo && !/^[0-9]+$/.test(replyTo)) throw new ContainerCreationError('ID balasan tidak valid.');
    return this.create(token,{ media_type: 'TEXT', text, ...(replyTo ? { reply_to_id: replyTo } : {}) });
  }
  async createMediaContainer(token: string, text: string, kind: 'IMAGE' | 'VIDEO', mediaUrl: string): Promise<string> {
    const source = new URL(mediaUrl);
    if (source.protocol !== 'https:' || source.username || source.password || !['IMAGE','VIDEO'].includes(kind)) throw new ContainerCreationError('URL media harus HTTPS.');
    const params: Record<string,string> = { media_type: kind, [kind === 'IMAGE' ? 'image_url' : 'video_url']: mediaUrl };
    if (text.trim()) params.text = text;
    return this.create(token,params);
  }
  async createCarouselItem(token: string, mediaUrl: string): Promise<string> {
    const source = new URL(mediaUrl);
    if (source.protocol !== 'https:' || source.username || source.password) throw new ContainerCreationError('URL media harus HTTPS.');
    return this.create(token,{ media_type:'IMAGE', image_url:mediaUrl, is_carousel_item:'true' });
  }
  async createCarouselContainer(token: string, text: string, children: string[]): Promise<string> {
    if (children.length < 2 || children.length > 10 || children.some(id => !/^[0-9]+$/.test(id))) throw new ContainerCreationError('Carousel tidak valid.');
    return this.create(token,{ media_type:'CAROUSEL', children:children.join(','), ...(text.trim() ? { text } : {}) });
  }
  private async create(token: string, params: Record<string,string>): Promise<string> {
    if (!token) throw new ContainerCreationError('Token tidak valid.');
    const url = new URL('https://graph.threads.net/me/threads');
    url.search = new URLSearchParams(params).toString();
    try {
      const response = await this.request(url.toString(), { method: 'POST', headers: { Authorization: `Bearer ${token}` }, redirect: 'error', signal: AbortSignal.timeout(15000) });
      if (!response.ok) throw new ContainerCreationError('Container Threads tidak dapat dibuat.', response.status === 429 || response.status >= 500, response.status === 401 || response.status === 403 ? 'meta_auth' : response.status === 429 || response.status >= 500 ? 'meta_unavailable' : 'meta_rejected');
      const value: unknown = await response.json();
      if (!value || typeof value !== 'object' || typeof (value as { id?: unknown }).id !== 'string' || !/^[0-9]+$/.test((value as { id: string }).id)) throw new ContainerCreationError('Respons container tidak valid.');
      return (value as { id: string }).id;
    } catch (error) { if (error instanceof ContainerCreationError) throw error; throw new ContainerCreationError('Container Threads tidak dapat dibuat.', true, 'meta_unavailable'); }
  }

  async containerStatus(token: string, container: string): Promise<'FINISHED' | 'IN_PROGRESS' | 'ERROR' | 'EXPIRED' | 'PUBLISHED'> {
    if (!token || !/^[0-9]+$/.test(container)) throw new ContainerCreationError('Container tidak valid.');
    try {
      const url = new URL(`https://graph.threads.net/${container}`); url.searchParams.set('fields','status');
      const response = await this.request(url.toString(),{ headers: { Authorization: `Bearer ${token}` }, redirect: 'error', signal: AbortSignal.timeout(15000) });
      if (!response.ok) throw new ContainerCreationError('Status container belum dapat dibaca.',response.status === 429 || response.status >= 500,response.status === 401 || response.status === 403 ? 'meta_auth' : 'meta_unavailable');
      const data = await response.json() as { status?: unknown };
      if (!data || !['FINISHED','IN_PROGRESS','ERROR','EXPIRED','PUBLISHED'].includes(String(data.status))) throw new ContainerCreationError('Status container tidak valid.',true,'meta_unavailable');
      return data.status as 'FINISHED' | 'IN_PROGRESS' | 'ERROR' | 'EXPIRED' | 'PUBLISHED';
    } catch (error) { if (error instanceof ContainerCreationError) throw error; throw new ContainerCreationError('Status container belum dapat dibaca.',true,'meta_unavailable'); }
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
