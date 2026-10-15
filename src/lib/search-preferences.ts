import { parseQuery } from "./domain";
import type { Query } from "./types";

export type SearchConditions = Pick<Query, "nickname" | "startDate" | "endDate" | "mode" | "characterCodes">;
export const RECENT_KEY = "er-insight:recent:v1";
export const SAVED_KEY = "er-insight:saved:v1";
export const MAX_CONDITIONS = 5;
export const QUICK_DAYS = [7, 30, 90] as const;
const KST_OFFSET = 9 * 60 * 60 * 1000;

export function queryParams(query: Query): URLSearchParams {
  const params = new URLSearchParams({ nickname: query.nickname, startDate: query.startDate, endDate: query.endDate, mode: query.mode, page: String(query.page), pageSize: String(query.pageSize) });
  if (query.characterCodes.length) params.set("characterCodes", [...new Set(query.characterCodes)].sort((a, b) => a - b).join(","));
  return params;
}

export function normalizeConditions(value: unknown): SearchConditions | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const input = value as Record<string, unknown>;
  if (typeof input.nickname !== "string" || typeof input.startDate !== "string" || typeof input.endDate !== "string" || typeof input.mode !== "string" || !["all", "normal", "ranked"].includes(input.mode) || !Array.isArray(input.characterCodes) || input.characterCodes.length > 100 || input.characterCodes.some(code => !Number.isSafeInteger(code) || code <= 0)) return null;
  try {
    const parsed = parseQuery(queryParams({ nickname: input.nickname, startDate: input.startDate, endDate: input.endDate, mode: input.mode as Query["mode"], characterCodes: input.characterCodes, page: 1, pageSize: 20 }));
    return { nickname: parsed.nickname, startDate: parsed.startDate, endDate: parsed.endDate, mode: parsed.mode, characterCodes: parsed.characterCodes };
  } catch { return null; }
}

export function conditionsKey(value: SearchConditions): string {
  const normalized = normalizeConditions(value);
  return JSON.stringify(normalized ?? value);
}

export function rememberCondition(list: SearchConditions[], value: SearchConditions): SearchConditions[] {
  const normalized = normalizeConditions(value);
  if (!normalized) return list;
  const key = conditionsKey(normalized);
  return [normalized, ...list.filter(item => conditionsKey(item) !== key)].slice(0, MAX_CONDITIONS);
}

export function decodeConditions(raw: string | null): SearchConditions[] {
  if (!raw || raw.length > 65536) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    const result: SearchConditions[] = [];
    const seen = new Set<string>();
    for (const item of parsed.slice(0, 100)) {
      const condition = normalizeConditions(item);
      if (!condition) continue;
      const key = conditionsKey(condition);
      if (!seen.has(key)) { result.push(condition); seen.add(key); }
      if (result.length === MAX_CONDITIONS) break;
    }
    return result;
  } catch { return []; }
}

export interface ConditionStorage { getItem(key: string): string | null; setItem(key: string, value: string): void }
export function readConditions(storage: ConditionStorage, key: string): SearchConditions[] {
  try { return decodeConditions(storage.getItem(key)); } catch { return []; }
}
export function writeConditions(storage: ConditionStorage, key: string, list: SearchConditions[]): boolean {
  try { storage.setItem(key, JSON.stringify(list)); return true; } catch { return false; }
}

export function quickPeriod(days: (typeof QUICK_DAYS)[number], nowMs = Date.now()): { startDate: string; endDate: string } {
  const kstDay = new Date(nowMs + KST_OFFSET).toISOString().slice(0, 10);
  const startDate = new Date(Date.parse(`${kstDay}T00:00:00.000Z`) - (days - 1) * 86400000).toISOString().slice(0, 10);
  return { startDate, endDate: kstDay };
}
export function activeQuickPeriod(startDate: string, endDate: string, nowMs = Date.now()): number | null {
  return QUICK_DAYS.find(days => { const period = quickPeriod(days, nowMs); return period.startDate === startDate && period.endDate === endDate; }) ?? null;
}
export function shareUrl(origin: string, pathname: string, applied: Query): string {
  const query = parseQuery(queryParams(applied));
  const url = new URL(pathname, origin);
  url.search = queryParams(query).toString();
  return url.toString();
}
