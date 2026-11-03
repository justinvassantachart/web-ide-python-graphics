# Releasing @web-ide/python-graphics

The package is distributed the way web-ide itself is: as a packed tarball
attached to a GitHub release, not via the npm registry (`private: true` guards
against an accidental `npm publish`). Publishing to a registry is a separate
owner decision.

## Compatibility

Each release records the exact web-ide version it was verified against. The
companion depends only on public web-ide contracts that have been stable since
0.7.3 (`RuntimeSession.registerHostDevice`, execution-only plugin resources,
`IDEPanelContribution`), so `peerDependencies.web-ide` is `>=0.10.0`. When
web-ide publishes a new version, re-run the consumer check against its tarball
before claiming support, and bump the devDependency pin.

## Checklist

1. `npm ci` on a clean checkout.
2. `npm run validate` (lint, typecheck, 49 unit tests, library build).
3. Download the web-ide release asset to verify against, then
   `WEB_IDE_TARBALL=/abs/path/web-ide-<version>.tgz npm run check:consumer`
   (clean install of both tarballs, bundler + strict NodeNext typecheck,
   production build).
4. Run the browser matrix in `docs/VERIFICATION.md` against the consumer-check
   app (Chromium; needs network to jsDelivr for Monaco and runno.dev for the
   Python WASM runtime). Record the browser version and update the table.
5. Update `version` in `package.json` and the "verified against" note in
   `README.md`; protocol changes must bump `TRANSPORT_VERSION` or
   `GRAPHICS_VERSION` in `src/protocol/constants.ts` **and** the Python helper in
   lockstep, with a note in `docs/INTEGRATION.md`.
6. Commit, tag `python-graphics-v<version>`, and attach `npm pack` output
   (`web-ide-python-graphics-<version>.tgz`) plus its SHA-512 to the GitHub
   release. The release notes name the web-ide version/tag verified against.

## What is not a release

A version number in source, a green CI run, or a local tarball does not
establish a release; only the tagged commit with its attached, checksummed
tarball does. Consumers pin that exact asset URL.
