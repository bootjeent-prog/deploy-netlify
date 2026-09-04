import { spawn } from 'node:child_process';

const children = [
  spawn(process.execPath, ['--watch', 'server/index.js'], { stdio: 'inherit' }),
  spawn(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['run', 'dev:client'], { stdio: 'inherit' })
];

function stop() {
  for (const child of children) child.kill('SIGTERM');
}
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
for (const child of children) child.on('exit', (code) => {
  if (code && code !== 0) process.exitCode = code;
});
