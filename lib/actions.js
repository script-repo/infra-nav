const VERSIONS = ["v4.0", "v4.1", "v4.2", "v4.3"];
const POWER = {
  on: ["power-on"],
  off: ["power-off"],
  reboot: ["reboot", "guest-reboot"]
};

function missingEndpoint(error) {
  const status = error?.response?.status;
  const data = error?.response?.data;
  const text = (typeof data === "string" ? data : data ? JSON.stringify(data) : error?.message || "").toLowerCase();
  if (status === 404 || status === 405) return true;
  if ((status === 400 || status === 501) && (text.includes("no api path") || text.includes("not found") || text.includes("not implemented"))) {
    return true;
  }
  return false;
}

function needsEtag(error) {
  const status = error?.response?.status;
  const data = error?.response?.data;
  const text = (typeof data === "string" ? data : data ? JSON.stringify(data) : "").toLowerCase();
  if (status === 412 || status === 428) return true;
  return status === 400 && (text.includes("etag") || text.includes("if-match") || text.includes("vmm-30300"));
}

async function postAction(client, url, etag) {
  const headers = { "Content-Type": undefined };
  if (etag) headers["If-Match"] = etag;
  return client.request({ method: "post", url, headers, data: undefined });
}

async function readEtag(client, vmUuid) {
  const id = encodeURIComponent(String(vmUuid || ""));
  for (const version of VERSIONS) {
    try {
      const resp = await client.get(`/api/vmm/${version}/ahv/config/vms/${id}`);
      const etag = resp.headers?.etag || resp.data?.data?.$reserved?.ETag || "";
      if (etag) return String(etag);
    } catch (_error) {
      // Try the next version.
    }
  }
  return "";
}

export async function powerVm(client, vmUuid, action) {
  const names = POWER[action];
  if (!names) {
    const error = new Error("Choose power on, power off, or reboot.");
    error.statusCode = 400;
    throw error;
  }
  const id = encodeURIComponent(String(vmUuid || ""));
  let etag = "";
  let lastError;
  for (const name of names) {
    for (const version of VERSIONS) {
      const url = `/api/vmm/${version}/ahv/config/vms/${id}/$actions/${name}`;
      try {
        await postAction(client, url, etag);
        return { action, operation: name };
      } catch (error) {
        lastError = error;
        if (needsEtag(error) && !etag) {
          etag = await readEtag(client, vmUuid);
          if (etag) {
            try {
              await postAction(client, url, etag);
              return { action, operation: name };
            } catch (retry) {
              lastError = retry;
              if (missingEndpoint(retry)) continue;
              throw retry;
            }
          }
        }
        if (missingEndpoint(error)) continue;
        throw error;
      }
    }
  }
  throw lastError || new Error("Prism Central did not accept that power action.");
}

function findValue(input, keys) {
  const seen = new Set();
  const walk = (node) => {
    if (!node || typeof node !== "object" || seen.has(node)) return "";
    seen.add(node);
    if (Array.isArray(node)) {
      for (const item of node) {
        const found = walk(item);
        if (found) return found;
      }
      return "";
    }
    for (const [key, value] of Object.entries(node)) {
      if (keys.has(key) && typeof value === "string" && value.trim()) return value.trim();
    }
    for (const value of Object.values(node)) {
      const found = walk(value);
      if (found) return found;
    }
    return "";
  };
  return walk(input);
}

function taskStatus(task) {
  return String(task?.status || task?.progressStatus || task?.state || "").toUpperCase();
}

const WS_NAMES = ["consolewebsocketuri", "wsuri", "websocketuri", "websocketurl", "consoleuri", "consolewebsocketurl", "consoleurl", "vncurl"];
const TOKEN_NAMES = ["vmconsoletoken", "consoletoken", "consoletoken", "token", "jwt", "accesstoken"];

function scalarDetail(value, depth = 0) {
  if (depth > 4 || value == null) return "";
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (typeof value === "string") {
    const text = value.trim();
    if ((text.startsWith("{") || text.startsWith("[")) && text.length < 8000) {
      try {
        const parsed = JSON.parse(text);
        return scalarDetail(parsed, depth + 1) || text;
      } catch (_error) {
        return text;
      }
    }
    return text;
  }
  if (typeof value !== "object" || Array.isArray(value)) return "";
  const nested = value.stringValue ?? value.strValue ?? value.value ?? value.data;
  if (nested != null && nested !== value) return scalarDetail(nested, depth + 1);
  return "";
}

function namedDetails(task) {
  const found = [];
  const seen = new Set();
  const walk = (node) => {
    if (!node || typeof node !== "object" || seen.has(node)) return;
    seen.add(node);
    if (Array.isArray(node)) {
      node.forEach(walk);
      return;
    }
    const name = node.name || node.key;
    const value = scalarDetail(node.value);
    if (name && value) found.push({ name: String(name).toLowerCase().replace(/[\s_-]/g, ""), value });
    Object.values(node).forEach(walk);
  };
  walk(task);
  return found;
}

export function consoleTargetFromTask(task, pcHost) {
  const details = namedDetails(task);
  const direct = details.find((item) => /^wss?:\/\//i.test(item.value));
  if (direct) return direct.value;
  const byName = (names) => details.find((item) => names.includes(item.name) && item.value)?.value || "";
  const wsPath = byName(WS_NAMES) || findValue(task, new Set([
    "console_websocket_uri", "WsUri", "wsUri", "websocketUri", "webSocketUri", "websocketUrl", "consoleUri"
  ]));
  const token = byName(TOKEN_NAMES) || findValue(task, new Set([
    "console_token", "VmConsoleToken", "vmConsoleToken", "consoleToken", "jwt"
  ]));
  if (!wsPath && !token) return "";
  if (/^wss?:\/\//i.test(wsPath)) return wsPath;
  const path = wsPath ? (wsPath.startsWith("/") ? wsPath : `/${wsPath}`) : "";
  if (!path || !token) return "";
  const join = path.includes("?") ? "&" : "?";
  const withToken = /vmconsoletoken=|token=/i.test(path) ? path : `${path}${join}VmConsoleToken=${encodeURIComponent(token)}`;
  return `wss://${pcHost}:9440${withToken}`;
}

export async function requestConsoleTarget(client, pcHost, vmUuid) {
  const id = encodeURIComponent(String(vmUuid || ""));
  const paths = ["generate-console-token", "generate-vm-console-token"];
  let lastError;
  let taskId = "";
  for (const action of paths) {
    for (const version of VERSIONS) {
      const url = `/api/vmm/${version}/ahv/config/vms/${id}/$actions/${action}`;
      try {
        const resp = await postAction(client, url, "");
        taskId = resp.data?.data?.extId || resp.data?.data?.id || resp.data?.extId || "";
        if (taskId) break;
      } catch (error) {
        lastError = error;
        if (!missingEndpoint(error)) throw error;
      }
    }
    if (taskId) break;
  }
  if (!taskId) throw lastError || new Error("Prism Central did not start a console token.");

  let task = null;
  for (let attempt = 0; attempt < 12; attempt += 1) {
    for (const version of ["v4.0", "v4.1"]) {
      try {
        const resp = await client.get(`/api/prism/${version}/config/tasks/${encodeURIComponent(taskId)}`);
        task = resp.data?.data || resp.data;
        break;
      } catch (error) {
        lastError = error;
      }
    }
    const status = taskStatus(task);
    if (status.includes("SUCCEEDED")) break;
    if (status.includes("FAILED")) {
      throw new Error(findValue(task, new Set(["message", "errorMessage"])) || "Console token task failed.");
    }
    await new Promise((resolve) => setTimeout(resolve, 400));
  }
  if (!taskStatus(task).includes("SUCCEEDED")) {
    throw lastError || new Error("Console token task did not finish.");
  }

  const target = consoleTargetFromTask(task, pcHost);
  if (!target) throw new Error("Prism Central finished the console task without a connection token.");
  return target;
}
