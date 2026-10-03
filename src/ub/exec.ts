import * as cp from "child_process";

export class ExecTimeoutError extends Error {
  constructor(cmd: string, timeoutMs: number) {
    super(`${cmd} timed out after ${timeoutMs}ms`);
    this.name = "ExecTimeoutError";
  }
}

const LIPO_TIMEOUT = 60_000;
const CODESIGN_TIMEOUT = 120_000;
const PS_TIMEOUT = 10_000;

/**
 * execFile (argv array, never a shell). Resolves on ANY exit code; rejects with
 * ExecTimeoutError on timeout (child SIGKILLed) and with the Node errno error
 * on spawn failure.
 */
export function run(
  cmd: string,
  args: string[],
  timeoutMs: number,
): Promise<{ stdout: string; stderr: string; code: number }> {
  return new Promise((resolve, reject) => {
    cp.execFile(
      cmd,
      args,
      {
        timeout: timeoutMs,
        killSignal: "SIGKILL",
        maxBuffer: 64 * 1024 * 1024,
        encoding: "utf8",
      },
      (err, stdout, stderr) => {
        const out = String(stdout ?? "");
        const errText = String(stderr ?? "");
        if (!err) return resolve({ stdout: out, stderr: errText, code: 0 });
        const e = err as NodeJS.ErrnoException & {
          killed?: boolean;
          signal?: string | null;
        };
        if (e.killed || e.signal === "SIGKILL") {
          return reject(new ExecTimeoutError(cmd, timeoutMs));
        }
        if (typeof e.code === "number") {
          return resolve({ stdout: out, stderr: errText, code: e.code });
        }
        reject(err);
      },
    );
  });
}

export async function lipoThin(src: string, out: string): Promise<void> {
  const r = await run(
    "/usr/bin/lipo",
    [src, "-thin", "arm64", "-output", out],
    LIPO_TIMEOUT,
  );
  if (r.code !== 0) {
    throw new Error(`lipo -thin failed (${r.code}): ${r.stderr.trim()}`);
  }
}

export async function lipoArchs(p: string): Promise<string[]> {
  const r = await run("/usr/bin/lipo", ["-archs", p], LIPO_TIMEOUT);
  if (r.code !== 0) {
    throw new Error(`lipo -archs failed (${r.code}): ${r.stderr.trim()}`);
  }
  return r.stdout.split(/\s+/).filter(Boolean);
}

export async function codesignVerify(
  app: string,
): Promise<{ ok: boolean; errorText: string }> {
  const r = await run(
    "/usr/bin/codesign",
    ["--verify", "--deep", "--strict", app],
    CODESIGN_TIMEOUT,
  );
  return { ok: r.code === 0, errorText: r.stderr.trim() };
}

/** Full executable paths of running processes, exactly as `ps` prints them. */
export async function processSnapshot(): Promise<Set<string>> {
  const r = await run("/bin/ps", ["-axww", "-o", "comm="], PS_TIMEOUT);
  const out = new Set<string>();
  for (const line of r.stdout.split("\n")) {
    const t = line.trim();
    if (t.startsWith("/")) out.add(t);
  }
  return out;
}
