import assert from "node:assert/strict";
import test from "node:test";
import { normalizeHostDetail } from "../lib/host-detail.js";

test("host detail keeps CPU, memory, NICs, and performance samples", () => {
  const host = normalizeHostDetail({
    body: {
      extId: "h1",
      hostName: "node-a",
      cpuModel: "AMD EPYC",
      numberOfCpuSockets: 2,
      numberOfCpuCores: 32,
      numberOfCpuThreads: 64,
      memorySizeBytes: 512 * 1024 ** 3,
      hypervisor: { type: "AHV", state: "ACROPOLIS_NORMAL", externalAddress: { ipv4: { value: "10.0.0.9" } } },
      blockModel: "NX-3060",
      blockSerial: "ABC"
    },
    nics: [{ name: "eth0", macAddress: "00:11:22:33:44:55", linkSpeed: "10000", status: "UP" }],
    stats: { raw: { stats: [{ timestamp: "t", hypervisorCpuUsagePpm: 100000, controllerNumIops: 4 }] } }
  });
  assert.equal(host.name, "node-a");
  assert.equal(host.sockets, 2);
  assert.equal(host.memoryBytes, 512 * 1024 ** 3);
  assert.equal(host.ip, "10.0.0.9");
  assert.equal(host.nics[0].mac, "00:11:22:33:44:55");
  assert.equal(host.performance.samples[0].metrics.hypervisorCpuUsagePpm, 100000);
});
