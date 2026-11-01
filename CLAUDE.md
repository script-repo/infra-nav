# Infrastructure navigator

Read-only proof of concept. Not a Prism feature and not a production console.

## Source of truth

`sobeys-infrastructure-navigation-spec.md` wins over guesses. Prism calls are limited to spec section 6.

## Layout

- `server.js` - Express session and inventory routes. Browser never talks to Prism.
- `lib/prism.js` - GET-only Prism Central client on port 9440.
- `lib/normalize.js` - Cluster, VM, and category field picking aligned with NRCC.
- `lib/project.js` - Folder tree. Unbound folders have no rows.
- `public/` - Grocery-portal visual system. Tokens live in `public/theme.css`.

## Rules

- Do not add `.post`, `.put`, `.patch`, or `.delete` in `lib/prism.js`.
- Do not invent hosts, disks, storage containers, networks, OS names, or store codes.
- Unbound copy is exactly: `This folder is not bound in this build.`
- Empty bound copy is exactly: `There is nothing in this folder.`
- Credentials stay in the server process for the session only.

## Run

```bash
npm install
npm test
npm start
```

The server listens on port 4173 unless `PORT` is set.
