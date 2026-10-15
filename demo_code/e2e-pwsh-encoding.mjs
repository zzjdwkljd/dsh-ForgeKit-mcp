// e2e-pwsh-encoding.mjs — historical probe behind the 2026-10-15 decision to
// drop the PowerShell backend and keep Git Bash only.
//
// Question it answered: does Windows PowerShell 5.1 honour
// [Console]::OutputEncoding when stdout is a PIPE (not a console)? 5.1 is known
// to use the OEM codepage for piped output regardless of
// [Console]::OutputEncoding in some hosting modes, so measure raw bytes.
//
// Result (this machine): the prologue sets [Console]::OutputEncoding=UTF8 and
// $OutputEncoding=utf-8, both self-report as effective, yet the child still
// writes GBK bytes — unfixable from outside. That is why src/modules/shell/
// is a single Git Bash backend and the pwsh backend was removed.
//
// Kept as evidence only: it does not import the server (the pwsh backend no
// longer exists), is not part of `npm test`, and only runs where
// powershell.exe exists. It exits 0 with "skipped" when PowerShell is absent.

import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';

const exe = process.env.SystemRoot ? `${process.env.SystemRoot}\\System32\\WindowsPowerShell\\v1.0\\powershell.exe` : 'powershell.exe';

if (process.platform !== 'win32' || !existsSync(exe)) {
  console.log('skipped: powershell.exe not available on this machine');
  process.exit(0);
}

console.log('exe:', exe);

function probe(args, label) {
  const out = execFileSync(exe, args, {
    input: ['[Console]::OutputEncoding = [System.Text.Encoding]::UTF8',
            '$OutputEncoding = [System.Text.Encoding]::UTF8',
            'Write-Output 中文输出测试'].join('\n'),
    windowsHide: true,
  });
  const buf = Buffer.from(out);
  const utf8 = buf.includes(Buffer.from('中文输出测试', 'utf8'));
  console.log(`${label}: utf8_ok=${utf8} head=${JSON.stringify(buf.toString('utf8').trim().slice(0, 40))}`);
}

// 1) -Command - (stdin scripting, what the session used)
probe(['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', '-'], 'stdin -Command -');

// 2) -Command with the encoding set inline (does switching it help?)
probe(['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', '[Console]::OutputEncoding=[System.Text.Encoding]::UTF8; Write-Output 中文输出测试'], 'direct -Command');

// 3) what codepage does 5.1 think it uses for piped output?
const probeCp = execFileSync(exe, ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command',
  'Write-Output ("OutEnc=" + [Console]::OutputEncoding.WebName); Write-Output ($OutputEncoding | Out-String)'],
  { encoding: 'utf8', input: '', windowsHide: true });
console.log('codepage probe:', JSON.stringify(probeCp.trim()));
