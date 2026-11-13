/**
 * wizardStore — types.
 * Split out of client/wizardStore.ts by the module-structure refactor.
 */
/**
 * Shared open/closed state for the New Project wizard.
 *
 * The trigger lives in the Workspaces panel's More menu and the dialog lives in
 * the frame-wide `shell.overlay`, because dismissing the menu unmounts
 * everything inside it. A module-level listener set is enough: one dialog,
 * one opener, and it must survive the menu unmounting.
 */

export type Listener = (open: boolean) => void