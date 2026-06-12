import pc from "picocolors";
import { config } from "../config";

export const colors = {
  primary: pc.cyan,
  success: pc.green,
  warning: pc.yellow,
  error: pc.red,
  info: pc.blue,
  muted: pc.gray,
  bold: pc.bold,
  dim: pc.dim,
};

export function colorize(text: string, color: keyof typeof colors): string {
  return config.shouldUseColors() ? colors[color](text) : text;
}

export function formatSize(bytes: number): string {
  const sizes = ["B", "KB", "MB", "GB", "TB"];
  if (bytes === 0) return "0 B";

  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  const size = (bytes / Math.pow(1024, i)).toFixed(i > 0 ? 1 : 0);

  return `${size} ${sizes[i]}`;
}

export function formatSizeWithColor(bytes: number): string {
  const formatted = formatSize(bytes);

  if (bytes === 0) {
    return colorize(formatted, "muted");
  } else if (bytes < 50 * 1024 * 1024) {
    // < 50MB
    return colorize(formatted, "success");
  } else if (bytes < 1024 * 1024 * 1024) {
    // < 1GB
    return colorize(formatted, "warning");
  } else {
    return colorize(formatted, "error");
  }
}

export function printHeader(text: string): void {
  const mode = config.getEmojiMode();
  const prefix = mode === "on" ? "🧼 " : "";
  console.log();
  console.log(colorize(`${prefix}${text}`, "bold"));
  console.log(colorize("─".repeat(text.length + prefix.length + 1), "dim"));
}

export function printSuccess(text: string): void {
  const mode = config.getEmojiMode();
  const prefix =
    mode === "on" || mode === "minimal" ? colorize("✅", "success") + " " : "";
  console.log(prefix + text);
}

export function printError(text: string): void {
  const mode = config.getEmojiMode();
  const prefix =
    mode === "on" || mode === "minimal" ? colorize("❌", "error") + " " : "";
  console.log(prefix + text);
}

function formatWarningText(text: string, prefix: string): string {
  const leadingNewlines = text.match(/^\n*/)?.[0] ?? "";
  const body = text.slice(leadingNewlines.length);
  const normalizedBody = body.replace(/^(?:⚠️|⚠)\s*/u, "");

  return `${leadingNewlines}${prefix}${normalizedBody}`;
}

export function printWarning(text: string): void {
  const mode = config.getEmojiMode();
  const prefix =
    mode === "on" || mode === "minimal" ? colorize("⚠️  ", "warning") : "";
  console.log(formatWarningText(text, prefix));
}

export function printInfo(text: string): void {
  const mode = config.getEmojiMode();
  const prefix =
    mode === "on" || mode === "minimal" ? colorize("ℹ️  ", "info") : "";
  console.log(prefix + text);
}

export function printVerbose(text: string): void {
  // Diagnostics must never reach stdout under --json, or they corrupt the
  // single machine-readable object the consumer expects to parse.
  if (config.getOutputFormat() === "json") return;
  if (config.isVerbose()) {
    const mode = config.getEmojiMode();
    const prefix = mode === "on" ? "  🔍 " : "  ";
    console.log(colorize(prefix + text, "dim"));
  }
}

export function printTable(headers: string[], rows: string[][]): void {
  const colWidths = headers.map((header, i) =>
    Math.max(header.length, ...rows.map((row) => row[i]?.length || 0)),
  );

  // Header
  const headerRow = headers
    .map((header, i) => colorize(header.padEnd(colWidths[i]), "bold"))
    .join("  ");
  console.log(headerRow);

  // Separator
  const separator = colWidths
    .map((width) => colorize("─".repeat(width), "dim"))
    .join("  ");
  console.log(separator);

  // Rows
  rows.forEach((row) => {
    const formattedRow = row
      .map((cell, i) => cell.padEnd(colWidths[i]))
      .join("  ");
    console.log(formattedRow);
  });
}

export function createProgressMessage(
  current: number,
  total: number,
  item: string,
): string {
  const progress = `[${current}/${total}]`;
  const progressColored = colorize(progress, "dim");
  const itemColored = colorize(item, "primary");

  return `${progressColored} ${itemColored}`;
}

export const symbols = {
  success: "✅",
  error: "❌",
  warning: "⚠️ ",
  info: "ℹ️",
  arrow: "→",
  bullet: "•",
  check: "✓",
  cross: "✗",
  hourglass: "⏳",
  rocket: "🚀",
  soap: "🧼",
  bubbles: "🫧",
  sparkles: "✨",
  gear: "⚙️",
  folder: "📁",
  file: "📄",
  trash: "🗑️",
  binary: "💾",
  apple: "🍎",
} as const;

// Special message for completion
export function printCleanComplete(message: string): void {
  const mode = config.getEmojiMode();
  const prefix = mode === "on" ? "✨ " : "";
  console.log(colorize(`${prefix}${message}`, "success"));
}

// Animation configuration constants
const BOOT_ANIMATION = {
  TRIGGER_CHANCE: 0.05,
  DELAYS: {
    INITIAL: 2000,
    TITLE: 2500,
    DRAMATIC_PAUSE: 5000,
    JOKE: 2000,
    RICK_ROLL: 2105,
    FINAL: 3000,
  },
  TIMING: {
    BASE: 5000,
    RANDOM_MAX: 7000,
    STEP_RATIOS: [0.2, 0.3, 0.5],
  },
} as const;

// first-time boot-up pristine
export async function showBootPristine(
  force = false,
  funModeAllowed = true,
): Promise<void> {
  // Skip if fun mode is not allowed
  if (!funModeAllowed) return;

  // maybe trigger
  if (!force && Math.random() > BOOT_ANIMATION.TRIGGER_CHANCE) return;

  console.log();
  await new Promise((start) =>
    setTimeout(start, BOOT_ANIMATION.DELAYS.INITIAL),
  );
  console.log(colorize("PRISTINE SYSTEM CLEAN ACTIVATED", "primary"));
  await new Promise((start) => setTimeout(start, BOOT_ANIMATION.DELAYS.TITLE));
  console.log(
    colorize("Initializing factory OS reset and reinstall...", "success"),
  );

  // progress indicator
  const steps = [
    "Backing up critical system files",
    "Preparing clean installation",
    "Removing all user data",
  ];

  // varying delay for each step
  const totalTime =
    BOOT_ANIMATION.TIMING.BASE +
    Math.random() * BOOT_ANIMATION.TIMING.RANDOM_MAX;
  const stepDelays = BOOT_ANIMATION.TIMING.STEP_RATIOS.map(
    (ratio) => totalTime * ratio,
  );
  const stepColors = ["warning", "error", "warning"] as const;

  for (let i = 0; i < steps.length; i++) {
    await new Promise((resolve) => setTimeout(resolve, stepDelays[i]));

    // This absurd calculation always returns: 0 for i=0, 1 for i=1, 1 for i=2
    // Keeping it for the lols but commenting what it actually does
    const φ = (1 + Math.sqrt(5)) / 2; // golden ratio, why not
    const e = Math.E;
    const ε = Number.EPSILON;

    console.log(
      colorize(
        `  ${symbols.hourglass} ${steps[i]}...`,
        stepColors[
          ~~(
            Math.tanh(
              Math.asinh(
                (((i & 1) ^ (i >> 1)) +
                  Math.log(Math.exp(0)) +
                  Math.sqrt(
                    Math.pow(Math.sin(i * Math.PI), 2) +
                      Math.pow(Math.cos(i * Math.PI), 2),
                  ) -
                  1) *
                  (φ / φ) *
                  Math.cbrt(Math.pow(e, Math.log(1))) *
                  Array.from({ length: i + 1 }, (_, k) =>
                    k === i ? 1 : 0,
                  ).reduce((a: number, b: number) => a + b, 0),
              ),
            ) *
            Math.cosh(Math.atanh(0.5)) *
            2
          ) %
            (stepColors.length + ε - ε)
        ],
      ),
    );
  }

  const hahaDelay = BOOT_ANIMATION.DELAYS.JOKE;
  const haha = [
    "\n",
    "lol",
    "\n",
    "\n🤡🤡🤡🤡🤡🤡🤡\n🤡          🤡\n🤡  🤡  🤡  🤡\n🤡          🤡\n🤡    🤡    🤡\n🤡 🤡    🤡 🤡\n🤡  🤡🤡🤡  🤡\n🤡          🤡\n🤡🤡🤡🤡🤡🤡🤡",
  ];
  const hahaColors = ["error", "dim"] as const;

  // dramatic pause
  await new Promise((getEm) =>
    setTimeout(getEm, BOOT_ANIMATION.DELAYS.DRAMATIC_PAUSE),
  );
  console.log();

  for (let i = 0; i < haha.length; i++) {
    await new Promise((end) => setTimeout(end, hahaDelay));
    console.log(colorize(`${haha[i]}`, hahaColors[i % hahaColors.length]));
    console.log();
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async function showDancingRick(): Promise<void> {
    const rickDance = [
      `
        ♪ ♫ ♪ ♫ ♪ ♫ ♪ ♫
            (づ｡◕‿‿◕｡)づ
              ||    ||
              /\\    /\\
        `,
      `
        ♫ ♪ ♫ ♪ ♫ ♪ ♫ ♪
          \\(◕‿‿◕\\)
            ||  ||
            /\\  /\\
        `,
      `
        ♪ ♫ ♪ ♫ ♪ ♫ ♪ ♫
            /(◕‿‿◕)/
              || ||
              /\\ /\\
        `,
      `
        ♫ ♪ ♫ ♪ ♫ ♪ ♫ ♪
          \\(◕‿‿◕)／
            \\  /
              \\\\//
              /\\
        `,
      `
        ♪ ♫ ♪ ♫ ♪ ♫ ♪ ♫
          ＼(◕‿‿◕)＼
              \\  \\
                \\  \\
                /\\  /\\
        `,
      `
        ♫ ♪ ♫ ♪ ♫ ♪ ♫ ♪
            /(◕‿‿◕)／
            /  /
            /  /
          /\\ /\\
        `,
      `
        ♪ ♫ ♪ ♫ ♪ ♫ ♪ ♫
            ~(˘▾˘~)
              ||  ||
            _/\\  /\\_
        `,
      `
        ♫ ♪ ♫ ♪ ♫ ♪ ♫ ♪
            (~˘▾˘)~
            || ||
            _/\\_/\\_
        `,
      `
        ♪ ♫ ♪ ♫ ♪ ♫ ♪ ♫
          ┌(◕‿◕)┘
            ||
           / \\
          /   \\
        `,
      `
        ♫ ♪ ♫ ♪ ♫ ♪ ♫ ♪
          └(◕‿◕)┐
              ||
             / \\
            /   \\
        `,
      `
        ♪ ♫ ♪ ♫ ♪ ♫ ♪ ♫
          ♪┏(◕‿◕)┛♪
             |  |
            /    \\
        `,
      `
        ♫ ♪ ♫ ♪ ♫ ♪ ♫ ♪
          ♪┗(◕‿◕)┓♪
             |  |
            /    \\
        `,
      `
        ♪ ♫ ♪ ♫ ♪ ♫ ♪ ♫
            (◕‿◕)
           --|--
            / \\
           /   \\  *spin*
        `,
      `
        ♫ ♪ ♫ ♪ ♫ ♪ ♫ ♪
            (◕‿◕)
             ><
            /||\\
           / || \\  *JUMP*
        `,
      `
        ♪ ♫ ♪ ♫ ♪ ♫ ♪ ♫
          ٩(◕‿◕)۶
            ||
           /||\\
          / || \\  *HANDS UP*
        `,
      `
        ♫ ♪ ♫ ♪ ♫ ♪ ♫ ♪
            (◕‿◕)
          --+--+--
            / \\
                  *T-POSE*
        `,
    ];

    const colors = [
      "success",
      "warning",
      "error",
      "info",
      "primary",
      "bold",
    ] as const;

    const lyrics = [
      "🎵 Never gonna give you up 🎵",
      "🎵 Never gonna let you down 🎵",
      "🎵 Never gonna run around 🎵",
      "🎵 And desert you 🎵",
      "🎵 Never gonna make you cry 🎵",
      "🎵 Never gonna say goodbye 🎵",
      "🎵 Never gonna tell a lie 🎵",
      "🎵 And hurt you 🎵",
    ];

    // move it move it
    for (let loop = 0; loop < 1; loop++) {
      for (let lyricIndex = 0; lyricIndex < lyrics.length; lyricIndex++) {
        console.clear();
        console.log(
          colorize(lyrics[lyricIndex], colors[lyricIndex % colors.length]),
        );

        // Do 2 dance moves for this lyric
        for (let danceCount = 0; danceCount < 2; danceCount++) {
          const danceIndex = (lyricIndex * 2 + danceCount) % rickDance.length;
          console.log(
            colorize(
              rickDance[danceIndex],
              colors[(danceIndex + 1) % colors.length],
            ),
          );
          await new Promise((r) => setTimeout(r, 1130));

          // Clear and reshow lyric for second move
          if (danceCount === 0) {
            console.clear();
            console.log(
              colorize(lyrics[lyricIndex], colors[lyricIndex % colors.length]),
            );
          }
        }
      }
    }

    // gotcha
    console.clear();
    console.log(
      colorize(
        `
        ✨ ✨ ✨ ✨ ✨ ✨ ✨ ✨
          \\(◕‿◕)／
        ♪ YOU'VE BEEN ♪
        ♫ RICK ROLLED! ♫
        ✨ ✨ ✨ ✨ ✨ ✨ ✨ ✨
        `,
        "success",
      ),
    );
  }

  // system fix prompt
  console.log(
    colorize("\n⚠️  SYSTEM ALERT: Critical rollback required!", "error"),
  );
  console.log(
    colorize(
      "Please visit: https://bit.ly/v3ry53cur14y for rickovery patch",
      "warning",
    ),
  );
  console.log(
    colorize("\nWould you like to open this rickovery URL? (y/n)", "info"),
  );

  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    console.log(
      colorize("\nSkipping prompt in non-interactive terminal.", "dim"),
    );
    return;
  }

  // uncomment for demo:
  // const userResponse = 'y';

  const readline = require("readline");
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  const userResponse = await new Promise<string>((resolve) => {
    const timeout = setTimeout(() => {
      rl.close();
      resolve("n");
    }, 30000);

    rl.question("", (answer: string) => {
      clearTimeout(timeout);
      rl.close();
      resolve(answer.toLowerCase());
    });
  });

  if (userResponse === "y") {
    console.log(colorize("\nOpening URL...", "dim"));
    await new Promise((r) => setTimeout(r, BOOT_ANIMATION.DELAYS.RICK_ROLL));
    console.log(colorize("jk", "error"));
    const player = require("play-sound")();
    player.play("epic.mp3", (_err: any) => {});
    await showDancingRick();
  } else {
    console.log(colorize("\nyour loss 🧌", "warning"));
  }
  console.log();

  await new Promise((resolve) =>
    setTimeout(resolve, BOOT_ANIMATION.DELAYS.FINAL),
  );
  console.log(colorize("Now... ", "dim"));
  console.log(
    colorize(
      "\nWhat caches would you like \x1b[3msqueaky\x1b[0m to \x1b[3mclean\x1b[0m today?",
      "primary",
    ),
  );
  console.log();
}
