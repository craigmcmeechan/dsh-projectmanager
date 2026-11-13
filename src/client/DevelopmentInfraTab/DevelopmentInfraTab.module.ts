/**
 * DevelopmentInfraTab — module.
 * Split out of client/DevelopmentInfraTab.tsx by the module-structure refactor.
 */
/** Render bytes as a human memory figure. */
export function memory(bytes: number | undefined): string {
  if (bytes === undefined || bytes <= 0) return 'unknown'
  const gb = bytes / 1024 ** 3
  return gb >= 1 ? `${gb.toFixed(1)} GB` : `${Math.round(bytes / 1024 ** 2)} MB`
}