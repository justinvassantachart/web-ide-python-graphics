# Packed clean-consumer check

Proves the published surface is self-sufficient: it packs
**@web-ide/python-graphics**, installs it together with a **web-ide** tarball
into a throwaway app that imports both by their bare package names (no source
alias, no sibling checkout, no workspace link), then typechecks and
production-builds that app.

```sh
npm run build                                     # ensure dist/ is current
WEB_IDE_TARBALL=/abs/path/web-ide-0.10.0.tgz npm run check:consumer
```

`WEB_IDE_TARBALL` is the web-ide release asset to verify against, e.g.
`https://github.com/justinvassantachart/web-ide/releases/download/web-ide-v0.10.0/web-ide-0.10.0.tgz`
downloaded locally. The check requires network access to the npm registry and to
the engine's GitHub release (web-ide's `debugger-sh` dependency).

What it runs in the temp app: a clean `npm install --ignore-scripts`, a
bundler-resolution `tsc` of the app, a strict `moduleResolution: NodeNext`
compile of the installed declaration graph (`tsconfig.nodenext.json`,
`skipLibCheck: false`), and `vite build` of the production bundle. It does not
run the app in a browser; the browser matrix is in
[`../docs/VERIFICATION.md`](../docs/VERIFICATION.md).

`app/` is the consumer source (composes the plugin, a mock second service on the
shared device, and exercises the public exports). `run.mjs` copies it to a temp
dir, generates `programs.ts` from `../examples/programs` plus `qa-programs/`,
writes the `file:` tarball dependencies, installs, and builds.

## Driving the browser QA matrix

```sh
WEB_IDE_TARBALL=/abs/web-ide-0.10.0.tgz KEEP_CONSUMER_DIR=/abs/pg-consumer npm run check:consumer
cd /abs/pg-consumer/app && node node_modules/vite/bin/vite.js preview --host 127.0.0.1 --port 4310 --strictPort
```

Then open `http://127.0.0.1:4310/?program=<key>` in Chromium and follow the
scenario table in [`../docs/VERIFICATION.md`](../docs/VERIFICATION.md). Query
controls: `program` (`shapes`, `bounce`, `paint`, `turtle`, `hello`, `noimport`,
`mutation`, `events`, `error`, `tiny`, `tall`, `huge`, `anchors`, `opacity`,
`nodraw`, `multi`), `theme=dark|light`, `panel=15..57` (panel column percent),
`service=multi` (adds the mock channel-2 service), `instances=2` (two IDE
mounts), `host=plain` (no graphics plugin). `qa-programs/*.py` are QA-only
programs; `../examples/programs` are the documentation examples.
