// Downloads the exact woff2 files the résumé needs from Google Fonts and
// self-hosts them under cv/fonts/. Run once: `npm run fonts`.
// Self-hosting keeps the build hermetic (no network at render time) and lets
// Chrome embed/subset the fonts into the PDF so it looks identical everywhere.
import { mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const FONTS_DIR = join(dirname(fileURLToPath(import.meta.url)), "fonts");

// One css2 request covering every family/weight/style we render with.
const CSS_URL =
  "https://fonts.googleapis.com/css2?" +
  "family=Cormorant+Garamond:wght@500;600;700&" +
  "family=JetBrains+Mono:ital,wght@0,400;0,500;0,600;1,400&display=swap";

// A modern Chrome UA makes Google serve woff2 (its smallest, best-supported format).
const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/124.0 Safari/537.36";

const slug = (name) => name.replace(/['"]/g, "").replace(/\s+/g, "");

async function main() {
  await mkdir(FONTS_DIR, { recursive: true });
  const css = await (await fetch(CSS_URL, { headers: { "User-Agent": UA } })).text();

  // Google splits every weight into many unicode-range subsets, each preceded by
  // a /* subset */ comment. The résumé is Latin-only, so we keep just `latin`
  // (covers ASCII + the î in "Abdul-Azîm"). One clean file per family/weight/style.
  const KEEP = new Set(["latin"]);
  const re = /\/\*\s*([\w-]+)\s*\*\/\s*@font-face\s*{([^}]*)}/g;
  let count = 0;
  for (const [, subset, body] of css.matchAll(re)) {
    if (!KEEP.has(subset)) continue;
    const family = body.match(/font-family:\s*([^;]+);/)?.[1]?.trim();
    const weight = body.match(/font-weight:\s*(\d+)/)?.[1] ?? "400";
    const style = body.match(/font-style:\s*(\w+)/)?.[1] ?? "normal";
    const url = body.match(/url\(([^)]+\.woff2)\)/)?.[1];
    if (!family || !url) continue;
    const name =
      `${slug(family)}-${weight}${style === "italic" ? "-italic" : ""}.woff2`;
    const buf = Buffer.from(await (await fetch(url)).arrayBuffer());
    await writeFile(join(FONTS_DIR, name), buf);
    console.log(`  ${name}  (${(buf.length / 1024).toFixed(1)} KB)`);
    count++;
  }
  if (!count) throw new Error("No latin @font-face blocks parsed — Google Fonts response changed?");
  console.log(`Saved ${count} font files to cv/fonts/`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
