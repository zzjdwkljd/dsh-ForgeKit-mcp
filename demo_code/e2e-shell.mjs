// e2e-shell.mjs — real E2E of the shell tool (Git Bash only): session
// persistence, UTF-8 output, exit codes, cwd retention, timeout survival.
import { shellModule } from '../dist/modules/index.js';

let handler = null;
const registrar = { registerTool: (name, def, h) => { if (name === 'shell') handler = h; } };
shellModule.register(registrar);
const call = async (args) => JSON.parse((await handler(args)).content[0].text);

// 1) session persistence: variable + cwd survive across calls
const r1 = await call({ action: 'run', command: 'export FK_DEMO=你好世界; cd /d/text; echo ok-bash' });
console.log('[persist] exit=' + r1.exitCode, 'output=' + JSON.stringify(r1.output));
const r2 = await call({ action: 'run', command: 'echo -n "$FK_DEMO" | wc -c; pwd' });
console.log('[persist] var bytes (12 = 4 CJK chars UTF-8) + cwd:', JSON.stringify(r2.output), 'exit=' + r2.exitCode);

// 2) UTF-8 output
const r3 = await call({ action: 'run', command: 'echo 中文输出测试' });
console.log('[utf8]', JSON.stringify(r3.output));

// 3) exit codes: success and failure
const r4 = await call({ action: 'run', command: 'true' });
const r5 = await call({ action: 'run', command: 'exit 7' });
console.log('[exit] true ->', r4.exitCode, '| exit 7 ->', r5.exitCode);
// session dies with the child after `exit`; next run should transparently start a new one
const r6 = await call({ action: 'run', command: 'echo new-session' });
console.log('[restart after exit] exit=' + r6.exitCode, 'output=' + JSON.stringify(r6.output));

// 4) timeout survival: sleep beyond timeout, session still usable
const r7 = await call({ action: 'run', command: 'sleep 3; echo late', timeoutMs: 1000 });
console.log('[timeout] timedOut=' + r7.timedOut);
const r8 = await call({ action: 'run', command: 'echo still-alive' });
console.log('[timeout] session alive:', JSON.stringify(r8.output));

// 5) list
const listed = await call({ action: 'list' });
console.log('[list] sessions:', JSON.stringify(listed.sessions.map((s) => ({ id: s.id, closed: s.closed }))));
await shellModule.dispose();
console.log('SHELL E2E OK');
