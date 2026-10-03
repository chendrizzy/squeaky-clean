import { describe, it, expect } from "vitest";
import { vol } from "memfs";
import * as fs from "fs";
import { recoverJournal } from "../../ub/restore";
import { writeEntry, type JournalEntry } from "../../ub/journal";
import { backupDirFor, type AgentHome } from "../../ub/paths";

const h: AgentHome = { home: "/agent", staging: "/agent/staging", backups: "/agent/backups", journal: "/agent/journal" };
const bundle = "/Volumes/Ext/Apps/X.app";
// memfs reports dev 0 everywhere; fake a second volume mounted at /Volumes/Ext
const stat = (async (p: fs.PathLike) => ({ dev: String(p).startsWith("/Volumes/Ext") ? 2 : 1 })) as unknown as typeof fs.promises.stat;
const prefix = `.squeaky-ub-staging-${process.getuid!()}-`;

const entry = (seq: number, stagingDir: string): JournalEntry => ({
  runId: "r1", seq, bundle, bundleId: null, version: "1.0", build: "1",
  backupDir: backupDirFor(h, bundle, "1", `r1s${seq}`), stagingDir,
  files: [{ rel: "Contents/MacOS/x", origIno: 1, origSize: 2, origMtimeMs: 3 }], phase: "staged",
});

describe("recoverJournal cross-volume staging removal", () => {
  it("removes a staging dir directly under the bundle's mount point and reports one anywhere else", async () => {
    const good = `/Volumes/Ext/${prefix}abc`;
    const forged = `/Volumes/Ext/victim/${prefix}forged`;
    vol.fromJSON({ "/agent/journal/.keep": "", "/agent/staging/.keep": "", [`${good}/t`]: "", [`${forged}/keep.txt`]: "precious" });
    await writeEntry(h, entry(0, good));
    await writeEntry(h, entry(1, forged));

    const res = await recoverJournal(h, "other", { stat });

    expect(res.map((x) => x.result)).toEqual(["cleaned", "cleaned"]);
    expect(fs.existsSync(good)).toBe(false);
    expect(fs.readFileSync(`${forged}/keep.txt`, "utf8")).toBe("precious");
    expect(res[0].notes).toEqual([]);
    expect(res[1].notes.join("\n")).toMatch(/not a squeaky staging location/);
  });
});
