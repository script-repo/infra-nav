import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { normalizeVmAsset, normalizeVmStats } from "../lib/vm-detail.js";
import { createApp } from "../server.js";

test("a v4 VM body keeps sockets, memory, disk, NIC, cluster, and categories", () => {
  const asset = normalizeVmAsset({
    extId: "vm-1",
    name: "app",
    description: "demo",
    powerState: "ON",
    cluster: { extId: "cluster-1" },
    host: { extId: "host-1" },
    numSockets: 2,
    numCoresPerSocket: 4,
    numThreadsPerCore: 1,
    memorySizeBytes: 8589934592,
    machineType: "Q35",
    disks: [
      {
        diskAddress: { busType: "SCSI", index: 0 },
        backingInfo: { diskSizeBytes: 10737418240 }
      }
    ],
    nics: [
      {
        backingInfo: { macAddress: "50:6b:8d:11:22:33" },
        nicNetworkInfo: {
          vlanId: 120,
          subnet: { extId: "subnet-1", name: "servers" },
          ipv4Info: { learnedIpAddresses: [{ value: "10.2.3.4" }] }
        }
      }
    ],
    categories: [{ key: "OS", value: "Linux" }],
    isAgentVm: false,
    isControllerVm: true,
    protectionType: "UNPROTECTED",
    createTime: "2024-01-01T00:00:00Z",
    updateTime: "2024-06-01T00:00:00Z"
  });

  assert.equal(asset.uuid, "vm-1");
  assert.equal(asset.numSockets, 2);
  assert.equal(asset.numCoresPerSocket, 4);
  assert.equal(asset.memorySizeBytes, 8589934592);
  assert.equal(asset.clusterId, "cluster-1");
  assert.equal(asset.hostId, "host-1");
  assert.deepEqual(asset.disks, [{ busType: "SCSI", index: 0, sizeBytes: 10737418240 }]);
  assert.equal(asset.nics.length, 1);
  assert.equal(asset.nics[0].mac, "50:6b:8d:11:22:33");
  assert.deepEqual(asset.nics[0].ips, ["10.2.3.4"]);
  assert.equal(asset.nics[0].subnetId, "subnet-1");
  assert.equal(asset.nics[0].networkName, "servers");
  assert.deepEqual(asset.ipAddresses, ["10.2.3.4"]);
  assert.deepEqual(asset.categories, ["OS:Linux"]);
});

test("a v3 VM body maps sockets, mebibytes, disk list, and nic list", () => {
  const asset = normalizeVmAsset({
    metadata: { uuid: "vm-3" },
    spec: { name: "legacy" },
    status: {
      name: "legacy",
      resources: {
        num_sockets: 1,
        num_vcpus_per_socket: 2,
        num_threads_per_core: 1,
        memory_size_mib: 2048,
        power_state: "OFF",
        machine_type: "PC",
        host_reference: { uuid: "host-3" },
        disk_list: [
          {
            device_properties: { disk_address: { adapter_type: "SCSI", device_index: 1 } },
            disk_size_mib: 1024
          }
        ],
        nic_list: [
          {
            mac_address: "aa:bb:cc:dd:ee:ff",
            ip_endpoint_list: [{ ip: "10.9.9.9" }],
            vlan_mode: "ACCESS"
          }
        ]
      }
    },
    clusterReference: { uuid: "cluster-3" }
  });

  assert.equal(asset.uuid, "vm-3");
  assert.equal(asset.numSockets, 1);
  assert.equal(asset.numCoresPerSocket, 2);
  assert.equal(asset.memorySizeBytes, 2048 * 1024 * 1024);
  assert.equal(asset.clusterId, "cluster-3");
  assert.equal(asset.hostId, "host-3");
  assert.deepEqual(asset.disks, [{ busType: "SCSI", index: 1, sizeBytes: 1024 * 1024 * 1024 }]);
  assert.equal(asset.nics[0].mac, "aa:bb:cc:dd:ee:ff");
  assert.deepEqual(asset.nics[0].ips, ["10.9.9.9"]);
  assert.equal(asset.nics[0].vlan, "ACCESS");
  assert.deepEqual(asset.disks.length > 0 && asset.nics.length > 0, true);
});

test("missing VM fields stay empty without inventing a host", () => {
  const asset = normalizeVmAsset({});
  assert.equal(asset.uuid, "");
  assert.equal(asset.name, "");
  assert.equal(asset.hostId, "");
  assert.equal(asset.clusterId, "");
  assert.equal(asset.numSockets, null);
  assert.equal(asset.memorySizeBytes, null);
  assert.deepEqual(asset.disks, []);
  assert.deepEqual(asset.nics, []);
  assert.deepEqual(asset.categories, []);
  assert.deepEqual(asset.ipAddresses, []);
});

test("a stats array becomes one sample of numeric metrics", () => {
  const performance = normalizeVmStats({
    raw: {
      stats: [
        {
          timestamp: "t",
          hypervisorCpuUsagePpm: 100000,
          memoryUsagePpm: 5,
          $objectType: "vmm.v4.stats.VmStatsTuple",
          vmExtId: "abc"
        }
      ]
    },
    error: ""
  });
  assert.deepEqual(performance, {
    error: "",
    samples: [
      {
        timestamp: "t",
        metrics: { hypervisorCpuUsagePpm: 100000, memoryUsagePpm: 5 }
      }
    ]
  });
});

test("a stats object becomes one sample and empty metric rows are dropped", () => {
  const performance = normalizeVmStats({
    raw: { stats: { time: "t2", hypervisorCpuUsagePpm: 3, name: "nope" } },
    error: ""
  });
  assert.deepEqual(performance.samples, [{ timestamp: "t2", metrics: { hypervisorCpuUsagePpm: 3 } }]);
  const empty = normalizeVmStats({ raw: { stats: [{ timestamp: "t", name: "x" }] }, error: "" });
  assert.deepEqual(empty.samples, []);
});

test("a stats failure returns the Prism error and no samples", () => {
  const performance = normalizeVmStats({ raw: null, error: "Prism read failed (404)." });
  assert.equal(performance.error, "Prism read failed (404).");
  assert.deepEqual(performance.samples, []);
});

test("VM detail requires a session and returns the loadVm payload", async () => {
  const app = createApp({
    probe: async () => ({}),
    loadInventory: async () => ({
      clusters: [],
      vms: [],
      clusterError: null,
      vmError: null,
      warnings: []
    }),
    loadVm: async () => ({ asset: { uuid: "u", name: "vm" }, performance: { error: "", samples: [] } })
  });
  const server = app.listen(0);
  try {
    const port = server.address().port;
    const base = `http://127.0.0.1:${port}`;
    const anon = await fetch(`${base}/api/vms/u`);
    assert.equal(anon.status, 401);
    const signed = await fetch(`${base}/api/session`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ pcHost: "pc.example", username: "lab", password: "secret" })
    });
    assert.equal(signed.status, 200);
    const cookie = signed.headers.get("set-cookie").split(";")[0];
    const detail = await fetch(`${base}/api/vms/u`, { headers: { cookie } });
    assert.equal(detail.status, 200);
    assert.equal(detail.headers.get("cache-control"), "no-store");
    assert.deepEqual(await detail.json(), {
      asset: { uuid: "u", name: "vm" },
      performance: { error: "", samples: [] }
    });
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test("prism client stays limited to GET", () => {
  const prism = readFileSync(new URL("../lib/prism.js", import.meta.url), "utf8");
  assert.doesNotMatch(prism, /\.(put|patch|delete)\s*\(/);
  assert.match(prism, /\/api\/nutanix\/v3\/users\/login/);
  assert.match(prism, /\/api\/vmm\/\$\{version\}\/ahv\/config\/vms\/\$\{id\}/);
  assert.match(prism, /\/api\/vmm\/\$\{version\}\/ahv\/stats\/vms\/\$\{id\}/);
});
