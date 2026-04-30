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
    anchor: "middle", offset: 12,
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
    orient: "none", direction: "horizontal", titleOrient: "top",
    legendY: -34,
    // legendX is set per-spec via centeredLegend() because Vega-Lite has no
    // native "center horizontally" option and legend pixel-width depends on
    // entry labels.
  },
  header: {
    labelColor: palette.fg, labelFont: SANS, labelFontSize: 13,
    titleColor: palette.fg, titleFont: SANS,
  },
  arc: { stroke: palette.divider, strokeWidth: 2 },
  bar: { stroke: palette.divider, strokeWidth: 1, cornerRadiusEnd: 4 },
};

// Helper: per-spec config that centers the legend horizontally above the chart.
// Vega-Lite has no native "center the legend" option for orient: "top"; we use
// orient: "none" with explicit legendX. Legend widths are measured from a prior
// render — if you change a label or font, re-measure the <path class="background"
// d="M0,0h{W}..."> in the rendered SVG and update the constants below.
function centerLegend(chartWidth, legendWidth) {
  return {
    ...baseConfig,
    legend: {
      ...baseConfig.legend,
      legendX: Math.round(chartWidth / 2 - legendWidth / 2),
    },
  };
}

// Helper: precompute centroid (x, y) for each donut slice so text labels sit
// inside the right slice. Avoids a Vega-Lite quirk where the text mark's
// radius/theta positioning uses the opposite x sign from the arc mark.
function withDonutLabelPos(rows, valueField, labelRadius, cx, cy) {
  const total = rows.reduce((s, d) => s + (d[valueField] || 0), 0);
  if (!total) return rows.map(d => ({ ...d, label_x: cx, label_y: cy }));
  let cum = 0;
  return rows.map(d => {
    const v = d[valueField] || 0;
    const t0 = (cum / total) * 2 * Math.PI;
    cum += v;
    const t1 = (cum / total) * 2 * Math.PI;
    const mid = (t0 + t1) / 2;
    return {
      ...d,
      label_x: cx + labelRadius * Math.sin(mid),
      label_y: cy - labelRadius * Math.cos(mid),
    };
  });
}

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
  config: centerLegend(540, 367),  // legend width measured from prior render
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
  config: centerLegend(540, 158),
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
const facetW = 220, facetH = 220, donutLabelR = 80;
const data3Before = withDonutLabelPos([
  { phase: "Before", state: "Done",        n: 49, ord: 1 },
  { phase: "Before", state: "Real Todo",   n: 27, ord: 2 },
  { phase: "Before", state: "Ghost Todo",  n: 24, ord: 3 },
  { phase: "Before", state: "In Progress", n:  5, ord: 4 },
], "n", donutLabelR, facetW / 2, facetH / 2);
const data3After = withDonutLabelPos([
  { phase: "After", state: "Done",        n: 73, ord: 1 },
  { phase: "After", state: "Real Todo",   n: 30, ord: 2 },
  { phase: "After", state: "Ghost Todo",  n:  0, ord: 3 },
  { phase: "After", state: "In Progress", n:  2, ord: 4 },
], "n", donutLabelR, facetW / 2, facetH / 2);

export const spec3 = {
  "$schema": "https://vega.github.io/schema/vega-lite/v5.json",
  // Faceted chart: 2 facets × 220 wide + ~20 spacing ≈ 460 total
  config: centerLegend(460, 453),
  title: "Ghost Todos masked the real backlog",
  data: { values: [...data3Before, ...data3After] },
  facet: {
    column: {
      field: "phase", type: "nominal",
      sort: ["Before", "After"], title: null,
      // Put "Before"/"After" labels below each donut so they don't collide
      // with the top-mounted legend.
      header: { labelOrient: "bottom", labelPadding: 8, labelFontSize: 13 },
    },
  },
  spec: {
    width: facetW, height: facetH,
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
        mark: { type: "text", fontSize: 13, fontWeight: 600 },
        encoding: {
          x: { field: "label_x", type: "quantitative", scale: null, axis: null },
          y: { field: "label_y", type: "quantitative", scale: null, axis: null },
          text:    { field: "n", type: "quantitative" },
          color:   { value: palette.label },
          opacity: { condition: { test: "datum.n > 0", value: 1 }, value: 0 },
        },
      },
    ],
  },
};

// 4. Token distribution (donut + center label + percent labels in slices) -----
const tokenW = 320, tokenH = 320;
const data4 = withDonutLabelPos([
  { kind: "Cache read",   n: 3615480, pct: 91.3 },
  { kind: "New input",    n:  312840, pct:  7.9 },
  { kind: "Agent output", n:   31680, pct:  0.8 },
], "n", 115, tokenW / 2, tokenH / 2)
  .map(d => ({ ...d, label: d.pct.toFixed(1) + "%" }));

export const spec4 = {
  "$schema": "https://vega.github.io/schema/vega-lite/v5.json",
  config: centerLegend(320, 394),
  title: "91% of tokens were cache reads",
  width: tokenW, height: tokenH,
  layer: [
    {
      data: { values: data4 },
      layer: [
        {
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
        {
          mark: { type: "text", fontSize: 13, fontWeight: 600 },
          encoding: {
            x: { field: "label_x", type: "quantitative", scale: null, axis: null },
            y: { field: "label_y", type: "quantitative", scale: null, axis: null },
            text:    { field: "label", type: "nominal" },
            color:   { value: palette.label },
            opacity: { condition: { test: "datum.pct >= 2", value: 1 }, value: 0 },
          },
        },
      ],
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
