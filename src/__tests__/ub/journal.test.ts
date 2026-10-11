import { describe, it, expect } from "vitest";
import { vol } from "memfs";
import * as fs from "fs";
import { writeEntry, type JournalEntry } from "../../ub/journal";
import type { AgentHome } from "../../ub/paths";

const h: AgentHome = {
  home: "/agent",
  staging: "/agent/staging",
  backups: "/agent/backups",
  journal: "/agent/journal",
};
const entry: JournalEntry = {
  runId: "r1",
  seq: 0,
  bundle: "/Apps/X.app",
  bundleId: null,
  version: "1.0",
  build: "1",
  backupDir: "/agent/backups/h/1-r1",
  stagingDir: "/agent/staging/r1-0",
  files: [{ rel: "Contents/MacOS/x", origIno: 1, origSize: 2, origMtimeMs: 3 }],
  phase: "staged",
};

describe("writeEntry", () => {
  it("writes a valid entry", async () => {
    vol.fromJSON({ "/agent/journal/.keep": "" });
    await writeEntry(h, entry);
    expect(
      JSON.parse(fs.readFileSync("/agent/journal/r1-0.json", "utf8")),
    ).toEqual(entry);
  });

  it("throws for an entry that fails validation and writes nothing", async () => {
    vol.fromJSON({ "/agent/journal/.keep": "" });
    await expect(
      writeEntry(h, { ...entry, backupDir: "/tmp/evil" }),
    ).rejects.toThrow(/invalid entry/);
    expect(fs.readdirSync("/agent/journal")).toEqual([".keep"]);
  });
});
