/**
 * Types for the Add Remote Server wizard.
 */

/** Which screen the wizard is on. */
export type WizardStep = 1 | 2 | 3 | 4 | 5

/**
 * How credentials are supplied.
 *
 * `password` results in a generated key and password login being disabled;
 * `key` reuses an existing key and leaves the server's auth config alone.
 */
export type AuthChoice = 'password' | 'key'
