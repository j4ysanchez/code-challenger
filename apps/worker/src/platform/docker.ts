import { promises as fs } from 'node:fs';
import { readFileSync } from 'node:fs';
import http from 'node:http';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Duplex, Writable } from 'node:stream';
import Docker from 'dockerode';
import type { Language } from '@code-challenger/contracts';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** Sandbox images live outside the worker's own source tree (contracts/sandbox-profile.md). */
const SANDBOX_ROOT = path.resolve(__dirname, '../../../../infra/sandbox');

const PROFILE_DIRS: Readonly<Record<Language, string>> = {
  python: 'python312',
  javascript: 'node22',
};

export interface SandboxProfile {
  readonly language: Language;
  readonly image: string;
  readonly sourceFilename: string;
  readonly compileCommand: readonly string[] | null;
  readonly runCommand: readonly string[];
}

interface RawProfile {
  readonly image: string;
  readonly sourceFilename: string;
  readonly compileCommand?: readonly string[];
  readonly runCommand: readonly string[];
}

const profileCache = new Map<Language, SandboxProfile>();

/** Reads infra/sandbox/<lang>/profile.json — the single source of truth for run/compile commands and image tag. */
export const loadSandboxProfile = (language: Language): SandboxProfile => {
  const cached = profileCache.get(language);
  if (cached) {
    return cached;
  }
  const dir = PROFILE_DIRS[language];
  const raw = readFileSync(path.join(SANDBOX_ROOT, dir, 'profile.json'), 'utf8');
  const parsed = JSON.parse(raw) as RawProfile;
  const profile: SandboxProfile = {
    language,
    image: parsed.image,
    sourceFilename: parsed.sourceFilename,
    compileCommand: parsed.compileCommand ?? null,
    runCommand: parsed.runCommand,
  };
  profileCache.set(language, profile);
  return profile;
};

export interface ResourceLimits {
  readonly cpuTimeLimitMs: number;
  readonly wallTimeLimitMs: number;
  readonly memoryLimitMb: number;
}

export interface SandboxRunRequest {
  readonly profile: SandboxProfile;
  readonly command: readonly string[];
  readonly sourceCode: string;
  readonly stdin: string;
  readonly limits: ResourceLimits;
}

export interface SandboxRunResult {
  readonly exitCode: number | null;
  readonly signal: string | null;
  readonly stdout: string;
  readonly stderr: string;
  readonly timedOut: boolean;
  readonly oomKilled: boolean;
  readonly outputCapped: boolean;
  readonly wallTimeMs: number;
  readonly peakMemoryKb: number;
}

/** Hostile-containment table: stdout streamed and truncated at 1 MB (contracts/sandbox-profile.md). */
const STDOUT_CAP_BYTES = 1024 * 1024;
/** stderr is only ever shown to users as inert text, truncated well below the display limit. */
const STDERR_CAP_BYTES = 64 * 1024;
const PIDS_LIMIT = 64;
const CPU_POLL_INTERVAL_MS = 100;

/** Accumulates a stream up to a byte cap; further bytes are dropped and `capped` flips true. */
class CappedCollector extends Writable {
  private readonly chunks: Buffer[] = [];
  private total = 0;
  capped = false;

  constructor(
    private readonly capBytes: number,
    private readonly onCapExceeded?: () => void,
  ) {
    super();
  }

  override _write(chunk: Buffer, _encoding: string, callback: (error?: Error | null) => void): void {
    const remaining = this.capBytes - this.total;
    if (remaining > 0) {
      const slice = chunk.subarray(0, remaining);
      this.chunks.push(slice);
      this.total += slice.length;
    }
    if (chunk.length > remaining && !this.capped) {
      this.capped = true;
      this.onCapExceeded?.();
    }
    callback();
  }

  text(): string {
    return Buffer.concat(this.chunks).toString('utf8');
  }
}

let sharedClient: Docker | undefined;

export const defaultDockerClient = (): Docker => {
  sharedClient ??= new Docker();
  return sharedClient;
};

interface ContainerStatsSnapshot {
  readonly cpu_stats?: { readonly cpu_usage?: { readonly total_usage?: number } };
  readonly memory_stats?: { readonly usage?: number };
}

const cpuUsageNs = (stats: ContainerStatsSnapshot): number => stats.cpu_stats?.cpu_usage?.total_usage ?? 0;

const memoryUsageBytes = (stats: ContainerStatsSnapshot): number => stats.memory_stats?.usage ?? 0;

/**
 * dockerode's `container.attach({ hijack: true, stdin: true, ... })` has a bug in the
 * docker-modem version we depend on: because `opts` is non-empty, `buildRequest` JSON-stringifies
 * it as a POST body (`data = JSON.stringify(opts._body || opts)`), which then rides along on the
 * hijacked socket and lands as garbage at the front of the container's stdin. Attaching over a raw
 * HTTP request to the same endpoint avoids dockerode's option-forwarding entirely.
 */
interface ModemWithSocketPath {
  getSocketPath(): Promise<string>;
}

const attachStdio = async (dockerClient: Docker, containerId: string): Promise<Duplex> => {
  // @types/dockerode doesn't declare docker-modem's getSocketPath, though it exists at runtime.
  const socketPath = await (dockerClient.modem as unknown as ModemWithSocketPath).getSocketPath();
  return new Promise((resolve, reject) => {
    const req = http.request({
      socketPath,
      path: `/containers/${containerId}/attach?stream=1&stdin=1&stdout=1&stderr=1`,
      method: 'POST',
      headers: { Connection: 'Upgrade', Upgrade: 'tcp' },
    });
    req.on('upgrade', (_res, socket: Duplex, head: Buffer) => {
      if (head.length > 0) {
        socket.unshift(head);
      }
      resolve(socket);
    });
    req.on('error', reject);
    req.end();
  });
};

/**
 * Runs one command (compile or run step) in a fresh, fully hardened, ephemeral
 * container per contracts/sandbox-profile.md: no network, non-root, read-only
 * rootfs + noexec tmpfs scratch, all capabilities dropped, no-new-privileges,
 * pids/memory/cpu/ulimit caps, wall-clock + polled-cpu-time kill, capped
 * stdout/stderr. The container is always force-removed afterwards.
 */
export const runInSandbox = async (
  request: SandboxRunRequest,
  dockerClient: Docker = defaultDockerClient(),
): Promise<SandboxRunResult> => {
  const hostDir = await fs.mkdtemp(path.join(tmpdir(), 'sandbox-'));
  const hostSourcePath = path.join(hostDir, request.profile.sourceFilename);

  try {
    await fs.writeFile(hostSourcePath, request.sourceCode, 'utf8');

    const container = await dockerClient.createContainer({
      Image: request.profile.image,
      Cmd: [...request.command],
      User: '65534:65534',
      WorkingDir: '/scratch',
      AttachStdin: true,
      AttachStdout: true,
      AttachStderr: true,
      OpenStdin: true,
      StdinOnce: true,
      Tty: false,
      HostConfig: {
        NetworkMode: 'none',
        ReadonlyRootfs: true,
        // uid/gid/mode: the tmpfs otherwise mounts root-owned 0755, and the sandbox
        // runs as uid 65534 — without this it can't even mkdir (e.g. Python's
        // __pycache__) inside its own scratch space.
        Tmpfs: { '/scratch': 'rw,noexec,nosuid,size=64m,uid=65534,gid=65534,mode=0755' },
        Binds: [`${hostSourcePath}:/scratch/${request.profile.sourceFilename}:ro`],
        CapDrop: ['ALL'],
        SecurityOpt: ['no-new-privileges'],
        PidsLimit: PIDS_LIMIT,
        Memory: request.limits.memoryLimitMb * 1024 * 1024,
        MemorySwap: request.limits.memoryLimitMb * 1024 * 1024,
        NanoCpus: 1_000_000_000,
        Ulimits: [
          { Name: 'nofile', Soft: 64, Hard: 64 },
          { Name: 'fsize', Soft: 8_388_608, Hard: 8_388_608 },
        ],
        Init: true,
      },
    });

    const timers: { timedOut: boolean; peakMemoryBytes: number } = { timedOut: false, peakMemoryBytes: 0 };
    const stdout = new CappedCollector(STDOUT_CAP_BYTES, () => {
      void container.kill().catch(() => undefined);
    });
    const stderr = new CappedCollector(STDERR_CAP_BYTES);

    try {
      const stream = await attachStdio(dockerClient, container.id);
      dockerClient.modem.demuxStream(stream, stdout, stderr);
      stream.write(request.stdin);
      stream.end();

      const startedAt = Date.now();
      await container.start();

      const wallTimer = setTimeout(() => {
        timers.timedOut = true;
        void container.kill().catch(() => undefined);
      }, request.limits.wallTimeLimitMs);

      const cpuPoller = setInterval(() => {
        void (async () => {
          try {
            const stats = await container.stats({ stream: false });
            timers.peakMemoryBytes = Math.max(timers.peakMemoryBytes, memoryUsageBytes(stats));
            if (cpuUsageNs(stats) / 1_000_000 > request.limits.cpuTimeLimitMs) {
              timers.timedOut = true;
              await container.kill().catch(() => undefined);
            }
          } catch {
            // container already exited between the poll tick and the stats call — ignore
          }
        })();
      }, CPU_POLL_INTERVAL_MS);

      try {
        await container.wait();
      } finally {
        clearTimeout(wallTimer);
        clearInterval(cpuPoller);
      }

      const inspect = await container.inspect();
      const wallTimeMs = Date.now() - startedAt;

      return {
        exitCode: inspect.State.ExitCode ?? null,
        signal: timers.timedOut ? 'SIGKILL' : null,
        stdout: stdout.text(),
        stderr: stderr.text(),
        timedOut: timers.timedOut,
        oomKilled: inspect.State.OOMKilled ?? false,
        outputCapped: stdout.capped,
        wallTimeMs,
        peakMemoryKb: Math.round(timers.peakMemoryBytes / 1024),
      };
    } finally {
      // Retries with backoff: under heavy concurrent Docker load the daemon occasionally
      // 409s a force-remove issued immediately after a kill/exit it's still processing.
      const removeWithRetries = async (attemptsLeft: number, delayMs: number): Promise<void> => {
        await container.remove({ force: true }).catch(async (error: unknown) => {
          if (attemptsLeft <= 0) {
            throw error;
          }
          await new Promise((resolve) => setTimeout(resolve, delayMs));
          await removeWithRetries(attemptsLeft - 1, delayMs * 2);
        });
      };
      await removeWithRetries(3, 250).catch(() => undefined);
    }
  } finally {
    await fs.rm(hostDir, { recursive: true, force: true }).catch(() => undefined);
  }
};
