function finite(...values) {
  for (const value of values) {
    if (Array.isArray(value)) {
      const nested = finite(...value);
      if (nested != null) return nested;
      continue;
    }
    if (value && typeof value === "object") {
      const nested = finite(value.value, value.int64, value.longValue, value.$numberLong, value.amount);
      if (nested != null) return nested;
      continue;
    }
    const num = typeof value === "number" ? value : typeof value === "string" && value.trim() ? Number(value) : NaN;
    if (Number.isFinite(num) && num >= 0) return num;
  }
  return null;
}

function metricsOf(sample) {
  if (!sample || typeof sample !== "object" || Array.isArray(sample)) return {};
  const source = sample.metrics && typeof sample.metrics === "object" ? { ...sample, ...sample.metrics } : sample;
  const metrics = {};
  for (const [key, value] of Object.entries(source)) {
    if (key === "timestamp" || key === "time" || key === "metrics" || key.startsWith("$")) continue;
    const num = finite(value);
    if (num != null) metrics[key] = num;
  }
  return metrics;
}

function statsNode(raw) {
  let node = raw;
  for (let depth = 0; depth < 4 && node && typeof node === "object" && !Array.isArray(node); depth += 1) {
    if (node.stats != null) return node.stats;
    if (node.data != null) {
      node = node.data;
      continue;
    }
    break;
  }
  return raw;
}

function pointTime(point) {
  return typeof point?.timestamp === "string" ? point.timestamp : typeof point?.time === "string" ? point.time : "";
}

function pivotSeries(rows) {
  const byTime = new Map();
  for (const row of rows) {
    const name = row?.name || row?.metric || row?.stat || "";
    const points = Array.isArray(row?.values) ? row.values : Array.isArray(row?.data) ? row.data : null;
    if (!name || !points) continue;
    for (const point of points) {
      const stamp = pointTime(point) || "sample";
      const metrics = byTime.get(stamp) || {};
      const num = finite(point?.value, point?.values, point);
      if (num != null) metrics[name] = num;
      byTime.set(stamp, metrics);
    }
  }
  return [...byTime.entries()].map(([timestamp, metrics]) => ({ timestamp, metrics }));
}

function samplesFrom(raw) {
  const stats = statsNode(raw);
  const rows = Array.isArray(stats) ? stats : stats && typeof stats === "object" ? [stats] : [];
  const pivoted = pivotSeries(rows).filter((sample) => Object.keys(sample.metrics).length > 0);
  if (pivoted.length) return pivoted;
  return rows
    .map((sample) => ({
      timestamp: pointTime(sample),
      metrics: metricsOf(sample)
    }))
    .filter((sample) => Object.keys(sample.metrics).length > 0);
}

function loose(metrics, names) {
  const bag = {};
  for (const [key, value] of Object.entries(metrics || {})) bag[key.toLowerCase()] = value;
  for (const name of names) {
    const num = finite(bag[name.toLowerCase()]);
    if (num != null) return num;
  }
  return null;
}

function usageStat(config, names) {
  return loose({ ...(config?.usageStats || {}), ...(config?.usage_stats || {}), ...(config || {}) }, names);
}

const LOGICAL_KEYS = ["dataReductionOverallPreReductionBytes", "storageUsageBytes", "storage.logical_usage_bytes", "logicalUsageBytes"];
const PHYSICAL_KEYS = ["storageActualPhysicalUsageBytes", "dataReductionOverallPostReductionBytes", "storage.physical_usage_bytes", "storage.usage_bytes", "physicalUsageBytes"];
const CAPACITY_KEYS = ["storageCapacityBytes", "storage.capacity_bytes", "storage.user_capacity_bytes"];
const REPLICATION_KEYS = ["storageReplicationFactor", "replicationFactor", "replication_factor"];

function replicationCopies(...values) {
  for (const value of values) {
    const num = finite(value);
    if (num != null && num >= 1 && num <= 4) return num;
    const text = String(value || "").toUpperCase();
    if (text === "ONE" || text === "RF1" || text === "RF_1") return 1;
    if (text === "TWO" || text === "RF2" || text === "RF_2") return 2;
    if (text === "THREE" || text === "RF3" || text === "RF_3") return 3;
  }
  return null;
}

export function normalizeContainerUsage({ config = null, stats = null } = {}) {
  const samples = samplesFrom(stats?.raw);
  const latest = samples.at(-1)?.metrics || {};
  let logicalBytes = loose(latest, LOGICAL_KEYS) ?? usageStat(config, LOGICAL_KEYS);
  let physicalBytes = loose(latest, PHYSICAL_KEYS) ?? usageStat(config, PHYSICAL_KEYS);
  const capacityBytes = loose(latest, CAPACITY_KEYS) ?? usageStat(config, CAPACITY_KEYS);
  const freeBytes = loose(latest, ["storageFreeBytes", "storage.free_bytes"]) ?? usageStat(config, ["storageFreeBytes", "storage.free_bytes"]);
  if (logicalBytes == null && capacityBytes != null && freeBytes != null) logicalBytes = Math.max(0, capacityBytes - freeBytes);
  const advertised = finite(config?.maxCapacityBytes, config?.advertisedCapacityBytes);
  const presentedBytes = advertised != null ? advertised : capacityBytes;
  const copies = replicationCopies(
    loose(latest, REPLICATION_KEYS),
    usageStat(config, REPLICATION_KEYS),
    config?.replicationFactor,
    config?.replication_factor,
    config?.replicaFactor
  );
  const rawCapacityBytes = capacityBytes != null && copies != null ? capacityBytes * copies : null;
  const presentingLess = presentedBytes != null && capacityBytes != null && presentedBytes < capacityBytes;
  const series = samples
    .map((sample) => {
      const logical = loose(sample.metrics, LOGICAL_KEYS);
      const physical = loose(sample.metrics, PHYSICAL_KEYS);
      const cap = loose(sample.metrics, CAPACITY_KEYS) ?? capacityBytes;
      const used = physical ?? logical;
      if (logical == null && physical == null) return null;
      return {
        timestamp: sample.timestamp,
        logical,
        physical,
        utilization: used != null && cap ? used / cap : null
      };
    })
    .filter(Boolean);
  return {
    error: stats?.error || "",
    logicalBytes,
    physicalBytes,
    presentedBytes,
    capacityBytes,
    replicationFactor: copies,
    rawCapacityBytes,
    presentingLess,
    shortfallBytes: presentingLess ? capacityBytes - presentedBytes : 0,
    series
  };
}

export function containerStatsUseful(raw) {
  const usage = normalizeContainerUsage({ stats: { raw } });
  return usage.logicalBytes != null || usage.physicalBytes != null;
}
