import type { BrowserContext } from 'playwright-core';
import { z } from 'zod';

const Cookie = z.object({
  name: z.string(), value: z.string(), domain: z.string().min(1), path: z.string().startsWith('/'),
  expires: z.number().finite().min(-1), httpOnly: z.boolean(), secure: z.boolean(),
  sameSite: z.enum(['Strict', 'Lax', 'None']), partitionKey: z.string().optional(),
});
const Origin = z.object({
  origin: z.string().refine((value) => {
    try { const url = new URL(value); return ['http:', 'https:'].includes(url.protocol) && url.origin === value; }
    catch { return false; }
  }, 'Expected an HTTP(S) origin without a path'),
  localStorage: z.array(z.object({ name: z.string(), value: z.string() })).default([]),
}).strict();
const Snapshot = z.object({ cookies: z.array(Cookie).default([]), origins: z.array(Origin).default([]) }).strict();
export type StorageSnapshot = z.infer<typeof Snapshot>;

/** Reject malformed/unsupported state before launching a browser or applying cookies. */
export function parseStorageState(content: string): StorageSnapshot {
  let raw: unknown;
  try { raw = JSON.parse(content); } catch { throw new Error('Login state must be valid JSON'); }
  const result = Snapshot.safeParse(raw);
  if (!result.success) {
    throw new Error('Invalid login state: ' + result.error.issues.map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`).join('; '));
  }
  return result.data;
}

/**
 * Merge the supplied localStorage keys once, without a permanent init script.
 * A routed, empty page avoids fetching the supplied origins or running their code.
 * Do not use setStorageState here: that API also clears unrelated IndexedDB/OPFS.
 */
export async function restoreLocalStorage(context: BrowserContext, origins: StorageSnapshot['origins']): Promise<void> {
  if (!origins.length) return;
  const page = await context.newPage();
  try {
    const session = await context.newCDPSession(page);
    await session.send('Network.setBypassServiceWorker', { bypass: true });
    await page.route('**/*', (route) => route.fulfill({
      status: 200, contentType: 'text/html', body: '<!doctype html><title>ForgeKit state restore</title>',
    }));
    for (const origin of origins) {
      await page.goto(origin.origin, { waitUntil: 'domcontentloaded' });
      await page.evaluate((items) => {
        const previous = items.map((item) => ({ name: item.name, value: localStorage.getItem(item.name) }));
        try {
          for (const item of items) localStorage.setItem(item.name, item.value);
        } catch (error) {
          for (const item of previous) {
            if (item.value === null) localStorage.removeItem(item.name);
            else localStorage.setItem(item.name, item.value);
          }
          throw error;
        }
      }, origin.localStorage);
    }
  } finally {
    await page.close();
  }
}
