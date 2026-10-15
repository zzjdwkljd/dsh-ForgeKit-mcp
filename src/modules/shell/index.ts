// shell module - persistent Git Bash sessions with UTF-8 native I/O.
//
// One backend only (2026-10-15 user decision): Git Bash. PowerShell is dropped
// entirely — 5.1's piped-output codepage quirks are unfixable from the outside,
// and every machine that runs this tool (node/npm/git) already has Git Bash.
// bash is MSYS2: UTF-8 native, so no encoding prologue is needed beyond pinning
// LANG/LC_ALL.
//
// Session mechanism: a long-lived child bash reads commands from stdin; each
// command is followed by an end-marker line carrying the exit code, so
// multi-line output is unambiguous and state (variables, cwd, functions)
// survives across tool calls. Sessions are process-local by design (a shell is
// a living process, not data), so they die with the MCP server.

import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { z } from 'zod';
import type { ToolModule } from '../../core/module.js';
import { ok, text, tool } from '../../core/results.js';

const MAX_OUTPUT_CHARS = 200_000;
const DEFAULT_TIMEOUT_MS = clampFromEnv('MCP_SHELL_TIMEOUT_MS', 120_000, 1_000, 600_000);

function clampFromEnv(name: string, fallback: number, min: number, max: number): number {
  const n = Number.parseInt(process.env[name] ?? '', 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

interface ShellSession {
  id: string;
  child: ReturnType<typeof spawn>;
  /** Everything the child has printed since the last completed command. */
  buffer: string;
  /** Resolvers waiting for new output (wake after each chunk / exit). */
  waiters: Array<() => void>;
  closed: boolean;
  exitCode: number | null;
  /** Set when the child never started (spawn error). */
  spawnError: string | null;
  /** Marker of a timed-out command still running in the child; its output is swallowed until the marker arrives. */
  staleMarker: string | null;
  createdAt: string;
  lastUsedAt: string;
  cwd: string;
  /** Serializes commands inside one session; shell state is shared. */
  tail: Promise<void>;
}

const sessions = new Map<string, ShellSession>();

// ---------- bash resolution ----------

/** Derive the Git installation root from git.exe on PATH (e.g. D:\Git\cmd\git.exe -> D:\Git). */
export function gitRootFromPath(): string | null {
  const dirs = (process.env.PATH ?? '').split(path.delimiter).filter(Boolean);
  for (const dir of dirs) {
    for (const name of ['git.exe', 'git']) {
      const candidate = path.join(dir, name);
      if (existsSync(candidate)) {
        // <root>\cmd\git.exe (Windows installer) or <root>\bin\git.exe (MSYS2 layout)
        const parent = path.dirname(path.dirname(candidate));
        if (/^(cmd|bin)$/i.test(path.basename(path.dirname(candidate)))) return parent;
        return path.dirname(candidate);
      }
    }
  }
  return null;
}

/** Common Git-for-Windows layouts, most specific first. `gitRoot` optional hint. */
export function bashCandidates(gitRoot?: string): string[] {
  const list: string[] = [];
  const push = (p: string | undefined): void => { if (p) list.push(p); };
  push(process.env.MCP_SHELL_BASH);
  for (const root of [gitRoot, gitRootFromPath()].filter(Boolean) as string[]) {
    push(path.join(root, 'bin', 'bash.exe'));
    push(path.join(root, 'usr', 'bin', 'bash.exe'));
  }
  push('C:\\Program Files\\Git\\bin\\bash.exe');
  push('C:\\Program Files\\Git\\usr\\bin\\bash.exe');
  push('C:\\Program Files (x86)\\Git\\bin\\bash.exe');
  push('/usr/bin/bash');
  push('/bin/bash');
  return [...new Set(list)];
}

/** Locate a usable bash; null when absent. */
export function resolveBashExecutable(): string | null {
  for (const candidate of bashCandidates()) {
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

/** Resolve the bash executable; throws with guidance when absent. */
export function resolveShellExecutable(): string {
  const bash = resolveBashExecutable();
  if (bash) return bash;
  throw new Error(
    '未找到 Git Bash：请安装 Git for Windows，或用 MCP_SHELL_BASH 指向 bash.exe 后重试',
  );
}

// ---------- session prologue & markers ----------

function prologue(): string {
  // MSYS2 is UTF-8 native; pin the locale so tools never inherit the parent's.
  return [
    'export LANG=C.UTF-8 LC_ALL=C.UTF-8',
    'export MSYS2_ARG_CONV_EXCL="*"',
  ].join('\n') + '\n';
}

function startSession(id: string, cwd: string): ShellSession {
  const file = resolveShellExecutable(); // throws with guidance when Git Bash is absent
  const child = spawn(file, ['--noprofile', '--norc', '-s'], {
    stdio: ['pipe', 'pipe', 'pipe'],
    cwd,
    windowsHide: true,
    env: { ...process.env },
  });
  const session: ShellSession = {
    id, child, buffer: '', waiters: [], closed: false, exitCode: null, spawnError: null, staleMarker: null,
    createdAt: new Date().toISOString(), lastUsedAt: new Date().toISOString(), cwd, tail: Promise.resolve(),
  };
  const push = (chunk: Buffer): void => {
    session.buffer += chunk.toString('utf8');
    if (session.buffer.length > 4_000_000) session.buffer = session.buffer.slice(-2_000_000);
    const waiters = session.waiters.splice(0);
    for (const w of waiters) w();
  };
  child.stdout?.on('data', push);
  child.stderr?.on('data', push);
  child.on('error', (error) => {
    // spawn failure (ENOENT etc.): mark closed and wake waiters so pending
    // commands fail with a readable error instead of crashing the process.
    session.closed = true;
    session.spawnError = error.message;
    session.buffer += `\n[shell] failed to start bash: ${error.message}\n`;
    const waiters = session.waiters.splice(0);
    for (const w of waiters) w();
  });
  child.on('exit', (code) => {
    session.closed = true;
    session.exitCode = code ?? null;
    const waiters = session.waiters.splice(0);
    for (const w of waiters) w();
  });
  child.stdin?.write(prologue());
  return session;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function runInSession(session: ShellSession, command: string, timeoutMs: number): Promise<{ output: string; exitCode: number | null; timedOut: boolean }> {
  // A previous command timed out and is still running: swallow its output
  // until its end-marker shows up (bounded by a fresh timeout), so the stale
  // exit code / marker text can never pollute this command's window.
  if (session.staleMarker) {
    const stale = session.staleMarker;
    session.staleMarker = null;
    const drainDeadline = Date.now() + 60_000;
    while (Date.now() < drainDeadline && !session.closed) {
      const staleIndex = session.buffer.indexOf(stale);
      if (staleIndex !== -1) {
        session.buffer = session.buffer.slice(session.buffer.indexOf('\n', staleIndex) + 1);
        break;
      }
      await sleep(80);
    }
  }
  const deadline = Date.now() + timeoutMs;
  const marker = `__FK_END_${Date.now().toString(36)}${Math.random().toString(36).slice(2)}__`;
  const before = session.buffer.length;
  // The marker line reports the pipeline's exit code; it is written after the
  // command finishes, so multi-line output can never swallow it.
  session.child.stdin!.write(`${command}\nprintf '%s\\n' "${marker}:$?"\n`);
  for (;;) {
    const markerIndex = session.buffer.indexOf(marker, before);
    if (markerIndex !== -1) {
      const afterMarker = session.buffer.slice(markerIndex + marker.length);
      const exitMatch = /^:(-?\d+)/.exec(afterMarker);
      const exitCode = exitMatch ? Number(exitMatch[1]) : null;
      const output = session.buffer.slice(before, markerIndex).replace(/\r\n/g, '\n').replace(/^\n+/, '').replace(/\n+$/, '');
      // Bytes after the marker belong to the next command; keep them.
      session.buffer = afterMarker.slice(exitMatch ? exitMatch[0].length : 0).replace(/^\r?\n/, '');
      session.lastUsedAt = new Date().toISOString();
      const truncated = output.length > MAX_OUTPUT_CHARS;
      return {
        output: truncated ? `[output truncated to the last ${MAX_OUTPUT_CHARS} chars]\n` + output.slice(-MAX_OUTPUT_CHARS) : output,
        exitCode,
        timedOut: false,
      };
    }
    if (session.closed) {
      const output = session.buffer.slice(before).replace(/\r\n/g, '\n');
      session.buffer = session.buffer.slice(before);
      const detail = session.spawnError ? ` (spawn failed: ${session.spawnError})` : '';
      return { output: output.slice(-MAX_OUTPUT_CHARS) + (session.spawnError ? `\n[shell] session died${detail}` : ''), exitCode: session.exitCode, timedOut: false };
    }
    if (Date.now() > deadline) {
      // Timed out. The command keeps running, so its end-marker will still be
      // written later. Draining to now would leak the marker text into the
      // next command's output; leaving the bytes would let the next command
      // match the STALE marker and inherit a wrong exit code. Correct fix:
      // remember the stale marker and swallow everything up to and including
      // it before the next command starts reading.
      session.staleMarker = marker;
      const output = session.buffer.slice(before).replace(/\r\n/g, '\n');
      session.buffer = session.buffer.slice(before);
      return { output: output.slice(-MAX_OUTPUT_CHARS), exitCode: null, timedOut: true };
    }
    await sleep(80);
  }
}

const ShellSchema = z.object({
  action: z.enum(['run', 'list', 'close', 'close_all']).describe('run=在会话中执行命令; list=列出会话; close=关闭指定会话; close_all=关闭全部'),
  sessionId: z.string().max(40).optional().describe('目标会话 ID；action=run 未传时用默认会话 "main"'),
  command: z.string().max(200_000).optional().describe('action=run 必填：bash 命令（变量/工作目录/函数跨调用保留）'),
  cwd: z.string().optional().describe('新建会话的工作目录（默认用户主目录；仅在创建时生效）'),
  timeoutMs: z.number().int().min(1000).max(600000).optional().describe('run 超时(毫秒, 默认 120000)；超时不会杀死会话'),
});

export const shellModule: ToolModule = {
  id: 'shell',
  description: 'Persistent Git Bash sessions with UTF-8 native I/O; variables, cwd and functions survive across calls.',
  register(server) {
    let releaseGate: (() => void) | null = null;
    server.registerTool(
      'shell',
      {
        title: 'Git Bash（持久会话）',
        description:
          'Run bash commands in persistent named sessions (default "main"): variables, working directory and functions survive across calls. Uses the locally installed Git Bash (auto-detected via git on PATH and standard layouts; override with MCP_SHELL_BASH). MSYS2 is UTF-8 native, so Chinese output is clean. Output is capped to the last 200k chars; exit codes come from $? after each command; timeouts leave the session alive for follow-ups.',
        inputSchema: ShellSchema,
        annotations: { openWorldHint: false },
      },
      tool(async (args: z.infer<typeof ShellSchema>) => {
        if (args.action === 'list') {
          const items = [...sessions.values()].map((s) => ({
            id: s.id, created_at: s.createdAt, last_used_at: s.lastUsedAt, closed: s.closed, cwd: s.cwd,
          }));
          return ok([text({ sessions: items, default_timeout_ms: DEFAULT_TIMEOUT_MS })]);
        }
        if (args.action === 'close_all') {
          const closed: string[] = [];
          for (const [id, s] of sessions) {
            s.closed = true;
            s.child.kill();
            closed.push(id);
          }
          sessions.clear();
          return ok([text({ closed: closed.length, sessions: closed })]);
        }
        if (args.action === 'close') {
          if (!args.sessionId) throw new Error('action=close 需要 sessionId');
          const s = sessions.get(args.sessionId);
          if (!s) return ok([text({ closed: false, reason: 'no such session' })]);
          s.closed = true;
          s.child.kill();
          sessions.delete(args.sessionId);
          return ok([text({ closed: true, sessionId: args.sessionId })]);
        }
        // action=run
        if (args.command === undefined || args.command.trim() === '') throw new Error('action=run 需要 command');
        const id = args.sessionId ?? 'main';
        let session = sessions.get(id);
        if (!session || session.closed) {
          const cwd = args.cwd ? path.resolve(args.cwd) : os.homedir();
          session = startSession(id, cwd); // throws with guidance when Git Bash is absent
          sessions.set(id, session);
          await sleep(120); // let the prologue land before the first command
        }
        const previous = session.tail;
        const gate = new Promise<void>((resolve) => { releaseGate = resolve; });
        session.tail = previous.then(() => gate);
        await previous;
        try {
          const result = await runInSession(session, args.command, args.timeoutMs ?? DEFAULT_TIMEOUT_MS);
          return ok([text({ sessionId: id, exitCode: result.exitCode, timedOut: result.timedOut, output: result.output })]);
        } finally {
          releaseGate?.();
        }
      }),
    );
  },
  async dispose() {
    for (const s of sessions.values()) {
      s.closed = true;
      s.child.kill();
    }
    sessions.clear();
  },
};
