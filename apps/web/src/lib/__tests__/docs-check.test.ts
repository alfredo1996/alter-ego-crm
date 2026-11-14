import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, normalize, relative } from "node:path";

import { describe, expect, it } from "vitest";

// Vitest runs with cwd = apps/web, so the repository root is two levels up.
const ROOT = join(process.cwd(), "../..");

function walk(dir: string, ext: RegExp): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    return statSync(p).isDirectory() ? walk(p, ext) : ext.test(name) ? [p] : [];
  });
}

const DOC_FILES = [
  join(ROOT, "README.md"),
  join(ROOT, "docs-site/README.md"),
  // docs/plans/ is not scanned: the two plans are marked as history and name
  // files that no longer exist.
  ...walk(join(ROOT, "docs"), /\.md$/).filter(
    (f) => !f.includes("/docs/plans/"),
  ),
  ...walk(join(ROOT, "content/docs"), /\.mdx$/),
].filter(existsSync);

// `setup` is out on purpose: it is a pnpm built-in, so `pnpm setup` never
// reaches a script of that name.
const SCRIPTS = new Set(
  Object.keys(
    JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8")).scripts,
  ).filter((s) => s !== "setup"),
);

// pnpm commands that are not package.json scripts.
const PNPM_BUILTINS = new Set([
  "install", "add", "exec", "dlx", "run", "i", "remove", "update", "up",
  "audit", "why", "store", "create", "rebuild", "outdated", "dedupe",
  "init", "approve-builds",
]); // prettier-ignore

// Only these prefixes are relative to apps/web.
const WEB_RELATIVE = /^(src|e2e)\//;

// Ceiling: only inline code and links are checked. A path inside a fenced block
// (a file tree, a shell snippet) is not, so those can still go stale. A bare file
// name is checked only when it is a root-level kind (BARE_FILE below): any other
// bare name, such as `package.json`, is not.

// Written by the reader on their own machine, never committed.
const LOCAL_ONLY = new Set(["apps/web/.env.local"]);

const REPO_PATH =
  /^(apps|packages|firestore|docker|scripts|docs|content|docs-site|\.github|src|e2e)\//;

// A bare name (no slash) of a config, rules or root file; it lives at the root,
// in apps/web or in firestore/.
const BARE_FILE = /^(?:[\w.-]+\.(?:ya?ml|rules)|\.nvmrc|LICENSE)$/;
const BARE_DIRS = ["", "apps/web", "firestore"];

function lines(file: string) {
  return readFileSync(file, "utf8")
    .split("\n")
    .map((text, i) => ({ text, at: `${relative(ROOT, file)}:${i + 1}` }));
}

function offenders(check: (text: string, file: string) => string[]): string[] {
  return DOC_FILES.flatMap((file) =>
    lines(file).flatMap(({ text, at }) =>
      check(text, file).map((what) => `${at}  ${what}`),
    ),
  );
}

// This repository's own files, written as absolute GitHub URLs.
const REPO_URL =
  /^https:\/\/github\.com\/alfredo1996\/alter-ego-crm\/(?:blob|tree)\/main\//;

function docsPageExists(lang: string, rest: string) {
  const base = join(ROOT, "content/docs", lang, rest);
  return existsSync(`${base}.mdx`) || existsSync(join(base, "index.mdx"));
}

describe("documentation matches the repository", () => {
  it("names only pnpm commands that exist", () => {
    const bad = offenders((text) =>
      [...text.matchAll(/pnpm (?:run )?([a-z][\w:.-]*)/g)]
        .map((m) => m[1].replace(/\.+$/, ""))
        .filter((s) => !SCRIPTS.has(s) && !PNPM_BUILTINS.has(s))
        .map((s) => `pnpm ${s}`),
    );
    expect(bad).toEqual([]);
  });

  it("names only repository paths that exist", () => {
    const bad = offenders((text) =>
      [...text.matchAll(/`([^`\s]+)`/g)]
        .map((m) => m[1])
        .filter(
          (p) =>
            (REPO_PATH.test(p) || BARE_FILE.test(p)) &&
            !/[*<>{}$|…]|\.\.\./.test(p),
        )
        .map((p) => p.replace(/:\d+$/, "").replace(/[/.,]+$/, ""))
        .filter(
          (p) =>
            !LOCAL_ONLY.has(p) &&
            !existsSync(join(ROOT, p)) &&
            !(WEB_RELATIVE.test(p) && existsSync(join(ROOT, "apps/web", p))) &&
            !(BARE_FILE.test(p) && BARE_DIRS.some((d) => existsSync(join(ROOT, d, p)))),
        ),
    );
    expect(bad).toEqual([]);
  });

  it("links only to files and docs pages that exist", () => {
    const bad = offenders((text, file) =>
      [...text.matchAll(/\]\(([^)\s]+)\)/g)]
        .map((m) => m[1].split("#")[0])
        .filter((t) => t && (REPO_URL.test(t) || !/^(https?:|mailto:)/.test(t)))
        .filter((t) => {
          if (REPO_URL.test(t))
            return !existsSync(join(ROOT, t.replace(REPO_URL, "")));
          const inSite = file.startsWith(join(ROOT, "content/docs"));
          const docs = inSite && /^\/(?:(en|it)\/)?docs\/?(.*)$/.exec(t);
          if (docs) {
            // The static site only serves /<lang>/docs/..., in the page's own language.
            const lang = /content\/docs\/(\w+)\//.exec(file)?.[1] ?? "en";
            if (docs[1] !== lang) return true;
            return !docsPageExists(lang, docs[2].replace(/\/$/, ""));
          }
          const target = t.startsWith("/")
            ? join(ROOT, t)
            : normalize(join(dirname(file), t));
          return !(
            existsSync(target) ||
            existsSync(`${target}.mdx`) ||
            existsSync(join(target, "index.mdx"))
          );
        }),
    );
    expect(bad).toEqual([]);
  });

  // The one fenced block that is checked: the routes in the README's project tree.
  it("lists the app's routes in the README's project tree", () => {
    const readme = readFileSync(join(ROOT, "README.md"), "utf8");
    const tree = /\(app\)\/([\s\S]*?)── api\//.exec(readme)?.[1] ?? "";
    const routes = readdirSync(join(process.cwd(), "src/app/(app)"), {
      withFileTypes: true,
    })
      .filter((d) => d.isDirectory() && !d.name.startsWith("_"))
      .map((d) => `/${d.name}`);
    expect((tree.match(/\/[a-z-]+/g) ?? []).sort()).toEqual(routes.sort());
  });
});
