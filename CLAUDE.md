# Working agreements for this repo

`AGENTS.md` is the project blueprint (product rules, technical rules,
implementation notes). `README.md` is the user- and developer-facing
documentation. Read `AGENTS.md` before making design decisions.

## Standing rule: documentation is part of every change

**Always update `README.md` and `AGENTS.md` in the same change as the code.**
Never leave it as a follow-up, never wait to be asked, and never report a
task as finished with the docs still describing the old behaviour.

Applies whenever a change touches:

- **Behaviour or UX** — navigation, screens, controls, what a button does,
  what refreshes when → update the relevant `README.md` section.
- **Permissions** — which roles may do what → update the role table in
  README's "Group types & permissions".
- **The API surface** — new/changed Balanz commands or payload handling →
  update README's "API contract".
- **Files** — new, renamed, or deleted source files → update README's
  "Project structure".
- **Setup, build, or deployment steps** → update the corresponding README
  section.
- **An intended product or technical rule** (not just its implementation) →
  update `AGENTS.md` too, so the blueprint keeps matching the app.

Also keep cross-references honest: if a section is renamed, fix the prose
that points at it, and remove statements the change made untrue rather than
only adding new ones. Both documents should always describe the app as it
currently is, not as it once was.

## Versioning

Bump `version` in `package.json` for user-visible releases. It is injected
at build time and shown under **About**, so it only changes after a rebuild
(and a dev-server restart — `vite.config.js` reads `package.json` once at
config load). See "Version & build info" in `README.md`.

## Verifying changes

Run `npm run build` and confirm it completes cleanly before reporting a
change as done.
