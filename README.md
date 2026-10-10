# Web Pair v2 — evil⁶⁶⁶MD WhatsApp Pairing Portal

Storm-sky WhatsApp pairing portal. Enter a number, get a pair code, link the device.

## Deploy on Render

1. Push this repo to GitHub (or use "Deploy to Render" from the repo page).
2. On Render: **New → Web Service** → connect this repo.
3. Build command: `npm install --legacy-peer-deps` — Start command: `node server.js`.
4. Open the service URL — done.

## Local run

```
npm install --legacy-peer-deps
node server.js
```

Listens on PORT (default 3000 on Render, 3001 locally).
