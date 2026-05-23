const fs = require('fs');
const path = require('path');
const { execFileSync, spawn } = require('child_process');

function escapePowerShell(value) {
  return String(value ?? '').replace(/'/g, "''");
}

function buildArgumentClause(args = []) {
  if (!Array.isArray(args) || args.length === 0) {
    return '';
  }

  const serializedArgs = args.map(arg => `'${escapePowerShell(arg)}'`).join(', ');
  return ` -ArgumentList ${serializedArgs}`;
}

function launchTarget(target, args = []) {
  const safeTarget = String(target ?? '').trim();
  if (!safeTarget) {
    throw new Error('No target provided');
  }

  const isExecutablePath = (
    path.isAbsolute(safeTarget) &&
    path.extname(safeTarget).toLowerCase() === '.exe' &&
    fs.existsSync(safeTarget)
  );

  if (isExecutablePath) {
    const child = spawn(safeTarget, args, {
      detached: true,
      stdio: 'ignore'
    });
    child.unref();
    return;
  }

  const script = `Start-Process -FilePath '${escapePowerShell(safeTarget)}'${buildArgumentClause(args)}`;
  execFileSync('powershell.exe', ['-NoProfile', '-Command', script], {
    timeout: 5000,
    stdio: 'ignore'
  });
}

module.exports = {
  launchTarget
};
