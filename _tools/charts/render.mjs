// Render every Vega-Lite spec in specs.mjs to an SVG file under
// public/images/openclaw-agents-stuck/.
//
// Run with:  npm install && npm run render

import { compile } from "vega-lite";
import { parse, View } from "vega";
import { writeFile, mkdir } from "node:fs/promises";
import { dirname, resolve, join } from "node:path";
import { fileURLToPath } from "node:url";
import { specs } from "./specs.mjs";

const here   = dirname(fileURLToPath(import.meta.url));
const outDir = resolve(here, "../../public/images/openclaw-agents-stuck");

await mkdir(outDir, { recursive: true });

for (const [name, vlSpec] of Object.entries(specs)) {
  const vega = compile(vlSpec).spec;
  const view = new View(parse(vega), { renderer: "none" });
  const svg  = await view.toSVG();
  const file = join(outDir, `${name}.svg`);
  await writeFile(file, svg);
  console.log(`wrote ${file}  (${svg.length.toLocaleString()} bytes)`);
}
