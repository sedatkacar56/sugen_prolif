let umapData = null;
let groups = [];
let geneList = [];
let activeIdx = -1;

// dot plot state
let dotplotData = null;       // { cell_types, groups, genes }
let cellTypes = [];
let mode = "feature";          // "feature" | "dotplot"
let currentGene = null;        // last successfully loaded gene

async function loadGeneList() {
  try {
    const res = await fetch("./gene_list.json");
    geneList = await res.json();
  } catch (e) { console.warn("gene_list.json not found"); }
}

async function loadDotplot() {
  try {
    const [dpRes, ctRes] = await Promise.all([
      fetch("./dotplot.json"),
      fetch("./cell_types.json")
    ]);
    dotplotData = await dpRes.json();
    cellTypes = await ctRes.json();

    const sel = document.getElementById("cellTypeSelect");
    cellTypes.forEach(ct => {
      const opt = document.createElement("option");
      opt.value = ct;
      opt.textContent = ct;
      sel.appendChild(opt);
    });
  } catch (e) {
    console.warn("dotplot data not found", e);
  }
}

function showSuggestions(query) {
  const box = document.getElementById("suggestions");
  if (!query || geneList.length === 0) { box.style.display = "none"; return; }
  const q = query.toLowerCase();
  const matches = geneList.filter(g => g.toLowerCase().startsWith(q)).slice(0, 15);
  if (matches.length === 0) { box.style.display = "none"; return; }
  box.innerHTML = matches.map(g => `<div>${g}</div>`).join("");
  box.style.display = "block";
  activeIdx = -1;
  box.querySelectorAll("div").forEach(item => {
    item.addEventListener("mousedown", () => {
      document.getElementById("geneInput").value = item.textContent;
      box.style.display = "none";
      loadGene();
    });
  });
}

async function loadUmap() {
  const res = await fetch("./umap.json");
  umapData = await res.json();

  const groupOrder = ["Control", "Sugen 2", "Sugen 5"];
  const found = [...new Set(umapData.map(d => d.group))];
  groups = groupOrder.filter(g => found.includes(g))
           .concat(found.filter(g => !groupOrder.includes(g)));

  renderPlots(null, "UMAP");
  document.getElementById("status").textContent = "UMAP loaded. Enter a gene.";
}

function renderPlots(exprValues, title) {
  const n = groups.length;
  const ncols = Math.min(n, 3);
  const nrows = Math.ceil(n / ncols);
  const globalMax = exprValues ? Math.max(...Object.values(exprValues)) : 1;

  const traces = [];
  const annotations = [];

  groups.forEach((grp, i) => {
    let cells = umapData.filter(d => d.group === grp);
    const axSuffix = i === 0 ? "" : String(i + 1);

    if (exprValues) {
      cells = [...cells].sort((a, b) =>
        (exprValues[a.cell] ?? 0) - (exprValues[b.cell] ?? 0)
      );
    }

    const colors = exprValues
      ? cells.map(d => exprValues[d.cell] ?? 0)
      : cells.map(() => 0);

    traces.push({
      x: cells.map(d => d.UMAP_1),
      y: cells.map(d => d.UMAP_2),
      mode: "markers", type: "scattergl", name: grp,
      text: cells.map(d => `${d.cell}<br>${grp}`),
      hoverinfo: "text",
      xaxis: `x${axSuffix}`, yaxis: `y${axSuffix}`,
      showlegend: false,
      marker: {
        size: 3,
        color: colors,
        colorscale: [[0, "lightgrey"], [0.0001, "#F0F921"], [0.25, "#FCA636"],
                     [0.5, "#E06D9C"], [0.75, "#9C179E"], [1, "#0D0887"]],
        cmin: 0, cmax: globalMax,
        showscale: i === n - 1,
        colorbar: { title: "Expr", thickness: 12, len: 0.5, y: 0.5 }
      }
    });

    annotations.push({
      text: `<b>${grp}</b>`,
      xref: `x${axSuffix} domain`, yref: `y${axSuffix} domain`,
      x: 0.5, y: 1.08, showarrow: false, font: { size: 13 }
    });
  });

  const axisBase = { zeroline: false, showgrid: false, showline: true, linecolor: "black", linewidth: 1, ticks: "outside", tickcolor: "black" };
  const layoutAxes = {};
  groups.forEach((_, i) => {
    const suf = i === 0 ? "" : String(i + 1);
    layoutAxes[`xaxis${suf}`] = { ...axisBase, title: { text: "umap_1", font: { size: 11 } } };
    layoutAxes[`yaxis${suf}`] = { ...axisBase, title: { text: "umap_2", font: { size: 11 } } };
  });

  // Restore container height for feature plot (dot plot mode may have shrunk it).
  document.getElementById("plot").style.height = (nrows * 380) + "px";

  Plotly.newPlot("plot", traces, {
    grid: { rows: nrows, columns: ncols, pattern: "independent" },
    ...layoutAxes,
    annotations,
    title: { text: title, font: { size: 16 } },
    margin: { l: 40, r: 80, t: 60, b: 40 },
    showlegend: false,
    height: nrows * 380,
    paper_bgcolor: "#fff", plot_bgcolor: "#fff"
  }, { responsive: true });
}

function renderDotPlot(gene, cellTypeFilter) {
  if (!dotplotData) {
    document.getElementById("status").textContent = "Dot plot data not loaded yet";
    return;
  }
  const rows = dotplotData.genes[gene];
  if (!rows) {
    document.getElementById("status").textContent = `Gene not found: ${gene}`;
    return;
  }

  // Clean up any old HTML size legend from previous approach
  const oldLeg = document.getElementById("_sizeLegend");
  if (oldLeg) oldLeg.remove();

  const cts  = dotplotData.cell_types;
  const grps = dotplotData.groups;
  const nG   = grps.length;
  const isAll = cellTypeFilter === "__all__";

  // ── 1. Build data arrays ──────────────────────────────────────────────────
  const xs = [], ys = [], sizes = [], colors = [], hover = [];
  cts.forEach((ct, ci) => {
    if (!isAll && ct !== cellTypeFilter) return;
    for (let gj = 0; gj < nG; gj++) {
      const [pct, avg] = rows[ci * nG + gj];
      if (isAll) { xs.push(grps[gj]); ys.push(ct); }
      else       { xs.push(gene);     ys.push(grps[gj]); }
      sizes.push(pct);
      colors.push(avg);
      hover.push(`${ct} • ${grps[gj]}<br>% expr: ${(pct*100).toFixed(1)}%<br>avg: ${avg.toFixed(3)}`);
    }
  });

  // ── 2. Absolute size: 0%→4px, 100%→22px ─────────────────────────────────
  const sizeFor    = p => 4 + p * 18;
  const markerSizes = sizes.map(sizeFor);

  // ── 3. Z-score colors (Seurat scale=TRUE default) ─────────────────────────
  const meanC  = colors.reduce((a,b) => a+b, 0) / colors.length;
  const sdC    = Math.sqrt(colors.reduce((a,b) => a+(b-meanC)**2, 0) / colors.length);
  const zColors = sdC === 0
    ? colors.map(() => 0)
    : colors.map(v => Math.max(-2.5, Math.min(2.5, (v-meanC)/sdC)));
  const zMin = Math.min(...zColors);
  const zMax = Math.max(...zColors);

  // ── 4. Data-driven legend pct ticks ──────────────────────────────────────
  const maxPct  = Math.max(...sizes);
  const niceMax = Math.max(5, Math.round(maxPct * 100 / 5) * 5);
  const niceMid = Math.round(niceMax / 2 / 5) * 5;
  // Bottom→top: 0 (small), mid, max (large) — matches ggplot visual order
  const legPcts  = [0, niceMid, niceMax];
  const legFracs = legPcts.map(p => p / 100);
  // Evenly spaced y positions in y2 domain — no overlap
  const legYs    = [0.06, 0.16, 0.26];

  // ── 5. Layout sizes ───────────────────────────────────────────────────────
  const yCount     = isAll ? cts.length : grps.length;
  const plotHeight = Math.max(420, 120 + yCount * 48);  // taller, not square
  const plotWidth  = isAll ? undefined : 520;

  // ── 6. Main dot trace ─────────────────────────────────────────────────────
  const mainTrace = {
    x: xs, y: ys,
    mode: "markers", type: "scatter",
    text: hover, hoverinfo: "text",
    showlegend: false,
    marker: {
      size: markerSizes,
      color: zColors,
      colorscale: [[0,"#D3D3D3"],[1,"#0000FF"]],
      cmin: zMin, cmax: zMax,
      showscale: true,
colorbar: {
  title: {
    text: "",
    font: { size: 12 }
  },
  thickness: 15,
  len: 0.38,
  x: 0.80,
  xanchor: "left",
  y: 0.78,
  yanchor: "middle",
  tickfont: { size: 11 }
},
      line: { width: 0.5, color: "#555" }
    }
  };

  // ── 7. Size legend dots ───────────────────────────────────────────────────
 const legTrace = {
  x: legYs.map(() => 0.45),
  y: legYs,
  mode: "markers",
  type: "scatter",
  hoverinfo: "skip",
  showlegend: false,
  xaxis: "x2",
  yaxis: "y2",
  marker: {
    size: legFracs.map(sizeFor),
    color: "#000",
    line: { width: 0.5, color: "#000" }
  }
};

const legAnnotations = [
  {
    text: "Average Expression",
    xref: "paper",
    yref: "paper",
    x: 0.70,
    y: 0.93,
    showarrow: false,
    xanchor: "left",
    yanchor: "bottom",
    font: { size: 12 }
  },
  {
    text: "Percent Expressed",
    xref: "x2",
    yref: "y2",
    x: 0.80,
    y: 0.34,
    showarrow: false,
    xanchor: "center",
    yanchor: "bottom",
    font: { size: 12 }
  },
  ...legPcts.map((p, i) => ({
    text: String(p),
    xref: "x2",
    yref: "y2",
    x: 0.95,
    y: legYs[i],
    showarrow: false,
    xanchor: "left",
    yanchor: "middle",
    font: { size: 11 }
  }))
];



  // ── 8. Axis + layout config ───────────────────────────────────────────────
  const plotTitle  = isAll ? `${gene} — dot plot` : cellTypeFilter;
  const xCatArray  = isAll ? grps : [gene];
  const yCatArray  = isAll ? cts.slice().reverse() : grps.slice().reverse();

  document.getElementById("plot").style.height = plotHeight + "px";
  document.getElementById("plot").style.width  = plotWidth ? plotWidth + "px" : "";

  Plotly.newPlot("plot", [mainTrace, legTrace], {
    title: { text: `<b>${plotTitle}</b>`, font: { size: 16 } },
    xaxis: {
      title: { text: isAll ? "" : "Features", font: { size: 12 } },
      type: "category", categoryorder: "array", categoryarray: xCatArray,
      tickfont: { size: 12 }, tickangle: 0,
      showgrid: false, zeroline: false,
      showline: true, mirror: false,   // no top border line
      linecolor: "black", linewidth: 1,
      ticks: "outside", tickcolor: "black",
      domain: [0, 0.70]
    },
    yaxis: {
      title: { text: isAll ? "" : "Identity", font: { size: 12 } },
      type: "category", categoryorder: "array", categoryarray: yCatArray,
      tickfont: { size: 11 }, showgrid: false, zeroline: false,
      showline: true, mirror: false,   // no right border line
      linecolor: "black", linewidth: 1,
      ticks: "outside", tickcolor: "black", automargin: true
    },
xaxis2: {
  domain: [0.78, 0.98],
  range: [0, 1],
  visible: false,
  fixedrange: true
},
yaxis2: {
  domain: [0.05, 0.40],
  range: [0.0, 0.38],
  visible: false,
  fixedrange: true
},
    annotations: legAnnotations,
margin: { l: 100, r: 170, t: 60, b: 60 },
    width: plotWidth, height: plotHeight,
    paper_bgcolor: "#fff", plot_bgcolor: "#fff"
  }, { responsive: !plotWidth });
}

function render() {
  if (mode === "feature") {
    if (!currentGene) { renderPlots(null, "UMAP"); return; }
    // re-render existing feature plot — need expression map again, refetch
    loadGene();
  } else {
    if (!currentGene) {
      document.getElementById("status").textContent = "Enter a gene to see dot plot";
      Plotly.purge("plot");
      return;
    }
    const ct = document.getElementById("cellTypeSelect").value;
    renderDotPlot(currentGene, ct);
    document.getElementById("status").textContent = `${currentGene} — dot plot`;
  }
}

async function loadGene() {
  const gene = document.getElementById("geneInput").value.trim();
  if (!gene || !umapData) return;
  document.getElementById("status").textContent = `Loading ${gene}...`;

  if (mode === "dotplot") {
    if (!dotplotData) {
      document.getElementById("status").textContent = "Dot plot data still loading...";
      return;
    }
    if (!dotplotData.genes[gene]) {
      document.getElementById("status").textContent = `Gene not found: ${gene}`;
      return;
    }
    currentGene = gene;
    const ct = document.getElementById("cellTypeSelect").value;
    renderDotPlot(gene, ct);
    document.getElementById("status").textContent = `${gene} — dot plot`;
    return;
  }

  // feature plot mode
  try {
    const res = await fetch(`./genes/${gene}.json`);
    if (!res.ok) throw new Error("not found");
    const geneData = await res.json();
    const exprMap = {};
    umapData.forEach((d, i) => { exprMap[d.cell] = geneData.values[i]; });
    currentGene = geneData.gene;
    renderPlots(exprMap, `${geneData.gene} — split by group`);
    document.getElementById("status").textContent = `${geneData.gene} loaded`;
  } catch (err) {
    document.getElementById("status").textContent = `Gene not found: ${gene}`;
  }
}

function setMode(newMode) {
  if (newMode === mode) return;
  mode = newMode;
  document.getElementById("modeFeature").classList.toggle("active", mode === "feature");
  document.getElementById("modeDotplot").classList.toggle("active", mode === "dotplot");
  document.getElementById("cellTypeWrapper").style.display =
    mode === "dotplot" ? "block" : "none";
  render();
}

document.getElementById("loadBtn").addEventListener("click", loadGene);

document.getElementById("modeFeature").addEventListener("click", () => setMode("feature"));
document.getElementById("modeDotplot").addEventListener("click", () => setMode("dotplot"));

document.getElementById("cellTypeSelect").addEventListener("change", () => {
  if (mode === "dotplot" && currentGene) {
    renderDotPlot(currentGene, document.getElementById("cellTypeSelect").value);
  }
});

document.getElementById("geneInput").addEventListener("input", e => {
  showSuggestions(e.target.value.trim());
});

document.getElementById("geneInput").addEventListener("keydown", e => {
  const box = document.getElementById("suggestions");
  const items = box.querySelectorAll("div");
  if (e.key === "ArrowDown") activeIdx = Math.min(activeIdx + 1, items.length - 1);
  else if (e.key === "ArrowUp") activeIdx = Math.max(activeIdx - 1, 0);
  else if (e.key === "Enter") {
    if (activeIdx >= 0 && items[activeIdx]) {
      document.getElementById("geneInput").value = items[activeIdx].textContent;
      box.style.display = "none";
    }
    loadGene(); return;
  } else if (e.key === "Escape") { box.style.display = "none"; return; }
  items.forEach((el, i) => el.classList.toggle("active", i === activeIdx));
  if (items[activeIdx]) items[activeIdx].scrollIntoView({ block: "nearest" });
});

document.addEventListener("click", e => {
  if (!document.getElementById("autocomplete-wrapper").contains(e.target))
    document.getElementById("suggestions").style.display = "none";
});

loadUmap();
loadGeneList();
loadDotplot();
