import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS, SettingsSchema, parseStoredSettings, shouldFilter, isAllowlisted, type Verdict } from '../src/shared/contracts';
import { isSensitivePage, normalizeEndpoint, normalizeDomain, publicContentUrl } from '../src/shared/security';

const verdict: Verdict = { id:'x', category:'ai-slop', confidence:.9, reasons:['Repetitive content'], signals:{lowQuality:.9,synthetic:.9,clickbait:.1}, evidence:{text:true,thumbnail:false,destination:false}, model:'test' };
describe('filtering policy', () => {
  it('requires confidence and the matching filter to be enabled', () => {
    expect(shouldFilter(verdict, DEFAULT_SETTINGS)).toBe(true);
    expect(shouldFilter(verdict, {...DEFAULT_SETTINGS,aiSlop:false})).toBe(false);
    expect(shouldFilter(verdict, {...DEFAULT_SETTINGS,threshold:.95})).toBe(false);
    expect(shouldFilter(verdict, {...DEFAULT_SETTINGS,enabled:false})).toBe(false);
    expect(shouldFilter({...verdict,category:'uncertain',confidence:1},DEFAULT_SETTINGS)).toBe(false);
    expect(shouldFilter({...verdict,category:'quality',confidence:1},DEFAULT_SETTINGS)).toBe(false);
  });
  it('does not enable network processing before consent', () => expect(DEFAULT_SETTINGS.consent).toBe(false));
  it('normalizes older image-analysis preferences to text-only', () => {
    expect(DEFAULT_SETTINGS.inspectThumbnails).toBe(false);
    expect(SettingsSchema.parse({...DEFAULT_SETTINGS,inspectThumbnails:true}).inspectThumbnails).toBe(false);
  });
  it('filters unknown-authorship slop only with both categories enabled', () => {
    expect(shouldFilter({...verdict,category:'slop'},DEFAULT_SETTINGS)).toBe(true);
    expect(shouldFilter({...verdict,category:'slop'},{...DEFAULT_SETTINGS,aiSlop:false})).toBe(false);
    expect(shouldFilter({...verdict,category:'slop'},{...DEFAULT_SETTINGS,humanSlop:false})).toBe(false);
  });
  it('rejects corrupted settings', () => {
    expect(SettingsSchema.safeParse({threshold:1.1}).success).toBe(false);
    expect(SettingsSchema.safeParse({mode:'delete'}).success).toBe(false);
  });
  it('uses direct mode for fresh settings and preserves the legacy server route', () => {
    expect(parseStoredSettings(undefined)).toMatchObject({connectionMode:'direct',inspectDestinations:false,consent:false});
    expect(parseStoredSettings({})).toMatchObject({connectionMode:'direct',consent:false});
    expect(parseStoredSettings({consent:true,endpoint:'https://my-detector.example',serviceToken:'existing'})).toMatchObject({connectionMode:'server',consent:true,inspectDestinations:true,serviceToken:'existing'});
    expect(parseStoredSettings({consent:true,threshold:5})).toMatchObject({connectionMode:'direct',consent:false});
    expect(parseStoredSettings({connectionMode:'direct',consent:false})).toMatchObject({connectionMode:'direct',inspectDestinations:false});
  });
  it('matches whole domain boundaries, including subdomains', () => {
    expect(isAllowlisted('www.Example.com',['example.com'])).toBe(true);
    expect(isAllowlisted('evilexample.com',['example.com'])).toBe(false);
    expect(isAllowlisted('example.com.evil.org',['example.com'])).toBe(false);
  });
});
describe('service and browsing privacy', () => {
  it('allows HTTPS hosted services and loopback development only', () => {
    expect(normalizeEndpoint('https://api.example.com/')).toBe('https://api.example.com');
    expect(normalizeEndpoint('http://localhost:8787')).toBe('http://localhost:8787');
    for (const url of ['http://example.com','https://a:b@example.com','https://example.com?key=x','javascript:alert(1)']) expect(() => normalizeEndpoint(url)).toThrow();
  });
  it('normalizes domains but rejects addresses with paths or credentials', () => {
    expect(normalizeDomain('*.EXAMPLE.com')).toBe('example.com');
    for (const value of ['https://example.com','me@example.com','example.com/path']) expect(() => normalizeDomain(value)).toThrow();
  });
  it('strips fragments and query secrets from destination URLs', () => {
    expect(publicContentUrl('https://example.com/article?access_token=secret#private')).toBe('https://example.com/article');
    expect(publicContentUrl('https://www.youtube.com/watch?v=abcdefghijk&utm_source=x')).toBe('https://www.youtube.com/watch?v=abcdefghijk');
    expect(publicContentUrl('https://user:pass@example.com')).toBeUndefined();
    expect(publicContentUrl('https://www.google.com/url?url=https%3A%2F%2Fexample.com%2Farticle%3Faccess_token%3Dsecret')).toBe('https://example.com/article');
    expect(publicContentUrl('https://www.google.com/url?url=javascript%3Aalert(1)')).toBeUndefined();
  });
  it('excludes mail, private messages, intranet and account pages', () => {
    for (const value of ['https://mail.google.com/mail/u/0/','https://x.com/messages/1','https://instagram.com/direct/inbox','https://shop.com/checkout','http://192.168.1.1','http://intranet','https://foo.slack.com/']) expect(isSensitivePage(value)).toBe(true);
    for (const value of ['https://www.youtube.com/','https://www.google.com/search?q=test','https://example.com/articles/good-work','https://x.com/home']) expect(isSensitivePage(value)).toBe(false);
  });
  it('recognizes encoded private routes and local-network hostnames', () => {
    for (const value of ['https://x.com/m%65ssages/1','https://instagram.com/%2564irect/inbox','https://user:pass@example.com/article','http://printer.office.local/','https://portal.company.internal/','http://100.80.1.1/']) expect(isSensitivePage(value)).toBe(true);
  });
  it('keeps Google opaque destination metadata only when destination inspection is allowed', () => {
    const opaque='https://www.google.com/goto?url=ABCD_0123-efgh&tracking=secret#fragment';
    expect(publicContentUrl(opaque)).toBe('https://www.google.com/goto?url=ABCD_0123-efgh');
    expect(publicContentUrl(opaque,false)).toBeUndefined();
    expect(publicContentUrl('https://www.google.com/goto?url='+('a'.repeat(1501)))).toBeUndefined();
    expect(publicContentUrl('https://example.com/goto?url=ABCD_0123-efgh')).toBe('https://example.com/goto');
  });
});
