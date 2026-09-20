import { z } from 'zod';

export const PlatformSchema = z.enum(['youtube', 'google', 'instagram', 'facebook', 'tiktok', 'x', 'reddit', 'forum', 'generic']);
export type Platform = z.infer<typeof PlatformSchema>;
export const ContentItemSchema = z.object({
  id: z.string().min(1).max(120), platform: PlatformSchema,
  kind: z.enum(['video', 'search', 'post', 'comment', 'paragraph']),
  title: z.string().max(600), text: z.string().max(6000),
  url: z.string().url().max(2000).optional(),
  thumbnailUrl: z.string().url().max(2000).optional(),
  context: z.string().max(1500).optional(),
}).strict();
export type ContentItem = z.infer<typeof ContentItemSchema>;
export const VerdictSchema = z.object({
  id: z.string(),
  category: z.enum(['ai-slop', 'human-slop', 'slop', 'quality', 'uncertain']),
  confidence: z.number().min(0).max(1),
  reasons: z.array(z.string().max(200)).max(6),
  signals: z.object({ lowQuality: z.number().min(0).max(1), synthetic: z.number().min(0).max(1), clickbait: z.number().min(0).max(1) }),
  evidence: z.object({ text: z.boolean(), thumbnail: z.boolean(), destination: z.boolean() }),
  model: z.string(),
});
export type Verdict = z.infer<typeof VerdictSchema>;
// Normalize the legacy preference too: existing installs must stop image work
// on upgrade, rather than silently keeping their previously saved `true` value.
const TextOnlyThumbnailSetting = z.boolean().default(false).transform((): boolean => false);
export const AnalyzeRequestSchema = z.object({ items: z.array(ContentItemSchema).min(1).max(8), inspectThumbnails: TextOnlyThumbnailSetting, inspectDestinations: z.boolean().default(false) }).strict();
export const AnalyzeResponseSchema = z.object({ verdicts: z.array(VerdictSchema), errors: z.array(z.object({ id: z.string(), message: z.string() })).default([]) });
export type AnalyzeResponse = z.infer<typeof AnalyzeResponseSchema>;
export const AnalysisDeferredSchema = z.object({
  status: z.literal('deferred'),
  reason: z.enum(['pacing', 'rate-limit', 'busy']),
  retryAfterMs: z.number().int().min(1).max(3_600_000),
});

export const SettingsSchema = z.object({
  enabled: z.boolean().default(true), aiSlop: z.boolean().default(true), humanSlop: z.boolean().default(true),
  mode: z.enum(['censor', 'hide']).default('censor'), threshold: z.number().min(0.6).max(0.99).default(0.85),
  animations: z.boolean().default(true), annotateParagraphs: z.boolean().default(true),
  inspectThumbnails: TextOnlyThumbnailSetting, inspectDestinations: z.boolean().default(true),
  endpoint: z.string().max(2048).default('http://localhost:8787'),
  serviceToken: z.string().max(500).default(''), consent: z.boolean().default(false),
  allowlist: z.array(z.string().max(253)).max(500).default([]),
  platforms: z.record(PlatformSchema, z.boolean()).default({ youtube:true, google:true, instagram:true, facebook:true, tiktok:true, x:true, reddit:true, forum:true, generic:true }),
});
export type Settings = z.infer<typeof SettingsSchema>;
export const DEFAULT_SETTINGS: Settings = SettingsSchema.parse({});

export interface PageStats { scanned: number; filtered: number; uncertain: number; status: 'idle'|'scanning'|'waiting'|'ready'|'error'|'paused'; error?: string; }
export const EMPTY_STATS: PageStats = { scanned:0, filtered:0, uncertain:0, status:'idle' };
export type RuntimeMessage =
  | { type:'GET_SETTINGS' }
  | { type:'SAVE_SETTINGS'; settings:Partial<Settings> }
  | { type:'ANALYZE'; items:ContentItem[] }
  | { type:'GET_TAB_STATE' }
  | { type:'PAGE_STATS'; stats:PageStats }
  | { type:'RESTORE_PAGE' }
  | { type:'RESCAN_PAGE' }
  | { type:'SETTINGS_CHANGED'; settings:Settings }
  | { type:'HEALTH_CHECK' };

export function shouldFilter(verdict: Verdict, settings: Settings): boolean {
  return settings.enabled && verdict.confidence >= settings.threshold &&
    ((verdict.category === 'ai-slop' && settings.aiSlop) || (verdict.category === 'human-slop' && settings.humanSlop) || (verdict.category === 'slop' && settings.aiSlop && settings.humanSlop));
}
export function isAllowlisted(hostname: string, entries: string[]): boolean {
  const host = hostname.toLowerCase().replace(/\.$/, '');
  return entries.some(entry => host === entry || host.endsWith(`.${entry}`));
}
