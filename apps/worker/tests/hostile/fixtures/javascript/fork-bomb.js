const { spawn } = require('child_process');

spawn(process.execPath, [__filename], { stdio: 'ignore' });

while (true) {
  // keep the parent alive so the pids-limit keeps getting hit
}
