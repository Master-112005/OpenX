const { spawnSync } = require('child_process');
const electronPath = require('electron');

const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;

const args = ['.', ...process.argv.slice(2)];
const result = spawnSync(electronPath, args, {
  cwd: require('path').resolve(__dirname, '..'),
  env,
  stdio: 'inherit'
});

if (result.error) {
  console.error(`Failed to start Electron: ${result.error.message}`);
  process.exitCode = 1;
} else if (result.signal) {
  console.error(`Electron stopped by signal ${result.signal}`);
  process.exitCode = 1;
} else {
  process.exitCode = result.status ?? 0;
}
