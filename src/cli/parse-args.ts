import { DEFAULT_ANSWER_AUDIENCE, isSupportedAnswerAudience, SUPPORTED_ANSWER_AUDIENCES } from "../core/answer/answer-audience.js";
import { HelpError } from "../core/cli/help-error.js";
import { DEFAULT_CODEX_MODEL, DEFAULT_CODEX_REASONING_EFFORT } from "../core/codex/constants.js";
import { SUPPORTED_SELECTION_STRATEGIES, isSelectionStrategy } from "../core/repos/selection-strategies.js";
import type { AnswerAudience } from "../core/answer/answer-audience.js";
import type {
  AskCommandOptions,
  CliCommandOptions,
  ConfigDiscoverGithubCommandOptions,
  ConfigInitCommandOptions,
  Environment,
  RepoSelectionStrategy,
  ReposListCommandOptions,
  ReposSyncCommandOptions
} from "../core/types.js";

export { HelpError };

function requireValue(flag: string, value: string | undefined): string {
  if (!value) {
    throw new Error(`Missing value for ${flag}`);
  }
  return value;
}

export function parseArgs(argv: string[], env: Environment): CliCommandOptions {
  if (argv[0] === "repos") {
    return parseRepoCommand(argv.slice(1));
  }

  if (argv[0] === "config") {
    return parseConfigCommand(argv.slice(1));
  }

  return parseAskCommand(argv, env);
}

function parseAskCommand(argv: string[], env: Environment): AskCommandOptions {
  const questionParts: string[] = [];
  let questionFile: string | null = null;
  let audience: AnswerAudience = DEFAULT_ANSWER_AUDIENCE;
  let model = env.ATC_DEFAULT_MODEL || DEFAULT_CODEX_MODEL;
  let reasoningEffort = env.ATC_DEFAULT_REASONING_EFFORT || DEFAULT_CODEX_REASONING_EFFORT;
  let selectionMode: RepoSelectionStrategy = "single";
  let selectionShadowCompare = false;
  let noSync = false;
  let noSynthesis = false;
  let repoNames: string[] | null = null;
  let parseOptions = true;

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === undefined) {
      continue;
    }

    if (parseOptions && arg === "--") {
      parseOptions = false;
      continue;
    }

    if (!parseOptions) {
      questionParts.push(arg);
      continue;
    }

    switch (arg) {
      case "--repo":
        repoNames = splitRepoNames(requireValue(arg, argv[index + 1]));
        index += 1;
        break;
      case "--question-file":
        questionFile = requireValue(arg, argv[index + 1]);
        index += 1;
        break;
      case "--audience":
        audience = parseAudience(requireValue(arg, argv[index + 1]));
        index += 1;
        break;
      case "--model":
        model = requireValue(arg, argv[index + 1]);
        index += 1;
        break;
      case "--reasoning-effort":
        reasoningEffort = requireValue(arg, argv[index + 1]);
        index += 1;
        break;
      case "--selection-mode":
        selectionMode = parseSelectionMode(requireValue(arg, argv[index + 1]));
        index += 1;
        break;
      case "--selection-shadow-compare":
        selectionShadowCompare = true;
        break;
      case "--no-sync":
        noSync = true;
        break;
      case "--no-synthesis":
        noSynthesis = true;
        break;
      case "-h":
      case "--help":
        throw new HelpError(helpText());
      default:
        if (arg.startsWith("-")) {
          throw new Error(`Unknown ask option: ${arg}\n\n${helpText()}`);
        }
        questionParts.push(arg);
        break;
    }
  }

  const question = questionParts.join(" ").trim();
  if (question && questionFile) {
    throw new Error("Use either a positional question or --question-file, not both");
  }
  if (!question && !questionFile) {
    throw new Error(helpText());
  }

  return {
    command: "ask",
    question,
    questionFile,
    audience,
    model,
    reasoningEffort,
    selectionMode,
    selectionShadowCompare,
    noSync,
    noSynthesis,
    repoNames
  };
}

function parseRepoCommand(argv: string[]): ReposListCommandOptions | ReposSyncCommandOptions {
  const subcommand = argv[0];

  switch (subcommand) {
    case "list":
      return {
        command: "repos-list"
      };
    case "sync":
      return parseRepoSyncCommand(argv.slice(1));
    case "-h":
    case "--help":
    case undefined:
      throw new HelpError(helpText());
    default:
      throw new Error(`Unknown repos subcommand: ${subcommand}\n\n${helpText()}`);
  }
}

function parseRepoSyncCommand(argv: string[]): ReposSyncCommandOptions {
  if (argv.some(isHelpFlag)) {
    throw new HelpError(helpText());
  }

  const invalidOption = argv.find(arg => arg.startsWith("-"));
  if (invalidOption) {
    throw new Error(`Unknown repos sync option: ${invalidOption}\n\n${helpText()}`);
  }

  return {
    command: "repos-sync",
    repoNames: splitRepoNames(argv.join(","))
  };
}

function parseConfigCommand(argv: string[]): ConfigInitCommandOptions | ConfigDiscoverGithubCommandOptions | { command: "config-path" } {
  const subcommand = argv[0];

  switch (subcommand) {
    case "path":
      return {
        command: "config-path"
      };
    case "init":
      return parseConfigInitCommand(argv.slice(1));
    case "discover-github":
      return parseConfigDiscoverGithubCommand(argv.slice(1));
    case "-h":
    case "--help":
    case undefined:
      throw new HelpError(helpText());
    default:
      throw new Error(`Unknown config subcommand: ${subcommand}\n\n${helpText()}`);
  }
}

function parseConfigInitCommand(argv: string[]): ConfigInitCommandOptions {
  let catalogPath: string | null = null;
  let managedReposRoot: string | null = null;
  let force = false;

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    switch (arg) {
      case "--catalog":
        catalogPath = requireValue(arg, argv[index + 1]);
        index += 1;
        break;
      case "--managed-repos-root":
        managedReposRoot = requireValue(arg, argv[index + 1]);
        index += 1;
        break;
      case "--force":
        force = true;
        break;
      case "-h":
      case "--help":
        throw new HelpError(helpText());
      default:
        throw new Error(`Unknown config init option: ${arg}\n\n${helpText()}`);
    }
  }

  return {
    command: "config-init",
    catalogPath,
    managedReposRoot,
    force
  };
}

function parseConfigDiscoverGithubCommand(argv: string[]): ConfigDiscoverGithubCommandOptions {
  let owner: string | null = null;
  let includeForks = true;
  let includeArchived = false;
  let addRepoNames: string[] = [];
  let overrideRepoNames: string[] = [];

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === undefined) {
      continue;
    }

    switch (arg) {
      case "--owner":
        owner = requireValue(arg, argv[index + 1]);
        index += 1;
        break;
      case "--add":
        addRepoNames = splitRepoNames(requireValue(arg, argv[index + 1]));
        index += 1;
        break;
      case "--override":
        overrideRepoNames = splitRepoNames(requireValue(arg, argv[index + 1]));
        index += 1;
        break;
      case "--exclude-forks":
        includeForks = false;
        break;
      case "--include-archived":
        includeArchived = true;
        break;
      case "-h":
      case "--help":
        throw new HelpError(helpText());
      default:
        throw new Error(`Unknown config discover-github option: ${arg}\n\n${helpText()}`);
    }
  }

  return {
    command: "config-discover-github",
    owner,
    includeForks,
    includeArchived,
    addRepoNames,
    overrideRepoNames
  };
}

function splitRepoNames(value: string): string[] {
  return value
    .split(",")
    .map(part => part.trim())
    .filter(Boolean);
}

function parseAudience(value: string): AnswerAudience {
  if (!isSupportedAnswerAudience(value)) {
    throw new Error(
      `Unsupported audience: ${value}. Use one of: ${SUPPORTED_ANSWER_AUDIENCES.join(", ")}.`
    );
  }

  return value;
}

function parseSelectionMode(value: string): RepoSelectionStrategy {
  if (isSelectionStrategy(value)) {
    return value;
  }

  throw new Error(`Unsupported selection mode: ${value}. Use one of: ${SUPPORTED_SELECTION_STRATEGIES.join(", ")}.`);
}

function isHelpFlag(value: string): boolean {
  return value === "-h" || value === "--help";
}

function helpText(): string {
  return [
    "ask-the-code is your personal code archaeologist.",
    "Ask your codebase how it behaves.",
    "",
    "Usage:",
    "  atc [options] <question>",
    "  atc repos list",
    "  atc repos sync [repo1,repo2,...]",
    "  atc config path",
    "  atc config init [--catalog <path>] [--managed-repos-root <path>] [--force]",
    "  atc config discover-github [--owner <name|@accessible>] [--add <names>] [--override <names>] [--exclude-forks] [--include-archived]",
    "",
    "Ask Options:",
    "  --repo <names>                Limit to managed repo names",
    "  --question-file <path>        Read the question from a file",
    `  --audience <mode>             Answer audience (${SUPPORTED_ANSWER_AUDIENCES.join("|")})`,
    "  --model <name>                Codex model for synthesis",
    "  --reasoning-effort <level>    Codex reasoning effort",
    `  --selection-mode <mode>       Repo selection mode (${SUPPORTED_SELECTION_STRATEGIES.join("|")})`,
    "  --selection-shadow-compare    Benchmark none/low/high repo selection in the background (3 parallel selector calls)",
    "  --no-sync                     Skip clone/pull before asking",
    "  --no-synthesis                Show selected repos and sync results only",
    "  --                            Stop parsing options for the question text",
    "",
    "Config Discovery:",
    "  --owner <name>                GitHub user, org, or @accessible; prompts on TTY and otherwise defaults to @accessible",
    "  --add <names>                 Non-interactive add selection (comma-separated or *)",
    "  --override <names>            Non-interactive override selection (comma-separated or *)",
    "  --exclude-forks               Skip forks during discovery",
    "  --include-archived            Include archived repos during discovery",
    "",
    "Config:",
    "  ATC_CONFIG_PATH               Override config file location",
    "  ATC_DEFAULT_MODEL             Override default model",
    "  ATC_DEFAULT_REASONING_EFFORT  Override default reasoning effort",
    "",
    "  -h, --help                    Show help"
  ].join("\n");
}
