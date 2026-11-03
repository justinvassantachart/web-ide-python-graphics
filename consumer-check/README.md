# Packed clean-consumer check

Proves the published surface is self-sufficient: it packs **web-ide** and
**@web-ide/python-graphics** into tarballs, installs **both** into a throwaway
app that imports them by their bare package names (no source alias, no sibling
repo, no workspace link), then typechecks and production-builds that app.

```sh
# from packages/python-graphics
npm run build                 # ensure dist/ is current
node consumer-check/run.mjs
```

Requirements: network access to the npm registry and the engine's GitHub release
(for `web-ide`'s `debugger-sh` dependency). The check does a clean
`npm install --ignore-scripts`, a bundler-resolution `tsc` of the app, a strict
`moduleResolution: NodeNext` compile of the installed declaration graph
(`tsconfig.nodenext.json`, `skipLibCheck: false`), and `vite build` of the
production bundle. It does not run the app in a
browser (that needs a browser and the runtime asset CDN); see
[`../docs/VERIFICATION.md`](../docs/VERIFICATION.md).

`app/` is the consumer source (composes the plugin, a mock second service, and
exercises the public exports). `run.mjs` copies it to a temp dir, generates
`programs.ts` from `../examples/programs`, writes the `file:` tarball
dependencies, installs, and builds.
