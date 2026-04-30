// Vega-Lite specs for the "agents stuck" post.
// Imported by both preview.html (browser, via <script type="module">) and
// render.mjs (Node, for static SVG export).

// Light-mode palette tuned for the blog (light page bg, GitHub-style ink).
// Saturated enough that white in-segment labels stay legible.
export const palette = {
  green:   "#3aa55c",
  pink:    "#d96080",
  orange:  "#e58643",
  blue:    "#4a8ec8",
  magenta: "#9b528b",
  yellow:  "#c0921a",
  grey:    "#6e7781",
  fg:      "#24292e",
  bg:      null,        // transparent — page bg shows through
  divider: "#ffffff",   // stroke between stacked segments / arc slices
  label:   "#ffffff",   // in-segment / in-slice text
};

export const SANS = '-apple-system, BlinkMacSystemFont, "Inter", system-ui, sans-serif';
export const MONO = 'ui-monospace, "SF Mono", Menlo, monospace';

export const baseConfig = {
  background: palette.bg,
  font: SANS,
  padding: { left: 8, right: 8, top: 8, bottom: 8 },
  title: {
    color: palette.fg, font: SANS, fontSize: 16, fontWeight: 600,
    anchor: "start", offset: 12,
  },
  view: { stroke: null },
  axis: {
    labelColor: palette.fg, titleColor: palette.fg,
    domainColor: palette.fg, tickColor: palette.fg,
    labelFont: MONO, titleFont: SANS,
    labelFontSize: 12, titleFontSize: 14, titleFontWeight: "normal",
    grid: false, tickSize: 5, domainWidth: 1,
  },
  axisX: { labelFont: SANS },
  legend: {
    labelColor: palette.fg, titleColor: palette.fg,
    labelFont: SANS, titleFont: SANS,
    labelFontSize: 13, symbolType: "circle", symbolSize: 100,
    orient: "top", titleOrient: "top", direction: "horizontal",
  },
  header: {
    labelColor: palette.fg, labelFont: SANS, labelFontSize: 13,
    titleColor: palette.fg, titleFont: SANS,
  },
  arc: { stroke: palette.divider, strokeWidth: 2 },
  bar: { stroke: palette.divider, strokeWidth: 1, cornerRadiusEnd: 4 },
};

// Helper: stacked-bar text layer that places labels at the segment midpoint.
// Vega-Lite's built-in `stack: "zero"` only gives top-of-segment, so we use an
// explicit stack transform + midpoint calc.
function stackedBarLabels({ groupby, sort, value, xSort, color = palette.label }) {
  return {
    transform: [
      { stack: value, groupby: [groupby], sort: [{ field: sort, order: "ascending" }], as: ["y0", "y1"] },
      { calculate: "(datum.y0 + datum.y1) / 2", as: "y_mid" },
      { filter: `datum.${value} > 0` },
    ],
    mark: { type: "text", color, fontSize: 13, fontWeight: 600 },
    encoding: {
      x: { field: groupby, type: "nominal", sort: xSort },
      y: { field: "y_mid", type: "quantitative" },
      text: { field: value, type: "quantitative" },
    },
  };
}

// 1. Agent run outcomes (stacked vertical bar, with in-segment numbers) -------
const data1 = [
  { phase: "Before fixes", outcome: "Idle",       n: 47, ord: 1 },
  { phase: "Before fixes", outcome: "Failed",     n:  3, ord: 2 },
  { phase: "Before fixes", outcome: "Picked",     n:  0, ord: 3 },
  { phase: "Before fixes", outcome: "Productive", n:  0, ord: 4 },
  { phase: "After fixes",  outcome: "Idle",       n:  0, ord: 1 },
  { phase: "After fixes",  outcome: "Failed",     n:  4, ord: 2 },
  { phase: "After fixes",  outcome: "Picked",     n:  2, ord: 3 },
  { phase: "After fixes",  outcome: "Productive", n:  6, ord: 4 },
];

export const spec1 = {
  "$schema": "https://vega.github.io/schema/vega-lite/v5.json",
  config: baseConfig,
  title: "Most runs went idle before the fixes",
  width: 540, height: 280,
  data: { values: data1 },
  layer: [
    {
      mark: { type: "bar", cornerRadiusEnd: 4 },
      encoding: {
        x: { field: "phase", type: "nominal",
             sort: ["Before fixes", "After fixes"],
             axis: { title: null, labelAngle: 0, labelPadding: 10 } },
        y: { field: "n", type: "quantitative", aggregate: "sum", title: "Runs" },
        color: {
          field: "outcome", type: "nominal",
          scale: {
            domain: ["Idle", "Failed", "Picked", "Productive"],
            range:  [palette.pink, palette.orange, palette.blue, palette.green],
          },
          legend: { title: null },
        },
        order: { field: "ord", type: "quantitative" },
      },
    },
    stackedBarLabels({ groupby: "phase", sort: "ord", value: "n",
                       xSort: ["Before fixes", "After fixes"] }),
  ],
};

// 2. Debug progress (stacked bar across iterations) ---------------------------
const data2 = [
  { step: "Baseline",  state: "Fixed",  n: 4, ord: 1 },
  { step: "Baseline",  state: "Broken", n: 4, ord: 2 },
  { step: "Model fix", state: "Fixed",  n: 5, ord: 1 },
  { step: "Model fix", state: "Broken", n: 3, ord: 2 },
  { step: "Boot fix",  state: "Fixed",  n: 6, ord: 1 },
  { step: "Boot fix",  state: "Broken", n: 2, ord: 2 },
  { step: "Board fix", state: "Fixed",  n: 8, ord: 1 },
  { step: "Board fix", state: "Broken", n: 0, ord: 2 },
];

export const spec2 = {
  "$schema": "https://vega.github.io/schema/vega-lite/v5.json",
  config: baseConfig,
  title: "8 checks → all green after four iterations",
  width: 540, height: 280,
  data: { values: data2 },
  layer: [
    {
      mark: { type: "bar", cornerRadiusEnd: 4 },
      encoding: {
        x: { field: "step", type: "nominal",
             sort: ["Baseline", "Model fix", "Boot fix", "Board fix"],
             axis: { title: null, labelAngle: 0, labelPadding: 10 } },
        y: { field: "n", type: "quantitative", aggregate: "sum", title: "Checks (out of 8)" },
        color: {
          field: "state", type: "nominal",
          scale: { domain: ["Fixed", "Broken"], range: [palette.green, palette.pink] },
          legend: { title: null },
        },
        order: { field: "ord", type: "quantitative" },
      },
    },
    stackedBarLabels({ groupby: "step", sort: "ord", value: "n",
                       xSort: ["Baseline", "Model fix", "Boot fix", "Board fix"] }),
  ],
};

// 3. Project board (faceted donut, before vs after) ---------------------------
export const spec3 = {
  "$schema": "https://vega.github.io/schema/vega-lite/v5.json",
  config: baseConfig,
  title: "Ghost Todos masked the real backlog",
  data: { values: [
    { phase: "Before", state: "Done",        n: 49, ord: 1 },
    { phase: "Before", state: "Real Todo",   n: 27, ord: 2 },
    { phase: "Before", state: "Ghost Todo",  n: 24, ord: 3 },
    { phase: "Before", state: "In Progress", n:  5, ord: 4 },
    { phase: "After",  state: "Done",        n: 73, ord: 1 },
    { phase: "After",  state: "Real Todo",   n: 30, ord: 2 },
    { phase: "After",  state: "Ghost Todo",  n:  0, ord: 3 },
    { phase: "After",  state: "In Progress", n:  2, ord: 4 },
  ]},
  facet: { column: { field: "phase", type: "nominal", sort: ["Before", "After"], title: null } },
  spec: {
    width: 220, height: 220,
    layer: [
      {
        mark: { type: "arc", innerRadius: 60, outerRadius: 100, padAngle: 0.01 },
        encoding: {
          theta: { field: "n", type: "quantitative", stack: true },
          color: {
            field: "state", type: "nominal",
            scale: {
              domain: ["Done", "Real Todo", "Ghost Todo", "In Progress"],
              range:  [palette.green, palette.blue, palette.pink, palette.yellow],
            },
            legend: { title: null },
          },
          order: { field: "ord", type: "quantitative" },
        },
      },
      {
        transform: [{ filter: "datum.n > 0" }],
        mark: { type: "text", radius: 80, fontSize: 13, fontWeight: 600, color: palette.label },
        encoding: {
          theta: { field: "n", type: "quantitative", stack: true },
          text:  { field: "n", type: "quantitative" },
          order: { field: "ord", type: "quantitative" },
        },
      },
    ],
  },
};

// 4. Token distribution (donut + center label + percent labels in slices) -----
export const spec4 = {
  "$schema": "https://vega.github.io/schema/vega-lite/v5.json",
  config: baseConfig,
  title: "91% of tokens were cache reads",
  width: 320, height: 320,
  layer: [
    {
      data: { values: [
        { kind: "Cache read",   n: 3615480, pct: 91.3 },
        { kind: "New input",    n:  312840, pct:  7.9 },
        { kind: "Agent output", n:   31680, pct:  0.8 },
      ]},
      mark: { type: "arc", innerRadius: 90, outerRadius: 140, padAngle: 0.01 },
      encoding: {
        theta: { field: "n", type: "quantitative", stack: true },
        color: {
          field: "kind", type: "nominal",
          scale: {
            domain: ["Cache read", "New input", "Agent output"],
            range:  [palette.blue, palette.orange, palette.green],
          },
          legend: { title: null },
        },
      },
    },
    // Percent labels inside each slice (skip <2% so they don't overlap)
    {
      data: { values: [
        { kind: "Cache read",   n: 3615480, pct: 91.3 },
        { kind: "New input",    n:  312840, pct:  7.9 },
        { kind: "Agent output", n:   31680, pct:  0.8 },
      ]},
      transform: [
        { filter: "datum.pct >= 2" },
        { calculate: "format(datum.pct, '.1f') + '%'", as: "label" },
      ],
      mark: { type: "text", radius: 115, fontSize: 13, fontWeight: 600, color: palette.label },
      encoding: {
        theta: { field: "n", type: "quantitative", stack: true },
        text:  { field: "label", type: "nominal" },
      },
    },
    // Center label: big number
    {
      data: { values: [{}] },
      mark: { type: "text", text: "3.96M", color: palette.fg,
              fontSize: 30, fontWeight: 600, dy: -8, font: SANS },
    },
    // Center label: caption
    {
      data: { values: [{}] },
      mark: { type: "text", text: "tokens", color: palette.grey,
              fontSize: 13, dy: 20, font: SANS },
    },
  ],
};

// File-name → spec map used by render.mjs (matches existing webp basenames).
export const specs = {
  "before-after-runs":  spec1,
  "eval-progression":   spec2,
  "board-before-after": spec3,
  "token-distribution": spec4,
};
