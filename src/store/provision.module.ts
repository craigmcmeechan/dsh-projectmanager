/**
 * Remote server provisioning.
 *
 * The wizard's five screens are backed by functions here rather than by one
 * long procedure, because each step's result is shown to the operator and some
 * steps are optional. Every step is idempotent: re-running a probe is safe, and
 * installing a present package is a no-op the OS resolves.
 *
 * ## Security posture
 *
 * A password is used **once**, to install a public key, and then password login
 * is disabled. The password is never written to disk or to the store: the only
 * persisted credential is the key this module generates, which can be revoked
 * per server. This is why the operator is told up front that supplying a
 * password will result in key auth plus password login off — it is a change to
 * their server, not a preference.
 */
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { mkdirSync, existsSync, readFileSync, chmodSync } from 'node:fs'
import { join } from 'node:path'
import type { ServerFacts } from './store.interface.ts'

const run = promisify(execFile)

/** Result of one shell step on the remote host. */
export interface StepResult {
  ok: boolean
  stdout: string
  stderr: string
}

/** Credentials supplied for the first connection. */
export interface ProvisionCredentials {
  host: string
  user: string
  port: number
  /** Password for the first connection, when the operator chose password auth. */
  password?: string
  /** Path to an existing private key, when the operator already has one. */
  keyPath?: string
}

/** Where the plugin keeps generated keys. */
export function keysDirectory(home: string): string {
  return join(home, 'project-manager', 'keys')
}

/** Path of the generated key for one server name. */
export function keyPathFor(home: string, name: string): string {
  return join(keysDirectory(home), `${name.replace(/[^a-z0-9-]/gi, '_')}_ed25519`)
}

/**
 * Generate an SSH keypair for a server, unless one already exists.
 *
 * `ssh-keygen` writes both halves; the private key is chmod 600 before it is
 * ever used, so there is no window where it is world-readable.
 * @param home - Harness home.
 * @param name - the server's distinct name.
 * @returns the private key path and the public key text.
 */
export async function generateKey(
  home: string,
  name: string,
): Promise<{ privateKeyPath: string; publicKey: string } | { error: string }> {
  const dir = keysDirectory(home)
  mkdirSync(dir, { recursive: true, mode: 0o700 })
  const privateKeyPath = keyPathFor(home, name)
  if (existsSync(privateKeyPath)) {
    const publicKey = readFileSync(`${privateKeyPath}.pub`, 'utf8').trim()
    chmodSync(privateKeyPath, 0o600)
    return { privateKeyPath, publicKey }
  }
  try {
    await run('ssh-keygen', ['-t', 'ed25519', '-N', '', '-C', `dsh-project-manager:${name}`, '-f', privateKeyPath], {
      timeout: 20_000,
    })
    chmodSync(privateKeyPath, 0o600)
    return { privateKeyPath, publicKey: readFileSync(`${privateKeyPath}.pub`, 'utf8').trim() }
  } catch (error) {
    return { error: error instanceof Error ? error.message : 'could not generate a key' }
  }
}

/**
 * Run a script on the remote host.
 *
 * @param credentials - where and how to connect.
 * @param script - a literal script; never built from operator input.
 * @param options - `keyPath` switches to key auth, `password` to a single
 *   password-authenticated call via `sshpass`.
 * @returns stdout/stderr and whether it exited zero.
 */
export async function runRemote(
  credentials: ProvisionCredentials,
  script: string,
  options: { keyPath?: string; timeoutMs?: number } = {},
): Promise<StepResult> {
  const base = [
    '-o', 'StrictHostKeyChecking=accept-new',
    '-o', 'ConnectTimeout=10',
    '-p', String(credentials.port),
  ]
  const exec = { timeout: options.timeoutMs ?? 60_000, maxBuffer: 8 * 1024 * 1024 }

  try {
    if (credentials.password !== undefined && options.keyPath === undefined) {
      // Password auth: sshpass feeds it non-interactively. Chosen over a pty
      // because the alternative is hanging on a prompt, which reads as a hang.
      const { stdout, stderr } = await run(
        'sshpass',
        ['-e', 'ssh', ...base, '-o', 'PreferredAuthentications=password', '-o', 'PubkeyAuthentication=no',
          `${credentials.user}@${credentials.host}`, `bash -lc ${JSON.stringify(script)}`],
        { ...exec, env: { ...process.env, SSHPASS: credentials.password } },
      )
      return { ok: true, stdout, stderr }
    }
    const keyPath = options.keyPath ?? credentials.keyPath
    const keyArgs = keyPath === undefined ? [] : ['-i', keyPath]
    const { stdout, stderr } = await run(
      'ssh',
      ['-o', 'BatchMode=yes', ...base, ...keyArgs, `${credentials.user}@${credentials.host}`,
        `bash -lc ${JSON.stringify(script)}`],
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
          ? 'the ssh (or sshpass) client is not installed on this host'
          : (detail.stderr ?? detail.message ?? 'command failed'),
    }
  }
}

/** The probe script: one round trip, machine-readable output. */
const PROBE_SCRIPT = `
set -e
echo "OS_BEGIN"
. /etc/os-release 2>/dev/null || true
echo "OS_NAME=$PRETTY_NAME"
echo "OS_ID=$ID"
echo "KERNEL=$(uname -r)"
echo "ARCH=$(uname -m)"
echo "RAM_MB=$(awk '/MemTotal/{printf "%d", $2/1024}' /proc/meminfo 2>/dev/null || echo 0)"
echo "CPU=$(nproc 2>/dev/null || echo 0)"
echo "PROBE_END"
command -v node >/dev/null 2>&1 && echo "NODE=$(node --version 2>/dev/null)" || echo "NODE="
[ -s "$HOME/.nvm/nvm.sh" ] && echo "NVM=$(bash -lc 'nvm --version' 2>/dev/null)" || echo "NVM="
command -v git >/dev/null 2>&1 && echo "GIT=$(git --version 2>/dev/null | awk '{print $3}')" || echo "GIT="
command -v docker >/dev/null 2>&1 && echo "DOCKER=$(docker --version 2>/dev/null | awk '{print $3}' | tr -d ,)" || echo "DOCKER="
# Docker present but daemon down is a different problem than absent.
if command -v docker >/dev/null 2>&1; then
  docker info >/dev/null 2>&1 && echo "DOCKER_RUNNING=1" || echo "DOCKER_RUNNING=0"
else
  echo "DOCKER_RUNNING=0"
fi
exit 0
`

/** Parse the probe script's `KEY=value` output. */
export function parseProbe(stdout: string): ServerFacts {
  const values = new Map<string, string>()
  for (const line of stdout.split('\n')) {
    const eq = line.indexOf('=')
    if (eq <= 0) continue
    values.set(line.slice(0, eq).trim(), line.slice(eq + 1).trim())
  }
  const num = (key: string): number | undefined => {
    const raw = values.get(key)
    if (raw === undefined || raw.length === 0) return undefined
    const parsed = Number(raw)
    return Number.isFinite(parsed) ? parsed : undefined
  }
  const fact = (key: string): { present: boolean; version?: string } => {
    const raw = values.get(key)
    return raw !== undefined && raw.length > 0
      ? { present: true, version: raw }
      : { present: false }
  }
  // Assign key by key: `exactOptionalPropertyTypes` rejects an explicitly
  // `undefined` property, and a spread of a `string | undefined` is exactly that.
  const facts: ServerFacts = {
    node: fact('NODE'),
    nvm: fact('NVM'),
    git: fact('GIT'),
    docker: fact('DOCKER'),
    probedAt: Date.now(),
  }
  const os = values.get('OS_NAME')
  if (os !== undefined && os.length > 0) facts.os = os
  const osId = values.get('OS_ID')
  if (osId !== undefined && osId.length > 0) facts.osId = osId
  const kernel = values.get('KERNEL')
  if (kernel !== undefined && kernel.length > 0) facts.kernel = kernel
  const arch = values.get('ARCH')
  if (arch !== undefined && arch.length > 0) facts.arch = arch
  const ramMb = num('RAM_MB')
  if (ramMb !== undefined) facts.ramMb = ramMb
  const cpu = num('CPU')
  if (cpu !== undefined) facts.cpu = cpu
  return facts
}

/**
 * Probe the server for OS, resources, and the toolchain.
 * @param credentials - how to connect.
 * @param keyPath - managed key to use, once it is installed.
 */
export async function probeServer(
  credentials: ProvisionCredentials,
  keyPath?: string,
): Promise<{ facts?: ServerFacts; error?: string }> {
  const result = await runRemote(credentials, PROBE_SCRIPT, keyPath === undefined ? {} : { keyPath })
  if (!result.ok) return { error: result.stderr.trim() || 'could not reach the server' }
  return { facts: parseProbe(result.stdout) }
}

/**
 * Install the managed public key on the server.
 *
 * Uses password auth for this one call — the last time the password is needed.
 * Appends rather than overwrites, so an existing key for another operator is
 * not destroyed.
 * @returns whether the key is now accepted by a key-authenticated connection.
 */
export async function installKey(
  credentials: ProvisionCredentials,
  publicKey: string,
): Promise<{ ok: boolean; detail: string }> {
  const quoted = publicKey.replace(/'/g, `'\\''`)
  const script = [
    'mkdir -p "$HOME/.ssh"',
    'chmod 700 "$HOME/.ssh"',
    'touch "$HOME/.ssh/authorized_keys"',
    'chmod 600 "$HOME/.ssh/authorized_keys"',
    `grep -qF '${quoted}' "$HOME/.ssh/authorized_keys" 2>/dev/null || echo '${quoted}' >> "$HOME/.ssh/authorized_keys"`,
    'echo KEY_INSTALLED',
  ].join(' && ')
  const result = await runRemote(credentials, script)
  if (!result.ok) return { ok: false, detail: result.stderr.trim() || 'could not install the key' }
  return { ok: result.stdout.includes('KEY_INSTALLED'), detail: 'key installed' }
}

/**
 * Disable password SSH login on the server.
 *
 * Writes a drop-in file that sorts last, then validates the configuration
 * before reloading — the same lockout-safety rule the deploy scripts use. If
 * `sshd -t` rejects the file it is removed again, so a bad edit cannot lock the
 * operator out.
 * @returns whether password login is now disabled.
 */
export async function disablePasswordLogin(
  credentials: ProvisionCredentials,
  keyPath: string,
): Promise<{ ok: boolean; detail: string }> {
  const script = [
    'set -e',
    'sudo -n true 2>/dev/null || { echo NO_SUDO; exit 1; }',
    `sudo tee /etc/ssh/sshd_config.d/99-dsh-password-off.conf >/dev/null <<'CONF'
PasswordAuthentication no
KbdInteractiveAuthentication no
ChallengeResponseAuthentication no
PubkeyAuthentication yes
CONF`,
    'sudo sshd -t || { sudo rm -f /etc/ssh/sshd_config.d/99-dsh-password-off.conf; echo BAD_CONFIG; exit 1; }',
    'sudo systemctl reload ssh 2>/dev/null || sudo systemctl reload sshd',
    'echo PASSWORD_DISABLED',
  ].join('\n')
  const result = await runRemote(credentials, script, { keyPath, timeoutMs: 60_000 })
  if (!result.ok) {
    return { ok: false, detail: result.stderr.trim() || result.stdout.trim() || 'could not disable password login' }
  }
  return { ok: result.stdout.includes('PASSWORD_DISABLED'), detail: 'password login disabled' }
}

/**
 * Check for pending OS updates with the platform's own package manager.
 *
 * apt and dnf/yum report differently, so the script picks by which binary
 * exists rather than by the distribution name — a container or a derivative can
 * carry either.
 */
export async function checkUpdates(
  credentials: ProvisionCredentials,
  keyPath?: string,
): Promise<{ count: number; sample: string[]; manager?: string; error?: string }> {
  const script = `
if command -v apt-get >/dev/null 2>&1; then
  sudo -n true 2>/dev/null && SUDO=sudo || SUDO=
  $SUDO apt-get update -qq >/dev/null 2>&1 || true
  LIST=$($SUDO apt-get -s upgrade 2>/dev/null | grep -c '^Inst ' || true)
  echo "MANAGER=apt"
  echo "COUNT=\${LIST:-0}"
  $SUDO apt-get -s upgrade 2>/dev/null | grep '^Inst ' | awk '{print $2}' | head -5
elif command -v dnf >/dev/null 2>&1; then
  LIST=$(dnf -q check-update 2>/dev/null | grep -cE '^[a-zA-Z0-9]' || true)
  echo "MANAGER=dnf"
  echo "COUNT=\${LIST:-0}"
elif command -v yum >/dev/null 2>&1; then
  LIST=$(yum -q check-update 2>/dev/null | grep -cE '^[a-zA-Z0-9]' || true)
  echo "MANAGER=yum"
  echo "COUNT=\${LIST:-0}"
else
  echo "MANAGER=none"
  echo "COUNT=0"
fi
exit 0
`
  const result = await runRemote(credentials, script, keyPath === undefined ? {} : { keyPath, timeoutMs: 120_000 })
  if (!result.ok) return { count: 0, sample: [], error: result.stderr.trim() }
  const lines = result.stdout.split('\n').map((line) => line.trim()).filter(Boolean)
  const manager = lines.find((line) => line.startsWith('MANAGER='))?.slice('MANAGER='.length)
  const count = Number(lines.find((line) => line.startsWith('COUNT='))?.slice('COUNT='.length) ?? '0')
  const sample = lines.filter((line) => !line.includes('=')).slice(0, 5)
  return {
    count: Number.isFinite(count) ? count : 0,
    sample,
    ...(manager === undefined ? {} : { manager }),
  }
}

/**
 * Apply pending OS updates.
 *
 * Non-interactive on purpose: a prompt would stall the request until timeout.
 * `DEBIAN_FRONTEND` pins apt to its no-question mode.
 */
export async function applyUpdates(
  credentials: ProvisionCredentials,
  keyPath: string,
): Promise<{ ok: boolean; detail: string }> {
  const script = `
set -e
if command -v apt-get >/dev/null 2>&1; then
  sudo -n true 2>/dev/null || { echo NO_SUDO; exit 1; }
  sudo DEBIAN_FRONTEND=noninteractive apt-get upgrade -y -qq
elif command -v dnf >/dev/null 2>&1; then
  sudo -n true 2>/dev/null || { echo NO_SUDO; exit 1; }
  sudo dnf upgrade -y -q
elif command -v yum >/dev/null 2>&1; then
  sudo -n true 2>/dev/null || { echo NO_SUDO; exit 1; }
  sudo yum update -y -q
else
  echo NO_MANAGER; exit 1
fi
echo UPDATED
`
  const result = await runRemote(credentials, script, { keyPath, timeoutMs: 30 * 60_000 })
  return {
    ok: result.ok && result.stdout.includes('UPDATED'),
    detail: result.ok ? 'updates applied' : result.stderr.trim() || 'update failed',
  }
}

/**
 * Install one toolchain component the probe found missing.
 *
 * @param what - the component to install.
 * @returns whether it is present afterwards.
 */
export async function installTool(
  credentials: ProvisionCredentials,
  keyPath: string,
  what: 'node' | 'nvm' | 'git' | 'docker',
): Promise<{ ok: boolean; detail: string }> {
  const scripts: Record<typeof what, string> = {
    git: `
set -e
if command -v apt-get >/dev/null 2>&1; then
  sudo DEBIAN_FRONTEND=noninteractive apt-get install -y -qq git
elif command -v dnf >/dev/null 2>&1; then sudo dnf install -y -q git
else sudo yum install -y -q git; fi
echo INSTALLED
`,
    nvm: `
set -e
export NVM_DIR="$HOME/.nvm"
if [ ! -s "$NVM_DIR/nvm.sh" ]; then
  curl -fsSL https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.1/install.sh | bash
fi
echo INSTALLED
`,
    node: `
set -e
export NVM_DIR="$HOME/.nvm"
if [ -s "$NVM_DIR/nvm.sh" ]; then
  . "$NVM_DIR/nvm.sh"
  nvm install --lts
  nvm alias default 'lts/*' >/dev/null 2>&1 || true
else
  # No nvm: install nvm first, then node through it, so the version is switchable.
  curl -fsSL https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.1/install.sh | bash
  export NVM_DIR="$HOME/.nvm"; . "$NVM_DIR/nvm.sh"
  nvm install --lts
fi
echo INSTALLED
`,
    docker: `
set -e
if command -v docker >/dev/null 2>&1; then echo INSTALLED; exit 0; fi
curl -fsSL https://get.docker.com | sudo sh
sudo systemctl enable --now docker 2>/dev/null || true
sudo usermod -aG docker "$USER" || true
echo INSTALLED
`,
  }
  const result = await runRemote(credentials, scripts[what], { keyPath, timeoutMs: 20 * 60_000 })
  return {
    ok: result.ok && result.stdout.includes('INSTALLED'),
    detail: result.ok ? `${what} installed` : result.stderr.trim() || `${what} install failed`,
  }
}

/**
 * Set the server's hostname permanently.
 *
 * `hostnamectl set-hostname` is the systemd path and is what makes it survive a
 * reboot; `/etc/hostname` is written too because a minimal container image may
 * lack systemd. The hosts file entry is added so `sudo` does not stall resolving
 * the machine's own name.
 * @param hostname - the fully-qualified name created in DNS.
 */
export async function setHostname(
  credentials: ProvisionCredentials,
  keyPath: string,
  hostname: string,
): Promise<{ ok: boolean; detail: string }> {
  if (!/^[a-z0-9]([a-z0-9.-]{0,251}[a-z0-9])?$/i.test(hostname)) {
    return { ok: false, detail: 'that hostname is not a valid DNS name' }
  }
  const label = hostname.split('.')[0] ?? hostname
  const script = `
set -e
if command -v hostnamectl >/dev/null 2>&1; then
  sudo hostnamectl set-hostname ${hostname}
else
  echo ${hostname} | sudo tee /etc/hostname >/dev/null
  sudo hostname ${hostname} || true
fi
grep -q "${hostname}" /etc/hosts || echo "127.0.1.1 ${hostname} ${label}" | sudo tee -a /etc/hosts >/dev/null
echo HOSTNAME_SET
`
  const result = await runRemote(credentials, script, { keyPath })
  return {
    ok: result.ok && result.stdout.includes('HOSTNAME_SET'),
    detail: result.ok ? `hostname set to ${hostname}` : result.stderr.trim() || 'hostname change failed',
  }
}

/**
 * Pull one image on the remote server.
 * @param reference - image reference.
 */
export async function pullRemoteImage(
  credentials: ProvisionCredentials,
  keyPath: string,
  reference: string,
): Promise<{ ok: boolean; detail: string }> {
  if (!/^[A-Za-z0-9._\-/:@]+$/.test(reference)) {
    return { ok: false, detail: 'that image reference contains characters we do not accept' }
  }
  const result = await runRemote(credentials, `sudo docker pull ${reference}`, {
    keyPath,
    timeoutMs: 30 * 60_000,
  })
  return {
    ok: result.ok,
    detail: result.ok ? `pulled ${reference}` : result.stderr.trim() || `could not pull ${reference}`,
  }
}

/**
 * Create the default workspace folder on the server and a local path for it.
 * @param directory - absolute path to create.
 */
export async function ensureWorkdir(
  credentials: ProvisionCredentials,
  keyPath: string,
  directory: string,
): Promise<{ ok: boolean; detail: string }> {
  if (!/^\/[A-Za-z0-9._\-/]*$/.test(directory)) {
    return { ok: false, detail: 'use an absolute path with letters, digits, dots, dashes, and slashes' }
  }
  const result = await runRemote(credentials, `mkdir -p ${directory} && echo WORKDIR_OK`, { keyPath })
  return {
    ok: result.ok && result.stdout.includes('WORKDIR_OK'),
    detail: result.ok ? `folder ready at ${directory}` : result.stderr.trim() || 'could not create the folder',
  }
}
