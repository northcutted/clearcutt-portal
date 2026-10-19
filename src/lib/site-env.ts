// Environment variables bin/clearcutt-portal.ts and the action use to pass
// settings to the build. (The bundle's is BUNDLE_ENV in bundle.ts.)

/** Overrides the site title, which is otherwise the estate's name. */
export const TITLE_ENV = 'CLEARCUTT_PORTAL_TITLE';
/** The portal version shown in the footer, e.g. v0.1.0 or a commit. */
export const VERSION_ENV = 'CLEARCUTT_PORTAL_VERSION';
/** Days after which the overview flags a vulnerability scan as old. */
export const SCAN_AGE_ENV = 'CLEARCUTT_PORTAL_SCAN_AGE_DAYS';
/** How many of the latest runs the history pages show (0: all of them). */
export const HISTORY_RUNS_ENV = 'CLEARCUTT_PORTAL_HISTORY_RUNS';
