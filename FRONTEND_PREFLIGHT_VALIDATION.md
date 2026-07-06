# Frontend Preflight Validation

Frontend package: `C:\Users\14342\Desktop\snoozer-ai\omnia-journey`

## Available scripts

From `omnia-journey/package.json`:

- `npm run dev`
- `npm run build`
- `npm run preview`

No dedicated `lint` or `test` script is currently declared in the frontend package.

## Commands run

| Command | Result | Notes |
| --- | --- | --- |
| `npm run build` | pass | Vite production build completed successfully |

## Build output summary

- `dist/index.html`
- `dist/index.css`
- `dist/app.js`
- large image assets including rest-test PNGs

## Non-blocking warnings

- Vite chunk-size warning: `app.js` is above 500 kB minified
- Browserslist data is stale
- Vite CJS Node API deprecation warning

## Blockers for next frontend pass

None from the build baseline. The next pass is blocked more by architecture/ownership drift than by build failure.
