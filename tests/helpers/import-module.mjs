import { readFile } from "node:fs/promises";

const moduleUrls = new Map();
const loading = new Set();

/** Load the real browser ES modules, including relative imports and re-exports. */
export async function moduleUrl(file) {
  file = new URL(file);
  if (moduleUrls.has(file.href)) return moduleUrls.get(file.href);
  if (loading.has(file.href)) throw new Error(`Circular test module dependency: ${file.href}`);
  loading.add(file.href);
  try {
    let source = await readFile(file, "utf8");
    for (const match of [...source.matchAll(/\bfrom\s+(["'])(\.[^"']+)\1/g)]) {
      source = source.replace(match[0], `from ${JSON.stringify(await moduleUrl(new URL(match[2], file)))}`);
    }
    const url = `data:text/javascript;base64,${Buffer.from(source).toString("base64")}`;
    moduleUrls.set(file.href, url);
    return url;
  } finally {
    loading.delete(file.href);
  }
}

export async function importModule(file) {
  return import(await moduleUrl(file));
}
