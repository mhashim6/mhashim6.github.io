// resume.json → validate → HTML (template.ejs + print.css + embedded fonts) → resume.pdf
// Run: `npm run build:cv`.  Output: repo-root resume.pdf (linked from index.html).
import { readFile, readdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import ejs from "ejs";
import Ajv from "ajv";
import addFormats from "ajv-formats";
import puppeteer from "puppeteer";

const DIR = dirname(fileURLToPath(import.meta.url));
const ROOT = join(DIR, "..");
const p = (...x) => join(DIR, ...x);

const MONTHS = ["JAN","FEB","MAR","APR","MAY","JUN","JUL","AUG","SEP","OCT","NOV","DEC"];
const FAMILY = { CormorantGaramond: "Cormorant Garamond", JetBrainsMono: "JetBrains Mono" };

const esc = (s = "") =>
  String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

const fmtMonth = (d) => {
  if (!d) return "PRESENT";
  const [y, m] = d.split("-");
  return `${MONTHS[Number(m) - 1]} ${y}`;
};
const fmtRange = (start, end) => `${fmtMonth(start)} — ${end === undefined ? "" : fmtMonth(end)}`;

const groupMeta = (x) => {
  const starts = x.roles.map((r) => r.start);
  const minStart = starts.reduce((a, b) => (a < b ? a : b));
  const present = x.roles.some((r) => !r.end);
  const maxEnd = present ? null : x.roles.map((r) => r.end).reduce((a, b) => (a > b ? a : b));
  const span = fmtRange(minStart, maxEnd);
  return x.location ? `${span} · ${x.location.toUpperCase()}` : span;
};

const linkify = (escaped, link) =>
  link ? escaped.replace(`{{${link.label}}}`, `<a class="lnk" href="${link.url}">${esc(link.label)}</a>`) : escaped;
const impact = (r) => r.outcomes.map((o) => linkify(esc(o), r.link)).join("<br>");

const tagRow = (tags) => tags.map(esc).join('<span class="d">/</span>');

async function fontFaceCss() {
  const files = (await readdir(p("fonts"))).filter((f) => f.endsWith(".woff2"));
  const faces = await Promise.all(
    files.map(async (f) => {
      const [base, weight, italic] = f.replace(".woff2", "").split("-");
      const b64 = (await readFile(p("fonts", f))).toString("base64");
      return `@font-face{font-family:"${FAMILY[base] ?? base}";font-weight:${weight};` +
        `font-style:${italic ? "italic" : "normal"};font-display:swap;` +
        `src:url(data:font/woff2;base64,${b64}) format("woff2")}`;
    })
  );
  return faces.join("\n");
}

async function main() {
  const data = JSON.parse(await readFile(p("resume.json"), "utf8"));
  const schema = JSON.parse(await readFile(p("resume.schema.json"), "utf8"));

  // 1. Validate the source against the schema — fail loudly on any drift.
  const ajv = addFormats(new Ajv({ allErrors: true }));
  const validate = ajv.compile(schema);
  if (!validate(data)) {
    console.error("✗ resume.json failed schema validation:\n");
    for (const e of validate.errors) console.error(`  ${e.instancePath || "/"} ${e.message}`);
    process.exit(1);
  }

  // 2. Render the template with data + helpers.
  const css = `${await fontFaceCss()}\n${await readFile(p("print.css"), "utf8")}`;
  const nameHtml = esc(data.name).replace("î", '<span class="circ">î</span>');
  const html = await ejs.renderFile(p("template.ejs"), {
    ...data, css, nameHtml, esc, fmtRange, groupMeta, impact, tagRow,
  });

  // 3. Headless Chrome → A4 PDF with a real, embedded text layer (ATS-clean).
  const browser = await puppeteer.launch({ headless: "new", args: ["--no-sandbox"] });
  try {
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: "load" });
    await page.evaluateHandle("document.fonts.ready");

    // One-page guard: the résumé is meant to be a single A4 page. Warn loudly if
    // content overflows so a future content edit can't silently spill to page 2.
    const fit = await page.evaluate(() => {
      const el = document.querySelector(".page");
      const a4 = (297 / 25.4) * 96; // A4 height in CSS px at 96dpi
      return { content: el.scrollHeight, a4: Math.round(a4), over: Math.round(el.scrollHeight - a4) };
    });
    if (fit.over > 0) {
      console.warn(
        `⚠ Content overflows one A4 page by ${fit.over}px ` +
          `(${fit.content}px vs ${fit.a4}px). Trim resume.json or tighten cv/print.css.`
      );
    }

    await page.pdf({
      path: join(ROOT, "resume.pdf"),
      format: "A4",
      printBackground: true,
      preferCSSPageSize: true,
    });
  } finally {
    await browser.close();
  }

  console.log("✓ Built resume.pdf");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
