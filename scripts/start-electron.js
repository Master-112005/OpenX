const { spawn } = require('child_process');
const electronPath = require('electron');

const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;

const args = ['.', ...process.argv.slice(2)];
const child = spawn(electronPath, args, {
  cwd: require('path').resolve(__dirname, '..'),
  env,
  stdio: ['inherit', 'pipe', 'pipe']
});

const CHROMIUM_SSL_OFFLINE_NOISE = /ssl_client_socket_impl\.cc\(\d+\)\]\s+handshake failed;.*net_error -101/i;

function forwardStream(stream, destination) {
  let buffered = '';
  stream.setEncoding('utf8');
  stream.on('data', chunk => {
    buffered += chunk;
    const lines = buffered.split(/\r?\n/);
    buffered = lines.pop() || '';
    for (const line of lines) {
      if (!CHROMIUM_SSL_OFFLINE_NOISE.test(line)) {
        destination.write(`${line}\n`);
      }
    }
  });
  stream.on('end', () => {
    if (buffered && !CHROMIUM_SSL_OFFLINE_NOISE.test(buffered)) {
      destination.write(buffered);
    }
  });
}

forwardStream(child.stdout, process.stdout);
forwardStream(child.stderr, process.stderr);

child.on('error', error => {
  console.error(`Failed to start Electron: ${error.message}`);
  process.exitCode = 1;
});

child.on('close', (code, signal) => {
  if (signal) {
    console.error(`Electron stopped by signal ${signal}`);
    process.exitCode = 1;
    return;
  }
  process.exitCode = code ?? 0;
});
