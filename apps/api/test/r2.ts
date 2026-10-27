/* Bucket R2 en memoria para pruebas: get/head/put/delete/list con metadatos, lo que usa el Worker. */
interface Guardado {
  body: Uint8Array;
  httpMetadata?: R2HTTPMetadata;
  customMetadata?: Record<string, string>;
  uploaded: Date;
}

async function bytes(v: unknown): Promise<Uint8Array> {
  if (v === null || v === undefined) return new Uint8Array();
  if (typeof v === "string") return new TextEncoder().encode(v);
  if (v instanceof Uint8Array) return v;
  if (v instanceof ArrayBuffer) return new Uint8Array(v);
  if (ArrayBuffer.isView(v)) return new Uint8Array(v.buffer, v.byteOffset, v.byteLength);
  if (v instanceof Blob) return new Uint8Array(await v.arrayBuffer());
  if (v instanceof ReadableStream) return new Uint8Array(await new Response(v).arrayBuffer());
  throw new Error("Tipo de contenido no soportado en el R2 de prueba");
}

function objeto(key: string, o: Guardado) {
  return { key, size: o.body.byteLength, uploaded: o.uploaded, httpMetadata: o.httpMetadata ?? {}, customMetadata: o.customMetadata ?? {} };
}

export function memoryR2(): R2Bucket & { store: Map<string, Guardado> } {
  const store = new Map<string, Guardado>();
  const bucket = {
    store,
    async head(key: string) {
      const o = store.get(key);
      return o ? objeto(key, o) : null;
    },
    async get(key: string) {
      const o = store.get(key);
      if (!o) return null;
      const copia = o.body.slice();
      return {
        ...objeto(key, o),
        body: new Blob([copia]).stream(),
        text: async () => new TextDecoder().decode(copia),
        json: async () => JSON.parse(new TextDecoder().decode(copia)) as unknown,
        arrayBuffer: async () => copia.buffer,
      };
    },
    async put(key: string, value: unknown, opts: R2PutOptions = {}) {
      const o: Guardado = {
        body: await bytes(value),
        httpMetadata: opts.httpMetadata as R2HTTPMetadata | undefined,
        customMetadata: opts.customMetadata,
        uploaded: new Date(),
      };
      store.set(key, o);
      return objeto(key, o);
    },
    async delete(keys: string | string[]) {
      for (const k of Array.isArray(keys) ? keys : [keys]) store.delete(k);
    },
    async list(opts: R2ListOptions = {}) {
      const objects = [...store.keys()]
        .filter((k) => !opts.prefix || k.startsWith(opts.prefix))
        .sort()
        .map((k) => objeto(k, store.get(k)!));
      return { objects, truncated: false, delimitedPrefixes: [] };
    },
  };
  return bucket as unknown as R2Bucket & { store: Map<string, Guardado> };
}
