declare module 'rolldown-plugin-inline-worker' {
  import type { Plugin } from "rolldown";
  export default function inlineWorker(): Plugin;
}

declare module '*?worker&inline' {
    const createWorker: new (options?: WorkerOptions) => Worker;
    export default createWorker;
}
