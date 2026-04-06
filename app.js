let umapData = null;
let groups = [];
let geneList = [];
let activeIdx = -1;

async function loadGeneList() {
  try {
    const res = await fetch("./gene_list.json");
    geneList = await res.json();
  } catch (e) { console.warn("gene_list.json not found"); }
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

async function loadGene() {
  const gene = document.getElementById("geneInput").value.trim();
  if (!gene || !umapData) return;
  document.getElementById("status").textContent = `Loading ${gene}...`;
  try {
    const res = await fetch(`./genes/${gene}.json`);
    if (!res.ok) throw new Error("not found");
    const geneData = await res.json();
    const exprMap = {};
    umapData.forEach((d, i) => { exprMap[d.cell] = geneData.values[i]; });
    renderPlots(exprMap, `${geneData.gene} — split by group`);
    document.getElementById("status").textContent = `${geneData.gene} loaded`;
  } catch (err) {
    document.getElementById("status").textContent = `Gene not found: ${gene}`;
  }
}

document.getElementById("loadBtn").addEventListener("click", loadGene);

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
