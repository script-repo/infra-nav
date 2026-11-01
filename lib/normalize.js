const IPV4_LITERAL = /^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/;

function firstEntityArray(value, depth = 0) {
  if (Array.isArray(value)) return value.length ? value : null;
  if (!value || typeof value !== "object" || depth > 4) return null;
  for (const key of ["entities", "data", "results"]) {
    if (key in value) {
      const found = firstEntityArray(value[key], depth + 1);
      if (found && found.length) return found;
    }
  }
  return null;
}

export function parseGenericEntityList(response) {
  return firstEntityArray(response?.data?.data) || firstEntityArray(response?.data) || firstEntityArray(response) || [];
}

export function extractV4PageInfo(vmResponse) {
  const payload = vmResponse?.data?.data || vmResponse?.data || {};
  const metadata = payload?.metadata || vmResponse?.data?.metadata || {};
  const totalAvailableResults =
    Number(metadata?.totalAvailableResults) ||
    Number(metadata?.total_matches) ||
    Number(payload?.totalAvailableResults) ||
    Number(payload?.total_matches) ||
    0;
  const returned =
    Number(metadata?.returnedResults) ||
    Number(metadata?.returned_results) ||
    Number(payload?.returnedResults) ||
    Number(payload?.returned_results) ||
    0;
  return { totalAvailableResults, returned };
}

function addCategory(out, key, value) {
  if (!key || value == null) return;
  if (Array.isArray(value)) {
    for (const item of value) addCategory(out, key, item);
    return;
  }
  const v = String(value).trim();
  if (v) out.add(`${String(key).trim()}:${v}`);
}

export function normalizeVmCategoryEntries(...sources) {
  const out = new Set();
  for (const source of sources) {
    if (!source) continue;
    if (Array.isArray(source)) {
      for (const item of source) {
        if (typeof item === "string") {
          const trimmed = item.trim();
          if (trimmed) out.add(trimmed);
        } else if (item && typeof item === "object") {
          const key =
            item.key ||
            item.name ||
            item.categoryKey ||
            item.category_key ||
            item.categoryName ||
            item.category_name;
          const value =
            item.value ||
            item.categoryValue ||
            item.category_value ||
            item.categoryValueName ||
            item.category_value_name;
          if (key && value) addCategory(out, key, value);
          else if (item.extId) out.add(String(item.extId));
        }
      }
    } else if (typeof source === "object") {
      for (const [key, value] of Object.entries(source)) addCategory(out, key, value);
    }
  }
  return Array.from(out);
}

export function collectVmIpAddresses(vm) {
  const out = new Set();
  const visit = (node, parentKey) => {
    if (node == null) return;
    if (typeof node === "string") {
      if (IPV4_LITERAL.test(node) && parentKey && /(ip|address)/i.test(parentKey)) {
        out.add(node);
      }
      return;
    }
    if (typeof node !== "object") return;
    if (Array.isArray(node)) {
      node.forEach((child) => visit(child, parentKey));
      return;
    }
    for (const [key, val] of Object.entries(node)) {
      if (
        typeof val === "string" &&
        IPV4_LITERAL.test(val) &&
        /(ip|address|value)/i.test(key) &&
        (/(ip|address)/i.test(key) || /(ip|address)/i.test(parentKey || ""))
      ) {
        out.add(val);
      } else if (val && typeof val === "object") {
        visit(val, key);
      }
    }
  };
  const roots = [
    vm?.nics,
    vm?.spec?.resources?.nic_list,
    vm?.status?.resources?.nic_list,
    vm?.spec?.resources?.nicList,
    vm?.status?.resources?.nicList,
    vm?.networkConfig,
    vm?.networkInfo
  ];
  roots.forEach((root) => visit(root, ""));
  if (out.size === 0) visit(vm, "");
  return Array.from(out);
}

export function hostIdFromVm(vm) {
  const id =
    vm?.host?.extId ||
    vm?.hostReference?.extId ||
    vm?.hostReference?.uuid ||
    vm?.host_reference?.uuid ||
    vm?.status?.resources?.host_reference?.uuid ||
    vm?.spec?.resources?.host_reference?.uuid ||
    "";
  return String(id || "").trim();
}

function collectSubnetIds(vm) {
  const ids = new Set();
  const lists = [
    vm?.nics,
    vm?.nicList,
    vm?.status?.resources?.nic_list,
    vm?.spec?.resources?.nic_list
  ];
  for (const list of lists) {
    if (!Array.isArray(list)) continue;
    for (const nic of list) {
      const id =
        nic?.nicNetworkInfo?.subnet?.extId ||
        nic?.networkInfo?.subnet?.extId ||
        nic?.subnetReference?.extId ||
        nic?.subnet?.extId ||
        nic?.subnet_reference?.uuid ||
        nic?.networkUuid ||
        "";
      if (id) ids.add(String(id));
    }
  }
  return [...ids];
}

function refId(value) {
  if (value == null || value === "") return "";
  if (typeof value === "string" || typeof value === "number") return String(value).trim();
  if (typeof value !== "object") return "";
  return String(value.extId || value.uuid || value.entityId || value.id || "").trim();
}

function firstRef(list) {
  if (!Array.isArray(list)) return "";
  for (const item of list) {
    const id = refId(item);
    if (id) return id;
  }
  return "";
}

export function normalizeHost(raw, fallbackClusterId = "") {
  const id = String(raw?.extId || raw?.uuid || raw?.metadata?.uuid || "").trim();
  const ip =
    raw?.hypervisor?.externalAddress?.ipv4?.value ||
    raw?.hypervisor?.externalAddress?.ipv4?.address ||
    raw?.ipAddress ||
    "";
  const clusterId = String(
    refId(raw?.cluster) ||
    refId(raw?.clusterExtId) ||
    refId(raw?.clusterUuid) ||
    refId(raw?.clusterReference) ||
    firstRef(raw?.clusterReferenceList) ||
    fallbackClusterId ||
    ""
  ).trim();
  return {
    id,
    name: String(raw?.hostName || raw?.name || id).trim(),
    ip: String(ip || ""),
    clusterId
  };
}

export function normalizeDiskRecord(raw) {
  const id = String(raw?.extId || raw?.uuid || "").trim();
  const size = raw?.diskSizeBytes ?? raw?.sizeBytes ?? raw?.capacityBytes;
  return {
    id,
    name: String(raw?.serialNumber || raw?.mountPath || raw?.diskAddress || id),
    hostId: String(
      raw?.host?.extId || raw?.hostExtId || raw?.nodeUuid || raw?.nodeExtId || raw?.hostReference?.uuid || ""
    ).trim(),
    clusterId: String(raw?.clusterExtId || raw?.cluster?.extId || raw?.clusterReference?.uuid || "").trim(),
    sizeBytes: Number.isFinite(size) ? size : null,
    tier: String(raw?.storageTier || raw?.tier || "")
  };
}

export function normalizeContainer(raw) {
  const id = String(raw?.extId || raw?.containerExtId || raw?.uuid || raw?.containerUuid || "").trim();
  const capacity = raw?.maxCapacityBytes ?? raw?.totalExplicitReservedCapacityBytes ?? null;
  return {
    id,
    name: String(raw?.name || raw?.containerName || id),
    clusterId: String(
      raw?.clusterExtId ||
      raw?.clusterUuid ||
      raw?.cluster?.extId ||
      raw?.cluster?.uuid ||
      raw?.clusterReference?.extId ||
      raw?.clusterReference?.uuid ||
      ""
    ).trim(),
    capacityBytes: Number.isFinite(capacity) ? capacity : null
  };
}

export function normalizeSubnet(raw) {
  const id = String(raw?.extId || raw?.uuid || raw?.metadata?.uuid || "").trim();
  const vlan = raw?.vlanId ?? raw?.networkId ?? "";
  return {
    id,
    name: String(raw?.name || id),
    clusterId: String(
      refId(raw?.clusterReference) ||
      firstRef(raw?.clusterReferenceList) ||
      refId(raw?.clusterExtId) ||
      refId(raw?.clusterUuid) ||
      refId(raw?.cluster) ||
      ""
    ).trim(),
    vlan: vlan === "" || vlan == null ? "" : String(vlan),
    vmIds: []
  };
}

export function normalizeCategoryRecord(raw) {
  const key = String(raw?.key || "").trim();
  const value = String(raw?.value || "").trim();
  return {
    id: String(raw?.extId || (key && value ? `${key}:${value}` : "")).trim(),
    key,
    value
  };
}

export function vmIdFromVnic(raw) {
  return String(raw?.vmReference?.extId || raw?.vmExtId || raw?.vmUuid || raw?.vm?.extId || "").trim();
}

export function clusterIdFromVm(vm) {
  const id =
    vm?.cluster?.extId ||
    vm?.cluster?.uuid ||
    vm?.clusterReference?.uuid ||
    vm?.cluster_reference?.uuid ||
    vm?.spec?.cluster_reference?.uuid ||
    vm?.spec?.clusterReference?.uuid ||
    vm?.metadata?.cluster_reference?.uuid ||
    vm?.metadata?.clusterReference?.uuid ||
    "";
  return typeof id === "string" ? id.trim() : "";
}

export function normalizeCluster(entity) {
  const id = entity?.extId || entity?.id || entity?.uuid || entity?.metadata?.uuid || "";
  const name = typeof entity?.name === "string" ? entity.name.trim() : "";
  return {
    id: String(id || "").trim(),
    name
  };
}

export function externalAddressFromCluster(body) {
  const candidates = [
    body?.network?.externalAddress?.ipv4?.value,
    body?.network?.externalAddress?.value,
    body?.network?.externalIpAddress?.ipv4?.value,
    body?.network?.externalIpAddress?.value,
    body?.externalAddress?.ipv4?.value,
    body?.externalAddress?.value,
    body?.externalIpAddress?.ipv4?.value,
    body?.externalIpAddress?.value
  ];
  for (const candidate of candidates) {
    if (typeof candidate === "string" && candidate.trim()) return candidate.trim();
  }
  return "";
}

export function normalizeVm(vm) {
  const categories = normalizeVmCategoryEntries(
    vm?.categories,
    vm?.categories_mapping,
    vm?.categoriesMapping,
    vm?.categoryReferences,
    vm?.category_reference_list,
    vm?.metadata?.categories,
    vm?.metadata?.categories_mapping,
    vm?.metadata?.categoriesMapping,
    vm?.status?.resources?.categories,
    vm?.status?.resources?.categories_mapping,
    vm?.status?.resources?.categoriesMapping,
    vm?.spec?.resources?.categories,
    vm?.spec?.resources?.categories_mapping,
    vm?.spec?.resources?.categoriesMapping
  );
  const name =
    vm?.name ||
    vm?.spec?.name ||
    vm?.spec?.resources?.name ||
    vm?.status?.name ||
    vm?.status?.resources?.name ||
    vm?.metadata?.name ||
    vm?.vmName ||
    "Unnamed VM";
  const ipAddresses = collectVmIpAddresses(vm);
  const power =
    vm?.status?.resources?.powerState ||
    vm?.powerState ||
    vm?.status?.powerState ||
    "";
  return {
    uuid: String(
      vm?.extId || vm?.id || vm?.uuid || vm?.metadata?.uuid || vm?.status?.resources?.uuid || ""
    ).trim(),
    name: String(name),
    powerState: typeof power === "string" ? power : String(power || ""),
    categories,
    ipAddresses,
    clusterId: clusterIdFromVm(vm),
    hostId: hostIdFromVm(vm),
    subnetIds: collectSubnetIds(vm),
    isHidden: Boolean(
      vm?.isHidden || vm?.status?.resources?.isHidden || vm?.spec?.resources?.isHidden
    ),
    isControllerVm: Boolean(
      vm?.isControllerVm ||
        vm?.status?.resources?.isControllerVm ||
        vm?.spec?.resources?.isControllerVm
    )
  };
}
