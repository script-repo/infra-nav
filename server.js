import crypto from "node:crypto";
import http from "node:http";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import express from "express";
import { powerVm, requestConsoleTarget } from "./lib/actions.js";
import { attachConsoleProxy, rememberConsole } from "./lib/proxy.js";
import { projectInventory } from "./lib/project.js";
import {
  createPrismClient,
  fetchClusterExternalAddress,
  fetchVmBody,
  fetchVmClusterId,
  fetchContainerBody,
  fetchContainerStats,
  fetchHostBody,
  fetchHostNics,
  fetchHostStats,
  fetchVmStats,
  formatPrismError,
  listCategories,
  listClusters,
  listDisks,
  listHosts,
  listHostsByCluster,
  listStorageContainers,
  listSubnets,
  listVmIdsForSubnet,
  listVms,
  mapPool,
  probePrism
} from "./lib/prism.js";
import {
  normalizeCategoryRecord,
  normalizeContainer,
  normalizeDiskRecord,
  normalizeHost,
  normalizeSubnet
} from "./lib/normalize.js";
import { normalizeContainerUsage } from "./lib/container-detail.js";
import { normalizeHostDetail } from "./lib/host-detail.js";
import { normalizeVmAsset, normalizeVmStats } from "./lib/vm-detail.js";

const publicDir = path.join(path.dirname(fileURLToPath(import.meta.url)), "public");
const SESSION_MS = 8 * 60 * 60 * 1000;

export function normalizePcHost(value) {
  let host = String(value || "").trim();
  host = host.replace(/^https?:\/\//i, "");
  host = host.replace(/\/.*$/, "");
  host = host.replace(/:\d+$/, "");
  if (!host || !/^[A-Za-z0-9.-]+$/.test(host) || host.length > 253) {
    const error = new Error("Enter a Prism Central hostname or IP address.");
    error.statusCode = 400;
    throw error;
  }
  return host;
}

function readCookie(req, name) {
  const raw = req.headers.cookie || "";
  for (const part of raw.split(";")) {
    const [key, ...rest] = part.trim().split("=");
    if (key === name) return decodeURIComponent(rest.join("="));
  }
  return "";
}

async function defaultLoadInventory(session) {
  const client = createPrismClient(session);
  let listed;
  try {
    listed = await listClusters(client);
  } catch (error) {
    return {
      clusters: [],
      vms: [],
      clusterError: formatPrismError(error),
      vmError: null,
      warnings: []
    };
  }

  const warnings = [];
  if (listed.truncated) {
    warnings.push("The cluster list was longer than this POC reads in one pass.");
  }
  const clusters = [];
  for (const cluster of listed.clusters) {
    let externalAddress = "";
    try {
      externalAddress = await fetchClusterExternalAddress(client, cluster.id);
    } catch (_error) {
      warnings.push(`External address was not read for cluster ${cluster.id}.`);
    }
    clusters.push({ ...cluster, externalAddress });
  }

  let vmPage = { vms: [], truncated: false };
  let vmError = null;
  try {
    vmPage = await listVms(client);
  } catch (error) {
    vmError = formatPrismError(error);
  }
  if (vmPage.truncated) {
    warnings.push("The VM list was longer than this POC reads in one pass.");
  }

  const missing = vmError ? [] : vmPage.vms.filter((vm) => !vm.clusterId);
  await mapPool(missing, 4, async (vm) => {
    try {
      vm.clusterId = await fetchVmClusterId(client, vm.uuid);
    } catch (_error) {
      vm.clusterId = "";
    }
  });

  const listedHosts = await readList("Hosts", () => loadHostEntities(client, clusters), warnings);
  const listedDisks = await readList("Disks", () => listDisks(client), warnings);
  const listedContainers = await readList("Storage containers", () => listStorageContainers(client), warnings);
  const listedSubnets = await readList("Networks", () => listSubnets(client), warnings);
  const listedCategories = await readList("Categories", () => listCategories(client), warnings);

  const hosts = listedHosts.entities.map((raw) => normalizeHost(raw, raw.__clusterId)).filter((host) => host.id);
  const disks = listedDisks.entities.map(normalizeDiskRecord).filter((disk) => disk.id);
  const containers = listedContainers.entities
    .map(normalizeContainer)
    .filter((container) => container.id);
  const subnets = listedSubnets.entities.map(normalizeSubnet).filter((subnet) => subnet.id);
  await mapPool(subnets.slice(0, 40), 4, async (subnet) => {
    try {
      subnet.vmIds = await listVmIdsForSubnet(client, subnet.id);
    } catch (_error) {
      subnet.vmIds = [];
    }
  });
  const categories = listedCategories.entities
    .map(normalizeCategoryRecord)
    .filter((category) => category.key && category.value);

  return {
    clusters,
    vms: vmPage.vms,
    hosts,
    disks,
    containers,
    subnets,
    categories,
    clusterError: null,
    vmError,
    hostsError: listedHosts.error,
    disksError: listedDisks.error,
    containersError: listedContainers.error,
    networksError: listedSubnets.error,
    categoriesError: listedCategories.error,
    warnings
  };
}

function idsMatch(left, right) {
  const a = String(left || "").replace(/-/g, "").toLowerCase();
  const b = String(right || "").replace(/-/g, "").toLowerCase();
  return Boolean(a) && a === b;
}

async function loadHostEntities(client, clusters) {
  let globalEntities = [];
  let globalError = null;
  try {
    const page = await listHosts(client);
    globalEntities = page.entities || [];
  } catch (error) {
    globalError = error;
  }
  const placed = globalEntities.some((raw) => {
    const host = normalizeHost(raw, raw.__clusterId);
    return clusters.some((cluster) => idsMatch(host.clusterId, cluster.id));
  });
  if (placed) return { entities: globalEntities, truncated: false };
  const entities = [];
  let accepted = false;
  for (const cluster of clusters) {
    try {
      const page = await listHostsByCluster(client, cluster.id);
      accepted = true;
      for (const host of page.entities || []) host.__clusterId = cluster.id;
      entities.push(...(page.entities || []));
    } catch (_clusterError) {
      // Try the next cluster.
    }
  }
  if (entities.length) return { entities, truncated: false };
  if (globalEntities.length) return { entities: globalEntities, truncated: false };
  if (!accepted && globalError) throw globalError;
  return { entities: [], truncated: false };
}

async function readList(label, load, warnings) {
  try {
    const page = await load();
    if (page.truncated) warnings.push(`The ${label.toLowerCase()} list was longer than this POC reads in one pass.`);
    return { entities: page.entities || [], error: null };
  } catch (error) {
    const message = formatPrismError(error);
    warnings.push(`${label} were not read. ${message}`);
    return { entities: [], error: message };
  }
}

async function defaultLoadHost(session, clusterId, hostId) {
  const client = createPrismClient(session);
  const body = await fetchHostBody(client, clusterId, hostId);
  const nics = await fetchHostNics(client, clusterId, hostId);
  const stats = await fetchHostStats(client, clusterId, hostId);
  return normalizeHostDetail({ body, nics, stats });
}

async function defaultOpenConsole(session, uuid) {
  const client = createPrismClient(session);
  const targetUrl = await requestConsoleTarget(client, session.pcHost, uuid);
  const id = rememberConsole({
    targetUrl,
    tlsSkipVerify: Boolean(session.tlsSkipVerify),
    cookie: session.igwCookie || "",
    sendBasic: !session.igwCookie || Boolean(session.sendBasicWithCookie),
    basicAuth: Buffer.from(`${session.username}:${session.password}`).toString("base64")
  });
  return { websocketUrl: `/ws-proxy/${id}` };
}

async function defaultLoadContainer(session, uuid) {
  const client = createPrismClient(session);
  let config = null;
  try {
    config = await fetchContainerBody(client, uuid);
  } catch (_error) {
    config = null;
  }
  const stats = await fetchContainerStats(client, uuid);
  return normalizeContainerUsage({ config, stats });
}

async function defaultLoadVm(session, uuid) {
  const client = createPrismClient(session);
  const body = await fetchVmBody(client, uuid);
  const stats = await fetchVmStats(client, uuid);
  return { asset: normalizeVmAsset(body), performance: normalizeVmStats(stats) };
}

export function createApp(overrides = {}) {
  const sessions = new Map();
  const probe = overrides.probe || probePrism;
  const loadInventory = overrides.loadInventory || defaultLoadInventory;
  const loadVm = overrides.loadVm || defaultLoadVm;
  const loadContainer = overrides.loadContainer || defaultLoadContainer;
  const loadHost = overrides.loadHost || defaultLoadHost;
  const openConsole = overrides.openConsole || defaultOpenConsole;
  const runPower = overrides.runPower || ((session, uuid, action) => powerVm(createPrismClient(session), uuid, action));
  const app = express();
  app.disable("x-powered-by");
  app.use(express.json({ limit: "32kb" }));

  function sessionFor(req) {
    const id = readCookie(req, "nav_sid");
    if (!id) return null;
    const session = sessions.get(id);
    if (!session) return null;
    if (session.expiresAt < Date.now()) {
      sessions.delete(id);
      return null;
    }
    session.expiresAt = Date.now() + SESSION_MS;
    return session;
  }

  function setSessionCookie(res, id) {
    res.setHeader(
      "Set-Cookie",
      `nav_sid=${encodeURIComponent(id)}; HttpOnly; SameSite=Strict; Path=/`
    );
  }

  function clearSessionCookie(res) {
    res.setHeader("Set-Cookie", "nav_sid=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0");
  }

  app.post("/api/session", async (req, res) => {
    try {
      const pcHost = normalizePcHost(req.body?.pcHost);
      const username = String(req.body?.username || "");
      const password = String(req.body?.password || "");
      if (!username || !password) {
        res.status(400).json({ error: "Username and password are required." });
        return;
      }
      const session = { pcHost, username, password, tlsSkipVerify: true, expiresAt: Date.now() + SESSION_MS };
      await probe(session);
      const id = crypto.randomUUID();
      sessions.set(id, session);
      setSessionCookie(res, id);
      res.json({ ok: true, pcHost });
    } catch (error) {
      const status = error.statusCode || 502;
      res.status(status).json({ error: error.message || "Sign-in failed." });
    }
  });

  app.delete("/api/session", (req, res) => {
    const id = readCookie(req, "nav_sid");
    if (id) sessions.delete(id);
    clearSessionCookie(res);
    res.json({ ok: true });
  });

  app.get("/api/inventory", async (req, res) => {
    const session = sessionFor(req);
    if (!session) {
      res.status(401).json({ error: "Sign in required." });
      return;
    }
    res.setHeader("Cache-Control", "no-store");
    try {
      const raw = await loadInventory(session);
      res.json(projectInventory({ pcHost: session.pcHost, ...raw }));
    } catch (error) {
      res.status(502).json({ error: error.message || "Prism read failed." });
    }
  });

  app.get("/api/vms/:uuid", async (req, res) => {
    const session = sessionFor(req);
    if (!session) {
      res.status(401).json({ error: "Sign in required." });
      return;
    }
    res.setHeader("Cache-Control", "no-store");
    try {
      res.json(await loadVm(session, req.params.uuid));
    } catch (error) {
      res.status(502).json({ error: formatPrismError(error) });
    }
  });

  app.get("/api/storage-containers/:uuid", async (req, res) => {
    const session = sessionFor(req);
    if (!session) {
      res.status(401).json({ error: "Sign in required." });
      return;
    }
    res.setHeader("Cache-Control", "no-store");
    try {
      res.json(await loadContainer(session, req.params.uuid));
    } catch (error) {
      res.status(502).json({ error: formatPrismError(error) });
    }
  });

  app.get("/api/hosts/:clusterId/:hostId", async (req, res) => {
    const session = sessionFor(req);
    if (!session) {
      res.status(401).json({ error: "Sign in required." });
      return;
    }
    res.setHeader("Cache-Control", "no-store");
    try {
      res.json(await loadHost(session, req.params.clusterId, req.params.hostId));
    } catch (error) {
      res.status(502).json({ error: formatPrismError(error) });
    }
  });

  app.post("/api/vms/:uuid/console", async (req, res) => {
    const session = sessionFor(req);
    if (!session) {
      res.status(401).json({ error: "Sign in required." });
      return;
    }
    try {
      res.json(await openConsole(session, req.params.uuid));
    } catch (error) {
      res.status(502).json({ error: formatPrismError(error) });
    }
  });

  app.post("/api/vms/:uuid/power", async (req, res) => {
    const session = sessionFor(req);
    if (!session) {
      res.status(401).json({ error: "Sign in required." });
      return;
    }
    const action = String(req.body?.action || "");
    if (!["on", "off", "reboot"].includes(action)) {
      res.status(400).json({ error: "Choose power on, power off, or reboot." });
      return;
    }
    try {
      res.json(await runPower(session, req.params.uuid, action));
    } catch (error) {
      res.status(error.statusCode || 502).json({ error: formatPrismError(error) });
    }
  });

  const libDir = path.join(path.dirname(fileURLToPath(import.meta.url)), "lib");
  app.get("/columns.js", (_req, res) => {
    res.type("text/javascript");
    res.sendFile(path.join(libDir, "columns.js"));
  });

  const vendor = path.join(path.dirname(fileURLToPath(import.meta.url)), "node_modules", "@novnc", "novnc");
  app.use("/vendor/novnc", express.static(vendor));
  app.use(express.static(publicDir));
  return app;
}

const isMain =
  process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;

if (isMain) {
  const port = Number(process.env.PORT || 4173);
  const app = createApp();
  const server = http.createServer(app);
  attachConsoleProxy(server);
  server.listen(port, () => {
    console.log(`Infrastructure navigator listening on http://localhost:${port}`);
  });
}
