import { promises as fs } from "fs";
import * as cp from "child_process";

export type PlistValue =
  | string
  | number
  | boolean
  | PlistValue[]
  | { [k: string]: PlistValue };

export class PlistParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PlistParseError";
  }
}

const ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
};

function decode(s: string): string {
  return s.replace(/&(#x[0-9a-fA-F]+|#\d+|\w+);/g, (m, e: string) => {
    if (e[0] === "#") {
      const code =
        e[1] === "x" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(code) && code <= 0x10ffff
        ? String.fromCodePoint(code)
        : m;
    }
    return ENTITIES[e] ?? m;
  });
}

type Container =
  | { kind: "dict"; value: { [k: string]: PlistValue }; key: string | null }
  | { kind: "array"; value: PlistValue[] };

const LEAVES = new Set(["key", "string", "integer", "real", "data", "date"]);

/**
 * Parse an XML property list into plain JS values. `<data>` yields its base64
 * text (whitespace stripped), `<date>` its ISO string, `<real>`/`<integer>`
 * numbers. Throws PlistParseError on malformed input.
 */
export function parseXmlPlist(xml: string): PlistValue {
  const stack: Container[] = [];
  let root: PlistValue | undefined;
  let haveRoot = false;
  let sawPlist = false;
  let leaf: { name: string; text: string } | null = null;

  const place = (v: PlistValue): void => {
    const top = stack[stack.length - 1];
    if (!top) {
      if (haveRoot) throw new PlistParseError("multiple root values");
      root = v;
      haveRoot = true;
    } else if (top.kind === "array") {
      top.value.push(v);
    } else {
      if (top.key === null) throw new PlistParseError("dict value without key");
      top.value[top.key] = v;
      top.key = null;
    }
  };

  const finishLeaf = (name: string, text: string): void => {
    switch (name) {
      case "key": {
        const top = stack[stack.length - 1];
        if (!top || top.kind !== "dict" || top.key !== null) {
          throw new PlistParseError("unexpected <key>");
        }
        top.key = decode(text);
        return;
      }
      case "string":
        return place(decode(text));
      case "integer":
      case "real": {
        const t = text.trim();
        const n = Number(t);
        if (t === "" || Number.isNaN(n)) {
          throw new PlistParseError(`invalid <${name}>: ${t}`);
        }
        return place(n);
      }
      case "data":
        return place(text.replace(/\s+/g, ""));
      default: // date
        return place(text.trim());
    }
  };

  const tokens = xml.match(/<!--[\s\S]*?-->|<[^>]+>|[^<]+/g) ?? [];
  for (const tok of tokens) {
    if (tok[0] !== "<") {
      if (leaf) leaf.text += tok;
      else if (tok.trim() !== "") throw new PlistParseError("unexpected text");
      continue;
    }
    if (
      tok.startsWith("<!--") ||
      tok.startsWith("<?") ||
      tok.startsWith("<!")
    ) {
      continue;
    }
    const m = /^<(\/?)([A-Za-z]+)[^>]*?(\/?)>$/.exec(tok);
    if (!m) throw new PlistParseError(`bad tag: ${tok}`);
    const [, closing, name, selfClose] = m;

    if (leaf) {
      // Only the matching close tag may appear inside a leaf.
      if (closing && name === leaf.name) {
        const l = leaf;
        leaf = null;
        finishLeaf(l.name, l.text);
        continue;
      }
      throw new PlistParseError(`unexpected <${name}> inside <${leaf.name}>`);
    }

    if (closing) {
      if (name === "plist") {
        if (!sawPlist || stack.length)
          throw new PlistParseError("unbalanced </plist>");
        sawPlist = false;
        continue;
      }
      const top = stack.pop();
      if (!top || top.kind !== name) {
        throw new PlistParseError(`unbalanced </${name}>`);
      }
      if (top.kind === "dict" && top.key !== null) {
        throw new PlistParseError("dict key without value");
      }
      place(top.value);
      continue;
    }

    if (name === "plist") {
      if (selfClose) continue;
      sawPlist = true;
    } else if (name === "dict" || name === "array") {
      const c: Container =
        name === "dict"
          ? { kind: "dict", value: Object.create(null), key: null }
          : { kind: "array", value: [] };
      if (selfClose) place(c.value);
      else stack.push(c);
    } else if (name === "true" || name === "false") {
      place(name === "true");
    } else if (LEAVES.has(name)) {
      if (selfClose) {
        if (name === "integer" || name === "real") {
          throw new PlistParseError(`empty <${name}>`);
        }
        finishLeaf(name, "");
      } else {
        leaf = { name, text: "" };
      }
    } else {
      throw new PlistParseError(`unknown tag <${name}>`);
    }
  }

  if (leaf || stack.length || sawPlist) {
    throw new PlistParseError("unbalanced tags");
  }
  if (!haveRoot) throw new PlistParseError("no plist value");
  return root as PlistValue;
}

/**
 * Read and parse a plist file. XML plists parse in-process. A binary plist
 * (`bplist00`) is converted through `plutil` only when `allowSpawn`; otherwise
 * returns null (scan paths must never spawn). Throws PlistParseError on
 * malformed XML or a plutil failure; fs errors propagate.
 */
export async function readPlistFile(
  p: string,
  opts: { allowSpawn: boolean },
): Promise<PlistValue | null> {
  const buf = await fs.readFile(p);
  if (buf.subarray(0, 8).toString("latin1") === "bplist00") {
    if (!opts.allowSpawn) return null;
    const out = await new Promise<string>((resolve, reject) => {
      cp.execFile(
        "/usr/bin/plutil",
        ["-convert", "json", "-o", "-", p],
        { timeout: 10_000, maxBuffer: 16 * 1024 * 1024 },
        (err, stdout) => (err ? reject(err) : resolve(String(stdout))),
      );
    }).catch((e: unknown) => {
      throw new PlistParseError(`plutil failed: ${(e as Error).message}`);
    });
    try {
      return JSON.parse(out) as PlistValue;
    } catch (e) {
      throw new PlistParseError(
        `plutil produced invalid JSON: ${(e as Error).message}`,
      );
    }
  }
  return parseXmlPlist(buf.toString("utf8"));
}
