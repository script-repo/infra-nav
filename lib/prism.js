import crypto from "node:crypto";
import https from "node:https";
import axios from "axios";
import { containerStatsUseful } from "./container-detail.js";
import {
  clusterIdFromVm,
  externalAddressFromCluster,
  extractV4PageInfo,
  normalizeCluster,
  normalizeVm,
  parseGenericEntityList,
  vmIdFromVnic
} from "./normalize.js";

const VERSIONS = ["v4.0", "v4.1", "v4.2"];
const DETAIL_VERSIONS = ["v4.0", "v4.1", "v4.2", "v4.3"];
const READ_VERSIONS = ["v4.0", "v4.1", "v4.2", "v4.3", "v4.4"];
const PAGE_LIMIT = 100;
const MAX_PAGES = 20;
const STATS_WINDOW_MS = 60 * 60 * 1000;

function attachRequestIds(client) {
  client.interceptors.request.use((config) => {
    const reqId = crypto.randomUUID();
    config.headers = config.headers || {};
    config.headers["NTNX-Request-Id"] = reqId;
    config.headers["X-Request-Id"] = reqId;
    return config;
  });
  return client;
}

export function createPrismClient({ pcHost, username, password, tlsSkipVerify, igwCookie, sendBasicWithCookie }) {
  const config = {
    headers: { "Content-Type": "application/json" },
    timeout: 20000,
    httpsAgent: new https.Agent({ rejectUnauthorized: !tlsSkipVerify }),
    baseURL: `https://${pcHost}:9440`
  };
  if (igwCookie) config.headers.Cookie = igwCookie;
  if (!igwCookie || sendBasicWithCookie) config.auth = { username, password };
  return attachRequestIds(axios.create(config));
}

function extractCookieHeader(setCookie) {
  const list = Array.isArray(setCookie) ? setCookie : setCookie ? [setCookie] : [];
  return list
    .map((cookie) => String(cookie).split(";")[0].trim())
    .filter(Boolean)
    .join("; ");
}

export async function loginIntentGateway(session) {
  const client = attachRequestIds(axios.create({
    headers: { "Content-Type": "application/json" },
    timeout: 20000,
    maxRedirects: 0,
    validateStatus: () => true,
    httpsAgent: new https.Agent({ rejectUnauthorized: !session.tlsSkipVerify }),
    baseURL: `https://${session.pcHost}:9440`
  }));
  const resp = await client.post("/api/nutanix/v3/users/login", {
    username: session.username,
    password: session.password
  }).catch((error) => error.response || Promise.reject(error));
  const cookie = extractCookieHeader(resp.headers?.["set-cookie"]);
  if (resp.status === 401 || resp.status === 403) {
    const error = new Error("Prism Central rejected that username or password.");
    error.statusCode = 401;
    throw error;
  }
  if (!cookie || resp.status >= 400) {
    const error = new Error("Prism Central did not start a sign-in session.");
    error.statusCode = 502;
    throw error;
  }
  session.igwCookie = cookie;
  return cookie;
}

export function formatPrismError(error) {
  const status = error?.response?.status;
  const data = error?.response?.data;
  const apiMessage = data?.data?.error?.[0]?.message || data?.message;
  let detail = "";
  if (typeof apiMessage === "string" && apiMessage.trim()) detail = apiMessage.trim();
  else if (typeof data === "string") detail = data.slice(0, 300);
  else if (data) detail = JSON.stringify(data).slice(0, 300);
  else detail = error?.message || "Prism request failed.";
  return status ? `Prism read failed (${status}). ${detail}` : `Prism read failed. ${detail}`;
}

async function getPages(client, buildUrl) {
  const first = await client.get(buildUrl(0));
  const entities = [...parseGenericEntityList(first)];
  const pageInfo = extractV4PageInfo(first);
  let page = 1;
  while (
    page < MAX_PAGES &&
    pageInfo.totalAvailableResults &&
    entities.length < pageInfo.totalAvailableResults
  ) {
    const resp = await client.get(buildUrl(page));
    const more = parseGenericEntityList(resp);
    if (!more.length) break;
    entities.push(...more);
    page += 1;
  }
  return {
    entities,
    truncated: Boolean(
      pageInfo.totalAvailableResults && entities.length < pageInfo.totalAvailableResults
    )
  };
}

async function probeClusterList(client) {
  let last = "Prism Central did not accept a cluster list.";
  let lastStatus = 0;
  for (const version of VERSIONS) {
    try {
      await client.get(`/api/clustermgmt/${version}/config/clusters?$limit=1`);
      return { ok: true, version };
    } catch (error) {
      last = formatPrismError(error);
      lastStatus = error?.response?.status || lastStatus;
    }
  }
  return { ok: false, status: lastStatus, message: last };
}

export async function probePrism(session) {
  const basic = await probeClusterList(createPrismClient(session));
  if (basic.ok) return { version: basic.version, authMode: "basic" };
  if (!basic.ok && basic.status !== 401) {
    const error = new Error(basic.message);
    error.statusCode = 502;
    throw error;
  }
  await loginIntentGateway(session);
  let signedIn = await probeClusterList(createPrismClient(session));
  if (!signedIn.ok && signedIn.status === 401) {
    session.sendBasicWithCookie = true;
    signedIn = await probeClusterList(createPrismClient(session));
  }
  if (signedIn.ok) return { version: signedIn.version, authMode: "cookie" };
  const error = new Error(
    signedIn.status === 401 || signedIn.status === 403
      ? "Signed in, but this account cannot list clusters."
      : signedIn.message
  );
  error.statusCode = signedIn.status === 403 ? 403 : 502;
  throw error;
}

export async function listClusters(client) {
  let lastError;
  for (const version of VERSIONS) {
    try {
      const page = await getPages(
        client,
        (index) => `/api/clustermgmt/${version}/config/clusters?$limit=${PAGE_LIMIT}&$page=${index}`
      );
      return {
        version,
        truncated: page.truncated,
        clusters: page.entities.map(normalizeCluster).filter((cluster) => cluster.id)
      };
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError || new Error("Prism Central did not accept a cluster list.");
}

export async function listVms(client) {
  let lastError;
  for (const version of VERSIONS) {
    for (const includeHidden of [true, false]) {
      try {
        const page = await getPages(client, (index) => {
          const hidden = includeHidden ? "&$includeHidden=true" : "";
          return `/api/vmm/${version}/ahv/config/vms?$limit=${PAGE_LIMIT}&$page=${index}${hidden}`;
        });
        return {
          version,
          truncated: page.truncated,
          vms: page.entities.map(normalizeVm).filter((vm) => vm.uuid)
        };
      } catch (error) {
        lastError = error;
      }
    }
  }
  throw lastError || new Error("Prism Central did not accept a VM list.");
}

export async function fetchClusterExternalAddress(client, clusterId) {
  if (!clusterId) return "";
  for (const version of VERSIONS) {
    try {
      const resp = await client.get(
        `/api/clustermgmt/${version}/config/clusters/${encodeURIComponent(clusterId)}`
      );
      const body = resp?.data?.data || resp?.data || {};
      const address = externalAddressFromCluster(body);
      if (address) return address;
    } catch (_error) {
      // Try the next version.
    }
  }
  return "";
}

function unwrapData(resp) {
  return resp?.data?.data || resp?.data;
}

export async function fetchVmBody(client, vmUuid) {
  const id = encodeURIComponent(String(vmUuid || ""));
  let lastError;
  for (const version of DETAIL_VERSIONS) {
    try {
      const resp = await client.get(`/api/vmm/${version}/ahv/config/vms/${id}`);
      return unwrapData(resp);
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError || new Error("Prism Central did not accept a VM read.");
}

export async function fetchVmStats(client, vmUuid) {
  const id = encodeURIComponent(String(vmUuid || ""));
  const endTime = new Date();
  const startTime = new Date(endTime.getTime() - STATS_WINDOW_MS);
  const window = `$startTime=${encodeURIComponent(startTime.toISOString())}&$endTime=${encodeURIComponent(endTime.toISOString())}`;
  let lastError;
  let emptyRaw = null;
  const statQueries = [
    `$select=${encodeURIComponent("*")}&$statType=AVG&$samplingInterval=30`,
    `$select=${encodeURIComponent("*")}&$statType=AVG`,
    `$select=${encodeURIComponent("extId,stats")}&$statType=AVG`,
    `$select=${encodeURIComponent("*")}`,
    `$select=${encodeURIComponent("extId,stats")}`
  ];
  for (const select of statQueries) {
    const query = `${window}&${select}`;
    for (const version of DETAIL_VERSIONS) {
      try {
        const resp = await client.get(`/api/vmm/${version}/ahv/stats/vms/${id}?${query}`);
        const raw = unwrapData(resp) || null;
        const stats = raw?.stats;
        const hasStats = Array.isArray(stats) ? stats.length > 0 : Boolean(stats && typeof stats === "object");
        if (hasStats) return { raw, error: "" };
        emptyRaw = raw;
      } catch (error) {
        lastError = error;
      }
    }
  }
  if (emptyRaw) return { raw: emptyRaw, error: "" };
  return {
    raw: null,
    error: formatPrismError(lastError || new Error("Prism Central did not accept a VM stats read."))
  };
}

const CONTAINER_STATS = [
  "storageUsageBytes",
  "storageActualPhysicalUsageBytes",
  "storageCapacityBytes",
  "storageFreeBytes",
  "dataReductionOverallPreReductionBytes",
  "dataReductionOverallPostReductionBytes"
].join(",");

export async function fetchContainerBody(client, containerId) {
  const id = encodeURIComponent(String(containerId || ""));
  let lastError;
  for (const version of READ_VERSIONS) {
    try {
      const resp = await client.get(`/api/clustermgmt/${version}/config/storage-containers/${id}`);
      return unwrapData(resp) || {};
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError || new Error("Prism Central did not accept a storage container read.");
}

export async function fetchContainerStats(client, containerId) {
  const id = encodeURIComponent(String(containerId || ""));
  const endTime = new Date();
  const startTime = new Date(endTime.getTime() - STATS_WINDOW_MS);
  const window = `$startTime=${encodeURIComponent(startTime.toISOString())}&$endTime=${encodeURIComponent(endTime.toISOString())}`;
  const queries = [
    `${window}&$select=${encodeURIComponent(CONTAINER_STATS)}&$statType=AVG&$samplingInterval=300`,
    `${window}&$select=${encodeURIComponent("*")}&$statType=AVG&$samplingInterval=300`,
    `${window}&$select=${encodeURIComponent(CONTAINER_STATS)}&$statType=LAST`,
    `${window}&$select=${encodeURIComponent("*")}`,
    window
  ];
  let lastError;
  let emptyRaw = null;
  for (const query of queries) {
    for (const version of READ_VERSIONS) {
      try {
        const resp = await client.get(`/api/clustermgmt/${version}/stats/storage-containers/${id}?${query}`);
        const raw = unwrapData(resp) || null;
        if (containerStatsUseful(raw)) return { raw, error: "" };
        emptyRaw = raw || emptyRaw;
      } catch (error) {
        lastError = error;
      }
    }
  }
  if (emptyRaw) return { raw: emptyRaw, error: "" };
  return {
    raw: null,
    error: formatPrismError(lastError || new Error("Prism Central did not accept a storage container stats read."))
  };
}

async function listVersioned(client, pathFor) {
  let lastError;
  for (const version of READ_VERSIONS) {
    try {
      return await getPages(client, (page) => {
        const path = pathFor(version);
        const sep = path.includes("?") ? "&" : "?";
        return `${path}${sep}$page=${page}&$limit=${PAGE_LIMIT}`;
      });
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError || new Error("Prism Central did not accept the list.");
}

async function listOrUnpaged(client, pathFor) {
  let pagedError = null;
  try {
    const page = await listVersioned(client, pathFor);
    if (page.entities.length) return page;
  } catch (error) {
    pagedError = error;
  }
  let lastError = pagedError;
  for (const version of READ_VERSIONS) {
    try {
      const resp = await client.get(pathFor(version));
      const entities = parseGenericEntityList(resp);
      if (entities.length || !pagedError) return { entities, truncated: false };
    } catch (error) {
      lastError = error;
    }
  }
  if (lastError) throw lastError;
  return { entities: [], truncated: false };
}

export function listHosts(client) {
  return listOrUnpaged(client, (version) => `/api/clustermgmt/${version}/config/hosts`);
}

export function listHostsByCluster(client, clusterId) {
  const id = encodeURIComponent(String(clusterId || ""));
  return listVersioned(client, (version) => `/api/clustermgmt/${version}/config/clusters/${id}/hosts`);
}

export function listDisks(client) {
  return listVersioned(client, (version) => `/api/clustermgmt/${version}/config/disks`);
}

export async function listStorageContainers(client) {
  try {
    return await listVersioned(client, (version) => `/api/clustermgmt/${version}/config/storage-containers`);
  } catch (pagedError) {
    let lastError = pagedError;
    for (const version of READ_VERSIONS) {
      try {
        const resp = await client.get(`/api/clustermgmt/${version}/config/storage-containers`);
        return { entities: parseGenericEntityList(resp), truncated: false };
      } catch (error) {
        lastError = error;
      }
    }
    throw lastError;
  }
}

export async function fetchHostBody(client, clusterId, hostId) {
  const cluster = encodeURIComponent(String(clusterId || ""));
  const host = encodeURIComponent(String(hostId || ""));
  let lastError;
  for (const version of READ_VERSIONS) {
    try {
      const resp = await client.get(`/api/clustermgmt/${version}/config/clusters/${cluster}/hosts/${host}`);
      return unwrapData(resp) || {};
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError || new Error("Prism Central did not accept a host read.");
}

export async function fetchHostNics(client, clusterId, hostId) {
  const cluster = encodeURIComponent(String(clusterId || ""));
  const host = encodeURIComponent(String(hostId || ""));
  try {
    const page = await listVersioned(
      client,
      (version) => `/api/clustermgmt/${version}/config/clusters/${cluster}/hosts/${host}/host-nics`
    );
    return page.entities || [];
  } catch (_error) {
    return [];
  }
}

export async function fetchHostStats(client, clusterId, hostId) {
  const cluster = encodeURIComponent(String(clusterId || ""));
  const host = encodeURIComponent(String(hostId || ""));
  const endTime = new Date();
  const startTime = new Date(endTime.getTime() - STATS_WINDOW_MS);
  const window = `$startTime=${encodeURIComponent(startTime.toISOString())}&$endTime=${encodeURIComponent(endTime.toISOString())}`;
  const query = `${window}&$select=${encodeURIComponent("*")}&$statType=AVG`;
  let lastError;
  let emptyRaw = null;
  for (const version of READ_VERSIONS) {
    try {
      const resp = await client.get(`/api/clustermgmt/${version}/stats/clusters/${cluster}/hosts/${host}?${query}`);
      const raw = unwrapData(resp) || null;
      const stats = raw?.stats;
      const hasStats = Array.isArray(stats) ? stats.length > 0 : Boolean(stats && typeof stats === "object");
      if (hasStats) return { raw, error: "" };
      emptyRaw = raw;
    } catch (error) {
      lastError = error;
    }
  }
  if (emptyRaw) return { raw: emptyRaw, error: "" };
  return {
    raw: null,
    error: formatPrismError(lastError || new Error("Prism Central did not accept a host stats read."))
  };
}

export function listSubnets(client) {
  return listOrUnpaged(client, (version) => `/api/networking/${version}/config/subnets`);
}

export function listCategories(client) {
  return listVersioned(client, (version) => `/api/prism/${version}/config/categories`);
}

export async function listVmIdsForSubnet(client, subnetId) {
  const id = encodeURIComponent(String(subnetId || ""));
  const page = await listVersioned(
    client,
    (version) => `/api/networking/${version}/config/subnets/${id}/vnics`
  );
  return [...new Set(page.entities.map(vmIdFromVnic).filter(Boolean))];
}

export async function fetchVmClusterId(client, vmUuid) {
  if (!vmUuid) return "";
  for (const version of VERSIONS) {
    try {
      const resp = await client.get(
        `/api/vmm/${version}/ahv/config/vms/${encodeURIComponent(vmUuid)}`
      );
      const body = resp?.data?.data || resp?.data || {};
      const id = clusterIdFromVm(body);
      if (id) return id;
    } catch (_error) {
      // Try the next version.
    }
  }
  return "";
}

export async function mapPool(items, limit, worker) {
  const queue = [...items];
  const runners = Array.from({ length: Math.min(limit, queue.length) }, async () => {
    while (queue.length) {
      const item = queue.shift();
      await worker(item);
    }
  });
  await Promise.all(runners);
}
