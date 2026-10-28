# console

The Monkey Trading web app, hosted at console.monkey.trading: the client for the open-source CFD
engine in [monkey-trading/engine](https://github.com/monkey-trading/engine). The trading screens are
not built yet; this repository holds the Next.js, Tailwind CSS, and TypeScript scaffold they will
be built on, with its CI.

## Run it

Requires Node.js 24 (see `.nvmrc`).

```sh
npm ci
npm run dev
```

The app is served at `http://localhost:3000`. Before sending a change, run `npm run lint`,
`npm run typecheck`, `npm test`, and `npm run build`; CI runs the same checks.

## License

Apache License 2.0. See [LICENSE](LICENSE).
