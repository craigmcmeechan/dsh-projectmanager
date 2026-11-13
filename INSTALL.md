# Installing this plugin into a DeepSeek Harness checkout

This package **cannot be built standalone**. `packages/client/tsdown.client.ts`
imports the repository's `PLATFORM_MODULES`, the lightningcss pipeline, and the
asset manifest, so a copy outside the checkout produces no loadable
`lib/client.js`. It has to sit at `packages/client/ui-projects` **inside** a
checkout.

That means installing it is two things: putting this directory in the right
place, and making five edits in the host checkout so the build and the Loader
know it exists.

## 1. Place the directory

```sh
cd /path/to/dsh-checkout
git clone <this-repo> packages/client/ui-projects
```

Any existing `packages/client/ui-projects` must be moved aside first — the five
edits below assume exactly one copy.

## 2. The five edits

All paths are relative to the checkout root.

### `tsconfig.client.json` — build the browser half

Add to the `references` array, beside the other `packages/client/*` entries:

```json
{ "path": "./packages/client/ui-projects" }
```

### `tsconfig.host.json` — build the Node half

Add to the `references` array, beside the other `packages/client/*` host entries
(note the explicit `tsconfig.host.json`):

```json
{ "path": "./packages/client/ui-projects/tsconfig.host.json" }
```

### `packages/bundle/web-app/package.json` — declare the dependency

Add to `dependencies`, keeping the list alphabetical:

```json
"@deepseek-ai/dsh-client-ui-projects": "workspace:*",
```

### `packages/bundle/web-app/cordis.patch.yml` — mount the plugin

Add a row to the bundle's plugin list. Order matters only for readability; the
plugin needs `slots` and `sidebarRightTabs`, which earlier entries provide:

```yaml
    - id: ui-projects
      name: '@deepseek-ai/dsh-client-ui-projects'
```

### `pnpm-lock.yaml` — record the workspace link

Regenerate rather than hand-editing:

```sh
pnpm install
```

## 3. Build

```sh
pnpm install
pnpm exec tsc -b tsconfig.host.json tsconfig.client.json
pnpm exec tsdown --filter @deepseek-ai/dsh-client-ui-projects
```

`tsdown` bundles from `lib/types`, so **`tsc -b` must run first**. Building the
plugin alone after editing `src/` ships stale code:

```sh
cd packages/client/ui-projects
rm -rf lib
pnpm exec tsc -b tsconfig.host.json tsconfig.client.json
pnpm exec tsdown
```

Both `tsc -b` invocations must exit 0. A `UNRESOLVED_IMPORT` warning for
`@deepseek-ai/dsh-tools` is expected and pre-existing: that package is
externalised in the shipped bundles too.

## 4. Run

```sh
dsh web --token <something>
```

Then open the printed URL. The sidebar gains a **Project Manager** row, and
**Stores** in its header opens the plugin-wide stores.

## Verifying the install

The plugin is loaded when all three are true:

1. `packages/client/ui-projects/lib/client.js` and `lib/index.js` exist and are
   newer than your last `src/` edit.
2. The served bundle contains the plugin. Check the boot manifest:

   ```sh
   curl -s "http://127.0.0.1:<port>/?token=<token>" | grep -o 'ui-projects/client.js[^"]*'
   ```

3. The service logs no `ui-projects` load error:

   ```sh
   journalctl -u <service> -n 50 | grep -i ui-projects
   ```

An empty result is success. A `cannot get property ... without inject` message
means a service the plugin reads is missing from its `inject` array — see below.

## Two traps worth knowing

**Cordis `inject` must list every service read.** Reading an undeclared service
throws and takes the whole plugin down, not just the feature. This plugin reads
`slots`, `sidebarRightTabs`, `sidebarRight`, `remote`,
`remote.directoryPicker`, `remote.workspace`, `remote.session`, and
`uiWorkspace`. Adding a `ctx.get('remote').<namespace>` call means adding
`'remote.<namespace>'` to that array.

**A slot may have only one declarer.** Declaring a child slot that another entry
already declared throws at load time, again taking the whole plugin down. If a
registration fails complaining about a child key, do not satisfy the type by
adding `children` — the declaration is the thing that is illegal.

## What this plugin does not do

It does not scaffold projects from templates. `project-details/project.setup.json`
is read and stored, and `scripts/release.mjs` versions and records changes, but
turning a template into a project is not implemented.
