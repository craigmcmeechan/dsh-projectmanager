# AGENTS.md — Project Manager plugin: code structure rules

> Read this before adding, moving, or splitting a file in
> `packages/client/ui-projects/`. It is the contract the plugin's layout obeys;
> a change that breaks it makes the codebase harder to navigate for everyone
> after you.

**Language:** all output — prose, comments, identifiers, commit messages —
must be English. If a source or tool result is in another language, translate
it rather than copying it through.

## 1. The one rule

**One logical unit per directory, and the file name matches the directory name.**

No `.ts` or `.tsx` file sits loose in `src/` or `src/client/`. Every unit owns a
directory, and that directory's `index.ts` is the only thing other code
imports.

```text
src/
├── db/
│   ├── index.ts            barrel — the only public entry
│   ├── db.module.ts        behaviour: functions, classes, values
│   ├── db.schema.ts        the SQL schema (own file, it is data not logic)
│   ├── db.interface.ts     interfaces
│   └── db.types.ts         type aliases and enums
├── plugin/
│   ├── index.ts
│   ├── index.module.ts     apply() — wiring only
│   ├── routes.module.ts    the HTTP dispatch
│   ├── helpers.module.ts   request/registry/settings helpers
│   └── index.interface.ts
└── client/
    └── DirectoryPicker/
        ├── index.ts
        ├── DirectoryPicker.tsx            the component, and only the component
        ├── DirectoryPicker.interface.ts   props and shared shapes
        ├── DirectoryPicker.module.ts      pure functions it uses
        └── DirectoryPicker.styles.ts      style constants
```

## 2. Which file does a thing go in

| Suffix | Holds | Notes |
|---|---|---|
| `<Name>.tsx` | The React component | One component per file. No helpers, no types, no style objects. |
| `<Name>.module.ts` | Functions, classes, constants | Behaviour and logic. This is where a helper belongs, not beside the component. |
| `<Name>.interface.ts` | `interface` declarations | Props, API shapes, records. |
| `<Name>.types.ts` | `type` aliases, `enum`s | Anything `type X = …`. |
| `<Name>.styles.ts` | Style objects and constants | `React.CSSProperties` values, colour tokens, geometry. |
| `<Name>.schema.ts` | Large literal data (e.g. SQL) | Optional; use when a string literal would dominate the module. |
| `index.ts` | Barrel | Re-exports the directory's public surface. Never contains logic. |

**Decision order** — when adding a declaration, ask in this order:

1. Is it an `interface`? → `.interface.ts`
2. Is it a `type` or `enum`? → `.types.ts`
3. Is it a style constant (`CSSProperties`, a colour, a size used for layout)? → `.styles.ts`
4. Is it a function, class, or non-style constant? → `.module.ts`
5. Is it a React component? → `.tsx`

A component file that grows past ~250 lines is a signal that logic is living in
it — move that logic to `.module.ts`.

## 3. Imports

- **Cross-unit:** always import the *barrel*, never a file inside another
  directory: `import { x } from '../db/index.ts'`, not `'../db/db.module.ts'`.
- **Intra-unit:** import the sibling file directly:
  `import type { Props } from './DirectoryPicker.interface.ts'`.
- **Relative specifiers keep the `.ts` / `.tsx` extension.** This repo compiles
  with `allowImportingTsExtensions` + `rewriteRelativeImportExtensions`.
- **Types must be type-imported.** Use `import type { … }` for interfaces and
  type aliases. `verbatimModuleSyntax` is off here, but the convention is
  enforced by review.
- **Never delete an empty `import type {} from 'x'`.** It is not dead code: it
  loads a module's `declare module` augmentation (for example `ctx.webServer`
  comes from `@deepseek-ai/dsh-host-webserver`). Removing it silently breaks the
  types of every following line.

## 4. Barrels

```ts
/**
 * Barrel for the db module.
 */
export * from './db.module.ts'
export * from './db.schema.ts'
export * from './db.interface.ts'
export * from './db.types.ts'
```

- Re-export in order: behaviour, data, interfaces, types.
- If a chunk has **no** public exports, do not `export *` from it — add
  `export {}` to the file so it stays a module, or leave it out of the barrel.
- Never re-export a name from two chunks in the same barrel; the collision is a
  compile error and a confusing one.

## 5. Entry points

The package has two entries, and their **file paths are public API** — a bundle
patch row and `package.json` both name them:

- `src/index.ts` — host entry, a thin shim: `export * from './plugin/index.ts'`
- `src/client/index.ts` — client entry, shim over `./client/plugin/index.ts`

They stay named `index.ts` at those paths and contain nothing but the
re-export. The implementation lives in `src/plugin/` and `src/client/plugin/`
so the "directory name matches file name" rule holds without creating
`src/index/index.ts`.

## 6. Splitting a large module

`db.module.ts` (1,180 lines) and `routes.module.ts` (890 lines) are the only
files over 400 lines. When one grows further, split by **domain**, not by size:

- A split must follow a real seam — `db.schema.ts` exists because the SQL is
  data, not because the file was long.
- Keep the class/function that owns the behaviour in the module file; move
  cohesive groups of methods or functions to a sibling `.module.ts` named for
  the domain.
- After splitting, the barrel exports both, so no caller changes.

## 7. Verification before you call it done

The plugin must build from a **clean** `lib/`, because `tsdown` bundles from
`lib/types` and will otherwise ship stale code:

```sh
cd packages/client/ui-projects
rm -rf lib
pnpm exec tsc -b tsconfig.host.json tsconfig.client.json
pnpm exec tsdown
```

Both `tsc -b` invocations must exit 0. A green build with a `UNRESOLVED_IMPORT`
warning for `@deepseek-ai/dsh-tools` is expected and pre-existing.

Then restart the service and confirm it still serves:

```sh
systemctl restart dsh-dev
journalctl -u dsh-dev -n 30 --no-pager | grep -i "projects.*error"
```

## 8. Rules that exist because they were broken

- **Local constants used by another chunk must be exported.** A `const` that was
  module-private in a single file becomes a separate module's export after a
  split; forgetting this produces `Cannot find name` far from the cause.
- **`tsconfig.host.json` lists directories explicitly.** Adding a unit means
  adding it to `include`, or it is silently not compiled.
- **Do not reference a name only in a JSDoc `{@link}`.** It is not a use; a tool
  that scans text may think it is and generate an import for a value that does
  not exist.
