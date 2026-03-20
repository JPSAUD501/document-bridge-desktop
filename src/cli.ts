import path from "node:path";
import type { CliOptions } from "./types";

export function parseCliArgs(argv: string[]): CliOptions {
  const options: CliOptions = {
    help: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    if (!arg) {
      continue;
    }

    if (arg === "--help" || arg === "-h") {
      options.help = true;
      continue;
    }

    if (arg === "--resume") {
      const nextValue = argv[index + 1];
      if (nextValue) {
        options.resumePath = path.resolve(nextValue);
        index += 1;
      }
    }
  }

  return options;
}

export function printHelp(): void {
  process.stdout.write(
    [
      "ERP -> Midas TUI",
      "",
      "Comandos:",
      "  npm run start",
      "  npm run start -- --resume <run-folder>",
      "",
      "Variaveis de ambiente:",
      "  ERP_URL, MIDAS_URL",
      "",
    ].join("\n"),
  );
}
