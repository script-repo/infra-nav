import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { EMPTY_MESSAGE, projectInventory, UNBOUND_MESSAGE } from "../lib/project.js";
import { buildColumns } from "../lib/columns.js";
import { createApp } from "../server.js";

function sampleRaw() {
  return {
    clusters: [
      { id: "c-a", name: "cluster-a", externalAddress: "10.0.0.1" },
      { id: "c-b", name: "cluster-b", externalAddress: "" }
    ],
    vms: [
      {
        uuid: "v1",
        name: "app-1",
        powerState: "ON",
        categories: ["OS:Windows", "Site:cluster-a"],
        ipAddresses: ["10.1.1.1"],
        clusterId: "c-a"
      },
      {
        uuid: "v2",
        name: "app-2",
        powerState: "OFF",
        categories: ["OS:Linux"],
        ipAddresses: [],
        clusterId: "c-b"
      },
      {
        uuid: "v3",
        name: "untagged",
        powerState: "",
        categories: [],
        ipAddresses: [],
        clusterId: "c-a"
      }
    ],
    clusterError: null,
    vmError: null,
    warnings: []
  };
}

function site(tree, id) {
  const pc = tree.root.children.find((node) => node.id === "site:pc");
  return pc?.children?.find((node) => node.id === `site:${id}`);
}

test("sites lists Prism Central and each cluster with its address", () => {
  const tree = projectInventory({ pcHost: "pc.example", ...sampleRaw() });
  const clusterA = site(tree, "c-a");
  const clusterB = site(tree, "c-b");
  assert.equal(tree.root.label, "Sites");
  assert.deepEqual(tree.root.children.map((node) => node.label), ["Prism Central"]);
  assert.deepEqual(tree.root.children[0].children.map((node) => node.label), [
    "cluster-a",
    "cluster-b"
  ]);
  assert.equal(tree.root.children[0].externalAddress, "pc.example");
  assert.equal(clusterA.externalAddress, "10.0.0.1");
  assert.deepEqual(
    clusterA.children.map((node) => node.label),
    ["VMs", "Hosts", "Storage containers", "Networks", "Categories"]
  );
  assert.deepEqual(tree.cards["site:c-a:vms"].map((card) => card.name), ["app-1", "untagged"]);
  assert.deepEqual(tree.cards["site:c-b:vms"].map((card) => card.uuid), ["v2"]);
  const tagged = clusterA.children.at(-1).children.find((node) => node.label === "Site: cluster-a");
  assert.deepEqual(tree.cards[tagged.id].map((card) => card.uuid), ["v1"]);
  const linux = clusterB.children.at(-1).children.find((node) => node.label === "OS: Linux");
  assert.deepEqual(tree.cards[linux.id].map((card) => card.name), ["app-2"]);
  assert.equal(clusterA.children[0].kind, "vms");
});

test("empty categories and hosts stay empty instead of inventing rows", () => {
  const tree = projectInventory({
    pcHost: "pc.example",
    ...sampleRaw(),
    categories: [{ key: "Site", value: "cluster-b" }]
  });
  const clusterB = site(tree, "c-b");
  const category = clusterB.children.at(-1).children[0];
  assert.equal(category.label, "Site: cluster-b");
  assert.equal(category.binding, "bound");
  assert.equal(category.emptyMessage, EMPTY_MESSAGE);
  assert.deepEqual(tree.cards[category.id], []);
  const hosts = clusterB.children[1];
  assert.equal(hosts.binding, "bound");
  assert.equal(hosts.emptyMessage, EMPTY_MESSAGE);
  assert.equal(hosts.children.length, 0);
  assert.equal(clusterB.children[2].kind, "storage");
  assert.deepEqual(tree.cards[clusterB.children[2].id], []);
  const card = tree.cards["site:c-a:vms"][0];
  assert.equal(card.ipAddress, "10.1.1.1");
});

test("hosts and networks stay listed when the cluster reference is blank or unknown", () => {
  const tree = projectInventory({
    pcHost: "10.0.0.7",
    clusters: [{ id: "c1", name: "One" }, { id: "c2", name: "Two" }],
    hosts: [
      { id: "h-match", name: "matched", clusterId: "c1" },
      { id: "h-blank", name: "blank", clusterId: "" },
      { id: "h-odd", name: "odd", clusterId: "not-a-cluster" }
    ],
    subnets: [
      { id: "n-match", name: "matched-net", clusterId: "c2" },
      { id: "n-blank", name: "blank-net", clusterId: "" }
    ]
  });
  const one = site(tree, "c1");
  const two = site(tree, "c2");
  assert.deepEqual(one.children[1].children.map((node) => node.label), ["blank", "matched", "odd"]);
  assert.deepEqual(two.children[1].children.map((node) => node.label), ["blank", "odd"]);
  assert.deepEqual(one.children[3].children.map((node) => node.label), ["blank-net"]);
  assert.deepEqual(two.children[3].children.map((node) => node.label), ["blank-net", "matched-net"]);
});

test("a host, network, and category list the VMs that belong to them", () => {
  const tree = projectInventory({
    pcHost: "10.0.0.7",
    clusters: [{ id: "c1", name: "One", externalAddress: "10.0.0.8" }],
    vms: [{
      uuid: "v1",
      name: "app",
      clusterId: "c1",
      hostId: "h1",
      subnetIds: ["n1"],
      categories: ["OS:Linux"],
      ipAddresses: [],
      powerState: "ON"
    }],
    hosts: [{ id: "h1", name: "node-a", ip: "10.0.0.9", clusterId: "c1" }],
    disks: [{ id: "d1", name: "disk-a", hostId: "h1", clusterId: "c1", sizeBytes: 100, tier: "SSD" }],
    containers: [{ id: "s1", name: "default", clusterId: "c1", capacityBytes: 200 }],
    subnets: [{ id: "n1", name: "vlan-10", clusterId: "c1", vlan: "10", vmIds: ["v1"] }],
    categories: [{ key: "OS", value: "Linux" }]
  });
  const one = site(tree, "c1");
  const host = one.children[1].children[0];
  assert.equal(host.externalAddress, "10.0.0.9");
  assert.equal(host.hostId, "h1");
  assert.equal(host.clusterId, "c1");
  assert.deepEqual(host.children.map((node) => node.label), ["VMs", "Disks", "Storage containers"]);
  assert.equal(tree.cards[`${host.id}:vms`][0].uuid, "v1");
  assert.equal(tree.cards[`${host.id}:disks`][0].type, "disk");
  assert.equal(tree.cards[`${host.id}:storage`][0].name, "default");
  assert.equal(tree.cards["site:c1:storage"][0].name, "default");
  const network = one.children[3].children[0];
  assert.equal(tree.cards[network.id][0].uuid, "v1");
  assert.equal(tree.cards[one.children[4].children[0].id][0].uuid, "v1");
  assert.equal(tree.names.clusters.c1, "One");
  assert.equal(tree.names.hosts.h1, "node-a");
  assert.equal(tree.names.subnets.n1, "vlan-10");
  assert.equal(host.vmCount, 1);
  assert.equal(network.vmCount, 1);
  assert.equal(one.children[4].children[0].vmCount, 1);
});

test("a failed cluster read invents no clusters or VMs", () => {
  const tree = projectInventory({
    pcHost: "pc.example",
    clusters: [{ id: "should-not-appear", name: "Nope" }],
    vms: [{ uuid: "v9", name: "ghost", clusterId: "should-not-appear", categories: ["OS:Windows"] }],
    clusterError: "Prism read failed (503).",
    vmError: null
  });
  assert.equal(tree.root.children.length, 0);
  assert.equal(tree.root.readError, "Prism read failed (503).");
  assert.deepEqual(tree.cards, {});
});

test("a failed VM read keeps clusters and does not invent VM rows", () => {
  const tree = projectInventory({
    pcHost: "pc.example",
    clusters: [{ id: "c1", name: "One" }],
    vms: [],
    clusterError: null,
    vmError: "Prism read failed (500)."
  });
  const one = site(tree, "c1");
  const vms = one.children[0];
  const categories = one.children[4];
  assert.equal(vms.readError, "Prism read failed (500).");
  assert.deepEqual(tree.cards[vms.id], []);
  assert.equal(categories.readError, "Prism read failed (500).");
  assert.equal(categories.children.length, 0);
});

test("VMs with no cluster id stay out of invented clusters", () => {
  const tree = projectInventory({
    pcHost: "pc.example",
    clusters: [{ id: "c1", name: "One" }],
    vms: [{ uuid: "v1", name: "loose", categories: [], clusterId: "" }],
    clusterError: null,
    vmError: null
  });
  assert.equal(tree.cards["site:c1:vms"].length, 0);
  const loose = tree.root.children[0].children.find((node) => node.label === "Cluster not resolved");
  assert.equal(tree.cards[loose.id][0].uuid, "v1");
});

test("static UI is a full-screen console without the old banner", () => {
  const html = readFileSync(new URL("../public/index.html", import.meta.url), "utf8");
  const app = readFileSync(new URL("../public/app.js", import.meta.url), "utf8");
  const css = readFileSync(new URL("../public/styles.css", import.meta.url), "utf8");
  const prism = readFileSync(new URL("../lib/prism.js", import.meta.url), "utf8");
  const theme = readFileSync(new URL("../public/theme.css", import.meta.url), "utf8");
  const ui = `${html}\n${app}\n${css}`;
  assert.doesNotMatch(ui, /art of the possible/i);
  assert.match(html, /id="gate"/);
  assert.match(html, /id="shell"/);
  assert.match(css, /height:\s*100vh/);
  assert.match(app, /gate\.hidden = true/);
  assert.match(app, /\/api\/vms\//);
  assert.doesNotMatch(app, /:9440/);
  assert.doesNotMatch(app, /clustermgmt|\/api\/vmm|\/api\/prism/);
  assert.doesNotMatch(prism, /\.(put|patch|delete)\s*\(/);
  assert.match(prism, /\/api\/nutanix\/v3\/users\/login/);
  assert.match(prism, /\/api\/clustermgmt\/\$\{version\}\/config\/clusters/);
  assert.match(prism, /\/api\/vmm\/\$\{version\}\/ahv\/config\/vms/);
  assert.match(prism, /\$select=/);
  assert.match(prism, /storage-containers/);
  assert.match(prism, /config\/subnets/);
  assert.match(prism, /config\/categories/);
  assert.match(html, /id="consolePane"/);
  assert.match(html, /id="collapseNav"/);
  assert.match(html, /id="collapseInspector"/);
  assert.match(html, /id="consoleTabs"/);
  assert.match(html, /id="aboutToggle"/);
  assert.match(html, /Created by Daemon Behr/);
  assert.match(app, /\/api\/version-build/);
  assert.doesNotMatch(app, /crypto\.randomUUID/);
  assert.doesNotMatch(html, /id="toggleNav"|id="minimizeNav"|Hide folders|Minimize navigation/);
  assert.match(app, /contextmenu/);
  assert.match(app, /\/console/);
  assert.match(theme, /--brand-green:\s*#003D2A/);
  assert.match(theme, /--brand-cream:\s*#E9E3D2/);
});

test("version-build is readable without a session", async () => {
  const app = createApp();
  const server = app.listen(0);
  try {
    const port = server.address().port;
    const resp = await fetch(`http://127.0.0.1:${port}/api/version-build`);
    assert.equal(resp.status, 200);
    assert.deepEqual(await resp.json(), { version: "0.1.0", build: "2026-11-01-007" });
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test("session routes project inventory and reject anonymous reads", async () => {
  const app = createApp({
    probe: async () => ({ version: "v4.0" }),
    loadInventory: async () => sampleRaw()
  });
  const server = app.listen(0);
  try {
    const port = server.address().port;
    const base = `http://127.0.0.1:${port}`;
    const anon = await fetch(`${base}/api/inventory`);
    assert.equal(anon.status, 401);
    const page = await fetch(`${base}/`);
    const html = await page.text();
    assert.match(html, /id="shell"/);
    assert.doesNotMatch(html, /art of the possible/i);
    const signed = await fetch(`${base}/api/session`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        pcHost: "https://pc.example:9440/console",
        username: "lab",
        password: "secret"
      })
    });
    assert.equal(signed.status, 200);
    const cookie = signed.headers.get("set-cookie");
    assert.match(cookie, /nav_sid=/);
    assert.doesNotMatch(JSON.stringify(await signed.json()), /secret/);
    const inventory = await fetch(`${base}/api/inventory`, { headers: { cookie: cookie.split(";")[0] } });
    const body = await inventory.json();
    assert.equal(body.pcHost, "pc.example");
    assert.equal(body.root.label, "Sites");
    assert.equal(body.root.children.length, 1);
    assert.equal(body.root.children[0].label, "Prism Central");
    assert.equal(body.root.children[0].externalAddress, "pc.example");
    assert.equal(body.root.children[0].children.length, 2);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test("every folder level opens as its own column", () => {
  const tree = projectInventory({ pcHost: "pc.example", ...sampleRaw() });
  const pc = tree.root.children[0];
  const clusterA = site(tree, "c-a");
  const clusterB = site(tree, "c-b");
  const [vms, hosts, storage, networks, categories] = clusterA.children;
  const cards = tree.cards;

  assert.equal(buildColumns(tree.root, [], cards)[0].title, "Sites");
  assert.deepEqual(
    buildColumns(tree.root, [], cards)[0].list.map((item) => item.label),
    ["Prism Central"]
  );
  assert.deepEqual(
    buildColumns(tree.root, [pc.id], cards)[1].list.map((item) => item.label),
    ["cluster-a", "cluster-b"]
  );
  assert.deepEqual(
    buildColumns(tree.root, [pc.id, clusterA.id], cards)[2].list.map((item) => item.label),
    ["VMs", "Hosts", "Storage containers", "Networks", "Categories"]
  );
  const hostColumn = buildColumns(tree.root, [pc.id, clusterA.id, hosts.id], cards).at(-1);
  assert.equal(hostColumn.mode, "empty");
  assert.equal(hostColumn.emptyMessage, EMPTY_MESSAGE);
  assert.equal(buildColumns(tree.root, [pc.id, clusterA.id, storage.id], cards).at(-1).emptyMessage, EMPTY_MESSAGE);
  assert.equal(buildColumns(tree.root, [pc.id, clusterA.id, networks.id], cards).at(-1).emptyMessage, EMPTY_MESSAGE);

  const vmColumn = buildColumns(tree.root, [pc.id, clusterA.id, vms.id], cards).at(-1);
  assert.equal(vmColumn.mode, "files");
  assert.deepEqual(vmColumn.list.map((item) => item.name), ["app-1", "untagged"]);

  const osValue = categories.children.find((node) => node.label === "OS: Windows");
  assert.deepEqual(
    buildColumns(tree.root, [pc.id, clusterA.id, categories.id, osValue.id], cards)
      .at(-1)
      .list.map((item) => item.uuid),
    ["v1"]
  );
  const emptyOnB = clusterB.children[4].children.find((node) => node.label === "OS: Windows");
  const emptySite = buildColumns(tree.root, [pc.id, clusterB.id, clusterB.children[4].id, emptyOnB.id], cards).at(-1);
  assert.equal(emptySite.emptyMessage, EMPTY_MESSAGE);
  assert.equal(emptySite.list.length, 0);
});
