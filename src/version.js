/**
 * APP_VERSION and BUILD_DATE are injected at build time via vite.config.js's
 * `define` block (version sourced from package.json, build date captured at
 * the moment `vite build`/`vite dev` starts) - see AboutPanel.jsx, which is
 * the only place these currently surface to the user (Menu > About).
 *
 * The typeof guards are defensive: `define` performs a literal text
 * substitution, so in a normal Vite build/dev run these are always replaced
 * with real values, but the guard keeps this module from throwing a
 * ReferenceError if it's ever evaluated outside that pipeline (e.g. a
 * standalone unit test runner without the same config).
 */
export const APP_VERSION = typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : '0.0.0';
export const BUILD_DATE = typeof __BUILD_DATE__ !== 'undefined' ? __BUILD_DATE__ : null;
