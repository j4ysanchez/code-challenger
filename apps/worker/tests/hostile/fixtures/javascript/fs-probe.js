const fs = require('fs');

// Read a file that requires privilege the sandbox user does not have.
fs.readFileSync('/etc/shadow');

// Never reached if the read above is blocked, but included so the fixture
// still fails loudly if filesystem containment ever regresses.
fs.writeFileSync('/outside-scratch.txt', 'escaped');
