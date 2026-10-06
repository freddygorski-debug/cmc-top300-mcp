// Optional first-party publication lookup. A publication is not proof of price causation.
export type NewsSource = { id: number; symbol: string; name: string; url: string; hosts: string[]; prefix: string; format: "rss" | "jsonld"; aggregator?: boolean };
export const NEWS_SOURCES: readonly NewsSource[] = [
  { id: 1027, symbol: "ETH", name: "Ethereum Foundation", url: "https://blog.ethereum.org/en/feed.xml", hosts: ["blog.ethereum.org"], prefix: "/en/", format: "rss" },
  { id: 2280, symbol: "FIL", name: "Filecoin", url: "https://www.filecoin.io/blog", hosts: ["filecoin.io", "www.filecoin.io"], prefix: "/blog/", format: "jsonld" },
  { id: 20947, symbol: "SUI", name: "Sui", url: "https://www.sui.io/blog/rss.xml", hosts: ["www.sui.io"], prefix: "/blog/", format: "rss" },
  { id: 4847, symbol: "STX", name: "Stacks (blog agrégateur de l’écosystème)", url: "https://www.stacks.co/blog/rss.xml", hosts: ["www.stacks.co"], prefix: "/blog/", format: "rss", aggregator: true },
];
export const NEWS_POLICY = { recentMs: 72 * 3600000, cacheMs: 3600000, timeoutMs: 3000, maxBytes: 1000000, maxItems: 30, detailPages: 2 } as const;
export type Publication = { title: string; url: string; published_at: string };
export type NewsEvidence = { status: "recent_publication" | "no_recent_publication" | "unavailable" | "unsupported"; checked_at: string; source?: string; aggregator?: boolean; publication?: Publication; inspected?: number; limit?: number; failure?: "timeout" | "request" | "format" };
type NewsStorage = { get<T>(key: string): Promise<T | undefined>; put(key: string, value: unknown): Promise<unknown> };

function decodeNewsText(raw: string): string {
  const entities: Record<string,string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };
  return raw.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1").replace(/<[^>]*>/g, " ")
    .replace(/&(#x[\da-f]+|#\d+|amp|lt|gt|quot|apos|nbsp);/gi, (all, key: string) => {
      if (key[0] !== "#") return entities[key.toLowerCase()] ?? all;
      const code = key[1].toLowerCase() === "x" ? parseInt(key.slice(2),16) : parseInt(key.slice(1),10);
      return code > 0 && code <= 0x10ffff && !(code >= 0xd800 && code <= 0xdfff) ? String.fromCodePoint(code) : " ";
    }).replace(/[<>\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/g, " ").replace(/\s+/g, " ").trim();
}
function newsUrl(raw: unknown, source: NewsSource): string | null {
  if (typeof raw !== "string" || raw.length > 500) return null;
  try {
    const u = new URL(raw);
    if (u.protocol !== "https:" || u.username || u.password || u.port || !source.hosts.includes(u.hostname) || !u.pathname.startsWith(source.prefix) || u.search) return null;
    u.hash = "";
    // Use the verified www endpoint for Filecoin's canonical non-www URLs.
    if (source.id === 2280) u.hostname = "www.filecoin.io";
    return u.toString();
  } catch { return null; }
}
function publication(title: unknown, link: unknown, date: unknown, source: NewsSource): Publication | null {
  const url = newsUrl(link,source);
  const at = typeof date === "string" ? Date.parse(date) : NaN;
  const text = typeof title === "string" ? decodeNewsText(title).slice(0,160) : "";
  return url && text && Number.isFinite(at) ? { title:text, url, published_at:new Date(at).toISOString() } : null;
}
function jsonLd(html: string): Record<string,unknown>[] {
  const nodes: Record<string,unknown>[] = [];
  for (const match of html.matchAll(/<script\b[^>]*type\s*=\s*["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
    try {
      const data = JSON.parse(match[1]);
      for (const item of Array.isArray(data) ? data : [data]) {
        if (item && typeof item === "object") {
          nodes.push(item);
          if (Array.isArray(item["@graph"])) nodes.push(...item["@graph"].filter((x: unknown)=>x && typeof x === "object"));
        }
      }
    } catch { /* Malformed metadata is unavailable, not an inferred date. */ }
  }
  return nodes;
}
export function parsePublications(text: string, source: NewsSource): Publication[] {
  if (source.format === "jsonld") return jsonLd(text).filter(x=>x["@type"] === "BlogPosting" || x["@type"] === "NewsArticle")
    .map(x=>publication(x.headline,x.mainEntityOfPage ?? x.url,x.datePublished,source)).filter((x): x is Publication=>x!==null);
  if (!/<rss\b/i.test(text) || !/<\/rss>\s*$/i.test(text) || /<!DOCTYPE|<!ENTITY/i.test(text)) throw new Error("Invalid publication feed");
  return [...text.matchAll(/<item\b[^>]*>([\s\S]*?)<\/item>/gi)].slice(0,NEWS_POLICY.maxItems).map(match=> {
    const field=(tag:string)=>match[1].match(new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)<\\/${tag}>`,"i"))?.[1];
    return publication(field("title"),decodeNewsText(field("link") ?? ""),field("pubDate"),source);
  }).filter((x): x is Publication=>x!==null);
}
function detailUrls(text: string, source: NewsSource): string[] {
  const items = jsonLd(text).filter(x=>x["@type"] === "ItemList").flatMap(x=>Array.isArray(x.itemListElement) ? x.itemListElement : []);
  return [...new Set(items.map(x=>newsUrl(x?.url,source)).filter((x): x is string=>x!==null))].slice(0,NEWS_POLICY.detailPages);
}
async function newsDocument(url: string, signal: AbortSignal): Promise<string> {
  const response = await fetch(url,{ signal, redirect:"manual", headers: { "User-Agent":"cmc-top300-mcp/1.0 (+https://github.com/freddygorski-debug/cmc-top300-mcp)", Accept:"application/rss+xml, application/xml, text/html" } });
  if (!response.ok || !response.body) throw new Error("Publication request failed");
  const reader=response.body.getReader(), chunks:Uint8Array[]=[];
  let total=0;
  try {
    while (true) {
      const part=await reader.read(); if (part.done) break;
      total+=part.value.byteLength;
      if (total>NEWS_POLICY.maxBytes) throw new Error("Publication document too large");
      chunks.push(part.value);
    }
  } finally { await reader.cancel().catch(()=>undefined); }
  const bytes=new Uint8Array(total); let offset=0;
  for (const chunk of chunks) { bytes.set(chunk,offset); offset+=chunk.byteLength; }
  return new TextDecoder().decode(bytes);
}
export async function lookupNews(storage: NewsStorage, id: number, symbol: string, now: number): Promise<NewsEvidence> {
  const source=NEWS_SOURCES.find(x=>x.id===id && x.symbol===symbol);
  const checked_at=new Date(now).toISOString();
  if (!source) return {status:"unsupported",checked_at};
  const key=`news:${id}`;
  const cached=await storage.get<NewsEvidence>(key);
  if (cached && now-Date.parse(cached.checked_at)>=0 && now-Date.parse(cached.checked_at)<NEWS_POLICY.cacheMs) {
    if (cached.publication && now-Date.parse(cached.publication.published_at)>NEWS_POLICY.recentMs) return {...cached,status:"no_recent_publication",publication:undefined};
    return cached;
  }
  const signal=AbortSignal.timeout(NEWS_POLICY.timeoutMs);
  let result:NewsEvidence;
  try {
    const text=await newsDocument(source.url,signal);
    let publications:Publication[], limit:number;
    if (source.format === "jsonld") {
      const urls=detailUrls(text,source);
      if (!urls.length) throw new Error("Publication index unavailable");
      const pages=await Promise.all(urls.map(url=>newsDocument(url,signal)));
      publications=pages.flatMap(page=>parsePublications(page,source)); limit=urls.length;
    } else { publications=parsePublications(text,source); limit=NEWS_POLICY.maxItems; }
    if (!publications.length) { result={status:"unavailable",checked_at,source:source.name,failure:"format"}; }
    else {
      const recent=publications.filter(x=>Date.parse(x.published_at)<=now && now-Date.parse(x.published_at)<=NEWS_POLICY.recentMs)
        .sort((a,b)=>Date.parse(b.published_at)-Date.parse(a.published_at))[0];
      result={status:recent?"recent_publication":"no_recent_publication",checked_at,source:source.name,aggregator:source.aggregator,publication:recent,inspected:publications.length,limit};
    }
  } catch { result={status:"unavailable",checked_at,source:source.name,failure:signal.aborted?"timeout":"request"}; }
  await storage.put(key,result);
  return result;
}
export function newsMessage(evidence: NewsEvidence): string {
  const p=evidence.publication;
  if (evidence.status === "recent_publication" && p) {
    const day=new Intl.DateTimeFormat("fr-FR",{timeZone:"Europe/Paris",dateStyle:"short"}).format(new Date(p.published_at));
    return `Actualité : ${p.title} (${day}, ${evidence.source}). ${p.url}\nLien avec la hausse non établi ; publication ${evidence.aggregator?"relayée par l’écosystème":"sur une source officielle"}, pas une confirmation d’achat.`;
  }
  if (evidence.status === "no_recent_publication") return `Catalyseur : aucun récent vérifié dans les publications consultées (${evidence.source}, ${evidence.inspected} articles, fenêtre 72 h).`;
  if (evidence.status === "unavailable") return `Catalyseur : recherche indisponible (${evidence.source}) ; non vérifié.`;
  return "Catalyseur : non vérifié ; aucune source automatique configurée pour cet actif.";
}
