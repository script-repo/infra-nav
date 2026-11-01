import { collectVmIpAddresses, clusterIdFromVm, normalizeVmCategoryEntries } from "./normalize.js";

function text(...values) {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return "";
}

function num(value) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function firstNum(bags, keys) {
  for (const key of keys) {
    for (const bag of bags) {
      const value = num(bag?.[key]);
      if (value != null) return value;
    }
  }
  return null;
}

function bytesFromMib(value) {
  const mib = num(value);
  return mib == null ? null : mib * 1024 * 1024;
}

function flag(...values) {
  for (const value of values) {
    if (typeof value === "boolean") return value;
  }
  return false;
}

function asObjects(value) {
  if (!Array.isArray(value)) return null;
  return value.filter((item) => item && typeof item === "object");
}

function resourceBags(vm) {
  return [vm, vm?.status?.resources, vm?.spec?.resources];
}

function hostIdFromVm(vm) {
  const id =
    vm?.host?.extId ||
    vm?.host_reference?.uuid ||
    vm?.hostReference?.uuid ||
    vm?.status?.resources?.host_reference?.uuid ||
    vm?.status?.resources?.hostReference?.uuid ||
    vm?.spec?.resources?.host_reference?.uuid ||
    vm?.spec?.resources?.hostReference?.uuid ||
    "";
  return typeof id === "string" ? id.trim() : "";
}

function normalizeDisk(disk) {
  const address =
    disk?.diskAddress ||
    disk?.disk_address ||
    disk?.device_properties?.disk_address ||
    disk?.deviceProperties?.diskAddress ||
    {};
  const sizeBytes =
    num(disk?.backingInfo?.diskSizeBytes) ??
    num(disk?.backing_info?.disk_size_bytes) ??
    num(disk?.diskSizeBytes) ??
    num(disk?.disk_size_bytes) ??
    bytesFromMib(disk?.disk_size_mib) ??
    bytesFromMib(disk?.diskSizeMib);
  return {
    busType: text(address.busType, address.adapter_type, address.adapterType, disk?.busType),
    index: num(address.index ?? address.device_index ?? address.deviceIndex ?? disk?.index),
    sizeBytes
  };
}

function vlanLabel(nic) {
  const sources = [nic?.nicNetworkInfo, nic?.networkInfo, nic?.nic_network_info, nic];
  for (const source of sources) {
    if (!source || typeof source !== "object") continue;
    for (const key of ["vlanId", "vlan_id"]) {
      const value = source[key];
      if (typeof value === "number" && Number.isFinite(value)) return String(value);
      if (typeof value === "string" && value.trim()) return value.trim();
    }
  }
  for (const source of sources) {
    if (!source || typeof source !== "object") continue;
    for (const key of ["vlanMode", "vlan_mode"]) {
      if (typeof source[key] === "string" && source[key].trim()) return source[key].trim();
    }
  }
  return "";
}

function subnetOf(nic) {
  const sources = [nic?.nicNetworkInfo, nic?.networkInfo, nic?.nic_network_info, nic];
  for (const source of sources) {
    if (!source || typeof source !== "object") continue;
    const subnet = source.subnet || source.subnetReference || source.subnet_reference || source.networkReference || null;
    const subnetId = text(subnet?.extId, subnet?.uuid, source.subnetExtId, source.networkUuid, source.network_uuid);
    const networkName = text(subnet?.name, source.networkName, source.network_name, source.subnetName);
    if (subnetId || networkName) return { subnetId, networkName };
  }
  return { subnetId: "", networkName: "" };
}

function normalizeNic(nic) {
  const network = subnetOf(nic);
  return {
    mac: text(
      nic?.backingInfo?.macAddress,
      nic?.backing_info?.mac_address,
      nic?.macAddress,
      nic?.mac_address
    ),
    ips: collectVmIpAddresses({ nics: [nic] }),
    vlan: vlanLabel(nic),
    subnetId: network.subnetId,
    networkName: network.networkName
  };
}

function memorySizeBytes(vm) {
  const bags = resourceBags(vm);
  return (
    firstNum(bags, ["memorySizeBytes", "memory_size_bytes"]) ??
    bytesFromMib(vm?.status?.resources?.memory_size_mib) ??
    bytesFromMib(vm?.spec?.resources?.memory_size_mib) ??
    bytesFromMib(vm?.memorySizeMib) ??
    bytesFromMib(vm?.status?.resources?.memorySizeMib) ??
    bytesFromMib(vm?.spec?.resources?.memorySizeMib)
  );
}

export function normalizeVmAsset(body) {
  const vm = body && typeof body === "object" && !Array.isArray(body) ? body : {};
  const resources = vm.status?.resources || {};
  const specResources = vm.spec?.resources || {};
  const bags = resourceBags(vm);
  const disks = asObjects(vm.disks) ?? asObjects(resources.disk_list) ?? asObjects(resources.diskList) ?? asObjects(specResources.disk_list) ?? asObjects(specResources.diskList) ?? [];
  const nics = asObjects(vm.nics) ?? asObjects(resources.nic_list) ?? asObjects(resources.nicList) ?? asObjects(specResources.nic_list) ?? asObjects(specResources.nicList) ?? [];

  return {
    uuid: text(vm.extId, vm.id, vm.uuid, vm.metadata?.uuid, resources.uuid),
    name: text(vm.name, vm.spec?.name, resources.name, vm.status?.name, vm.metadata?.name, vm.vmName),
    description: text(vm.description, vm.spec?.description, vm.status?.description, resources.description),
    powerState: text(vm.powerState, resources.power_state, resources.powerState, vm.status?.powerState, specResources.power_state),
    clusterId: clusterIdFromVm(vm),
    hostId: hostIdFromVm(vm),
    numSockets: firstNum(bags, ["numSockets", "num_sockets"]),
    numCoresPerSocket: firstNum(bags, ["numCoresPerSocket", "num_vcpus_per_socket", "num_cores_per_socket"]),
    numThreadsPerCore: firstNum(bags, ["numThreadsPerCore", "num_threads_per_core"]),
    memorySizeBytes: memorySizeBytes(vm),
    machineType: text(vm.machineType, resources.machine_type, resources.machineType, specResources.machine_type, specResources.machineType),
    disks: disks.map(normalizeDisk),
    nics: nics.map(normalizeNic),
    categories: normalizeVmCategoryEntries(
      vm.categories,
      vm.categories_mapping,
      vm.categoriesMapping,
      vm.categoryReferences,
      vm.category_reference_list,
      vm.metadata?.categories,
      vm.metadata?.categories_mapping,
      vm.metadata?.categoriesMapping,
      resources.categories,
      resources.categories_mapping,
      resources.categoriesMapping,
      specResources.categories,
      specResources.categories_mapping,
      specResources.categoriesMapping
    ),
    ipAddresses: collectVmIpAddresses(vm),
    isAgentVm: flag(vm.isAgentVm, resources.is_agent_vm, resources.isAgentVm, specResources.is_agent_vm),
    isControllerVm: flag(vm.isControllerVm, resources.is_controller_vm, resources.isControllerVm, specResources.is_controller_vm),
    protectionType: text(vm.protectionType, resources.protection_type, resources.protectionType, specResources.protection_type),
    createTime: text(vm.createTime, vm.metadata?.creation_time, vm.metadata?.creationTime, resources.create_time),
    updateTime: text(vm.updateTime, vm.metadata?.last_update_time, vm.metadata?.lastUpdateTime, resources.update_time)
  };
}

function timestampOf(sample) {
  const value = sample?.timestamp ?? sample?.time;
  if (typeof value === "string") return value;
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return "";
}

function numericMetrics(sample) {
  const metrics = {};
  if (!sample || typeof sample !== "object" || Array.isArray(sample)) return metrics;
  const source =
    sample.metrics && typeof sample.metrics === "object" && !Array.isArray(sample.metrics)
      ? { ...sample, ...sample.metrics }
      : sample;
  for (const [key, value] of Object.entries(source)) {
    if (key.startsWith("$") || key === "timestamp" || key === "time" || key === "metrics") continue;
    const number = typeof value === "number" ? value : typeof value === "string" && value.trim() ? Number(value) : NaN;
    if (Number.isFinite(number)) metrics[key] = number;
  }
  return metrics;
}

function samplesFromStats(stats) {
  const rows = Array.isArray(stats) ? stats : stats && typeof stats === "object" ? [stats] : [];
  return rows
    .map((sample) => ({ timestamp: timestampOf(sample), metrics: numericMetrics(sample) }))
    .filter((sample) => Object.keys(sample.metrics).length > 0);
}

function statsPayload(raw) {
  if (Array.isArray(raw)) return raw;
  if (Array.isArray(raw?.stats)) return raw.stats;
  if (raw?.stats && typeof raw.stats === "object") return raw.stats;
  return null;
}

export function normalizeVmStats({ raw, error } = {}) {
  if (error) return { error: String(error), samples: [] };
  return { error: "", samples: samplesFromStats(statsPayload(raw)) };
}
