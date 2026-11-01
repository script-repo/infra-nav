# Infrastructure navigator - Ralph Method PRD

## Overview

Sites opens Prism Central, Prism Central opens clusters, and each cluster opens its infrastructure. A VM click opens a console in the wide middle pane. The right pane shows names, categories, storage, and host hardware.

## Tasks

### Task 1: Hierarchy
Sites contains Prism Central. Prism Central contains clusters. A cluster contains VMs, Hosts, Storage containers, Networks, and Categories.

### Task 2: VM interaction
Right-click a VM for power on, power off, and reboot. Click a VM to open its console in the middle pane and its asset, categories, and performance on the right. Hide folders collapses the left columns.

### Task 3: Host and storage
A host shows CPU, memory, NICs, and performance. Storage containers listed for the cluster show logical, physical, and presented capacity.

## Checklist

- [x] Task 1 complete
- [x] Task 2 complete
- [x] Task 3 complete

## Stop Condition

Exit when ALL are true:

- `npm test` exits 0
- Sites column lists Prism Central, and that row's children are clusters
- `public/index.html` contains `#consolePane` and `#toggleNav`
- `public/app.js` handles `contextmenu` and posts `/api/vms/:uuid/console` and `/api/vms/:uuid/power`
- Host detail normalization keeps CPU, memory, and NIC fields
