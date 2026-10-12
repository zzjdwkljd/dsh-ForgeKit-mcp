export interface HumanizeOptions {
  enabled: boolean;
  typingDelayMinMs: number;
  typingDelayMaxMs: number;
  actionDelayMinMs: number;
  actionDelayMaxMs: number;
}

export interface HumanizeUpdate {
  humanize?: boolean | undefined;
  typingDelayMinMs?: number | undefined;
  typingDelayMaxMs?: number | undefined;
  actionDelayMinMs?: number | undefined;
  actionDelayMaxMs?: number | undefined;
}

function delay(raw: string | undefined, fallback: number): number {
  return raw === undefined || raw === '' ? fallback : Number(raw);
}

function validate(config: HumanizeOptions): HumanizeOptions {
  if (typeof config.enabled !== 'boolean') throw new Error('humanize must be a boolean');
  for (const key of ['typingDelayMinMs', 'typingDelayMaxMs', 'actionDelayMinMs', 'actionDelayMaxMs'] as const) {
    const value = config[key];
    const max = key.startsWith('typing') ? 5000 : 10000;
    if (!Number.isInteger(value) || value < 0 || value > max) throw new Error(`${key} must be an integer between 0 and ${max}`);
  }
  if (config.typingDelayMinMs > config.typingDelayMaxMs) throw new Error('typingDelayMinMs must not exceed typingDelayMaxMs');
  if (config.actionDelayMinMs > config.actionDelayMaxMs) throw new Error('actionDelayMinMs must not exceed actionDelayMaxMs');
  return { ...config };
}

export function defaultHumanize(env: NodeJS.ProcessEnv = process.env): HumanizeOptions {
  return validate({
    enabled: String(env.MCP_BROWSER_HUMANIZE ?? 'true').toLowerCase() !== 'false',
    typingDelayMinMs: delay(env.MCP_BROWSER_TYPING_MIN_MS, 40),
    typingDelayMaxMs: delay(env.MCP_BROWSER_TYPING_MAX_MS, 120),
    actionDelayMinMs: delay(env.MCP_BROWSER_ACTION_MIN_MS, 150),
    actionDelayMaxMs: delay(env.MCP_BROWSER_ACTION_MAX_MS, 600),
  });
}

/** Validate the whole candidate before committing a partial configuration update. */
export function mergeHumanize(base: HumanizeOptions, update: HumanizeUpdate): HumanizeOptions {
  return validate({
    enabled: update.humanize ?? base.enabled,
    typingDelayMinMs: update.typingDelayMinMs ?? base.typingDelayMinMs,
    typingDelayMaxMs: update.typingDelayMaxMs ?? base.typingDelayMaxMs,
    actionDelayMinMs: update.actionDelayMinMs ?? base.actionDelayMinMs,
    actionDelayMaxMs: update.actionDelayMaxMs ?? base.actionDelayMaxMs,
  });
}

export function randInt(min: number, max: number): number {
  return min + Math.floor(Math.random() * (max - min + 1));
}

/** Cumulative rounding keeps small/negative scroll distances from being lost. */
export function scrollSteps(x: number, y: number, count: number): Array<{ x: number; y: number }> {
  if (!Number.isInteger(count) || count < 1) throw new Error('Scroll step count must be positive');
  return Array.from({ length: count }, (_, index) => ({
    x: Math.round(x * (index + 1) / count) - Math.round(x * index / count),
    y: Math.round(y * (index + 1) / count) - Math.round(y * index / count),
  }));
}
