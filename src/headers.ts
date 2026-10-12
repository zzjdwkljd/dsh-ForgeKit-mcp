// headers.ts - request-header policy: validation, safe defaults and
// fingerprint-consistency derivation. Pure functions (no browser objects) so
// every rule stays unit-testable and easy to read.
//
// Three layers, merged in this order:
//   1. browser-native defaults -- Chrome's own headers whenever we override
//      nothing. This is the fallback: the unmodified browser header set,
//      so we never fabricate Accept / sec-fetch-* / Accept-Encoding ourselves.
//   2. consistency (derived) layer -- headers generated from a custom
//      User-Agent as a best-effort compatibility mapping. A custom UA does not reproduce an entire browser or hardware environment.
//   3. user custom layer -- validated, then merged on top.

// ---------- public types ----------

/** A plain header map as callers supply it (names are case-insensitive). */
export type HeaderMap = Record<string, string>;

/** Where an effective header value comes from. */
export type HeaderSource = 'browser-default' | 'derived' | 'custom';

/** One header of the effective policy, with provenance for readability. */
export interface HeaderEntry {
  name: string;
  value: string;
  source: HeaderSource;
}

/** A header the validator refused, with the reason. */
export interface RejectedHeader {
  name: string;
  value: string;
  reason: string;
}

export interface ValidationResult {
  /** Headers accepted after validation (trimmed names, casing preserved). */
  accepted: HeaderMap;
  /** Headers refused; never silently dropped. */
  rejected: RejectedHeader[];
  /** Soft guidance notes (e.g. headers the browser manages better). */
  notes: string[];
}

/** UA-CH brand/version pair, shape of `sec-ch-ua` and CDP userAgentMetadata. */
export interface BrandVersion {
  brand: string;
  version: string;
}

/** CDP `Emulation.setUserAgentOverride.userAgentMetadata` shape. */
export interface UserAgentMetadata {
  brands: BrandVersion[];
  fullVersionList: BrandVersion[];
  platform: string;
  platformVersion: string;
  architecture: string;
  bitness: string;
  model: string;
  mobile: boolean;
  wow64: boolean;
}

/** What we can read out of a User-Agent string. */
export interface UaProfile {
  browser: 'chrome' | 'edge' | 'opera' | 'unknown';
  chromeFullVersion: string;
  chromeMajor: string;
  /** UA-CH platform: Windows / macOS / Linux / Android / iOS / Unknown. */
  platform: string;
  /** navigator.platform-style value, kept consistent with the UA string. */
  navigatorPlatform: string;
  mobile: boolean;
  /** Parsed platform version for UA-CH metadata (best effort). */
  platformVersion: string;
  architecture: string;
  bitness: string;
  wow64: boolean;
}

export interface ConsistencyResult {
  /** Derived headers (only fields the user did NOT set themselves). */
  derived: HeaderMap;
  /** UA-CH metadata for the CDP layer; null when no UA override is active. */
  metadata: UserAgentMetadata | null;
  notes: string[];
}

// ---------- validation ----------

/** RFC 7230 token = allowed header-name characters. */
const HEADER_NAME_RE = /^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/;
/** Control characters are never legal in a header value (injection guard). */
const CONTROL_CHARS_RE = /[\u0000-\u001F\u007F]/;
const MAX_NAME_LENGTH = 128;
const MAX_VALUE_LENGTH = 4096;

/**
 * Headers that frame the HTTP message or are owned by the network stack.
 * Overriding these can break HTTP framing or browser-managed invariants.
 */
const FRAMING_HEADERS: ReadonlySet<string> = new Set([
  'connection',
  'content-length',
  'host',
  'keep-alive',
  'proxy-connection',
  'te',
  'trailer',
  'transfer-encoding',
  'upgrade',
]);

/** Protocol-level pseudo/websocket headers (HTTP/2, WS handshake). */
const DANGEROUS_PREFIXES: readonly string[] = [':', 'proxy-', 'sec-websocket-'];

/** Allowed but discouraged: the browser manages them better than we can. */
const DISCOURAGED: ReadonlyMap<string, string> = new Map([
  ['cookie', 'Cookie 由浏览器 Cookie 罐管理，直接设置会与已存登录态叠加；导入请用 browser_load_state'],
  ['referer', 'Referer 由浏览器按导航自动填写，显式设置可能被忽略或造成不一致'],
  ['origin', 'Origin 由浏览器自动填写，显式设置可能被忽略'],
]);

/**
 * Validate a user-supplied header map. Never silently drops anything: bad
 * entries land in `rejected` with a human-readable reason, soft problems in
 * `notes`.
 */
export function validateHeaders(input: HeaderMap): ValidationResult {
  const accepted: HeaderMap = Object.create(null);
  const names = new Set<string>();
  const rejected: RejectedHeader[] = [];
  const notes: string[] = [];

  for (const [rawName, rawValue] of Object.entries(input)) {
    const name = rawName.trim();
    const lower = name.toLowerCase();

    if (!name || name.length > MAX_NAME_LENGTH || !HEADER_NAME_RE.test(name)) {
      rejected.push({ name: rawName, value: rawValue, reason: '请求头名称不是合法的 RFC 7230 token' });
      continue;
    }
    if (typeof rawValue !== 'string') {
      rejected.push({ name: rawName, value: String(rawValue), reason: '请求头值必须是字符串' });
      continue;
    }
    if (CONTROL_CHARS_RE.test(rawValue)) {
      rejected.push({ name: rawName, value: rawValue, reason: '请求头值含控制字符（拒绝，防请求头注入）' });
      continue;
    }
    if (rawValue.length > MAX_VALUE_LENGTH) {
      rejected.push({ name: rawName, value: rawValue, reason: `请求头值超过 ${MAX_VALUE_LENGTH} 字符` });
      continue;
    }
    if (FRAMING_HEADERS.has(lower) || DANGEROUS_PREFIXES.some((p) => lower.startsWith(p))) {
      rejected.push({ name: rawName, value: rawValue, reason: '该请求头由 HTTP 协议/浏览器掌控，覆盖会破坏 HTTP 协议或浏览器约束' });
      continue;
    }

    if (names.has(lower)) {
      rejected.push({ name: rawName, value: rawValue, reason: '重复请求头名称（大小写不区分）' });
      continue;
    }
    names.add(lower);
    accepted[name] = rawValue;
    const advice = DISCOURAGED.get(lower);
    if (advice) notes.push(`${name}: ${advice}`);
  }

  return { accepted, rejected, notes };
}

/** Case-insensitive header lookup. */
export function getHeader(map: HeaderMap, name: string): string | undefined {
  const lower = name.toLowerCase();
  for (const [k, v] of Object.entries(map)) {
    if (k.toLowerCase() === lower) return v;
  }
  return undefined;
}

/** True when the map defines the header (case-insensitive). */
export function hasHeader(map: HeaderMap, name: string): boolean {
  return getHeader(map, name) !== undefined;
}

// ---------- User-Agent parsing ----------

const RE_CHROME_FULL = /Chrome\/([\d.]+)/;
const RE_EDGE = /Edg(?:e|A|iOS)?\/([\d.]+)/;
const RE_OPERA = /OPR\/([\d.]+)/;
const RE_MAC_OS = /Mac OS X (\d+)[._](\d+)[._]?(\d+)?/;
const RE_ANDROID = /Android (\d+)[._]?(\d+)?/;
const RE_IOS = /OS (\d+)_(\d+)_?(\d+)?/;

/**
 * Parse a User-Agent string into the fields needed for consistent headers
 * and UA-CH metadata. Returns null for values that are not Chromium-based.
 */
export function parseUserAgent(ua: string): UaProfile | null {
  const chromeMatch = RE_CHROME_FULL.exec(ua);
  if (!chromeMatch || !chromeMatch[1]) return null; // UA-CH only exists on Chromium

  const chromeFullVersion = chromeMatch[1];
  const chromeMajor = chromeFullVersion.split('.')[0] ?? chromeFullVersion;

  const edgeMatch = RE_EDGE.exec(ua);
  const operaMatch = RE_OPERA.exec(ua);
  const browser: UaProfile['browser'] = operaMatch ? 'opera' : edgeMatch ? 'edge' : 'chrome';

  const mobile = /Mobile/.test(ua);
  let platform = 'Unknown';
  let navigatorPlatform = 'Linux x86_64';
  let platformVersion = '0.0.0';
  if (/Windows/.test(ua)) {
    platform = 'Windows';
    navigatorPlatform = 'Win32';
    platformVersion = '10.0.0'; // UA reports NT 10.0 for both Win10 and Win11
  } else if (/Macintosh|Mac OS X/.test(ua)) {
    platform = 'macOS';
    navigatorPlatform = 'MacIntel';
    const m = RE_MAC_OS.exec(ua);
    platformVersion = m ? `${m[1] ?? '10'}.${m[2] ?? '15'}.${m[3] ?? '7'}` : '10.15.7';
  } else if (/Android/.test(ua)) {
    platform = 'Android';
    navigatorPlatform = 'Linux armv8l';
    const m = RE_ANDROID.exec(ua);
    platformVersion = m ? `${m[1] ?? '10'}.0.0` : '10.0.0';
  } else if (/iPhone|iPad|iPod/.test(ua)) {
    platform = 'iOS';
    navigatorPlatform = /iPad/.test(ua) ? 'iPad' : 'iPhone';
    const m = RE_IOS.exec(ua);
    platformVersion = m ? `${m[1] ?? '17'}.${m[2] ?? '0'}.${m[3] ?? '0'}` : '17.0.0';
  } else if (/Linux|X11|CrOS/.test(ua)) {
    platform = 'Linux';
    navigatorPlatform = 'Linux x86_64';
    platformVersion = '0.0.0';
  }

  const wow64 = /WOW64/.test(ua);
  const architecture = /arm|aarch64/i.test(ua) ? 'arm' : 'x86';
  const bitness = /Win64|x64|arm64|aarch64|WOW64/i.test(ua) ? (wow64 ? '32' : '64') : '32';

  return {
    browser,
    chromeFullVersion,
    chromeMajor,
    platform,
    navigatorPlatform,
    mobile,
    platformVersion,
    architecture,
    bitness,
    wow64,
  };
}

// ---------- consistency derivation ----------

/**
 * Grease brand rotation (approximation). Real Chrome rotates a fake brand
 * such as "Not A;Brand" / "Not)A;Brand" with the milestone; we rotate
 * deterministically by major version. Callers who need byte-exact values can
 * pass `sec-ch-ua` explicitly -- user values always win.
 */
const GREASE_BRANDS: readonly string[] = ['Not A;Brand', 'Not_A Brand', 'Not)A;Brand'];
const GREASE_VERSIONS: readonly string[] = ['8', '24', '99'];

function browserBrand(profile: UaProfile): BrandVersion {
  const name =
    profile.browser === 'edge' ? 'Microsoft Edge' : profile.browser === 'opera' ? 'Opera' : 'Google Chrome';
  return { brand: name, version: profile.chromeMajor };
}

function greaseBrand(profile: UaProfile): BrandVersion {
  const idx = Number.parseInt(profile.chromeMajor, 10) || 0;
  return {
    brand: GREASE_BRANDS[idx % GREASE_BRANDS.length] ?? 'Not A;Brand',
    version: GREASE_VERSIONS[idx % GREASE_VERSIONS.length] ?? '8',
  };
}

function secChUaString(brands: BrandVersion[]): string {
  return brands.map((b) => `"${b.brand}";v="${b.version}"`).join(', ');
}

/**
 * Derive the consistency layer from the user's custom headers. Only fields the
 * user left unset are produced -- explicit values always win. When the user
 * does not override User-Agent the result is empty: the browser's native
 * headers should remain untouched, so there is nothing to add.
 */
export function deriveConsistency(headers: HeaderMap, locale: string): ConsistencyResult {
  const notes: string[] = [];
  const uaValue = getHeader(headers, 'user-agent');

  if (!uaValue) {
    if (hasHeader(headers, 'sec-ch-ua') || hasHeader(headers, 'sec-ch-ua-platform')) {
      notes.push(
        '设置了 sec-ch-ua 系列头但未覆盖 user-agent：请求头与 navigator.userAgentData 可能不一致，建议一并设置 user-agent',
      );
    }
    return { derived: {}, metadata: null, notes };
  }

  if (Object.keys(headers).some((name) => name.toLowerCase().startsWith('sec-ch-ua'))) {
    notes.push('显式 Client Hints 请求头可能与按 UA 派生的 JS 元数据不一致；自定义值仍优先，不作一致性保证');
  }
  const profile = parseUserAgent(uaValue);
  if (!profile) {
    notes.push(`无法解析 User-Agent（非 Chromium 内核）：${uaValue}；仅原样发送，不派生 sec-ch-ua（自定义 UA 字符串不改变实际浏览器内核）`);
    return { derived: {}, metadata: null, notes };
  }

  const browser = browserBrand(profile);
  const grease = greaseBrand(profile);
  const brands: BrandVersion[] = [grease, { brand: 'Chromium', version: profile.chromeMajor }, browser];
  const fullVersionList: BrandVersion[] = [
    { brand: grease.brand, version: grease.version },
    { brand: 'Chromium', version: profile.chromeFullVersion },
    { brand: browser.brand, version: profile.chromeFullVersion },
  ];

  const derived: HeaderMap = {};
  if (!hasHeader(headers, 'sec-ch-ua')) derived['sec-ch-ua'] = secChUaString(brands);
  if (!hasHeader(headers, 'sec-ch-ua-mobile')) derived['sec-ch-ua-mobile'] = profile.mobile ? '?1' : '?0';
  if (!hasHeader(headers, 'sec-ch-ua-platform')) derived['sec-ch-ua-platform'] = `"${profile.platform}"`;
  if (!hasHeader(headers, 'sec-ch-ua-full-version-list')) {
    derived['sec-ch-ua-full-version-list'] = secChUaString(fullVersionList);
  }

  notes.push(`已按 User-Agent 派生 ${Object.keys(derived).length} 个兼容性请求头（sec-ch-ua 家族）；属于尽力映射，不代表完整浏览器身份`);

  const metadata: UserAgentMetadata = {
    brands,
    fullVersionList,
    platform: profile.platform,
    platformVersion: profile.platformVersion,
    architecture: profile.architecture,
    bitness: profile.bitness,
    model: '',
    mobile: profile.mobile,
    wow64: profile.wow64,
  };

  if (locale && !hasHeader(headers, 'accept-language')) {
    notes.push(`Accept-Language 未自定义，沿用浏览器 locale（${locale}）原生值`);
  }

  return { derived, metadata, notes };
}

/**
 * Merge layers with custom > derived > native. Returns every effective header
 * with its provenance so callers can show a readable policy table.
 */
export function buildEffective(
  custom: HeaderMap,
  derived: HeaderMap,
  nativeFallback: ReadonlyMap<string, string> = new Map(),
): HeaderEntry[] {
  const entries = new Map<string, HeaderEntry>();
  const put = (name: string, value: string, source: HeaderSource): void => {
    entries.set(name.toLowerCase(), { name, value, source });
  };
  for (const [n, v] of nativeFallback) put(n, v, 'browser-default');
  for (const [n, v] of Object.entries(derived)) put(n, v, 'derived');
  for (const [n, v] of Object.entries(custom)) put(n, v, 'custom');
  return [...entries.values()].sort((a, b) => a.name.localeCompare(b.name));
}

// ---------- Accept-Language helpers ----------

/**
 * Strip q-weights from an Accept-Language value, returning the bare language
 * list ("zh-CN,zh;q=0.9" -> "zh-CN,zh"). CDP's Emulation.acceptLanguage wants
 * exactly this: it re-generates canonical q values itself, so passing a
 * pre-weighted string corrupts the header ("...;q=0.9;q=0.9").
 */
export function toBareLanguageList(acceptLanguage: string): string {
  return acceptLanguage
    .split(',')
    .map((part) => part.split(';')[0]?.trim() ?? '')
    .filter((tag) => tag.length > 0)
    .join(',');
}

/**
 * Expand a locale into a natural language list ("zh-CN" -> "zh-CN,zh"), the
 * shape a real Chrome sends. Used when the user customizes neither
 * Accept-Language nor User-Agent's implied locale.
 */
export function localeToLanguageList(locale: string): string {
  const primary = locale.trim();
  if (!primary) return 'en-US';
  const base = primary.split('-')[0] ?? primary;
  return base === primary ? primary : `${primary},${base}`;
}
