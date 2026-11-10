# Documentation site

The docs in `../content/docs` (English and Italian) rendered as
static HTML for GitHub Pages.

```bash
pnpm --dir docs-site dev     # http://localhost:3010
pnpm --dir docs-site build   # static output in docs-site/out
```

## Why this is a second app

The main app cannot be exported. It has API route handlers and a middleware,
and `output: "export"` supports neither. This app carries only the docs routes and
reads the same `../content/docs`, so there is one copy of the prose and no risk of
the two drifting.

It builds with `--webpack`: Turbopack cannot infer a workspace root it can
resolve `next/package.json` from here.

## Publishing

`.github/workflows/docs.yml` builds on every change to the docs and asserts the
export produced exactly the expected number of pages (the count is in the
workflow), so a broken or missing page is caught in review. Change the count when
a page is added or removed.

The workflow's `deploy` job publishes to GitHub Pages on every push to `main` that
changes the docs, and when started by hand from the Actions tab. The site is at
https://alfredo1996.github.io/alter-ego-crm/.

`DOCS_BASE_PATH` is the sub-path a project site is served from, `/alter-ego-crm` for
`<user>.github.io/alter-ego-crm`. The workflow sets it from the repository name. Leave it
unset for a user or organisation site, or for a local build.
