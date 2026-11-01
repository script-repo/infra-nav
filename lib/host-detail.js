function finite(value) {
  const num = typeof value === "number" ? value : typeof value === "string" && value.trim() ? Number(value) : NaN;
  return Number.isFinite(num) ? num : null;
}

function metricsOf(sample) {
  const metrics = {};
  if (!sample || typeof sample !== "object" || Array.isArray(sample)) return metrics;
  for (const [key, value] of Object.entries(sample)) {
    if (key === "timestamp" || key === "time" || key.startsWith("$")) continue;
    const num = finite(value);
    if (num != null) metrics[key] = num;
  }
  return metrics;
}

function samplesFrom(raw) {
  const stats = Array.isArray(raw) ? raw : Array.isArray(raw?.stats) ? raw.stats : raw?.stats && typeof raw.stats === "object" ? [raw.stats] : [];
  return stats
    .map((sample) => ({
      timestamp: typeof sample?.timestamp === "string" ? sample.timestamp : "",
      metrics: metricsOf(sample)
    }))
    .filter((sample) => Object.keys(sample.metrics).length > 0);
}

function nicRow(nic) {
  return {
    name: String(nic?.name || nic?.nicName || ""),
    mac: String(nic?.macAddress || nic?.mac || ""),
    speed: nic?.linkSpeed || nic?.speedInKbps || "",
    status: String(nic?.status || nic?.linkStatus || nic?.linkState || "")
  };
}

export function normalizeHostDetail({ body = {}, nics = [], stats = {} } = {}) {
  const hypervisor = body.hypervisor || {};
  return {
    name: String(body.hostName || body.name || ""),
    uuid: String(body.extId || body.uuid || ""),
    cpuModel: String(body.cpuModel || ""),
    sockets: finite(body.numberOfCpuSockets ?? body.cpuSocketCount),
    cores: finite(body.numberOfCpuCores),
    threads: finite(body.numberOfCpuThreads),
    cpuHz: finite(body.cpuFrequencyHz ?? body.cpuCapacityHz),
    memoryBytes: finite(body.memorySizeBytes ?? body.memoryCapacityBytes),
    hypervisor: String(hypervisor.type || body.hypervisorType || ""),
    hypervisorState: String(hypervisor.state || body.hostStatus || ""),
    blockModel: String(body.blockModel || body.nodeModel || ""),
    blockSerial: String(body.blockSerial || ""),
    ip: String(hypervisor.externalAddress?.ipv4?.value || hypervisor.externalAddress?.ipv4?.address || ""),
    nics: (Array.isArray(nics) ? nics : []).map(nicRow).filter((nic) => nic.name || nic.mac),
    performance: {
      error: stats.error || "",
      samples: samplesFrom(stats.raw)
    }
  };
}
