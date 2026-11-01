import { buildColumns, rowId } from "/columns.js";

const gate = document.querySelector("#gate");
const shell = document.querySelector("#shell");
const signIn = document.querySelector("#signIn");
const formError = document.querySelector("#formError");
const columnsEl = document.querySelector("#columns");
const inspectorEl = document.querySelector("#inspector");
const pathbar = document.querySelector("#pathbar");
const search = document.querySelector("#search");
const who = document.querySelector("#who");
const logout = document.querySelector("#logout");
const navPane = document.querySelector("#navPane");
const inspectorPane = document.querySelector("#inspectorPane");
const collapseNav = document.querySelector("#collapseNav");
const collapseInspector = document.querySelector("#collapseInspector");
const consoleTabs = document.querySelector("#consoleTabs");
const consoleScreens = document.querySelector("#consoleScreens");
const consoleStatus = document.querySelector("#consoleStatus");
const consoleCad = document.querySelector("#consoleCad");
const menu = document.querySelector("#menu");

const folderIcon = `<svg class="icon" viewBox="0 0 16 16" aria-hidden="true"><path fill="#0E5A19" d="M1.5 3.5A1.5 1.5 0 0 1 3 2h3l1.2 1.5H13A1.5 1.5 0 0 1 14.5 5v7A1.5 1.5 0 0 1 13 13.5H3A1.5 1.5 0 0 1 1.5 12Z"/></svg>`;
const vmIcon = `<svg class="icon" viewBox="0 0 16 16" aria-hidden="true"><path fill="#4C4C4C" d="M3 1.5h6.2L13 5.2V14a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1V2.5a1 1 0 0 1 1-1Z"/><path fill="#fff" d="M9 1.8V5h3.2"/></svg>`;

let inventory = null;
let pathIds = [];
let query = "";
let username = "";
let detail = null;
let containerDetail = null;
let hostDetail = null;
const consoles = new Map();
let activeConsoleId = "";

function showError(message) {
  formError.hidden = !message;
  formError.textContent = message || "";
}

function powerBadge(state) {
  const raw = String(state || "").trim();
  if (!raw) return { className: "badge pending", text: "Unknown" };
  if (/^(on|powered_on|power_on)$/i.test(raw)) return { className: "badge recorded", text: "On" };
  return { className: "badge pending", text: raw };
}

function formatBytes(value) {
  const num = Number(value);
  if (!Number.isFinite(num)) return "";
  const gib = num / 1024 ** 3;
  if (gib >= 1) return `${gib >= 10 ? gib.toFixed(0) : gib.toFixed(1)} GiB`;
  return `${Math.round(num / 1024 ** 2)} MiB`;
}

function metricLabel(key) {
  return key
    .replace(/Ppm$/i, "")
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/^./, (char) => char.toUpperCase());
}

function metricValue(key, value) {
  if (typeof value !== "number") return String(value ?? "");
  if (/ppm$/i.test(key)) return `${(value / 10000).toFixed(1)}%`;
  if (/bytes$/i.test(key)) return formatBytes(value);
  return String(value);
}

function isVm(item) {
  return item?.type === "vm";
}

function itemLabel(item) {
  return item?.name || item?.label || "Untitled";
}

function placeName(group, id) {
  const table = inventory?.names?.[group] || {};
  if (typeof table[id] === "string" && table[id]) return table[id];
  const bare = String(id || "").replace(/-/g, "").toLowerCase();
  if (!bare) return "";
  const found = Object.entries(table).find(([key]) => key.replace(/-/g, "").toLowerCase() === bare);
  return found ? found[1] : "";
}

function networkLabel(nic) {
  return placeName("subnets", nic?.subnetId) || nic?.networkName || "";
}

function categoryLabels(asset, card) {
  const seen = new Set();
  const labels = [];
  for (const entry of [...(asset?.categories || []), ...(card?.categories || [])]) {
    const resolved = inventory?.names?.categories?.[entry] || entry;
    if (!resolved || seen.has(resolved)) continue;
    seen.add(resolved);
    labels.push(resolved);
  }
  return labels.join(", ");
}

function filtered(list) {
  const needle = query.trim().toLowerCase();
  if (!needle) return list;
  return list.filter((item) => {
    const hay = [itemLabel(item), item.uuid, item.ipAddress, item.externalAddress, ...(item.categories || [])].join(" ").toLowerCase();
    return hay.includes(needle);
  });
}

function trailNodes() {
  const nodes = [];
  if (!inventory?.root) return nodes;
  let current = inventory.root;
  nodes.push(current);
  for (const id of pathIds) {
    const folders = current.children || [];
    const next = folders.find((item) => rowId(item) === id);
    if (next) {
      current = next;
      nodes.push(current);
      continue;
    }
    const card = (inventory.cards[current.id] || []).find((item) => item.uuid === id);
    if (card) nodes.push(card);
    break;
  }
  return nodes;
}

function renderColumns() {
  columnsEl.replaceChildren();
  if (!inventory?.root) return;
  const columns = buildColumns(inventory.root, pathIds, inventory.cards);
  columns.forEach((column, index) => {
    const isLast = index === columns.length - 1;
    const section = document.createElement("section");
    section.className = "column";
    const head = document.createElement("div");
    head.className = "column-head";
    const title = document.createElement("span");
    title.textContent = column.title;
    const count = document.createElement("span");
    const visible = isLast ? filtered(column.list) : column.list;
    count.textContent = column.list.length ? String(visible.length) : "";
    head.append(title, count);
    head.addEventListener("contextmenu", (event) => {
      event.preventDefault();
      const through = column.selectedId ? index + 1 : index;
      openFavoriteMenu(event, pathIds.slice(0, through), column.title);
    });
    const body = document.createElement("div");
    body.className = "column-body";
    if (column.readError && !column.list.length) {
      const error = document.createElement("p");
      error.className = "column-error";
      error.textContent = column.readError;
      body.append(error);
    } else if (!visible.length) {
      const empty = document.createElement("p");
      empty.className = "column-empty";
      empty.textContent = query && isLast && column.list.length
        ? "No items match the search."
        : column.emptyMessage || "There is nothing in this folder.";
      body.append(empty);
    } else {
      for (const item of visible) {
        const button = document.createElement("button");
        button.type = "button";
        button.className = "row";
        if (rowId(item) === column.selectedId) button.classList.add("is-active");
        if ((item.kind === "host" || item.kind === "network" || item.kind === "category-value") && item.vmCount === 0) {
          button.classList.add("is-empty");
        }
        const isFile = item.type === "vm" || item.type === "disk" || item.type === "container";
        button.innerHTML = isFile ? vmIcon : folderIcon;
        const label = document.createElement("span");
        label.className = "row-label";
        label.textContent = itemLabel(item);
        button.append(label);
        const aside = item.externalAddress || item.detail || "";
        if (aside) {
          const note = document.createElement("span");
          note.className = "row-note";
          note.textContent = aside;
          button.append(note);
        } else if (!isVm(item) && item.binding === "unbound") {
          const note = document.createElement("span");
          note.className = "row-note";
          note.textContent = "Not bound";
          button.append(note);
        }
        button.addEventListener("click", () => choose(index, item));
        button.addEventListener("contextmenu", (event) => {
          event.preventDefault();
          event.stopPropagation();
          if (isVm(item)) openVmMenu(event, item);
          else openFavoriteMenu(event, pathIds.slice(0, index).concat(rowId(item)), itemLabel(item));
        });
        body.append(button);
      }
    }
    section.append(head, body);
    columnsEl.append(section);
  });
  const last = columnsEl.lastElementChild;
  if (last) last.scrollIntoView({ inline: "end", block: "nearest" });
}

function renderPath() {
  pathbar.replaceChildren();
  const nodes = trailNodes();
  nodes.forEach((node, index) => {
    if (index) {
      const sep = document.createElement("span");
      sep.className = "path-sep";
      sep.textContent = "›";
      pathbar.append(sep);
    }
    const chip = document.createElement("button");
    chip.type = "button";
    chip.className = "path-chip";
    chip.textContent = node.name || node.label || "Untitled";
    chip.addEventListener("click", () => {
      pathIds = pathIds.slice(0, index);
      detail = null;
      render();
    });
    pathbar.append(chip);
  });
}

function addRows(dl, pairs) {
  for (const [label, value] of pairs) {
    if (value == null || value === "") continue;
    const dt = document.createElement("dt");
    dt.textContent = label;
    const dd = document.createElement("dd");
    dd.textContent = String(value);
    dl.append(dt, dd);
  }
}

function renderFile(card) {
  const title = document.createElement("h2");
  title.textContent = card.name || "Item";
  inspectorEl.append(title);
  const panel = document.createElement("section");
  panel.className = "panel";
  const heading = document.createElement("h3");
  heading.textContent = "Disk";
  const dl = document.createElement("dl");
  dl.className = "kvs";
  addRows(dl, [
    ["Name", card.name],
    ["UUID", card.uuid],
    ["Size", card.sizeBytes != null ? formatBytes(card.sizeBytes) : ""],
    ["Tier", card.tier]
  ]);
  panel.append(heading, dl);
  inspectorEl.append(panel);
}

function meter(label, value, scale) {
  const row = document.createElement("div");
  row.className = "meter";
  const head = document.createElement("div");
  head.className = "meter-label";
  const name = document.createElement("span");
  name.textContent = label;
  const amount = document.createElement("span");
  amount.textContent = value == null ? "—" : formatBytes(value);
  head.append(name, amount);
  const track = document.createElement("div");
  track.className = "meter-track";
  const fill = document.createElement("div");
  fill.className = "meter-fill";
  const width = value != null && scale > 0 ? Math.min(100, (value / scale) * 100) : 0;
  fill.style.width = `${width}%`;
  track.append(fill);
  row.append(head, track);
  return row;
}

function capacityGraph(usage, logicalCapacity) {
  if (!logicalCapacity) return null;
  const wrap = document.createElement("div");
  const title = document.createElement("h3");
  title.textContent = "Capacity";
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 320 140");
  svg.setAttribute("class", "usage-chart");
  svg.setAttribute("role", "img");
  svg.setAttribute("aria-label", "Presented storage inside logical capacity");
  const scale = Math.max(logicalCapacity || 0, usage.rawCapacityBytes || 0, usage.presentedBytes || 0, usage.logicalBytes || 0);
  const rows = [
    ["Raw capacity", usage.rawCapacityBytes, "#C4A35A"],
    ["Logical capacity", logicalCapacity, "#003D2A"],
    ["Presented", usage.presentedBytes, "#3EB36C"],
    ["Logical", usage.logicalBytes, "#7DCEA0"]
  ];
  rows.forEach(([label, value, color], index) => {
    const y = 6 + index * 34;
    const text = document.createElementNS("http://www.w3.org/2000/svg", "text");
    text.setAttribute("x", "0");
    text.setAttribute("y", String(y + 12));
    text.setAttribute("fill", "#003D2A");
    text.setAttribute("font-size", "11");
    text.textContent = label;
    const track = document.createElementNS("http://www.w3.org/2000/svg", "rect");
    track.setAttribute("x", "118");
    track.setAttribute("y", String(y));
    track.setAttribute("width", "140");
    track.setAttribute("height", "16");
    track.setAttribute("rx", "4");
    track.setAttribute("fill", "#E6EFEA");
    const fill = document.createElementNS("http://www.w3.org/2000/svg", "rect");
    const width = value != null && scale > 0 ? Math.max(2, Math.min(140, (value / scale) * 140)) : 0;
    fill.setAttribute("x", "118");
    fill.setAttribute("y", String(y));
    fill.setAttribute("width", String(width));
    fill.setAttribute("height", "16");
    fill.setAttribute("rx", "4");
    fill.setAttribute("fill", color);
    const amount = document.createElementNS("http://www.w3.org/2000/svg", "text");
    amount.setAttribute("x", "264");
    amount.setAttribute("y", String(y + 12));
    amount.setAttribute("fill", "#4C4C4C");
    amount.setAttribute("font-size", "11");
    amount.textContent = value == null ? "—" : formatBytes(value);
    svg.append(text, track, fill, amount);
  });
  wrap.append(title, svg);
  return wrap;
}

function pointsFrom(samples, keys, scale) {
  return samples.map((sample) => {
    const key = keys.find((name) => Number.isFinite(sample.metrics?.[name]));
    if (!key) return null;
    return { value: scale(sample.metrics[key]), timestamp: sample.timestamp };
  }).filter(Boolean);
}

function lineChart(points, label, unit, ceiling) {
  const wrap = document.createElement("div");
  wrap.className = "vm-chart";
  const heading = document.createElement("h3");
  const latest = points.at(-1);
  heading.textContent = latest ? `${label} · ${latest.value.toFixed(1)} ${unit}` : label;
  wrap.append(heading);
  if (points.length < 2) {
    const empty = document.createElement("p");
    empty.className = "muted";
    empty.textContent = points.length === 1 ? `${points[0].value.toFixed(1)} ${unit}` : "No samples for the last hour.";
    wrap.append(empty);
    return wrap;
  }
  const peak = Math.max(ceiling || 0, ...points.map((point) => point.value), 1);
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 320 64");
  svg.setAttribute("class", "usage-chart");
  svg.setAttribute("role", "img");
  svg.setAttribute("aria-label", label);
  const coords = points.map((point, index) => {
    const x = 8 + (index / (points.length - 1)) * 304;
    const y = 58 - (Math.max(0, point.value) / peak) * 52;
    return `${x},${y}`;
  });
  const line = document.createElementNS("http://www.w3.org/2000/svg", "polyline");
  line.setAttribute("points", coords.join(" "));
  line.setAttribute("fill", "none");
  line.setAttribute("stroke", "#003D2A");
  line.setAttribute("stroke-width", "2");
  svg.append(line);
  wrap.append(svg);
  return wrap;
}

function vmPerformance(samples) {
  const box = document.createElement("div");
  box.className = "vm-metrics";
  const iops = pointsFrom(samples, ["controllerNumIops"], (value) => value);
  const disk = iops.length
    ? { points: iops, unit: "IOPS" }
    : { points: pointsFrom(samples, ["controllerIoBandwidthKbps", "controllerIoBandwidthkBps"], (value) => value), unit: "KB/s" };
  box.append(
    lineChart(pointsFrom(samples, ["hypervisorCpuUsagePpm"], (value) => value / 10000), "CPU utilization", "%", 100),
    lineChart(pointsFrom(samples, ["memoryUsagePpm", "hypervisorMemoryUsagePpm", "guestMemoryUsagePpm"], (value) => value / 10000), "RAM utilization", "%", 100),
    lineChart(disk.points, "Disk I/O", disk.unit, 0)
  );
  return box;
}

function utilizationChart(series) {
  const points = (series || []).filter((point) => Number.isFinite(point.utilization));
  if (points.length < 2) return null;
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 320 120");
  svg.setAttribute("class", "usage-chart");
  svg.setAttribute("role", "img");
  svg.setAttribute("aria-label", "Storage utilization over the last hour");
  const coords = points.map((point, index) => {
    const x = 16 + (index / (points.length - 1)) * 288;
    const y = 104 - Math.max(0, Math.min(1, point.utilization)) * 88;
    return `${x},${y}`;
  });
  const area = document.createElementNS("http://www.w3.org/2000/svg", "polygon");
  const first = coords[0].split(",")[0];
  const last = coords.at(-1).split(",")[0];
  area.setAttribute("points", `${first},104 ${coords.join(" ")} ${last},104`);
  area.setAttribute("fill", "#E6EFEA");
  const line = document.createElementNS("http://www.w3.org/2000/svg", "polyline");
  line.setAttribute("points", coords.join(" "));
  line.setAttribute("fill", "none");
  line.setAttribute("stroke", "#003D2A");
  line.setAttribute("stroke-width", "2");
  svg.append(area, line);
  return svg;
}

function renderContainer(card) {
  const title = document.createElement("h2");
  title.textContent = card.name || "Storage container";
  inspectorEl.append(title);
  if (!containerDetail || containerDetail.uuid !== card.uuid || containerDetail.loading) {
    const wait = document.createElement("p");
    wait.className = "muted";
    wait.textContent = "Reading storage capacity…";
    inspectorEl.append(wait);
    return;
  }
  if (containerDetail.error) {
    const error = document.createElement("p");
    error.className = "form-error";
    error.textContent = containerDetail.error;
    inspectorEl.append(error);
    return;
  }
  const usage = containerDetail.usage || {};
  const panel = document.createElement("section");
  panel.className = "panel";
  const heading = document.createElement("h3");
  heading.textContent = "Storage";
  const dl = document.createElement("dl");
  dl.className = "kvs";
  const logicalCapacity = usage.capacityBytes || Math.max(usage.logicalBytes || 0, usage.presentedBytes || 0, usage.physicalBytes || 0);
  const used = usage.physicalBytes ?? usage.logicalBytes;
  const utilization = used != null && logicalCapacity ? `${((used / logicalCapacity) * 100).toFixed(1)}%` : "";
  addRows(dl, [
    ["Name", card.name],
    ["Logical", usage.logicalBytes != null ? formatBytes(usage.logicalBytes) : ""],
    ["Raw capacity", usage.rawCapacityBytes != null ? formatBytes(usage.rawCapacityBytes) : ""],
    ["Presented", usage.presentedBytes != null ? formatBytes(usage.presentedBytes) : ""],
    ["Capacity", usage.capacityBytes != null ? formatBytes(usage.capacityBytes) : ""],
    ["Utilization", utilization]
  ]);
  panel.append(heading, dl);
  if (usage.presentingLess || (usage.presentedBytes != null && logicalCapacity && usage.presentedBytes < logicalCapacity)) {
    const note = document.createElement("p");
    note.className = "present-note";
    note.textContent = `Presented ${formatBytes(usage.presentedBytes)} is a subset of the ${formatBytes(logicalCapacity)} logical capacity.`;
    panel.append(note);
  }
  const chart = capacityGraph(usage, logicalCapacity);
  if (chart) panel.append(chart);
  const trend = utilizationChart(usage.series);
  if (trend) {
    const trendTitle = document.createElement("h3");
    trendTitle.textContent = "Utilization";
    panel.append(trendTitle, trend);
  }
  if (usage.error) {
    const error = document.createElement("p");
    error.className = "form-error";
    error.textContent = usage.error;
    panel.append(error);
  }
  inspectorEl.append(panel);
}

function renderInspector() {
  inspectorEl.classList.remove("is-vm");
  inspectorEl.replaceChildren();
  const selected = trailNodes().at(-1);
  if (selected?.type === "vm") {
    renderVm(selected);
    return;
  }
  if (selected?.kind === "host") {
    renderHost(selected);
    return;
  }
  if (selected?.type === "container") {
    renderContainer(selected);
    return;
  }
  if (selected?.type === "disk") {
    renderFile(selected);
    return;
  }
  const title = document.createElement("h2");
  title.textContent = selected?.label || "Infrastructure";
  const copy = document.createElement("p");
  copy.className = "muted";
  copy.textContent = selected?.lead || selected?.emptyMessage || "Select a folder or a VM.";
  inspectorEl.append(title, copy);
  if (inventory?.warnings?.length && (selected?.kind === "sites" || selected?.kind === "pc")) {
    for (const warning of inventory.warnings) {
      const note = document.createElement("p");
      note.className = "form-error";
      note.textContent = warning;
      inspectorEl.append(note);
    }
  }
}

function renderVm(card) {
  const head = document.createElement("div");
  head.className = "inspector-head";
  const title = document.createElement("h2");
  title.textContent = card.name;
  const badge = powerBadge(card.powerState);
  const pill = document.createElement("span");
  pill.className = badge.className;
  pill.textContent = badge.text;
  head.append(title, pill);
  inspectorEl.append(head);
  if (!detail || detail.uuid !== card.uuid || detail.loading) {
    const wait = document.createElement("p");
    wait.className = "muted";
    wait.textContent = "Reading asset and performance information…";
    inspectorEl.append(wait);
    return;
  }
  if (detail.error) {
    const error = document.createElement("p");
    error.className = "form-error";
    error.textContent = detail.error;
    inspectorEl.append(error);
    return;
  }
  const asset = detail.asset || {};
  const assetPanel = document.createElement("section");
  assetPanel.className = "panel";
  const assetTitle = document.createElement("h3");
  assetTitle.textContent = "Asset";
  const dl = document.createElement("dl");
  dl.className = "kvs";
  const cpu = [
    asset.numSockets != null ? `${asset.numSockets} sockets` : "",
    asset.numCoresPerSocket != null ? `${asset.numCoresPerSocket} cores/socket` : "",
    asset.numThreadsPerCore != null ? `${asset.numThreadsPerCore} threads/core` : ""
  ].filter(Boolean).join(" · ");
  addRows(dl, [
    ["Name", asset.name],
    ["UUID", asset.uuid],
    ["Description", asset.description],
    ["Power", powerBadge(asset.powerState).text],
    ["CPU", cpu],
    ["Memory", asset.memorySizeBytes != null ? formatBytes(asset.memorySizeBytes) : ""],
    ["Machine", asset.machineType],
    ["Cluster", placeName("clusters", asset.clusterId)],
    ["Host", placeName("hosts", asset.hostId)],
    ["Addresses", (asset.ipAddresses || []).join(", ")],
    ["Network", [...new Set((asset.nics || []).map(networkLabel).filter(Boolean))].join(", ")],
    ["Categories", categoryLabels(asset, card)],
    ["Protection", asset.protectionType],
    ["Agent VM", asset.isAgentVm ? "Yes" : ""],
    ["Controller VM", asset.isControllerVm ? "Yes" : ""],
    ["Created", asset.createTime],
    ["Updated", asset.updateTime]
  ]);
  assetPanel.append(assetTitle, dl);
  if (asset.disks?.length) assetPanel.append(table("Disks", ["Bus", "Index", "Size"], asset.disks.map((disk) => [
    disk.busType, disk.index ?? "", disk.sizeBytes != null ? formatBytes(disk.sizeBytes) : ""
  ])));
  if (asset.nics?.length) assetPanel.append(table("NICs", ["MAC", "Network", "Addresses", "VLAN"], asset.nics.map((nic) => [
    nic.mac, networkLabel(nic), (nic.ips || []).join(", "), nic.vlan
  ])));

  const perf = detail.performance || { error: "", samples: [] };
  const perfPanel = document.createElement("section");
  perfPanel.className = "panel vm-perf";
  const perfTitle = document.createElement("h3");
  perfTitle.textContent = "Performance";
  perfPanel.append(perfTitle);
  if (perf.error) {
    const error = document.createElement("p");
    error.className = "form-error";
    error.textContent = perf.error;
    perfPanel.append(error);
  } else if (!perf.samples?.length) {
    const empty = document.createElement("p");
    empty.className = "muted";
    empty.textContent = "Prism returned no performance samples for the last hour.";
    perfPanel.append(empty);
  } else {
    const shown = perf.samples.slice(-24);
    const note = document.createElement("p");
    note.className = "muted";
    note.textContent = shown.length === perf.samples.length
      ? `${perf.samples.length} sample${perf.samples.length === 1 ? "" : "s"} from the last hour.`
      : `Latest 24 of ${perf.samples.length} samples from the last hour.`;
    perfPanel.append(note);
    perfPanel.append(vmPerformance(shown));
  }
  inspectorEl.append(assetPanel, perfPanel);
}

function table(caption, headers, rows) {
  const wrap = document.createElement("div");
  const heading = document.createElement("h3");
  heading.textContent = caption;
  const el = document.createElement("table");
  el.className = "asset-table";
  const thead = document.createElement("thead");
  const hr = document.createElement("tr");
  for (const header of headers) {
    const th = document.createElement("th");
    th.textContent = header;
    hr.append(th);
  }
  thead.append(hr);
  const tbody = document.createElement("tbody");
  for (const row of rows) {
    const tr = document.createElement("tr");
    for (const cell of row) {
      const td = document.createElement("td");
      td.textContent = cell == null || cell === "" ? "—" : String(cell);
      tr.append(td);
    }
    tbody.append(tr);
  }
  el.append(thead, tbody);
  wrap.append(heading, el);
  return wrap;
}

function choose(columnIndex, item) {
  pathIds = pathIds.slice(0, columnIndex);
  pathIds.push(rowId(item));
  query = "";
  search.value = "";
  if (isVm(item)) {
    detail = { uuid: item.uuid, loading: true };
    containerDetail = null;
    hostDetail = null;
    render();
    loadDetail(item.uuid);
    connectConsole(item);
    return;
  }
  if (item.kind === "host" && item.hostId) {
    detail = null;
    containerDetail = null;
    hostDetail = { id: item.hostId, loading: true };
    render();
    loadHost(item.clusterId, item.hostId);
    return;
  }
  if (item.type === "container") {
    detail = null;
    hostDetail = null;
    containerDetail = { uuid: item.uuid, loading: true };
    render();
    loadContainer(item.uuid);
    return;
  }
  detail = null;
  containerDetail = null;
  hostDetail = null;
  render();
}

function performanceChart(samples) {
  const preferred = ["hypervisorCpuUsagePpm", "memoryUsagePpm", "hypervisorMemoryUsagePpm", "hypervisorCpuUsagePpm"];
  const key = preferred.find((name) => samples.some((sample) => Number.isFinite(sample.metrics?.[name])))
    || Object.keys(samples.at(-1)?.metrics || {}).find((name) => Number.isFinite(samples.at(-1).metrics[name]));
  if (!key) return null;
  const values = samples.map((sample) => sample.metrics?.[key]).filter((value) => Number.isFinite(value));
  if (values.length < 2) return null;
  const max = Math.max(...values, 1);
  const points = samples
    .map((sample) => sample.metrics?.[key])
    .filter((value) => Number.isFinite(value))
    .map((value) => ({ utilization: /ppm$/i.test(key) ? value / 1000000 : value / max }));
  const chart = utilizationChart(points);
  if (!chart) return null;
  chart.setAttribute("aria-label", `${metricLabel(key)} over the last hour`);
  return chart;
}

function renderHost(node) {
  const title = document.createElement("h2");
  title.textContent = node.label || "Host";
  inspectorEl.append(title);
  if (!hostDetail || hostDetail.id !== node.hostId || hostDetail.loading) {
    const wait = document.createElement("p");
    wait.className = "muted";
    wait.textContent = "Reading host hardware and performance…";
    inspectorEl.append(wait);
    return;
  }
  if (hostDetail.error) {
    const error = document.createElement("p");
    error.className = "form-error";
    error.textContent = hostDetail.error;
    inspectorEl.append(error);
    return;
  }
  const host = hostDetail.host || {};
  const panel = document.createElement("section");
  panel.className = "panel";
  const heading = document.createElement("h3");
  heading.textContent = "Hardware";
  const cpu = [
    host.sockets != null ? `${host.sockets} sockets` : "",
    host.cores != null ? `${host.cores} cores` : "",
    host.threads != null ? `${host.threads} threads` : ""
  ].filter(Boolean).join(" · ");
  const dl = document.createElement("dl");
  dl.className = "kvs";
  addRows(dl, [
    ["Name", host.name || node.label],
    ["UUID", host.uuid],
    ["Address", host.ip || node.externalAddress],
    ["CPU", [host.cpuModel, cpu].filter(Boolean).join(" · ")],
    ["CPU capacity", host.cpuHz != null ? `${host.cpuHz} Hz` : ""],
    ["Memory", host.memoryBytes != null ? formatBytes(host.memoryBytes) : ""],
    ["Hypervisor", [host.hypervisor, host.hypervisorState].filter(Boolean).join(" · ")],
    ["Block", [host.blockModel, host.blockSerial].filter(Boolean).join(" · ")]
  ]);
  panel.append(heading, dl);
  if (host.nics?.length) {
    panel.append(table("Network", ["Name", "MAC", "Speed", "Status"], host.nics.map((nic) => [
      nic.name, nic.mac, nic.speed, nic.status
    ])));
  }
  inspectorEl.append(panel);
  const perf = host.performance || { error: "", samples: [] };
  const perfPanel = document.createElement("section");
  perfPanel.className = "panel";
  const perfTitle = document.createElement("h3");
  perfTitle.textContent = "Performance";
  perfPanel.append(perfTitle);
  if (perf.error) {
    const error = document.createElement("p");
    error.className = "form-error";
    error.textContent = perf.error;
    perfPanel.append(error);
  } else if (!perf.samples?.length) {
    const empty = document.createElement("p");
    empty.className = "muted";
    empty.textContent = "Prism returned no performance samples for the last hour.";
    perfPanel.append(empty);
  } else {
    const chart = performanceChart(perf.samples);
    if (chart) perfPanel.append(chart);
    const latest = perf.samples.at(-1);
    const metrics = document.createElement("dl");
    metrics.className = "kvs";
    addRows(metrics, Object.entries(latest.metrics || {}).map(([key, value]) => [metricLabel(key), metricValue(key, value)]));
    perfPanel.append(metrics);
  }
  inspectorEl.append(perfPanel);
}

async function loadHost(clusterId, hostId) {
  try {
    const resp = await fetch(`/api/hosts/${encodeURIComponent(clusterId)}/${encodeURIComponent(hostId)}`, { credentials: "same-origin" });
    const body = await resp.json().catch(() => ({}));
    if (hostDetail?.id !== hostId) return;
    hostDetail = resp.ok ? { id: hostId, host: body } : { id: hostId, error: body.error || "Host detail failed." };
  } catch (error) {
    if (hostDetail?.id !== hostId) return;
    hostDetail = { id: hostId, error: error.message || "Host detail failed." };
  }
  renderInspector();
}

const FAVORITES_KEY = "nav-favorites";
let pendingFavorite = null;

function loadFavorites() {
  try {
    const parsed = JSON.parse(localStorage.getItem(FAVORITES_KEY) || "[]");
    return Array.isArray(parsed) ? parsed : [];
  } catch (_error) {
    return [];
  }
}

function saveFavorites(items) {
  localStorage.setItem(FAVORITES_KEY, JSON.stringify(items));
  renderFavorites();
}

function renderFavorites() {
  const panel = document.querySelector("#favPanel");
  if (!panel) return;
  panel.replaceChildren();
  const items = loadFavorites();
  if (!items.length) {
    const empty = document.createElement("p");
    empty.className = "muted";
    empty.textContent = "No favorites yet.";
    panel.append(empty);
    return;
  }
  for (const item of items) {
    const row = document.createElement("div");
    row.className = "fav-row";
    const open = document.createElement("button");
    open.type = "button";
    open.textContent = item.name;
    open.addEventListener("click", () => {
      panel.hidden = true;
      pathIds = Array.isArray(item.pathIds) ? item.pathIds.slice() : [];
      query = "";
      search.value = "";
      detail = null;
      containerDetail = null;
      hostDetail = null;
      render();
    });
    const remove = document.createElement("button");
    remove.type = "button";
    remove.textContent = "Remove";
    remove.addEventListener("click", () => {
      saveFavorites(loadFavorites().filter((entry) => entry.id !== item.id));
    });
    row.append(open, remove);
    panel.append(row);
  }
}

function openFavoriteMenu(event, nextPath, suggested) {
  menu.replaceChildren();
  const button = document.createElement("button");
  button.type = "button";
  button.textContent = "Add to favorites";
  button.addEventListener("click", () => {
    menu.hidden = true;
    pendingFavorite = { pathIds: nextPath.slice() };
    const dialog = document.querySelector("#favDialog");
    const input = dialog.querySelector("input[name=name]");
    input.value = suggested || "";
    dialog.showModal();
    input.focus();
  });
  menu.append(button);
  menu.hidden = false;
  menu.style.left = `${Math.min(event.clientX, window.innerWidth - 200)}px`;
  menu.style.top = `${Math.min(event.clientY, window.innerHeight - 80)}px`;
}

function openVmMenu(event, vm) {
  menu.replaceChildren();
  for (const [action, label] of [["on", "Power on"], ["off", "Power off"], ["reboot", "Reboot"]]) {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = label;
    button.addEventListener("click", () => {
      menu.hidden = true;
      runPower(vm, action);
    });
    menu.append(button);
  }
  menu.hidden = false;
  menu.style.left = `${Math.min(event.clientX, window.innerWidth - 200)}px`;
  menu.style.top = `${Math.min(event.clientY, window.innerHeight - 140)}px`;
}

async function runPower(vm, action) {
  consoleStatus.textContent = `Sending ${action} to ${vm.name}…`;
  try {
    const resp = await fetch(`/api/vms/${encodeURIComponent(vm.uuid)}/power`, {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action })
    });
    const body = await resp.json().catch(() => ({}));
    consoleStatus.textContent = resp.ok ? `${vm.name}: ${action} accepted.` : (body.error || "Power action failed.");
    if (resp.ok && action === "on") vm.powerState = "ON";
    if (resp.ok && action === "off") vm.powerState = "OFF";
  } catch (error) {
    consoleStatus.textContent = error.message || "Power action failed.";
  }
  renderInspector();
}

function setConsoleMessage(uuid, message) {
  const session = consoles.get(uuid);
  if (session) session.message = message;
  if (activeConsoleId === uuid) consoleStatus.textContent = message;
}

function fitConsole(session) {
  if (!session?.rfb || session.screen.hidden) return;
  session.rfb.scaleViewport = true;
}

function showConsole(uuid) {
  activeConsoleId = uuid;
  for (const [id, session] of consoles) {
    const on = id === uuid;
    session.screen.hidden = !on;
    session.tab.classList.toggle("is-active", on);
  }
  const session = consoles.get(uuid);
  consoleStatus.textContent = session?.message || "";
  requestAnimationFrame(() => fitConsole(session));
}

function closeConsole(uuid) {
  const ids = [...consoles.keys()];
  const index = ids.indexOf(uuid);
  const session = consoles.get(uuid);
  if (!session) return;
  const client = session.rfb;
  session.rfb = null;
  try { client?.disconnect(); } catch (_error) { /* The session is already closed. */ }
  session.tab.remove();
  session.screen.remove();
  consoles.delete(uuid);
  if (activeConsoleId !== uuid) return;
  const next = ids[index - 1] || ids[index + 1];
  if (next && consoles.has(next)) showConsole(next);
  else {
    activeConsoleId = "";
    consoleStatus.textContent = "Select a virtual machine to open its console.";
  }
}

function createConsoleSession(vm) {
  const tab = document.createElement("div");
  tab.className = "console-tab";
  const name = document.createElement("button");
  name.type = "button";
  name.className = "console-tab-name";
  name.textContent = vm.name || "Console";
  name.addEventListener("click", () => showConsole(vm.uuid));
  const close = document.createElement("button");
  close.type = "button";
  close.className = "console-tab-close";
  close.setAttribute("aria-label", `Close ${vm.name || "console"}`);
  close.textContent = "×";
  close.addEventListener("click", (event) => {
    event.stopPropagation();
    closeConsole(vm.uuid);
  });
  tab.append(name, close);
  consoleTabs.append(tab);
  const screen = document.createElement("div");
  screen.className = "console-screen";
  screen.hidden = true;
  consoleScreens.append(screen);
  return { vm, tab, screen, rfb: null, message: "Opening console…" };
}

async function connectConsole(vm) {
  const existing = consoles.get(vm.uuid);
  if (existing) {
    showConsole(vm.uuid);
    return;
  }
  const session = createConsoleSession(vm);
  consoles.set(vm.uuid, session);
  showConsole(vm.uuid);
  try {
    const resp = await fetch(`/api/vms/${encodeURIComponent(vm.uuid)}/console`, {
      method: "POST",
      credentials: "same-origin"
    });
    const body = await resp.json().catch(() => ({}));
    if (!consoles.has(vm.uuid)) return;
    if (!resp.ok) {
      setConsoleMessage(vm.uuid, body.error || "Console did not open.");
      return;
    }
    const { default: RFB } = await import("/vendor/novnc/core/rfb.js");
    const wsUrl = `${location.protocol === "https:" ? "wss" : "ws"}://${location.host}${body.websocketUrl}`;
    session.rfb = new RFB(session.screen, wsUrl, { credentials: {} });
    session.rfb.scaleViewport = true;
    session.rfb.resizeSession = false;
    session.rfb.background = "#1c1c1c";
    session.rfb.addEventListener("connect", () => {
      setConsoleMessage(vm.uuid, vm.name || "Connected");
      fitConsole(session);
    });
    session.rfb.addEventListener("disconnect", () => {
      if (consoles.get(vm.uuid)?.rfb) setConsoleMessage(vm.uuid, "Console disconnected.");
    });
  } catch (error) {
    if (consoles.has(vm.uuid)) setConsoleMessage(vm.uuid, error.message || "Console did not open.");
  }
}

async function loadContainer(uuid) {
  try {
    const resp = await fetch(`/api/storage-containers/${encodeURIComponent(uuid)}`, { credentials: "same-origin" });
    const body = await resp.json().catch(() => ({}));
    if (containerDetail?.uuid !== uuid) return;
    containerDetail = resp.ok
      ? { uuid, usage: body }
      : { uuid, error: body.error || "Storage container detail failed." };
  } catch (error) {
    if (containerDetail?.uuid !== uuid) return;
    containerDetail = { uuid, error: error.message || "Storage container detail failed." };
  }
  renderInspector();
}

async function loadDetail(uuid) {
  try {
    const resp = await fetch(`/api/vms/${encodeURIComponent(uuid)}`, { credentials: "same-origin" });
    const body = await resp.json().catch(() => ({}));
    if (detail?.uuid !== uuid) return;
    detail = resp.ok
      ? { uuid, asset: body.asset, performance: body.performance }
      : { uuid, error: body.error || "VM detail failed." };
  } catch (error) {
    if (detail?.uuid !== uuid) return;
    detail = { uuid, error: error.message || "VM detail failed." };
  }
  renderInspector();
}

function render() {
  renderColumns();
  renderPath();
  renderInspector();
}

function showShell() {
  gate.hidden = true;
  shell.hidden = false;
  who.textContent = username;
}

function showGate() {
  for (const uuid of [...consoles.keys()]) closeConsole(uuid);
  inventory = null;
  pathIds = [];
  detail = null;
  shell.hidden = true;
  gate.hidden = false;
}

async function loadInventory() {
  const resp = await fetch("/api/inventory", { credentials: "same-origin" });
  if (resp.status === 401) {
    showGate();
    return;
  }
  const body = await resp.json();
  if (!resp.ok) {
    showError(body.error || "The inventory read failed.");
    return;
  }
  inventory = body;
  pathIds = [];
  detail = null;
  showShell();
  render();
}

signIn.addEventListener("submit", async (event) => {
  event.preventDefault();
  showError("");
  const button = signIn.querySelector("button");
  button.disabled = true;
  const data = Object.fromEntries(new FormData(signIn).entries());
  username = data.username;
  try {
    const resp = await fetch("/api/session", {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data)
    });
    const body = await resp.json();
    if (!resp.ok) {
      showError(body.error || "Sign-in failed.");
      return;
    }
    await loadInventory();
  } catch (error) {
    const offline = error?.message === "Failed to fetch";
    showError(offline ? "The navigator server did not respond. Reload this page and try again." : error.message || "Sign-in failed.");
  } finally {
    button.disabled = false;
  }
});

logout.addEventListener("click", async () => {
  await fetch("/api/session", { method: "DELETE", credentials: "same-origin" });
  showGate();
});

search.addEventListener("input", () => {
  query = search.value;
  if (inventory) renderColumns();
});

const paneMotions = new WeakMap();

function togglePane(pane, button, hideLabel, showLabel) {
  const running = paneMotions.get(pane);
  const from = pane.getBoundingClientRect().width;
  if (running) {
    pane.style.flexBasis = `${from}px`;
    pane.style.width = `${from}px`;
    running.cancel();
    paneMotions.delete(pane);
  }
  const collapsing = !pane.classList.contains("is-collapsed");
  if (collapsing) pane.dataset.openWidth = String(Math.round(from));
  const to = collapsing ? 28 : Number(pane.dataset.openWidth || Math.round(from));
  pane.classList.toggle("is-collapsed", collapsing);
  button.setAttribute("aria-expanded", String(!collapsing));
  button.setAttribute("aria-label", collapsing ? showLabel : hideLabel);
  pane.style.flexGrow = "0";
  pane.style.flexShrink = "0";
  pane.style.minWidth = "0px";
  pane.style.maxWidth = "none";
  pane.style.overflow = "hidden";
  pane.style.flexBasis = `${from}px`;
  pane.style.width = `${from}px`;
  const animation = pane.animate(
    [
      { flexBasis: `${from}px`, width: `${from}px` },
      { flexBasis: `${to}px`, width: `${to}px` }
    ],
    { duration: 500, easing: "ease-in-out", fill: "forwards" }
  );
  paneMotions.set(pane, animation);
  animation.onfinish = () => {
    pane.style.flexBasis = `${to}px`;
    pane.style.width = `${to}px`;
    animation.cancel();
    paneMotions.delete(pane);
    fitConsole(consoles.get(activeConsoleId));
  };
}

collapseNav.addEventListener("click", () => {
  togglePane(navPane, collapseNav, "Hide navigation", "Show navigation");
});
collapseInspector.addEventListener("click", () => {
  togglePane(inspectorPane, collapseInspector, "Hide details", "Show details");
});
document.querySelector("#favToggle").addEventListener("click", () => {
  const panel = document.querySelector("#favPanel");
  panel.hidden = !panel.hidden;
  if (!panel.hidden) renderFavorites();
});
document.querySelector("#favForm").addEventListener("submit", (event) => {
  event.preventDefault();
  const name = new FormData(event.currentTarget).get("name");
  if (!pendingFavorite || !String(name || "").trim()) return;
  const items = loadFavorites();
  items.push({ id: crypto.randomUUID(), name: String(name).trim(), pathIds: pendingFavorite.pathIds });
  pendingFavorite = null;
  saveFavorites(items);
  document.querySelector("#favDialog").close();
});
document.querySelector("#favCancel").addEventListener("click", () => {
  pendingFavorite = null;
  document.querySelector("#favDialog").close();
});
renderFavorites();

consoleCad.addEventListener("click", () => {
  consoles.get(activeConsoleId)?.rfb?.sendCtrlAltDel();
});
window.addEventListener("resize", () => fitConsole(consoles.get(activeConsoleId)));

document.addEventListener("click", (event) => {
  if (!menu.contains(event.target)) menu.hidden = true;
});
