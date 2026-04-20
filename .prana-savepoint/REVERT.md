# Savepoint before the architectural-pass roadmap

Snapshotted: see `SAVEPOINT_AT.txt`.

Files captured:
- `now-console.tsx.bak`      → src/components/reception/now-console.tsx
- `globals.css.bak`          → src/app/globals.css
- `queue-status-route.ts.bak`→ src/app/api/queue/status/route.ts

## Scope covered by this savepoint
The four-step architectural pass:

1. Stale-token trust states + Prāṇa surfacing
2. Stale-token rollup class extension
3. WithDoctor → horizontal live-serving rail (layout change)
4. NextUp thresholded urgency rail (replaces waited pill when it fires)

## Full revert — one command

```bash
cp .prana-savepoint/now-console.tsx.bak        src/components/reception/now-console.tsx \
&& cp .prana-savepoint/globals.css.bak          src/app/globals.css \
&& cp .prana-savepoint/queue-status-route.ts.bak src/app/api/queue/status/route.ts
```

After running, restart the dev server. You're back to the state immediately
before the architectural pass.

## Partial revert

Each of the four steps lands as an isolated block of code with a
marker comment:

```
/* ═══ ARCH STEP N — title — start ═══ */
...
/* ═══ ARCH STEP N — end ═══ */
```

Search for `ARCH STEP` to find and excise individual blocks.
