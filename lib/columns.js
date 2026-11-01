const CARD_KINDS = new Set([
  "vms",
  "host-vms",
  "disks",
  "storage",
  "network",
  "category-value",
  "unresolved"
]);

export function rowId(item) {
  return item?.uuid || item?.id || "";
}

export function buildColumns(root, pathIds = [], cards = {}) {
  const columns = [];
  let current = root;
  const trail = Array.isArray(pathIds) ? pathIds : [];
  for (let depth = 0; depth < 16 && current; depth += 1) {
    const hasFolders = (current.children || []).length > 0;
    const isFiles = !hasFolders && (CARD_KINDS.has(current.kind) || (cards[current.id] || []).length > 0);
    const list = hasFolders ? current.children : isFiles ? cards[current.id] || [] : [];
    const mode = hasFolders ? "folders" : isFiles ? "files" : "empty";
    const selectedId = trail[depth] || "";
    columns.push({
      title: current.label,
      nodeId: current.id,
      mode,
      binding: current.binding || "bound",
      readError: current.readError || "",
      emptyMessage: list.length ? "" : current.readError || current.emptyMessage || "",
      list,
      selectedId
    });
    if (!selectedId || mode !== "folders") break;
    const next = list.find((item) => rowId(item) === selectedId);
    if (!next) break;
    current = next;
  }
  return columns;
}
