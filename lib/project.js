export const UNBOUND_MESSAGE = "This folder is not bound in this build.";
export const EMPTY_MESSAGE = "There is nothing in this folder.";

function sortByName(items, field = "name") {
  return [...items].sort((a, b) => String(a[field] || "").localeCompare(String(b[field] || "")));
}

function vmCard(vm) {
  const ipAddresses = Array.isArray(vm.ipAddresses) ? vm.ipAddresses.filter(Boolean) : [];
  return {
    type: "vm",
    uuid: vm.uuid,
    name: vm.name || "Unnamed VM",
    powerState: vm.powerState || "",
    ipAddress: ipAddresses[0] || "",
    ipAddresses,
    categories: Array.isArray(vm.categories) ? vm.categories : [],
    isHidden: Boolean(vm.isHidden),
    isControllerVm: Boolean(vm.isControllerVm),
    clusterId: vm.clusterId || ""
  };
}

function diskCard(disk) {
  return {
    type: "disk",
    uuid: disk.id,
    name: disk.name || disk.id,
    sizeBytes: disk.sizeBytes,
    tier: disk.tier || ""
  };
}

function containerCard(container) {
  return {
    type: "container",
    uuid: container.id,
    name: container.name || container.id,
    capacityBytes: container.capacityBytes
  };
}

function categoryPairs(vm) {
  const pairs = [];
  for (const entry of vm.categories || []) {
    const text = String(entry);
    const splitAt = text.indexOf(":");
    if (splitAt <= 0) continue;
    const key = text.slice(0, splitAt).trim();
    const value = text.slice(splitAt + 1).trim();
    if (key && value) pairs.push({ key, value });
  }
  return pairs;
}

function hasCategory(vm, key, value) {
  return categoryPairs(vm).some((pair) => pair.key === key && pair.value === value);
}

function fileFolder(id, label, kind, cards, items, readError, lead) {
  cards[id] = readError ? [] : items;
  return {
    id,
    label,
    kind,
    binding: "bound",
    readError: readError || "",
    lead,
    emptyMessage: EMPTY_MESSAGE,
    children: []
  };
}

function hostsFolder(siteId, hosts, siteVms, disks, containers, cards, vmError, hostsError) {
  const children = hostsError
    ? []
    : sortByName(hosts).map((host) => {
        const base = `${siteId}:host:${host.id}`;
        const hostVms = siteVms.filter((vm) => vm.hostId && vm.hostId === host.id);
        const hostDisks = disks.filter((disk) => disk.hostId && disk.hostId === host.id);
        const hostContainers = containers.filter(
          (container) => container.clusterId && host.clusterId && container.clusterId === host.clusterId
        );
        return {
          id: base,
          label: host.name || host.id,
          kind: "host",
          binding: "bound",
          hostId: host.id,
          clusterId: host.clusterId || "",
          externalAddress: host.ip || "",
          vmCount: hostVms.length,
          lead: host.ip ? `Host address ${host.ip}.` : "Host on this site.",
          children: [
            fileFolder(`${base}:vms`, "VMs", "host-vms", cards, sortByName(hostVms).map(vmCard), vmError, "VMs on this host."),
            fileFolder(`${base}:disks`, "Disks", "disks", cards, hostDisks.map(diskCard), "", "Disks on this host."),
            fileFolder(
              `${base}:storage`,
              "Storage containers",
              "storage",
              cards,
              hostContainers.map(containerCard),
              "",
              "Storage containers on this host's cluster."
            )
          ]
        };
      });
  return {
    id: `${siteId}:hosts`,
    label: "Hosts",
    kind: "hosts",
    binding: "bound",
    readError: hostsError || "",
    lead: "Hosts on this site.",
    emptyMessage: hostsError || EMPTY_MESSAGE,
    children
  };
}

function networksFolder(siteId, subnets, siteVms, cards, vmError, networksError) {
  const children = networksError
    ? []
    : sortByName(subnets).map((subnet) => {
        const id = `${siteId}:network:${subnet.id}`;
        const members = siteVms.filter(
          (vm) => (vm.subnetIds || []).includes(subnet.id) || (subnet.vmIds || []).includes(vm.uuid)
        );
        cards[id] = vmError ? [] : sortByName(members).map(vmCard);
        return {
          id,
          label: subnet.name || subnet.id,
          kind: "network",
          binding: "bound",
          vmCount: members.length,
          detail: subnet.vlan ? `VLAN ${subnet.vlan}` : "",
          lead: "VMs attached to this network.",
          readError: vmError || "",
          emptyMessage: EMPTY_MESSAGE,
          children: []
        };
      });
  return {
    id: `${siteId}:networks`,
    label: "Networks",
    kind: "networks",
    binding: "bound",
    readError: networksError || "",
    lead: "Networks on this site.",
    emptyMessage: networksError || EMPTY_MESSAGE,
    children
  };
}

function categoriesFolder(siteId, catalog, siteVms, cards, vmError, categoriesError) {
  const pairs = catalog.length
    ? catalog.filter((item) => item.key && item.value)
    : [];
  const seen = new Set(pairs.map((item) => `${item.key}:${item.value}`));
  if (!catalog.length) {
    for (const vm of siteVms) {
      for (const pair of categoryPairs(vm)) {
        const token = `${pair.key}:${pair.value}`;
        if (seen.has(token)) continue;
        seen.add(token);
        pairs.push(pair);
      }
    }
  }
  const children = categoriesError
    ? []
    : sortByName(
        pairs.map((pair) => ({ ...pair, name: `${pair.key}: ${pair.value}` })),
        "name"
      ).map((pair) => {
        const id = `${siteId}:category:${pair.key}:${pair.value}`;
        const members = siteVms.filter((vm) => hasCategory(vm, pair.key, pair.value));
        cards[id] = vmError ? [] : sortByName(members).map(vmCard);
        return {
          id,
          label: pair.name,
          kind: "category-value",
          binding: "bound",
          vmCount: members.length,
          lead: `VMs tagged ${pair.key}:${pair.value}.`,
          readError: vmError || "",
          emptyMessage: EMPTY_MESSAGE,
          children: []
        };
      });
  return {
    id: `${siteId}:categories`,
    label: "Categories",
    kind: "categories",
    binding: "bound",
    readError: categoriesError || (vmError && !children.length ? vmError : ""),
    lead: "Categories configured on this Prism Central.",
    emptyMessage: categoriesError || EMPTY_MESSAGE,
    children
  };
}

function siteNode({
  id,
  label,
  kind,
  externalAddress,
  lead,
  vms,
  hosts,
  disks,
  containers,
  subnets,
  categories,
  cards,
  vmError,
  hostsError,
  disksError,
  containersError,
  networksError,
  categoriesError
}) {
  return {
    id,
    label,
    kind,
    binding: "bound",
    externalAddress: externalAddress || "",
    lead,
    children: [
      fileFolder(`${id}:vms`, "VMs", "vms", cards, sortByName(vms).map(vmCard), vmError, "VMs on this site."),
      hostsFolder(id, hosts, vms, disksError ? [] : disks, containers, cards, vmError, hostsError),
      fileFolder(
        `${id}:storage`,
        "Storage containers",
        "storage",
        cards,
        containers.map(containerCard),
        containersError,
        "Storage containers on this site."
      ),
      networksFolder(id, subnets, vms, cards, vmError, networksError),
      categoriesFolder(id, categories, vms, cards, vmError, categoriesError)
    ]
  };
}

function sameId(left, right) {
  const a = String(left || "").replace(/-/g, "").toLowerCase();
  const b = String(right || "").replace(/-/g, "").toLowerCase();
  return Boolean(a) && a === b;
}

function forCluster(items, clusterId) {
  return items.filter((item) => sameId(item.clusterId, clusterId));
}

function containersFor(containers, clusterId) {
  return containers.filter((item) => !item.clusterId || sameId(item.clusterId, clusterId));
}

function scopedToCluster(items, clusterId, knownIds) {
  const known = knownIds || [];
  return items.filter((item) => {
    if (!item.clusterId || sameId(item.clusterId, clusterId)) return true;
    return !known.some((id) => sameId(id, item.clusterId));
  });
}

export function projectInventory({
  pcHost,
  clusters = [],
  vms = [],
  hosts = [],
  disks = [],
  containers = [],
  subnets = [],
  categories = [],
  clusterError = null,
  vmError = null,
  hostsError = null,
  disksError = null,
  containersError = null,
  networksError = null,
  categoriesError = null,
  warnings = []
} = {}) {
  const cards = {};
  const root = {
    id: "sites",
    label: "Sites",
    kind: "sites",
    binding: "bound",
    readError: clusterError || "",
    externalAddress: pcHost || "",
    lead: clusterError || "Prism Central and the clusters registered to it.",
    children: []
  };

  if (clusterError) {
    return {
      pcHost: pcHost || "",
      error: clusterError,
      warnings,
      root,
      cards,
      names: { clusters: {}, hosts: {} }
    };
  }

  const pcVms = vms.filter((vm) => vm?.uuid);
  const listed = categories.filter((item) => item?.key && item?.value);
  const derived = [];
  const seen = new Set();
  for (const vm of pcVms) {
    for (const pair of categoryPairs(vm)) {
      const token = `${pair.key}:${pair.value}`;
      if (seen.has(token)) continue;
      seen.add(token);
      derived.push(pair);
    }
  }
  const catalog = listed.length ? listed : derived;

  const knownClusterIds = clusters.filter((item) => item?.id).map((cluster) => cluster.id);
  const clusterNodes = clusters.filter((item) => item?.id).map((cluster) => siteNode({
    id: `site:${cluster.id}`,
    label: cluster.name || cluster.id,
    kind: "cluster",
    externalAddress: cluster.externalAddress || "",
    lead: cluster.externalAddress
      ? `Cluster address ${cluster.externalAddress}.`
      : "Cluster registered to this Prism Central.",
    vms: pcVms.filter((vm) => sameId(vm.clusterId, cluster.id)),
    hosts: scopedToCluster(hosts, cluster.id, knownClusterIds),
    disks,
    containers: containersFor(containers, cluster.id),
    subnets: scopedToCluster(subnets, cluster.id, knownClusterIds),
    categories: catalog,
    cards,
    vmError,
    hostsError,
    disksError,
    containersError,
    networksError,
    categoriesError
  }));

  const unresolved = pcVms.filter((vm) => !clusters.some((cluster) => sameId(cluster.id, vm.clusterId)));
  if (!vmError && unresolved.length) {
    const id = "site:pc:unresolved";
    cards[id] = sortByName(unresolved).map(vmCard);
    clusterNodes.push({
      id,
      label: "Cluster not resolved",
      kind: "unresolved",
      binding: "bound",
      lead: "These VMs were returned by Prism and did not include a cluster reference.",
      emptyMessage: EMPTY_MESSAGE,
      children: []
    });
  }

  root.children = [{
    id: "site:pc",
    label: "Prism Central",
    kind: "pc",
    binding: "bound",
    externalAddress: pcHost || "",
    lead: clusters.length
      ? "Clusters registered to this Prism Central."
      : "Prism Central did not return any clusters.",
    children: clusterNodes
  }];

  return {
    pcHost: pcHost || "",
    error: vmError || "",
    warnings,
    root,
    cards,
    names: {
      clusters: Object.fromEntries(clusters.filter((cluster) => cluster.id && cluster.name).map((cluster) => [cluster.id, cluster.name])),
      hosts: Object.fromEntries(hosts.filter((host) => host.id && host.name && host.name !== host.id).map((host) => [host.id, host.name])),
      subnets: Object.fromEntries(subnets.filter((subnet) => subnet.id && subnet.name && subnet.name !== subnet.id).map((subnet) => [subnet.id, subnet.name])),
      categories: Object.fromEntries(catalog.filter((item) => item.id).map((item) => [item.id, `${item.key}: ${item.value}`]))
    }
  };
}
