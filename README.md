# rolldown-plugin-inline-worker

Rolldown plugin that lets you import Vite-style inline web workers using the `?worker&inline` query.

## Installation

Add the plugin to your project (development dependency):

```
pnpm add -D rolldown-plugin-inline-worker
```

## Usage

Configure Rolldown:

```ts
// rolldown.config.ts
import inlineWorker from "rolldown-plugin-inline-worker";

export default {
  input: "src/main.ts",
  plugins: [inlineWorker()],
};
```

Import a worker with the inline query:

```ts
import createWorker from "./worker.ts?worker&inline";

const worker = createWorker({ name: "example" });
worker.postMessage("ping");
```

## Notes

- The plugin currently supports only inline workers (`?worker&inline`). Using `?worker` without `&inline` throws an error.
