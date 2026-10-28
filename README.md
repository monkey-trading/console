# console

The Monkey Trading web app, to be served at console.monkey.trading: the client for the open-source CFD
engine in [monkey-trading/engine](https://github.com/monkey-trading/engine). One full-view trading
terminal with a watchlist, a candlestick chart, a deal ticket that sends the quote you saw with your
slippage bound, positions, orders, history, and a funding drawer.

This build runs against a simulated node inside the browser, behind an interface a live client
replaces. Prices, fills and funds are simulated, and the app says so on screen. It opens on a demo
account with positions, resting orders, history and a withdrawal in the queue; Mock controls can reset
it to an empty account.

## Run it

Requires Node.js 24 (see `.nvmrc`).

```sh
npm ci
npm run dev
```

The app is served at `http://localhost:3000`. The Mock controls button in the top strip changes the
simulated node: the region it sees you in (to show the geo-block), its attestation, price shocks that
trigger a close-out, market halts, stress levels, and vault liquidity for the withdrawal queue. Before sending a change, run `npm run lint`,
`npm run typecheck`, `npm test`, `npm run build`, and `npm audit --audit-level=high`; CI runs these
and the docs and workflow checks.

## Deploy

`npm run build` prerenders every route; `npm start` serves the build. The build reads two optional
environment variables for the canonical origin in the document metadata: `SITE_URL`, a bare
http(s) origin such as `https://console.monkey.trading` that takes precedence, and
`VERCEL_PROJECT_PRODUCTION_URL`, a bare host that Vercel sets once the repository is connected to
it. With neither, the origin is `http://localhost:3000`.

## License

Licensed under the Apache License, Version 2.0; see [LICENSE](LICENSE).
