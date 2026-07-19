import os

# Read a file that requires privilege the sandbox user does not have.
open("/etc/shadow").read()

# Never reached if the read above is blocked, but included so the fixture
# still fails loudly (exit 1) if filesystem containment ever regresses.
os.listdir("/proc/1")
open("/outside-scratch.txt", "w").write("escaped")
