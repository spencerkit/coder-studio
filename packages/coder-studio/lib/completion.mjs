import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { listConfigKeys } from './user-config.mjs';

export const SUPPORTED_COMPLETION_SHELLS = ['bash', 'zsh', 'fish'];

const TOP_LEVEL_COMMANDS = [
  'help',
  'start',
  'stop',
  'restart',
  'status',
  'logs',
  'open',
  'doctor',
  'config',
  'auth',
  'completion',
];

const HELP_TOPICS = TOP_LEVEL_COMMANDS.filter((command) => command !== 'help');
const CONFIG_SUBCOMMANDS = ['path', 'show', 'get', 'set', 'unset', 'validate', 'root', 'password', 'auth'];
const CONFIG_ROOT_SUBCOMMANDS = ['show', 'set', 'clear'];
const CONFIG_PASSWORD_SUBCOMMANDS = ['status', 'set', 'clear'];
const CONFIG_AUTH_SUBCOMMANDS = ['public-mode', 'session-idle', 'session-max'];
const AUTH_SUBCOMMANDS = ['status', 'ip'];
const AUTH_IP_SUBCOMMANDS = ['list', 'unblock'];
const CONFIG_KEYS = listConfigKeys();

const TOP_LEVEL_FLAGS = ['--help', '-h', '--version', '-v'];
const START_FLAGS = ['--host', '--port', '--foreground', '--json', '--help', '-h'];
const STOP_FLAGS = ['--json', '--help', '-h'];
const RESTART_FLAGS = ['--json', '--help', '-h'];
const STATUS_FLAGS = ['--host', '--port', '--json', '--help', '-h'];
const LOGS_FLAGS = ['--follow', '-f', '--lines', '-n', '--help', '-h'];
const OPEN_FLAGS = ['--host', '--port', '--json', '--help', '-h'];
const DOCTOR_FLAGS = ['--host', '--port', '--json', '--help', '-h'];
const CONFIG_FLAGS = ['--json', '--help', '-h'];
const AUTH_FLAGS = ['--json', '--help', '-h'];
const COMPLETION_FLAGS = ['--help', '-h'];
const COMPLETION_COMMANDS = ['install', ...SUPPORTED_COMPLETION_SHELLS];
const COMPLETION_INSTALL_FLAGS = ['--json', '--help', '-h'];
const CONFIG_PASSWORD_SET_FLAGS = ['--stdin', '--help', '-h'];
const AUTH_IP_UNBLOCK_FLAGS = ['--all', '--json', '--help', '-h'];

const MANAGED_BLOCK_START = '# >>> coder-studio completion >>>';
const MANAGED_BLOCK_END = '# <<< coder-studio completion <<<';

function words(items) {
  return items.join(' ');
}

function lines(items) {
  return `${items.join('\n')}\n`;
}

function generateBashScript() {
  return lines([
    '# bash completion for coder-studio',
    '__coder_studio_complete() {',
    '  local cur prev command subcommand nested',
    '  COMPREPLY=()',
    '  cur="${COMP_WORDS[COMP_CWORD]}"',
    '  prev="${COMP_WORDS[COMP_CWORD-1]}"',
    '  command="${COMP_WORDS[1]}"',
    '  subcommand="${COMP_WORDS[2]}"',
    '  nested="${COMP_WORDS[3]}"',
    '',
    '  case "$prev" in',
    '    --host|--port|--lines|-n)',
    '      return 0',
    '      ;;',
    '  esac',
    '',
    '  if [[ $COMP_CWORD -eq 1 ]]; then',
    '    if [[ "$cur" == -* ]]; then',
    `      COMPREPLY=( $(compgen -W "${words(TOP_LEVEL_FLAGS)}" -- "$cur") )`,
    '    else',
    `      COMPREPLY=( $(compgen -W "${words(TOP_LEVEL_COMMANDS)}" -- "$cur") )`,
    '    fi',
    '    return 0',
    '  fi',
    '',
    '  case "$command" in',
    '    help)',
    `      COMPREPLY=( $(compgen -W "${words(HELP_TOPICS.concat(COMPLETION_FLAGS))}" -- "$cur") )`,
    '      return 0',
    '      ;;',
    '    start)',
    `      COMPREPLY=( $(compgen -W "${words(START_FLAGS)}" -- "$cur") )`,
    '      return 0',
    '      ;;',
    '    stop)',
    `      COMPREPLY=( $(compgen -W "${words(STOP_FLAGS)}" -- "$cur") )`,
    '      return 0',
    '      ;;',
    '    restart)',
    `      COMPREPLY=( $(compgen -W "${words(RESTART_FLAGS)}" -- "$cur") )`,
    '      return 0',
    '      ;;',
    '    status)',
    `      COMPREPLY=( $(compgen -W "${words(STATUS_FLAGS)}" -- "$cur") )`,
    '      return 0',
    '      ;;',
    '    logs)',
    `      COMPREPLY=( $(compgen -W "${words(LOGS_FLAGS)}" -- "$cur") )`,
    '      return 0',
    '      ;;',
    '    open)',
    `      COMPREPLY=( $(compgen -W "${words(OPEN_FLAGS)}" -- "$cur") )`,
    '      return 0',
    '      ;;',
    '    doctor)',
    `      COMPREPLY=( $(compgen -W "${words(DOCTOR_FLAGS)}" -- "$cur") )`,
    '      return 0',
    '      ;;',
    '    completion)',
    '      if [[ $COMP_CWORD -eq 2 ]]; then',
    `        COMPREPLY=( $(compgen -W "${words(COMPLETION_COMMANDS.concat(COMPLETION_FLAGS))}" -- "$cur") )`,
    '        return 0',
    '      fi',
    '      if [[ "$subcommand" == "install" ]]; then',
    '        if [[ $COMP_CWORD -eq 3 ]]; then',
    `          COMPREPLY=( $(compgen -W "${words(SUPPORTED_COMPLETION_SHELLS)}" -- "$cur") )`,
    '        else',
    `          COMPREPLY=( $(compgen -W "${words(COMPLETION_INSTALL_FLAGS)}" -- "$cur") )`,
    '        fi',
    '        return 0',
    '      fi',
    `      COMPREPLY=( $(compgen -W "${words(SUPPORTED_COMPLETION_SHELLS.concat(COMPLETION_FLAGS))}" -- "$cur") )`,
    '      return 0',
    '      ;;',
    '    config)',
    '      if [[ $COMP_CWORD -eq 2 ]]; then',
    `        COMPREPLY=( $(compgen -W "${words(CONFIG_SUBCOMMANDS.concat(CONFIG_FLAGS))}" -- "$cur") )`,
    '        return 0',
    '      fi',
    '      case "$subcommand" in',
    '        get|set|unset)',
    '          if [[ $COMP_CWORD -eq 3 ]]; then',
    `            COMPREPLY=( $(compgen -W "${words(CONFIG_KEYS)}" -- "$cur") )`,
    '            return 0',
    '          fi',
    '          ;;',
    '        show|validate|path)',
    `          COMPREPLY=( $(compgen -W "${words(CONFIG_FLAGS)}" -- "$cur") )`,
    '          return 0',
    '          ;;',
    '        root)',
    '          if [[ $COMP_CWORD -eq 3 ]]; then',
    `            COMPREPLY=( $(compgen -W "${words(CONFIG_ROOT_SUBCOMMANDS.concat(COMPLETION_FLAGS))}" -- "$cur") )`,
    '            return 0',
    '          fi',
    '          ;;',
    '        password)',
    '          if [[ $COMP_CWORD -eq 3 ]]; then',
    `            COMPREPLY=( $(compgen -W "${words(CONFIG_PASSWORD_SUBCOMMANDS.concat(COMPLETION_FLAGS))}" -- "$cur") )`,
    '            return 0',
    '          fi',
    '          if [[ "$nested" == "set" ]]; then',
    `            COMPREPLY=( $(compgen -W "${words(CONFIG_PASSWORD_SET_FLAGS)}" -- "$cur") )`,
    '            return 0',
    '          fi',
    '          ;;',
    '        auth)',
    '          if [[ $COMP_CWORD -eq 3 ]]; then',
    `            COMPREPLY=( $(compgen -W "${words(CONFIG_AUTH_SUBCOMMANDS.concat(COMPLETION_FLAGS))}" -- "$cur") )`,
    '            return 0',
    '          fi',
    '          if [[ "$nested" == "public-mode" && $COMP_CWORD -eq 4 ]]; then',
    '            COMPREPLY=( $(compgen -W "on off" -- "$cur") )',
    '            return 0',
    '          fi',
    '          ;;',
    '      esac',
    '      ;;',
    '    auth)',
    '      if [[ $COMP_CWORD -eq 2 ]]; then',
    `        COMPREPLY=( $(compgen -W "${words(AUTH_SUBCOMMANDS.concat(AUTH_FLAGS))}" -- "$cur") )`,
    '        return 0',
    '      fi',
    '      case "$subcommand" in',
    '        status)',
    `          COMPREPLY=( $(compgen -W "${words(AUTH_FLAGS)}" -- "$cur") )`,
    '          return 0',
    '          ;;',
    '        ip)',
    '          if [[ $COMP_CWORD -eq 3 ]]; then',
    `            COMPREPLY=( $(compgen -W "${words(AUTH_IP_SUBCOMMANDS.concat(COMPLETION_FLAGS))}" -- "$cur") )`,
    '            return 0',
    '          fi',
    '          if [[ "$nested" == "list" ]]; then',
    `            COMPREPLY=( $(compgen -W "${words(AUTH_FLAGS)}" -- "$cur") )`,
    '            return 0',
    '          fi',
    '          if [[ "$nested" == "unblock" ]]; then',
    `            COMPREPLY=( $(compgen -W "${words(AUTH_IP_UNBLOCK_FLAGS)}" -- "$cur") )`,
    '            return 0',
    '          fi',
    '          ;;',
    '      esac',
    '      ;;',
    '  esac',
    '',
    `  COMPREPLY=( $(compgen -W "${words(TOP_LEVEL_FLAGS)}" -- "$cur") )`,
    '}',
    'complete -F __coder_studio_complete coder-studio',
  ]);
}

function generateZshScript() {
  return lines([
    '#compdef coder-studio',
    '',
    '_coder_studio_complete() {',
    '  local -a suggestions',
    '  local command subcommand nested prev',
    '  command="${words[2]}"',
    '  subcommand="${words[3]}"',
    '  nested="${words[4]}"',
    '  prev="${words[CURRENT-1]}"',
    '',
    '  case "$prev" in',
    '    --host|--port|--lines|-n)',
    '      return 0',
    '      ;;',
    '  esac',
    '',
    '  if (( CURRENT == 2 )); then',
    `    suggestions=(${words(TOP_LEVEL_COMMANDS)} ${words(TOP_LEVEL_FLAGS)})`,
    '    compadd -- "${suggestions[@]}"',
    '    return 0',
    '  fi',
    '',
    '  case "$command" in',
    '    help)',
    `      suggestions=(${words(HELP_TOPICS)} ${words(COMPLETION_FLAGS)})`,
    '      ;;',
    '    start)',
    `      suggestions=(${words(START_FLAGS)})`,
    '      ;;',
    '    stop)',
    `      suggestions=(${words(STOP_FLAGS)})`,
    '      ;;',
    '    restart)',
    `      suggestions=(${words(RESTART_FLAGS)})`,
    '      ;;',
    '    status)',
    `      suggestions=(${words(STATUS_FLAGS)})`,
    '      ;;',
    '    logs)',
    `      suggestions=(${words(LOGS_FLAGS)})`,
    '      ;;',
    '    open)',
    `      suggestions=(${words(OPEN_FLAGS)})`,
    '      ;;',
    '    doctor)',
    `      suggestions=(${words(DOCTOR_FLAGS)})`,
    '      ;;',
    '    completion)',
    '      if (( CURRENT == 3 )); then',
    `        suggestions=(${words(COMPLETION_COMMANDS)} ${words(COMPLETION_FLAGS)})`,
    '      elif [[ "$subcommand" == "install" ]]; then',
    '        if (( CURRENT == 4 )); then',
    `          suggestions=(${words(SUPPORTED_COMPLETION_SHELLS)})`,
    '        else',
    `          suggestions=(${words(COMPLETION_INSTALL_FLAGS)})`,
    '        fi',
    '      else',
    `        suggestions=(${words(SUPPORTED_COMPLETION_SHELLS)} ${words(COMPLETION_FLAGS)})`,
    '      fi',
    '      ;;',
    '    config)',
    '      if (( CURRENT == 3 )); then',
    `        suggestions=(${words(CONFIG_SUBCOMMANDS)} ${words(CONFIG_FLAGS)})`,
    '      else',
    '        case "$subcommand" in',
    '          get|set|unset)',
    '            if (( CURRENT == 4 )); then',
    `              suggestions=(${words(CONFIG_KEYS)})`,
    '            else',
    '              suggestions=()',
    '            fi',
    '            ;;',
    '          show|validate|path)',
    `            suggestions=(${words(CONFIG_FLAGS)})`,
    '            ;;',
    '          root)',
    '            if (( CURRENT == 4 )); then',
    `              suggestions=(${words(CONFIG_ROOT_SUBCOMMANDS)} ${words(COMPLETION_FLAGS)})`,
    '            else',
    '              suggestions=()',
    '            fi',
    '            ;;',
    '          password)',
    '            if (( CURRENT == 4 )); then',
    `              suggestions=(${words(CONFIG_PASSWORD_SUBCOMMANDS)} ${words(COMPLETION_FLAGS)})`,
    '            elif [[ "$nested" == "set" ]]; then',
    `              suggestions=(${words(CONFIG_PASSWORD_SET_FLAGS)})`,
    '            else',
    '              suggestions=()',
    '            fi',
    '            ;;',
    '          auth)',
    '            if (( CURRENT == 4 )); then',
    `              suggestions=(${words(CONFIG_AUTH_SUBCOMMANDS)} ${words(COMPLETION_FLAGS)})`,
    '            elif [[ "$nested" == "public-mode" ]] && (( CURRENT == 5 )); then',
    '              suggestions=(on off)',
    '            else',
    '              suggestions=()',
    '            fi',
    '            ;;',
    '          *)',
    '            suggestions=()',
    '            ;;',
    '        esac',
    '      fi',
    '      ;;',
    '    auth)',
    '      if (( CURRENT == 3 )); then',
    `        suggestions=(${words(AUTH_SUBCOMMANDS)} ${words(AUTH_FLAGS)})`,
    '      else',
    '        case "$subcommand" in',
    '          status)',
    `            suggestions=(${words(AUTH_FLAGS)})`,
    '            ;;',
    '          ip)',
    '            if (( CURRENT == 4 )); then',
    `              suggestions=(${words(AUTH_IP_SUBCOMMANDS)} ${words(COMPLETION_FLAGS)})`,
    '            elif [[ "$nested" == "list" ]]; then',
    `              suggestions=(${words(AUTH_FLAGS)})`,
    '            elif [[ "$nested" == "unblock" ]]; then',
    `              suggestions=(${words(AUTH_IP_UNBLOCK_FLAGS)})`,
    '            else',
    '              suggestions=()',
    '            fi',
    '            ;;',
    '          *)',
    '            suggestions=()',
    '            ;;',
    '        esac',
    '      fi',
    '      ;;',
    '    *)',
    `      suggestions=(${words(TOP_LEVEL_FLAGS)})`,
    '      ;;',
    '  esac',
    '',
    '  (( ${#suggestions[@]} )) && compadd -- "${suggestions[@]}"',
    '}',
    '',
    'if ! typeset -f compdef >/dev/null 2>&1; then',
    '  autoload -Uz compinit',
    '  compinit >/dev/null 2>&1',
    'fi',
    '',
    'compdef _coder_studio_complete coder-studio',
  ]);
}

function generateFishScript() {
  return lines([
    '# fish completion for coder-studio',
    '',
    'complete -c coder-studio -n "not __fish_seen_subcommand_from help start stop restart status logs open doctor config auth completion" -a "help start stop restart status logs open doctor config auth completion"',
    'complete -c coder-studio -n "not __fish_seen_subcommand_from help start stop restart status logs open doctor config auth completion" -l help -s h',
    'complete -c coder-studio -n "not __fish_seen_subcommand_from help start stop restart status logs open doctor config auth completion" -l version -s v',
    '',
    'complete -c coder-studio -n "__fish_seen_subcommand_from help" -a "start stop restart status logs open doctor config auth completion"',
    '',
    'complete -c coder-studio -n "__fish_seen_subcommand_from start" -l host -r',
    'complete -c coder-studio -n "__fish_seen_subcommand_from start" -l port -r',
    'complete -c coder-studio -n "__fish_seen_subcommand_from start" -l foreground',
    'complete -c coder-studio -n "__fish_seen_subcommand_from start" -l json',
    'complete -c coder-studio -n "__fish_seen_subcommand_from start" -l help -s h',
    '',
    'complete -c coder-studio -n "__fish_seen_subcommand_from stop" -l json',
    'complete -c coder-studio -n "__fish_seen_subcommand_from stop" -l help -s h',
    '',
    'complete -c coder-studio -n "__fish_seen_subcommand_from restart" -l json',
    'complete -c coder-studio -n "__fish_seen_subcommand_from restart" -l help -s h',
    '',
    'complete -c coder-studio -n "__fish_seen_subcommand_from status" -l host -r',
    'complete -c coder-studio -n "__fish_seen_subcommand_from status" -l port -r',
    'complete -c coder-studio -n "__fish_seen_subcommand_from status" -l json',
    'complete -c coder-studio -n "__fish_seen_subcommand_from status" -l help -s h',
    '',
    'complete -c coder-studio -n "__fish_seen_subcommand_from logs" -l follow -s f',
    'complete -c coder-studio -n "__fish_seen_subcommand_from logs" -l lines -s n -r',
    'complete -c coder-studio -n "__fish_seen_subcommand_from logs" -l help -s h',
    '',
    'complete -c coder-studio -n "__fish_seen_subcommand_from open" -l host -r',
    'complete -c coder-studio -n "__fish_seen_subcommand_from open" -l port -r',
    'complete -c coder-studio -n "__fish_seen_subcommand_from open" -l json',
    'complete -c coder-studio -n "__fish_seen_subcommand_from open" -l help -s h',
    '',
    'complete -c coder-studio -n "__fish_seen_subcommand_from doctor" -l host -r',
    'complete -c coder-studio -n "__fish_seen_subcommand_from doctor" -l port -r',
    'complete -c coder-studio -n "__fish_seen_subcommand_from doctor" -l json',
    'complete -c coder-studio -n "__fish_seen_subcommand_from doctor" -l help -s h',
    '',
    'complete -c coder-studio -n "__fish_seen_subcommand_from completion; and not __fish_seen_subcommand_from install bash zsh fish" -a "install bash zsh fish"',
    'complete -c coder-studio -n "__fish_seen_subcommand_from completion" -l help -s h',
    'complete -c coder-studio -n "__fish_seen_subcommand_from completion; and __fish_seen_subcommand_from install; and not __fish_seen_subcommand_from bash zsh fish" -a "bash zsh fish"',
    'complete -c coder-studio -n "__fish_seen_subcommand_from completion; and __fish_seen_subcommand_from install" -l json',
    '',
    'complete -c coder-studio -n "__fish_seen_subcommand_from config; and not __fish_seen_subcommand_from path show get set unset validate root password auth" -a "path show get set unset validate root password auth"',
    'complete -c coder-studio -n "__fish_seen_subcommand_from config" -l json',
    'complete -c coder-studio -n "__fish_seen_subcommand_from config" -l help -s h',
    'complete -c coder-studio -n "__fish_seen_subcommand_from config; and __fish_seen_subcommand_from get set unset" -a "server.host server.port root.path auth.publicMode auth.password auth.sessionIdleMinutes auth.sessionMaxHours system.openCommand logs.tailLines"',
    'complete -c coder-studio -n "__fish_seen_subcommand_from config; and __fish_seen_subcommand_from root; and not __fish_seen_subcommand_from show set clear" -a "show set clear"',
    'complete -c coder-studio -n "__fish_seen_subcommand_from config; and __fish_seen_subcommand_from password; and not __fish_seen_subcommand_from status set clear" -a "status set clear"',
    'complete -c coder-studio -n "__fish_seen_subcommand_from config; and __fish_seen_subcommand_from password; and __fish_seen_subcommand_from set" -l stdin',
    'complete -c coder-studio -n "__fish_seen_subcommand_from config; and __fish_seen_subcommand_from auth; and not __fish_seen_subcommand_from public-mode session-idle session-max" -a "public-mode session-idle session-max"',
    'complete -c coder-studio -n "__fish_seen_subcommand_from config; and __fish_seen_subcommand_from public-mode" -a "on off"',
    '',
    'complete -c coder-studio -n "__fish_seen_subcommand_from auth; and not __fish_seen_subcommand_from status ip" -a "status ip"',
    'complete -c coder-studio -n "__fish_seen_subcommand_from auth" -l json',
    'complete -c coder-studio -n "__fish_seen_subcommand_from auth" -l help -s h',
    'complete -c coder-studio -n "__fish_seen_subcommand_from auth; and __fish_seen_subcommand_from ip; and not __fish_seen_subcommand_from list unblock" -a "list unblock"',
    'complete -c coder-studio -n "__fish_seen_subcommand_from auth; and __fish_seen_subcommand_from ip; and __fish_seen_subcommand_from unblock" -l all',
    'complete -c coder-studio -n "__fish_seen_subcommand_from auth; and __fish_seen_subcommand_from ip; and __fish_seen_subcommand_from unblock" -l json',
  ]);
}

function resolveInstallPlan(shell, env = process.env) {
  const home = os.homedir();
  const sharedCompletionDir = path.join(home, '.coder-studio', 'completions');
  const xdgConfigHome = env.XDG_CONFIG_HOME || path.join(home, '.config');

  switch (shell) {
    case 'bash':
      return {
        shell,
        scriptPath: path.join(sharedCompletionDir, 'coder-studio.bash'),
        profilePath: path.join(home, '.bashrc'),
        sourceLine: '[ -f "$HOME/.coder-studio/completions/coder-studio.bash" ] && source "$HOME/.coder-studio/completions/coder-studio.bash"',
        activationCommand: 'source ~/.bashrc',
      };
    case 'zsh':
      return {
        shell,
        scriptPath: path.join(sharedCompletionDir, 'coder-studio.zsh'),
        profilePath: path.join(home, '.zshrc'),
        sourceLine: '[ -f "$HOME/.coder-studio/completions/coder-studio.zsh" ] && source "$HOME/.coder-studio/completions/coder-studio.zsh"',
        activationCommand: 'source ~/.zshrc',
      };
    case 'fish':
      return {
        shell,
        scriptPath: path.join(xdgConfigHome, 'fish', 'completions', 'coder-studio.fish'),
        profilePath: null,
        sourceLine: null,
        activationCommand: 'exec fish',
      };
    default:
      throw new Error(`unsupported completion shell: ${shell}`);
  }
}

function buildManagedBlock(sourceLine) {
  return `${MANAGED_BLOCK_START}\n${sourceLine}\n${MANAGED_BLOCK_END}`;
}

function upsertManagedBlock(currentText, block) {
  const pattern = new RegExp(`${MANAGED_BLOCK_START}[\\s\\S]*?${MANAGED_BLOCK_END}`, 'm');
  if (pattern.test(currentText)) {
    return currentText.replace(pattern, block);
  }

  const normalized = currentText.trimEnd();
  return normalized ? `${normalized}\n\n${block}\n` : `${block}\n`;
}

async function readOptionalText(filePath) {
  try {
    return await fs.readFile(filePath, 'utf8');
  } catch (error) {
    if (error && typeof error === 'object' && error.code === 'ENOENT') {
      return '';
    }
    throw error;
  }
}

export async function installCompletionScript(shell, { env = process.env } = {}) {
  const plan = resolveInstallPlan(shell, env);
  const script = generateCompletionScript(shell);

  await fs.mkdir(path.dirname(plan.scriptPath), { recursive: true });
  await fs.writeFile(plan.scriptPath, script, 'utf8');

  let profileUpdated = false;
  if (plan.profilePath && plan.sourceLine) {
    const currentProfile = await readOptionalText(plan.profilePath);
    const nextProfile = upsertManagedBlock(currentProfile, buildManagedBlock(plan.sourceLine));
    profileUpdated = nextProfile !== currentProfile;
    if (profileUpdated) {
      await fs.writeFile(plan.profilePath, nextProfile, 'utf8');
    }
  }

  return {
    shell: plan.shell,
    scriptPath: plan.scriptPath,
    profilePath: plan.profilePath,
    profileUpdated,
    activationCommand: plan.activationCommand,
  };
}

export function generateCompletionScript(shell) {
  switch (shell) {
    case 'bash':
      return generateBashScript();
    case 'zsh':
      return generateZshScript();
    case 'fish':
      return generateFishScript();
    default:
      throw new Error(`unsupported completion shell: ${shell}`);
  }
}
