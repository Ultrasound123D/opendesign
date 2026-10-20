"use client";

/**
 * Model picker — searchable provider/model palette (models.dev catalog +
 * custom providers), showing key status per provider.
 */
import { useMemo, useState } from "react";
import { ChevronsUpDown, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { Badge } from "@/components/ui/badge";
import type { ModelRef, ProviderInfo } from "@/lib/types";

export function ModelPicker({
  providers,
  value,
  onChange,
  loading,
}: {
  providers: ProviderInfo[];
  value: ModelRef | null;
  onChange: (ref: ModelRef | null) => void;
  loading?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");

  const filtered = useMemo(() => {
    const q = query.toLowerCase().trim();
    return providers
      .map((p) => ({
        provider: p,
        models: p.models.filter((m) => !q || m.name.toLowerCase().includes(q) || m.id.toLowerCase().includes(q) || p.name.toLowerCase().includes(q)),
      }))
      .filter(({ provider, models }) => models.length > 0 || (q && provider.name.toLowerCase().includes(q)))
      .slice(0, 40);
  }, [providers, query]);

  const current = value
    ? providers.find((p) => p.id === value.providerId)?.models.find((m) => m.id === value.modelId)
    : null;
  const label = current ? `${current.providerId}/${current.id}` : loading ? "Loading models…" : "Default model";

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          className="h-8 max-w-[260px] gap-1.5 border-zinc-800 bg-zinc-900/60 font-mono text-xs text-zinc-300 hover:bg-zinc-800 hover:text-zinc-100"
        >
          <span className="truncate">{label}</span>
          <ChevronsUpDown className="h-3 w-3 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[340px] border-zinc-800 bg-zinc-950 p-0" align="end">
        <Command shouldFilter={false}>
          <div className="flex items-center gap-2 border-b border-zinc-800 px-3">
            <Search className="h-4 w-4 shrink-0 text-zinc-600" />
            <CommandInput
              value={query}
              onValueChange={setQuery}
              placeholder="Search providers & models…"
              className="flex-1 border-0 bg-transparent py-3 text-sm text-zinc-100 placeholder:text-zinc-600 focus:ring-0"
            />
          </div>
          <CommandList className="max-h-[420px] py-1">
            <CommandEmpty className="py-6 text-center text-xs text-zinc-600">No models found.</CommandEmpty>
            {filtered.map(({ provider, models }) => (
              <CommandGroup
                key={provider.id}
                heading={
                  <span className="flex items-center gap-1.5 text-[11px] font-medium text-zinc-500">
                    {provider.name}
                    {provider.source === "custom" ? <Badge className="h-4 rounded px-1 text-[9px]">CUSTOM</Badge> : null}
                    {provider.source === "builtin" ? <Badge className="h-4 rounded px-1 text-[9px]">BUILT-IN</Badge> : null}
                    {provider.source !== "builtin" && !provider.hasKey ? (
                      <span className="text-[10px] text-amber-500/80">no key</span>
                    ) : null}
                  </span>
                }
              >
                {models.slice(0, 60).map((m) => (
                  <CommandItem
                    key={`${provider.id}/${m.id}`}
                    value={`${provider.id}/${m.id}`}
                    onSelect={() => {
                      onChange({ providerId: provider.id, modelId: m.id });
                      setOpen(false);
                      setQuery("");
                    }}
                    className={`gap-2 px-3 py-1.5 text-xs text-zinc-300 aria-selected:bg-zinc-800 ${
                      value?.providerId === provider.id && value?.modelId === m.id ? "bg-zinc-800/60" : ""
                    }`}
                  >
                    <span className="flex min-w-0 flex-1 items-center gap-1.5">
                      <span className="truncate">{m.name}</span>
                      {m.reasoning ? (
                        <span className="shrink-0 rounded bg-violet-950/60 px-1 text-[9px] text-violet-300">reasoning</span>
                      ) : null}
                    </span>
                    <span className="shrink-0 font-mono text-[10px] text-zinc-600">{m.id}</span>
                  </CommandItem>
                ))}
              </CommandGroup>
            ))}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
