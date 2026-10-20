"use client";

/**
 * Memory dialog — browse / add / delete long-term memories.
 */
import { useEffect, useState } from "react";
import { Brain, Plus, Trash2 } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { addMemory, fetchMemories, removeMemory } from "@/lib/client/api";
import type { MemoryEntry } from "@/lib/types";
import { useToast } from "@/hooks/use-toast";

export function MemoryDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { toast } = useToast();
  const [memories, setMemories] = useState<MemoryEntry[]>([]);
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [tags, setTags] = useState("");
  const [busy, setBusy] = useState(false);

  const load = async () => {
    try {
      setMemories(await fetchMemories());
    } catch (e) {
      toast({ title: "Failed to load memories", description: String(e), variant: "destructive" });
    }
  };

  useEffect(() => {
    if (open) void load();
  }, [open]);

  const save = async () => {
    if (!title.trim() || !content.trim()) return;
    setBusy(true);
    try {
      await addMemory({
        title,
        content,
        tags: tags.split(",").map((t) => t.trim()).filter(Boolean),
      });
      setTitle("");
      setContent("");
      setTags("");
      await load();
      toast({ title: "Memory saved" });
    } catch (e) {
      toast({ title: "Failed to save", description: String(e), variant: "destructive" });
    } finally {
      setBusy(false);
    }
  };

  const remove = async (id: string) => {
    try {
      await removeMemory(id);
      setMemories((m) => m.filter((e) => e.id !== id));
    } catch (e) {
      toast({ title: "Failed to delete", description: String(e), variant: "destructive" });
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[80vh] gap-0 overflow-hidden border-zinc-800 bg-zinc-950 p-0 sm:max-w-lg">
        <DialogHeader className="border-b border-zinc-800 px-5 py-4">
          <DialogTitle className="flex items-center gap-2 text-base text-zinc-100">
            <Brain className="h-4 w-4 text-emerald-400" />
            Long-term memory
          </DialogTitle>
          <DialogDescription className="text-xs text-zinc-500">
            Durable facts the agent recalls across sessions. The model can save and search these with
            memory tools; recent entries are auto-injected into every prompt.
          </DialogDescription>
        </DialogHeader>

        <div className="flex max-h-[52vh] flex-col overflow-y-auto px-5 py-3">
          {memories.length === 0 ? (
            <p className="py-8 text-center text-xs text-zinc-600">No memories yet.</p>
          ) : (
            <ul className="space-y-2">
              {memories.map((m) => (
                <li key={m.id} className="rounded-lg border border-zinc-800 bg-zinc-900/40 p-3">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="text-sm font-medium text-zinc-200">{m.title}</div>
                      <p className="mt-1 text-xs leading-relaxed text-zinc-400">{m.content}</p>
                      <div className="mt-1.5 flex flex-wrap items-center gap-1">
                        <span className="font-mono text-[10px] text-zinc-600">{m.createdAt.slice(0, 10)}</span>
                        {m.tags.map((t) => (
                          <Badge key={t} variant="outline" className="h-4 rounded px-1 text-[9px] text-zinc-400">
                            {t}
                          </Badge>
                        ))}
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => remove(m.id)}
                      className="rounded p-1 text-zinc-600 hover:text-red-400"
                      title="Delete"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="space-y-2 border-t border-zinc-800 px-5 py-4">
          <div className="text-[11px] font-medium uppercase tracking-wider text-zinc-600">Add manually</div>
          <Input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Title (e.g. Brand colors)"
            className="border-zinc-800 bg-zinc-900/60 text-xs text-zinc-100"
          />
          <Textarea
            value={content}
            onChange={(e) => setContent(e.target.value)}
            placeholder="Content…"
            rows={2}
            className="border-zinc-800 bg-zinc-900/60 text-xs text-zinc-100"
          />
          <div className="flex gap-2">
            <Input
              value={tags}
              onChange={(e) => setTags(e.target.value)}
              placeholder="tags, comma separated"
              className="border-zinc-800 bg-zinc-900/60 text-xs text-zinc-100"
            />
            <Button size="sm" onClick={save} disabled={busy || !title.trim() || !content.trim()} className="shrink-0 bg-emerald-600 text-white hover:bg-emerald-500">
              <Plus className="mr-1 h-3.5 w-3.5" /> Save
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
