import { DEFAULT_ANSWER_AUDIENCE, isSupportedAnswerAudience, SUPPORTED_ANSWER_AUDIENCES } from "./answer-audience.js";
import { DEFAULT_CODEX_MODEL, DEFAULT_CODEX_REASONING_EFFORT } from "./codex-defaults.js";

export class HelpError extends Error {}

function requireValue(flag, value) {
  if (!value) {
    throw new Error(`Missing value for ${flag}`);
  }
  return value;
}

export function parseArgs(argv, env) {
  if (argv[0] === "repos") {
    return parseRepoCommand(argv.slice(1));
  }

  if (argv[0] === "config") {
    return parseConfigCommand(argv.slice(1));
  }

  return parseAskCommand(argv, env);
}

function parseAskCommand(argv, env) {
  let questionParts = [];
  let questionFile = null;
  let audience = DEFAULT_ANSWER_AUDIENCE;
  let model = env.ARCHA_DEFAULT_MODEL || env.ARCHA_MODEL || DEFAULT_CODEX_MODEL;
  let reasoningEffort = env.ARCHA_DEFAULT_REASONING_EFFORT
    || env.ARCHA_REASONING_EFFORT
    || DEFAULT_CODEX_REASONING_EFFORT;
  let noSync = false;
  let noSynthesis = false;
  let repoNames = null;
  let parseOptions = true;

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

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
    noSync,
    noSynthesis,
    repoNames
  };
}

function parseRepoCommand(argv) {
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

function parseRepoSyncCommand(argv) {
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

function parseConfigCommand(argv) {
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

function parseConfigInitCommand(argv) {
  let catalogPath = null;
  let managedReposRoot = null;
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

function parseConfigDiscoverGithubCommand(argv) {
  let owner = null;
  let apply = false;
  let includeForks = true;
  let includeArchived = false;
  let addRepoNames = [];
  let overrideRepoNames = [];

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    switch (arg) {
      case "--owner":
        owner = requireValue(arg, argv[index + 1]);
        index += 1;
        break;
      case "--apply":
        apply = true;
        break;
      case "--add":
        addRepoNames = splitRepoNames(requireValue(arg, argv[index + 1]));
        index += 1;
        break;
      case "--override":
        overrideRepoNames = splitRepoNames(requireValue(arg, argv[index + 1]));
        index += 1;
        break;
      case "--include-forks":
        includeForks = true;
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

  if (!owner) {
    throw new Error('Missing value for --owner');
  }

  if (!apply && (addRepoNames.length > 0 || overrideRepoNames.length > 0)) {
    throw new Error("Use --apply when passing --add or --override.");
  }

  return {
    command: "config-discover-github",
    owner,
    apply,
    includeForks,
    includeArchived,
    addRepoNames,
    overrideRepoNames
  };
}

function splitRepoNames(value) {
  return value
    .split(",")
    .map(part => part.trim())
    .filter(Boolean);
}

function parseAudience(value) {
  if (!isSupportedAnswerAudience(value)) {
    throw new Error(
      `Unsupported audience: ${value}. Use one of: ${SUPPORTED_ANSWER_AUDIENCES.join(", ")}.`
    );
  }

  return value;
}

function isHelpFlag(value) {
  return value === "-h" || value === "--help";
}

function helpText() {
  return [
    "Archa is your personal code archaeologist.",
    "Ask your codebase how it behaves.",
    "",
    "Usage:",
    "  archa [options] <question>",
    "  archa repos list",
    "  archa repos sync [repo1,repo2,...]",
    "  archa config path",
    "  archa config init [--catalog <path>] [--managed-repos-root <path>] [--force]",
    "  archa config discover-github --owner <name> [--apply] [--add <names>] [--override <names>] [--exclude-forks] [--include-archived]",
    "",
    "Ask Options:",
    "  --repo <names>                Limit to managed repo names",
    "  --question-file <path>        Read the question from a file",
    `  --audience <mode>             Answer audience (${SUPPORTED_ANSWER_AUDIENCES.join("|")})`,
    "  --model <name>                Codex model for synthesis",
    "  --reasoning-effort <level>    Codex reasoning effort",
    "  --no-sync                     Skip clone/pull before asking",
    "  --no-synthesis                Show selected repos and sync results only",
    "  --                            Stop parsing options for the question text",
    "",
    "Config Discovery:",
    "  --owner <name>                GitHub user or org to inspect",
    "  --apply                       Interactively select repos to add or override",
    "  --add <names>                 Non-interactive add selection (comma-separated or *)",
    "  --override <names>            Non-interactive override selection (comma-separated or *)",
    "  --exclude-forks               Skip forks during discovery",
    "  --include-archived            Include archived repos during discovery",
    "",
    "Config:",
    "  ARCHA_CONFIG_PATH             Override config file location",
    "  ARCHA_DEFAULT_MODEL           Override default model",
    "  ARCHA_DEFAULT_REASONING_EFFORT Override default reasoning effort",
    "",
    "  -h, --help                    Show help"
  ].join("\n");
}
