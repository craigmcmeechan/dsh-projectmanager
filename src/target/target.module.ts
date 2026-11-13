/**
 * target — module.
 * Split out of target.ts by the module-structure refactor.
 */
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import type { TargetProbe, SystemFacts, ShellResult } from './target.interface.ts'
import type { Target } from './target.types.ts'

const run = promisify(execFile)
/**
 * Run a shell snippet on the target.
 *
 * Never interpolates caller data into the command: snippets are constants from
 * this module, so there is no injection surface. A future caller that needs a
 * parameter must validate it first, not concatenate it.
 * @param target - where to run.
 * @param script - the snippet; treated as literal shell.
 * @returns stdout/stderr and whether it exited zero.
 */
export async function runOn(
  target: Target,
  script: string,
  timeoutMs = 20_000,
): Promise<ShellResult> {
  const exec = { timeout: timeoutMs, maxBuffer: 4 * 1024 * 1024 }
  try {
    if (target.kind === 'local') {
      const { stdout, stderr } = await run('bash', ['-lc', script], exec)
      return { ok: true, stdout, stderr }
    }
    // BatchMode keeps SSH from prompting: a prompt would hang the request until
    // the timeout, which reads as a hang rather than an auth problem.
    const { stdout, stderr } = await run(
      'ssh',
      [
        '-o',
        'BatchMode=yes',
        '-o',
        'StrictHostKeyChecking=accept-new',
        '-o',
        'ConnectTimeout=8',
        '-p',
        String(target.port),
        `${target.user}@${target.host}`,
        `bash -lc ${JSON.stringify(script)}`,
      ],
      exec,
    )
    return { ok: true, stdout, stderr }
  } catch (error) {
    const detail = error as { stdout?: string; stderr?: string; message?: string; code?: string }
    return {
      ok: false,
      stdout: detail.stdout ?? '',
      stderr:
        detail.code === 'ENOENT'
          ? 'the ssh client is not installed on this host'
          : (detail.stderr ?? detail.message ?? 'command failed'),
    }
  }
}
/** Describe the target for display, so the UI can say which machine was probed. */
export function describeTarget(target: Target): string {
  return target.kind === 'local'
    ? 'this machine (the Harness host)'
    : `${target.user}@${target.host}:${target.port}`
}
/**
 * Probe node, nvm, and installed versions on the target.
 *
 * The script reports all three in one round trip, because each SSH connection
 * costs more than the commands do.
 */
export async function probeNode(target: Target): Promise<{
  current: TargetProbe
  nvm: TargetProbe
  installed: string[]
  canInstallNvm: boolean
  target: string
  error?: string
}> {
  const script = [
    'node --version 2>/dev/null || echo NODE_MISSING',
    'echo SEP',
    'export NVM_DIR="${NVM_DIR:-$HOME/.nvm}"',
    'if [ -s "$NVM_DIR/nvm.sh" ]; then echo NVM_AT:$NVM_DIR; . "$NVM_DIR/nvm.sh" >/dev/null 2>&1; nvm --version 2>/dev/null || echo NVM_NOVERSION; echo VERSIONS:; nvm ls --no-colors 2>/dev/null | grep -oE "v[0-9]+\\.[0-9]+\\.[0-9]+" | sort -u; else echo NVM_MISSING; fi',
  ].join('; ')

  const result = await runOn(target, script)
  const [nodePart = '', nvmPart = ''] = result.stdout.split('SEP')

  const nodeMatch = /v(\d+\.\d+\.\d+)/.exec(nodePart)
  const current: TargetProbe =
    nodeMatch !== null
      ? { found: true, version: `v${nodeMatch[1]}` }
      : { found: false, reason: result.ok ? 'node is not on PATH' : result.stderr.trim().split('\n')[0] }

  const nvmAt = /NVM_AT:(\S+)/.exec(nvmPart)?.[1]
  const nvmMissing = /NVM_MISSING/.test(nvmPart)
  const nvmVersion = /^(\d+\.\d+\.\d+)$/m.exec(nvmPart)?.[1]

  const nvm: TargetProbe = nvmAt !== undefined
    ? { found: true, ...(nvmVersion === undefined ? {} : { version: nvmVersion }), path: nvmAt }
    : { found: false, reason: nvmMissing ? 'nvm is not installed' : 'nvm.sh not found' }

  const versionsSection = nvmPart.includes('VERSIONS:')
    ? nvmPart.slice(nvmPart.indexOf('VERSIONS:'))
    : ''
  const installed = [...new Set(
    (versionsSection.match(/v\d+\.\d+\.\d+/g) ?? []),
  )]

  return {
    current,
    nvm,
    installed,
    // Installing nvm is only offered where the target looks installable: we have
    // a shell and nvm is absent.
    canInstallNvm: !nvm.found && result.ok,
    target: describeTarget(target),
    ...(result.ok ? {} : { error: result.stderr.trim().split('\n')[0] }),
  }
}
/**
 * Probe Docker on the target.
 *
 * Client presence and daemon reachability are reported separately: a client with
 * a dead daemon is a real state and a different fix from a missing install.
 */
export async function probeDocker(target: Target): Promise<{
  installed: boolean
  version?: string
  daemon: boolean
  daemonReason?: string
  images: Array<{ repository: string; tag: string; sizeBytes: number }>
  target: string
}> {
  const script = [
    'docker --version 2>/dev/null || echo DOCKER_MISSING',
    'echo SEP',
    'docker version --format "{{.Server.Version}}" 2>/dev/null || echo DAEMON_DOWN',
    'echo SEP',
    'docker images --format "{{.Repository}}\t{{.Tag}}\t{{.Size}}" 2>/dev/null | head -50',
  ].join('; ')

  const result = await runOn(target, script)
  const parts = result.stdout.split('SEP')
  const clientPart = parts[0] ?? ''
  const daemonPart = parts[1] ?? ''
  const imagesPart = parts[2] ?? ''

  const installed = !/DOCKER_MISSING/.test(clientPart)
  const version = /(\d+\.\d+\.\d+)/.exec(clientPart)?.[0]
  const daemon = !/DAEMON_DOWN/.test(daemonPart) && daemonPart.trim().length > 0

  const images = installed && daemon
    ? imagesPart
        .split('\n')
        .filter((line) => line.trim().length > 0 && !line.startsWith('<none>'))
        .map((line) => {
          const [repository = '', tag = '', size = '0'] = line.split('\t')
          const multiplier = /GB/i.test(size) ? 1024 ** 3 : /MB/i.test(size) ? 1024 ** 2 : /kB/i.test(size) ? 1024 : 1
          return { repository, tag, sizeBytes: Math.round(Number.parseFloat(size) * multiplier) }
        })
    : []

  return {
    installed,
    ...(version === undefined ? {} : { version }),
    daemon,
    ...(daemon ? {} : { daemonReason: installed ? 'the daemon did not answer' : 'docker is not installed' }),
    images,
    target: describeTarget(target),
  }
}
/**
 * Probe OS, hardware, git, and install capability in one round trip.
 *
 * One connection rather than several: each SSH round trip costs more than the
 * commands do, and per-fact requests would make the panel feel slow.
 */
export async function probeSystem(target: Target): Promise<SystemFacts> {
  const script = [
    '. /etc/os-release 2>/dev/null && echo "OS:$PRETTY_NAME" || echo "OS:$(uname -s)"',
    'echo "KERNEL:$(uname -r 2>/dev/null)"',
    'echo "ARCH:$(uname -m 2>/dev/null)"',
    "echo \"MEMTOTAL:$(awk '/MemTotal/ {print $2}' /proc/meminfo 2>/dev/null)\"",
    "echo \"MEMFREE:$(awk '/MemAvailable/ {print $2}' /proc/meminfo 2>/dev/null)\"",
    'echo "CPUS:$(nproc 2>/dev/null || getconf _NPROCESSORS_ONLN 2>/dev/null)"',
    'echo "GIT:$(git --version 2>/dev/null || echo MISSING)"',
    'if [ "$(id -u)" -eq 0 ]; then echo "CANINSTALL:yes"; elif sudo -n true 2>/dev/null; then echo "CANINSTALL:yes"; else echo "CANINSTALL:no"; fi',
  ].join('; ')

  const result = await runOn(target, script)
  const field = (name: string): string | undefined => {
    const match = new RegExp('^' + name + ':(.*)$', 'm').exec(result.stdout)
    const value = match?.[1]?.trim()
    return value === undefined || value.length === 0 ? undefined : value
  }
  const kb = (name: string): number | undefined => {
    const raw = field(name)
    if (raw === undefined) return undefined
    const value = Number(raw)
    return Number.isFinite(value) ? value * 1024 : undefined
  }

  const gitRaw = field('GIT')
  const gitInstalled = gitRaw !== undefined && !/MISSING/.test(gitRaw)
  const total = kb('MEMTOTAL')
  const free = kb('MEMFREE')
  const cpus = field('CPUS')

  return {
    target: describeTarget(target),
    os: field('OS') ?? 'unknown',
    kernel: field('KERNEL') ?? 'unknown',
    arch: field('ARCH') ?? 'unknown',
    ...(total === undefined ? {} : { totalMemoryBytes: total }),
    ...(free === undefined ? {} : { freeMemoryBytes: free }),
    ...(cpus === undefined ? {} : { cpus: Number(cpus) }),
    gitInstalled,
    ...(gitInstalled ? { gitVersion: gitRaw.replace(/^git version\s*/i, '') } : {}),
    canInstallPackages: field('CANINSTALL') === 'yes',
  }
}
/**
 * Fetch and install nvm on the target.
 *
 * The version is pinned: an unpinned remote script would change behaviour
 * without notice. The script is fetched, not piped blind — a failure to fetch is
 * reported rather than surfacing as a confusing shell error.
 */
export async function installNvmOn(target: Target): Promise<{ ok: boolean; detail: string }> {
  const script = [
    'export NVM_DIR="${NVM_DIR:-$HOME/.nvm}"',
    'if [ -s "$NVM_DIR/nvm.sh" ]; then echo ALREADY_INSTALLED; exit 0; fi',
    'curl -fsSL https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.1/install.sh -o /tmp/nvm-install.sh || { echo FETCH_FAILED; exit 1; }',
    'bash /tmp/nvm-install.sh >/dev/null 2>&1 || { echo INSTALL_FAILED; exit 1; }',
    '[ -s "$NVM_DIR/nvm.sh" ] && echo INSTALLED || echo MISSING_AFTER_INSTALL',
  ].join('; ')

  const result = await runOn(target, script, 5 * 60_000)
  const text = `${result.stdout}\n${result.stderr}`.trim()
  if (/ALREADY_INSTALLED/.test(text)) return { ok: true, detail: 'nvm was already installed' }
  if (/INSTALLED/.test(text)) return { ok: true, detail: 'nvm installed' }
  if (/FETCH_FAILED/.test(text)) {
    return { ok: false, detail: 'could not download the nvm install script (no network, or curl missing)' }
  }
  return { ok: false, detail: text.split('\n').filter(Boolean).slice(-2).join(' ') || 'install failed' }
}
/** Install one Node version through nvm on the target. */
export async function installNodeOn(
  target: Target,
  version: string,
): Promise<{ ok: boolean; detail: string }> {
  // Validate before it reaches a shell: the version is the one caller-controlled
  // string in this module, so it must match a strict shape.
  if (!/^v\d+\.\d+\.\d+$/.test(version)) {
    return { ok: false, detail: `"${version}" is not a full version (vN.N.N)` }
  }
  const script = [
    'export NVM_DIR="${NVM_DIR:-$HOME/.nvm}"',
    '[ -s "$NVM_DIR/nvm.sh" ] || { echo NO_NVM; exit 1; }',
    '. "$NVM_DIR/nvm.sh" >/dev/null 2>&1',
    `nvm install ${version} >/dev/null 2>&1 || { echo INSTALL_FAILED; exit 1; }`,
    `nvm which ${version}`,
  ].join('; ')

  const result = await runOn(target, script, 10 * 60_000)
  if (/NO_NVM/.test(result.stdout)) return { ok: false, detail: 'nvm is not installed on that machine' }
  if (/INSTALL_FAILED/.test(result.stdout)) return { ok: false, detail: 'nvm could not install that version' }
  return result.ok
    ? { ok: true, detail: result.stdout.trim().split('\n').at(-1) ?? 'installed' }
    : { ok: false, detail: result.stderr.trim().split('\n')[0] ?? 'install failed' }
}
/**
 * List installable Node versions on the target.
 *
 * Slow by nature: `nvm ls-remote` fetches the full remote index.
 */
export async function remoteNodeVersionsOn(
  target: Target,
): Promise<{ versions: string[]; reason?: string }> {
  const script = [
    'export NVM_DIR="${NVM_DIR:-$HOME/.nvm}"',
    '[ -s "$NVM_DIR/nvm.sh" ] || { echo NO_NVM; exit 1; }',
    '. "$NVM_DIR/nvm.sh" >/dev/null 2>&1',
    'nvm ls-remote --lts 2>/dev/null | tail -12',
  ].join('; ')

  const result = await runOn(target, script, 90_000)
  if (/NO_NVM/.test(result.stdout)) {
    return { versions: [], reason: 'nvm is not installed on that machine, so remote versions cannot be listed' }
  }
  const versions = [...new Set((result.stdout.match(/v\d+\.\d+\.\d+/g) ?? []))]
  return versions.length === 0
    ? { versions: [], reason: result.stderr.trim().split('\n')[0] || 'nvm returned nothing' }
    : { versions: versions.reverse() }
}
/** Install git on the target via the distribution package manager. */
export async function installGitOn(target: Target): Promise<{ ok: boolean; detail: string }> {
  const script = [
    'command -v git >/dev/null 2>&1 && { echo ALREADY_INSTALLED; exit 0; }',
    'SUDO=""',
    'if [ "$(id -u)" -ne 0 ]; then if sudo -n true 2>/dev/null; then SUDO="sudo -n"; else echo NO_PRIVILEGE; exit 1; fi; fi',
    '$SUDO apt-get install -y git >/dev/null 2>&1 || { echo INSTALL_FAILED; exit 1; }',
    'command -v git >/dev/null 2>&1 && echo INSTALLED || echo MISSING_AFTER_INSTALL',
  ].join('; ')

  const result = await runOn(target, script, 10 * 60_000)
  const text = result.stdout + '\n' + result.stderr
  if (/ALREADY_INSTALLED/.test(text)) return { ok: true, detail: 'git was already installed' }
  if (/NO_PRIVILEGE/.test(text)) {
    return { ok: false, detail: 'the connecting user cannot install packages (no root, no passwordless sudo)' }
  }
  if (/INSTALLED/.test(text)) return { ok: true, detail: 'git installed' }
  return { ok: false, detail: 'install did not produce a git client' }
}
/** Install Docker on the target via the distribution package manager. */
export async function installDockerOn(target: Target): Promise<{ ok: boolean; detail: string }> {
  const script = [
    'command -v docker >/dev/null 2>&1 && { echo ALREADY_INSTALLED; exit 0; }',
    'SUDO=""',
    'if [ "$(id -u)" -ne 0 ]; then if sudo -n true 2>/dev/null; then SUDO="sudo -n"; else echo NO_PRIVILEGE; exit 1; fi; fi',
    // docker.io is the distribution package; the official convenience script is
    // deliberately not piped into a shell.
    '$SUDO apt-get install -y docker.io >/dev/null 2>&1 || { echo INSTALL_FAILED; exit 1; }',
    'command -v docker >/dev/null 2>&1 && echo INSTALLED || echo MISSING_AFTER_INSTALL',
  ].join('; ')

  const result = await runOn(target, script, 10 * 60_000)
  const text = `${result.stdout}\n${result.stderr}`
  if (/ALREADY_INSTALLED/.test(text)) return { ok: true, detail: 'docker was already installed' }
  if (/NO_PRIVILEGE/.test(text)) {
    return { ok: false, detail: 'the connecting user cannot install packages (no root, no passwordless sudo)' }
  }
  if (/INSTALLED/.test(text)) return { ok: true, detail: 'docker installed' }
  return { ok: false, detail: 'install did not produce a docker client' }
}