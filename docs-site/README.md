# Documentation site

The docs in `../content/docs` (English and Italian) rendered as
static HTML for GitHub Pages.

```bash
pnpm --dir docs-site dev     # http://localhost:3010
pnpm --dir docs-site build   # static output in docs-site/out
```

## Why this is a second app

The main app cannot be exported. It has six API route handlers and a middleware,
and `output: "export"` supports neither. This app carries only the docs routes and
reads the same `../content/docs`, so there is one copy of the prose and no risk of
the two drifting.

It builds with `--webpack`: Turbopack cannot infer a workspace root it can
resolve `next/package.json` from here.

## Publishing

`.github/workflows/docs.yml` builds on every change to the docs and asserts the
export produced at least 50 pages, so a broken page is caught in review.

**Publishing is manual for now.** GitHub Pages needs either a public repository or
a paid plan, and this one is private. Run the workflow by hand from the Actions
tab, or — once the accounting product lives in its own public repository — change
the `deploy` job's condition to run on pushes to `main`.

`DOCS_BASE_PATH` is the sub-path a project site is served from, `/alter-ego-crm` for
`<user>.github.io/alter-ego-crm`. The workflow sets it from the repository name. Leave it
unset for a user or organisation site, or for a local build.
