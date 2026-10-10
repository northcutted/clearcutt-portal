// Environment variables bin/clearcutt-portal.ts and the action use to pass
// settings to the build. (The bundle's is BUNDLE_ENV in bundle.ts.)

/** Overrides the site title, which is otherwise the estate's name. */
export const TITLE_ENV = 'CLEARCUTT_PORTAL_TITLE';
/** The portal version shown in the footer, e.g. v0.1.0 or a commit. */
export const VERSION_ENV = 'CLEARCUTT_PORTAL_VERSION';
