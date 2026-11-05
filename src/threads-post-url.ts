export function threadsPostKey(value:string):string|null {
  try {
    const url=new URL(value);
    if (url.protocol!=='https:' || url.username || url.password || url.port || !['threads.com','www.threads.com','threads.net','www.threads.net'].includes(url.hostname)) return null;
    return /^\/(?:@[^/]+\/post|t)\/([A-Za-z0-9_-]+)\/?$/.exec(decodeURIComponent(url.pathname))?.[1] ?? null;
  } catch {return null;}
}
