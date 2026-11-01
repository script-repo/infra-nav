import assert from "node:assert/strict";
import test from "node:test";
import { normalizeContainerUsage } from "../lib/container-detail.js";
import { createApp } from "../server.js";

test("container usage separates logical, physical, and a smaller presented capacity", () => {
  const usage = normalizeContainerUsage({
    config: { maxCapacityBytes: 50 * 1024 ** 3 },
    stats: {
      raw: {
        stats: [
          {
            timestamp: "2026-10-31T16:00:00Z",
            storageUsageBytes: 10 * 1024 ** 3,
            dataReductionOverallPreReductionBytes: 40 * 1024 ** 3,
            storageActualPhysicalUsageBytes: 12 * 1024 ** 3,
            storageCapacityBytes: 100 * 1024 ** 3
          },
          {
            timestamp: "2026-10-31T17:00:00Z",
            storageUsageBytes: 11 * 1024 ** 3,
            dataReductionOverallPreReductionBytes: 42 * 1024 ** 3,
            storageActualPhysicalUsageBytes: 14 * 1024 ** 3,
            storageCapacityBytes: 100 * 1024 ** 3
          }
        ]
      }
    }
  });
  assert.equal(usage.logicalBytes, 42 * 1024 ** 3);
  assert.equal(usage.physicalBytes, 14 * 1024 ** 3);
  assert.equal(usage.presentedBytes, 50 * 1024 ** 3);
  assert.equal(usage.capacityBytes, 100 * 1024 ** 3);
  assert.equal(usage.presentingLess, true);
  assert.equal(usage.shortfallBytes, 50 * 1024 ** 3);
  assert.equal(usage.series.length, 2);
  assert.equal(usage.series[1].utilization, 14 / 100);
});

test("container usage reads wrapped stat values and config usage stats", () => {
  const wrapped = normalizeContainerUsage({
    config: { maxCapacityBytes: 100 },
    stats: { raw: { data: { stats: [{ storageUsageBytes: [42], storageActualPhysicalUsageBytes: [{ value: 14 }], storageCapacityBytes: 100 }] } } }
  });
  assert.equal(wrapped.logicalBytes, 42);
  assert.equal(wrapped.physicalBytes, 14);
  assert.equal(wrapped.capacityBytes, 100);
  const fromConfig = normalizeContainerUsage({
    config: { usageStats: { "storage.logical_usage_bytes": "80", "storage.usage_bytes": "20" }, maxCapacityBytes: 200 }
  });
  assert.equal(fromConfig.logicalBytes, 80);
  assert.equal(fromConfig.physicalBytes, 20);
  assert.equal(fromConfig.presentedBytes, 200);
});

test("raw capacity is logical capacity times the replication factor", () => {
  const usage = normalizeContainerUsage({
    config: { replicationFactor: 2, maxCapacityBytes: 50 },
    stats: { raw: { stats: [{ storageCapacityBytes: 100, storageUsageBytes: 40, storageActualPhysicalUsageBytes: 20 }] } }
  });
  assert.equal(usage.replicationFactor, 2);
  assert.equal(usage.rawCapacityBytes, 200);
  assert.equal(usage.logicalBytes, 40);
  assert.equal(usage.physicalBytes, 20);
});

test("a container with no advertised limit presents its full capacity", () => {
  const usage = normalizeContainerUsage({
    config: {},
    stats: { raw: { stats: [{ storageUsageBytes: 5, storageCapacityBytes: 20, storageActualPhysicalUsageBytes: 4 }] } }
  });
  assert.equal(usage.presentedBytes, 20);
  assert.equal(usage.presentingLess, false);
  assert.equal(usage.series.length, 1);
  assert.equal(usage.series[0].utilization, 4 / 20);
});

test("storage container detail requires a session", async () => {
  const app = createApp({
    probe: async () => ({}),
    loadContainer: async () => ({ logicalBytes: 1, physicalBytes: 1, presentedBytes: 2, capacityBytes: 2, presentingLess: false, series: [] })
  });
  const server = app.listen(0);
  try {
    const port = server.address().port;
    const anon = await fetch(`http://127.0.0.1:${port}/api/storage-containers/abc`);
    assert.equal(anon.status, 401);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});
