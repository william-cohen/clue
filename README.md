# Clue Sheet

A companion app for Clue/Cluedo — track suggestions, manage your detective sheet, and get strategy recommendations powered by a deduction engine and Bayesian probability model.

## Development

```bash
npm install
npm run dev
```

## Scripts

- `npm run dev` — start the Vite dev server
- `npm run build` — type-check and build for production
- `npm run typecheck` — run `vue-tsc --noEmit`
- `npm run test` — run the Vitest test suite
- `npm run test:watch` — run tests in watch mode

## Simulation

A simulation harness is available to validate the deduction engine against randomly dealt games. It deals real Cluedo hands, simulates turns with random AI players, and checks the engine's chart for contradictions (bad ticks, bad crosses, wrong solutions).

```bash
npx tsx scripts/simulate.ts [players] [games]
```

- `players` — number of players (default: 4)
- `games` — number of games to simulate (default: 100)

Example:

```bash
npx tsx scripts/simulate.ts 4 100
```