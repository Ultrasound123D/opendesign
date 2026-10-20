/**
 * Optional loader for the platform SDK (z-ai-web-dev-sdk).
 *
 * In environments where the package is installed (this sandbox), a built-in
 * "zai-sandbox" provider (GLM models, zero-config, no API key) is available.
 * In a plain clone of this repository the package is absent — the dynamic
 * import below uses a non-literal specifier so bundlers/type-checkers never
 * require it, and the loader simply returns null.
 */

export interface ZaiSandboxClient {
  chat: {
    completions: {
      create: (body: Record<string, unknown>) => Promise<any>;
    };
  };
}

let cached: ZaiSandboxClient | null | undefined;

export async function loadZaiSandbox(): Promise<ZaiSandboxClient | null> {
  if (cached !== undefined) return cached;
  try {
    // Non-literal specifier: keeps this optional at build/type time.
    const specifier = "z-ai-web-dev-sdk";
    const mod = (await import(specifier)) as { default?: { create?: () => Promise<ZaiSandboxClient> } };
    if (mod?.default?.create) {
      cached = await mod.default.create();
    } else {
      cached = null;
    }
  } catch {
    cached = null;
  }
  return cached;
}
