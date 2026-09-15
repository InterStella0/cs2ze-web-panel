import type { FastifyInstance } from "fastify";
import { workshopIdLike, type WorkshopItem } from "@cs2ze/shared";
import { requireOperator, firstIssue } from "./access.js";

const DETAILS_URL = "https://api.steampowered.com/ISteamRemoteStorage/GetPublishedFileDetails/v1/";
const COLLECTION_URL = "https://api.steampowered.com/ISteamRemoteStorage/GetCollectionDetails/v1/";

interface SteamDetail {
  publishedfileid?: string;
  result?: number;
  title?: string;
  description?: string;
  preview_url?: string;
  file_size?: string | number;
  time_updated?: number;
}

function suggestedName(title: string, id: string): string {
  const explicit = title.match(/\b((?:ze|zm|de|cs|surf)_[A-Za-z0-9_-]+)\b/i)?.[1];
  if (explicit) return explicit.slice(0, 64);
  const normalized = title.toLowerCase().replace(/[^a-z0-9_-]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 61);
  return normalized ? `ze_${normalized}`.slice(0, 64) : `ze_${id}`.slice(0, 64);
}

async function steamPost<T>(url: string, body: URLSearchParams): Promise<T> {
  const response = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body,
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) throw Object.assign(new Error(`Steam Workshop returned HTTP ${response.status}`), { statusCode: 502 });
  return response.json() as Promise<T>;
}

export async function fetchWorkshopItems(ids: string[]): Promise<WorkshopItem[]> {
  if (!ids.length) return [];
  const body = new URLSearchParams({ itemcount: String(ids.length) });
  ids.forEach((id, index) => body.set(`publishedfileids[${index}]`, id));
  const data = await steamPost<{ response?: { publishedfiledetails?: SteamDetail[] } }>(DETAILS_URL, body);
  return (data.response?.publishedfiledetails ?? []).filter((item) => item.result === 1 && item.publishedfileid && item.title).map((item) => ({
    id: item.publishedfileid!,
    title: item.title!,
    description: item.description?.slice(0, 2_000) || null,
    previewUrl: item.preview_url || null,
    fileSize: item.file_size === undefined ? null : Number(item.file_size),
    timeUpdated: item.time_updated ?? null,
    suggestedMapName: suggestedName(item.title!, item.publishedfileid!),
  }));
}

export async function registerWorkshopRoutes(app: FastifyInstance): Promise<void> {
  app.get<{ Params: { id: string } }>("/api/workshop/:id", async (request, reply) => {
    if (!requireOperator(request, reply)) return;
    const parsed = workshopIdLike.safeParse(request.params.id);
    if (!parsed.success) return reply.code(400).send({ error: firstIssue(parsed, "Invalid workshop ID") });
    const items = await fetchWorkshopItems([String(parsed.data)]);
    if (!items[0]) return reply.code(404).send({ error: "Workshop item not found or not publicly accessible" });
    return items[0];
  });

  app.get<{ Params: { id: string } }>("/api/workshop/collection/:id", async (request, reply) => {
    if (!requireOperator(request, reply)) return;
    const parsed = workshopIdLike.safeParse(request.params.id);
    if (!parsed.success) return reply.code(400).send({ error: firstIssue(parsed, "Invalid collection ID") });
    const body = new URLSearchParams({ collectioncount: "1", "publishedfileids[0]": String(parsed.data) });
    const data = await steamPost<{ response?: { collectiondetails?: Array<{ result?: number; children?: Array<{ publishedfileid?: string }> }> } }>(COLLECTION_URL, body);
    const collection = data.response?.collectiondetails?.[0];
    if (collection?.result !== 1) return reply.code(404).send({ error: "Workshop collection not found or not publicly accessible" });
    const ids = (collection.children ?? []).map((child) => child.publishedfileid).filter((id): id is string => Boolean(id)).slice(0, 100);
    return { id: String(parsed.data), items: await fetchWorkshopItems(ids) };
  });
}
