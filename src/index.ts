import { Buffer } from "node:buffer";
import { readFile } from "node:fs/promises";
import { rolldown } from "rolldown";
import type { InputOptions, NormalizedOutputOptions, OutputChunk, Plugin } from "rolldown";

type Q = { worker: boolean; inline: boolean };
function parseQuery(id: string): { cleanId: string; q: Q } {
  const [cleanId, qStr] = id.split("?", 2);
  const q = new URLSearchParams(qStr || "");
  return { cleanId, q: { worker: q.has("worker"), inline: q.has("inline") } };
}

const VIRTUAL_PREFIX = '\0inline-worker:'
export default function inlineWorker(): Plugin {
  const workerEntries = new Map<
    string,
    {
      cleanId: string;
      marker: string;
    }
  >();
  let markerSeed = 0;

  let capturedOptions: InputOptions;

  async function rebundle(entryFile: string, outputOptions: NormalizedOutputOptions) {
    const rebundle = await rolldown({
      input: entryFile,
      cwd: capturedOptions.cwd,
      treeshake: false,
      external: () => false,
      resolve: capturedOptions.resolve,
      tsconfig: capturedOptions.tsconfig,
    });
    const { output } = await rebundle.generate({
      format: "iife",
      name: outputOptions.name,
      inlineDynamicImports: true,
      minify: outputOptions.minify ? true : false,
      globals: outputOptions.globals,
    });
    await rebundle.close();

    const chunk = output.find((item) => item.type === "chunk") as OutputChunk | undefined;
    if (!chunk) throw new Error(`Failed to inline worker bundle: ${entryFile}`);
    return chunk.code;
  }

  const plugin: Plugin = {
    name: "inline-worker",

    async options(options) {
      if (String(options?.input).startsWith(VIRTUAL_PREFIX)) return null;
      capturedOptions = options;
      return null;
    },

    async resolveId(source, importer, options) {
      if (source.startsWith(VIRTUAL_PREFIX)) {
        const resolved = await this.resolve(source.slice(VIRTUAL_PREFIX.length), importer, {
          ...(options ?? {}),
          skipSelf: true,
        });
        return {...resolved, id: source };
      }

      const { cleanId, q } = parseQuery(source);
      if (!q.worker) return null;

      const resolved = await this.resolve(cleanId, importer, {
        ...(options ?? {}),
        skipSelf: true,
      });
      if (!resolved) return null;
      if (resolved.external) return resolved;

      const query = q.inline ? "worker&inline" : "worker";
      return { ...resolved, id: `${resolved.id}?${query}` };
    },

    async load(id) {
      if (id.startsWith(VIRTUAL_PREFIX)) {
        return {
          code: await readFile(id.slice(VIRTUAL_PREFIX.length), "utf8"),
        };
      }

      const { cleanId, q } = parseQuery(id);
      if (!q.worker) return null;

      return {
        code: await readFile(cleanId, "utf8"),
      };
    },

    transform(_code, id) {
      const { cleanId, q } = parseQuery(id);
      if (!q.worker) return null;

      if (!q.inline) {
        throw new Error("This plugin currently supports only '?worker&inline'");
      }

      const marker = `__INLINE_WORKER_${markerSeed++}__`;
      workerEntries.set(marker, { cleanId, marker });
      const urlExpr = JSON.stringify(marker);

      const out = `export default function createWorker(options = {}) { return new Worker(${urlExpr}, options); }`;
      return { code: out, map: { mappings: "" } };
    },

    async generateBundle(outputOptions, bundle) {
      if (Object.values(bundle).some((x) => x.type === 'chunk' && x.facadeModuleId?.startsWith(VIRTUAL_PREFIX))) return;

      const replacements = new Map<string, string>();
      for (const { cleanId, marker } of workerEntries.values()) {
        const bundled = await rebundle(
          cleanId,
          outputOptions,
        );
        const base64 = Buffer.from(bundled, "utf8").toString("base64");
        replacements.set(marker, `data:application/javascript;base64,${base64}`);
      }

      if (replacements.size === 0) return;

      for (const entry of Object.values(bundle)) {
        if (!entry || entry.type !== "chunk") continue;
        const chunk = entry as OutputChunk;
        let code = chunk.code;
        let mutated = false;

        for (const [marker, dataUri] of replacements) {
          if (!code.includes(marker)) continue;
          code = code.split(marker).join(dataUri);
          mutated = true;
        }

        if (mutated) {
          chunk.code = code;
          chunk.imports = [];
        }
      }
    },
  };

  return plugin;
}
