"use client";

/**
 * Settings dialog — Codex/opencode-style provider configuration:
 *   Providers tab : API key + endpoint override + enable, per catalog provider (231+)
 *   Custom tab    : opencode-style custom providers (baseURL + key + model list)
 *   General tab   : default model + agent max steps
 */
import { useEffect, useMemo, useState } from "react";
import { Settings, KeyRound, Plug, Search, Plus, Trash2, Loader2, CheckCircle2, XCircle } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { fetchProviders, fetchSettings, putSettings, testProvider } from "@/lib/client/api";
import type { ProviderInfo } from "@/lib/types";
import type { PublicSettings } from "@/lib/client/api";
import { ModelPicker } from "./model-picker";
import { useToast } from "@/hooks/use-toast";

interface CustomDraft {
  id: string;
  name: string;
  baseURL: string;
  apiKey: string;
  env: string;
  models: string; // "model-id: Display name" per line
}

export function SettingsDialog({
  open,
  onOpenChange,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSaved: () => void;
}) {
  const { toast } = useToast();
  const [providers, setProviders] = useState<ProviderInfo[]>([]);
  const [settings, setSettings] = useState<PublicSettings | null>(null);
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<string | null>(null);
  const [apiKey, setApiKey] = useState("");
  const [baseURL, setBaseURL] = useState("");
  const [testing, setTesting] = useState(false);
  const [customDrafts, setCustomDrafts] = useState<CustomDraft[]>([]);
  const [maxSteps, setMaxSteps] = useState(40);

  const load = async () => {
    try {
      const [{ providers: p }, s] = await Promise.all([fetchProviders(), fetchSettings()]);
      setProviders(p);
      setSettings(s);
      setMaxSteps(s.agent.maxSteps);
      setCustomDrafts(
        Object.entries(s.customProviders ?? {}).map(([id, c]) => ({
          id,
          name: c.name,
          baseURL: c.baseURL,
          apiKey: "",
          env: (c.env ?? []).join(", "),
          models: Object.entries(c.models ?? {})
            .map(([mid, m]) => (m?.name && m.name !== mid ? `${mid}: ${m.name}` : mid))
            .join("\n"),
        })),
      );
      // Preselect first provider that needs attention (no key, not builtin/custom).
      const first = p.find((x) => x.source === "catalog" && !x.hasKey);
      if (first) setSelected(first.id);
    } catch (e) {
      toast({ title: "Failed to load settings", description: String(e), variant: "destructive" });
    }
  };

  useEffect(() => {
    if (open) void load();
  }, [open]);

  const current = providers.find((p) => p.id === selected) ?? null;
  const currentOverride = settings?.providers?.[selected ?? ""] ?? {};

  useEffect(() => {
    setApiKey("");
    setBaseURL(currentOverride.baseURL ?? "");
  }, [selected]);

  const filteredProviders = useMemo(() => {
    const q = query.toLowerCase().trim();
    return providers.filter((p) => !q || p.name.toLowerCase().includes(q) || p.id.includes(q));
  }, [providers, query]);

  const saveProvider = async (id: string, extra?: { enabled?: boolean }) => {
    await putSettings({
      providers: {
        [id]: {
          ...(apiKey.trim() ? { apiKey: apiKey.trim() } : {}),
          ...(baseURL.trim() !== (currentOverride.baseURL ?? "") ? { baseURL: baseURL.trim() || "" } : {}),
          ...(extra ?? {}),
        },
      },
    });
    await load();
    onSaved();
    toast({ title: `Saved ${id}` });
  };

  const test = async () => {
    if (!current) return;
    setTesting(true);
    try {
      const res = await testProvider(
        current.source === "custom"
          ? { custom: { baseURL, apiKey: apiKey.trim() || undefined } }
          : { providerId: current.id },
      );
      if (res.ok) {
        toast({
          title: `✓ ${current.name} reachable`,
          description: `${res.models?.length ?? 0} models visible${res.models?.length ? ` (e.g. ${res.models.slice(0, 3).join(", ")})` : ""}`,
        });
      } else {
        toast({ title: `✗ ${current.name} failed`, description: res.error ?? "unknown error", variant: "destructive" });
      }
    } catch (e) {
      toast({ title: "Test failed", description: String(e), variant: "destructive" });
    } finally {
      setTesting(false);
    }
  };

  const saveCustom = async () => {
    const customs: Record<string, { name: string; baseURL: string; env?: string[]; models: Record<string, { name?: string }> }> = {};
    for (const d of customDrafts) {
      if (!d.id.trim() || !d.baseURL.trim()) continue;
      const models: Record<string, { name?: string }> = {};
      for (const line of d.models.split("\n")) {
        const l = line.trim();
        if (!l) continue;
        const [mid, ...rest] = l.split(":");
        const name = rest.join(":").trim();
        models[mid.trim()] = name ? { name } : {};
      }
      if (Object.keys(models).length === 0) models["custom-model"] = { name: "Custom model" };
      customs[d.id.trim()] = {
        name: d.name.trim() || d.id.trim(),
        baseURL: d.baseURL.trim(),
        env: d.env.split(",").map((e) => e.trim()).filter(Boolean),
        models,
      };
    }
    await putSettings({ customProviders: customs });
    await load();
    onSaved();
    toast({ title: "Custom providers saved" });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] gap-0 overflow-hidden border-zinc-800 bg-zinc-950 p-0 sm:max-w-3xl">
        <DialogHeader className="border-b border-zinc-800 px-5 py-4">
          <DialogTitle className="flex items-center gap-2 text-base text-zinc-100">
            <Settings className="h-4 w-4 text-emerald-400" />
            Settings
          </DialogTitle>
          <DialogDescription className="text-xs text-zinc-500">
            Providers work exactly like opencode: pick any provider from the models.dev catalog (or add
            a custom OpenAI-compatible endpoint), set your API token and optionally override the
            endpoint URL. Keys are stored locally and never leave this machine.
          </DialogDescription>
        </DialogHeader>

        <Tabs defaultValue="providers" className="gap-0">
          <TabsList className="mx-5 mt-3 grid w-auto grid-cols-3 rounded-lg border border-zinc-800 bg-zinc-900/60">
            <TabsTrigger value="providers" className="data-[state=active]:bg-zinc-800 text-xs">Providers</TabsTrigger>
            <TabsTrigger value="custom" className="data-[state=active]:bg-zinc-800 text-xs">Custom providers</TabsTrigger>
            <TabsTrigger value="general" className="data-[state=active]:bg-zinc-800 text-xs">General</TabsTrigger>
          </TabsList>

          {/* ------------------------- Providers tab ------------------------- */}
          <TabsContent value="providers" className="mt-0 px-5 py-4">
            <div className="grid max-h-[55vh] grid-cols-[220px_1fr] gap-4">
              <div className="flex flex-col gap-2">
                <div className="relative">
                  <Search className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-zinc-600" />
                  <Input
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    placeholder="Search 200+ providers…"
                    className="h-8 border-zinc-800 bg-zinc-900/60 pl-8 text-xs text-zinc-100"
                  />
                </div>
                <div className="min-h-0 flex-1 space-y-0.5 overflow-y-auto pr-1">
                  {filteredProviders.slice(0, 120).map((p) => (
                    <button
                      key={p.id}
                      type="button"
                      onClick={() => setSelected(p.id)}
                      className={`flex w-full items-center gap-1.5 rounded-md px-2 py-1.5 text-left text-xs ${
                        selected === p.id ? "bg-zinc-800 text-zinc-100" : "text-zinc-400 hover:bg-zinc-900"
                      }`}
                    >
                      <span
                        className={`h-1.5 w-1.5 shrink-0 rounded-full ${
                          p.source === "builtin" ? "bg-emerald-500" : p.hasKey ? "bg-emerald-500" : "bg-zinc-700"
                        }`}
                      />
                      <span className="truncate">{p.name}</span>
                      <span className="ml-auto shrink-0 text-[9px] text-zinc-600">{p.models.length}</span>
                    </button>
                  ))}
                </div>
              </div>

              <div className="rounded-lg border border-zinc-800 bg-zinc-900/30 p-4">
                {!current ? (
                  <p className="pt-16 text-center text-xs text-zinc-600">Select a provider</p>
                ) : (
                  <div className="space-y-4">
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-semibold text-zinc-100">{current.name}</span>
                        <Badge variant="outline" className="h-4 rounded px-1 text-[9px] text-zinc-400">
                          {current.source}
                        </Badge>
                        {current.hasKey ? (
                          <span className="flex items-center gap-1 text-[10px] text-emerald-400">
                            <KeyRound className="h-3 w-3" />
                            {current.keyFromEnv ? "key from env" : "key saved"}
                          </span>
                        ) : current.source !== "builtin" ? (
                          <span className="text-[10px] text-amber-500/80">no key</span>
                        ) : null}
                      </div>
                      <p className="mt-0.5 font-mono text-[10px] text-zinc-600">
                        {current.npm} · {current.effectiveBaseURL ?? current.baseURL ?? "—"}
                      </p>
                      <p className="mt-0.5 text-[10px] text-zinc-600">
                        {current.models.length} models
                        {current.env.length > 0 ? ` · env: ${current.env.join(", ")}` : ""}
                      </p>
                    </div>

                    {current.source === "builtin" ? (
                      <p className="rounded-md border border-emerald-900/50 bg-emerald-950/20 px-3 py-2 text-xs text-emerald-300">
                        Built-in sandbox provider — works without any key (platform SDK). Models:{" "}
                        {current.models.map((m) => m.id).join(", ")}.
                      </p>
                    ) : (
                      <>
                        <div>
                          <label className="mb-1 block text-[11px] font-medium uppercase tracking-wider text-zinc-500">
                            API token {current.hasKey ? "(saved — type to replace)" : ""}
                          </label>
                          <Input
                            type="password"
                            value={apiKey}
                            onChange={(e) => setApiKey(e.target.value)}
                            placeholder={current.hasKey ? "••••••••" : current.env[0] ? `${current.env[0]} or paste token` : "paste token"}
                            className="border-zinc-800 bg-zinc-900/60 font-mono text-xs text-zinc-100"
                          />
                        </div>
                        <div>
                          <label className="mb-1 block text-[11px] font-medium uppercase tracking-wider text-zinc-500">
                            Endpoint (base URL) override
                          </label>
                          <Input
                            value={baseURL}
                            onChange={(e) => setBaseURL(e.target.value)}
                            placeholder={current.baseURL ?? "https://…"}
                            className="border-zinc-800 bg-zinc-900/60 font-mono text-xs text-zinc-100"
                          />
                        </div>
                        <div className="flex gap-2">
                          <Button
                            size="sm"
                            onClick={() => saveProvider(current.id)}
                            className="bg-emerald-600 text-xs text-white hover:bg-emerald-500"
                          >
                            Save
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={test}
                            disabled={testing}
                            className="gap-1.5 border-zinc-800 bg-zinc-900 text-xs text-zinc-300 hover:bg-zinc-800"
                          >
                            {testing ? <Loader2 className="h-3 w-3 animate-spin" /> : <Plug className="h-3 w-3" />}
                            Test
                          </Button>
                          {settings?.providers?.[current.id]?.enabled === false ? (
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => saveProvider(current.id, { enabled: true })}
                              className="border-zinc-800 bg-zinc-900 text-xs text-zinc-300"
                            >
                              Enable
                            </Button>
                          ) : current.source === "catalog" ? (
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => saveProvider(current.id, { enabled: false })}
                              className="border-zinc-800 bg-zinc-900 text-xs text-zinc-500 hover:text-red-400"
                            >
                              Disable
                            </Button>
                          ) : null}
                        </div>
                      </>
                    )}
                  </div>
                )}
              </div>
            </div>
          </TabsContent>

          {/* ------------------------- Custom tab ------------------------- */}
          <TabsContent value="custom" className="mt-0 px-5 py-4">
            <div className="max-h-[55vh] space-y-3 overflow-y-auto pr-1">
              <p className="text-xs text-zinc-500">
                Same mechanism as opencode custom providers: an OpenAI-compatible endpoint with your
                token and model list. Base URL supports <code className="font-mono text-emerald-400">{"{env:NAME}"}</code> substitution.
              </p>
              {customDrafts.map((d, i) => (
                <div key={i} className="space-y-2 rounded-lg border border-zinc-800 bg-zinc-900/30 p-3">
                  <div className="grid grid-cols-2 gap-2">
                    <Input
                      value={d.id}
                      onChange={(e) => setCustomDrafts(customDrafts.map((x, j) => (j === i ? { ...x, id: e.target.value } : x)))}
                      placeholder="id (e.g. my-llm)"
                      className="border-zinc-800 bg-zinc-900/60 font-mono text-xs text-zinc-100"
                    />
                    <Input
                      value={d.name}
                      onChange={(e) => setCustomDrafts(customDrafts.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))}
                      placeholder="Display name"
                      className="border-zinc-800 bg-zinc-900/60 text-xs text-zinc-100"
                    />
                  </div>
                  <Input
                    value={d.baseURL}
                    onChange={(e) => setCustomDrafts(customDrafts.map((x, j) => (j === i ? { ...x, baseURL: e.target.value } : x)))}
                    placeholder="https://llm.example.com/v1"
                    className="border-zinc-800 bg-zinc-900/60 font-mono text-xs text-zinc-100"
                  />
                  <div className="grid grid-cols-2 gap-2">
                    <Input
                      type="password"
                      value={d.apiKey}
                      onChange={(e) => setCustomDrafts(customDrafts.map((x, j) => (j === i ? { ...x, apiKey: e.target.value } : x)))}
                      placeholder={settings?.customProviders?.[d.id]?.hasApiKey ? "token saved — type to replace" : "API token (optional if env set)"}
                      className="border-zinc-800 bg-zinc-900/60 font-mono text-xs text-zinc-100"
                    />
                    <Input
                      value={d.env}
                      onChange={(e) => setCustomDrafts(customDrafts.map((x, j) => (j === i ? { ...x, env: e.target.value } : x)))}
                      placeholder="env vars (e.g. MY_LLM_API_KEY)"
                      className="border-zinc-800 bg-zinc-900/60 font-mono text-xs text-zinc-100"
                    />
                  </div>
                  <textarea
                    value={d.models}
                    onChange={(e) => setCustomDrafts(customDrafts.map((x, j) => (j === i ? { ...x, models: e.target.value } : x)))}
                    placeholder={"models — one per line, optional display name\nmodel-id: Display Name"}
                    rows={3}
                    className="w-full rounded-md border border-zinc-800 bg-zinc-900/60 p-2 font-mono text-xs text-zinc-100 placeholder:text-zinc-600"
                  />
                  <div className="flex gap-2">
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={async () => {
                        const res = await testProvider({ custom: { baseURL: d.baseURL, apiKey: d.apiKey.trim() || undefined } });
                        toast(
                          res.ok
                            ? { title: "✓ Reachable", description: `${res.models?.length ?? 0} models visible` }
                            : { title: "✗ Failed", description: res.error, variant: "destructive" },
                        );
                      }}
                      className="border-zinc-800 bg-zinc-900 text-xs text-zinc-300"
                    >
                      Test
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => setCustomDrafts(customDrafts.filter((_, j) => j !== i))}
                      className="border-zinc-800 bg-zinc-900 text-xs text-zinc-500 hover:text-red-400"
                    >
                      <Trash2 className="mr-1 h-3 w-3" /> Remove
                    </Button>
                  </div>
                </div>
              ))}
              <div className="flex gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => setCustomDrafts([...customDrafts, { id: "", name: "", baseURL: "", apiKey: "", env: "", models: "" }])}
                  className="border-dashed border-zinc-800 bg-transparent text-xs text-zinc-400"
                >
                  <Plus className="mr-1 h-3 w-3" /> Add custom provider
                </Button>
                <Button size="sm" onClick={saveCustom} className="bg-emerald-600 text-xs text-white hover:bg-emerald-500">
                  Save all
                </Button>
              </div>
            </div>
          </TabsContent>

          {/* ------------------------- General tab ------------------------- */}
          <TabsContent value="general" className="mt-0 px-5 py-4">
            <div className="max-h-[55vh] space-y-6">
              <div>
                <div className="mb-1.5 text-[11px] font-medium uppercase tracking-wider text-zinc-500">
                  Default model
                </div>
                <ModelPicker
                  providers={providers}
                  value={settings?.defaultModel ?? null}
                  onChange={async (ref) => {
                    await putSettings({ defaultModel: ref });
                    await load();
                    onSaved();
                  }}
                />
                <p className="mt-1.5 text-[11px] text-zinc-600">
                  Used when a chat doesn&apos;t pick a model explicitly. Falls back to the built-in
                  sandbox provider when available.
                </p>
              </div>
              <div>
                <div className="mb-1.5 text-[11px] font-medium uppercase tracking-wider text-zinc-500">
                  Agent max steps
                </div>
                <div className="flex items-center gap-3">
                  <Input
                    type="number"
                    min={1}
                    max={100}
                    value={maxSteps}
                    onChange={(e) => setMaxSteps(Number(e.target.value))}
                    className="w-24 border-zinc-800 bg-zinc-900/60 text-xs text-zinc-100"
                  />
                  <Button
                    size="sm"
                    onClick={async () => {
                      await putSettings({ agent: { maxSteps } });
                      toast({ title: "Saved" });
                    }}
                    className="bg-emerald-600 text-xs text-white hover:bg-emerald-500"
                  >
                    Save
                  </Button>
                  <span className="text-[11px] text-zinc-600">Tool-loop steps per message (opencode: agents.&lt;id&gt;.steps)</span>
                </div>
              </div>
              <div className="rounded-lg border border-zinc-800 bg-zinc-900/30 p-3 text-[11px] text-zinc-500">
                <div className="mb-1 flex items-center gap-1.5 font-medium text-zinc-300">
                  <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" /> Data location
                </div>
                Sessions, memories, settings and the catalog cache live in{" "}
                <code className="font-mono text-zinc-300">~/.opendesign/</code> (override with{" "}
                <code className="font-mono text-zinc-300">OPENDESIGN_DATA_DIR</code>). API keys never
                leave this machine.
              </div>
            </div>
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}
