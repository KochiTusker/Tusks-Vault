import { useCallback, useState, type Dispatch, type SetStateAction } from "react";

// Shape returned by GET /api/personas. `builtin: true` flags presets that
// ship in code on the server; user-authored personas have `builtin: false`
// and may carry timestamps from the on-disk store.
export type PersonaRow = {
  id: string;
  name: string;
  description: string;
  prompt: string;
  builtin: boolean;
  createdAt?: number;
  updatedAt?: number;
};

// Editor state. Null = closed; otherwise carries the in-progress values plus
// a `mode` flag controlling whether Save calls POST (create) or PATCH (edit).
export type PersonaEditorState = {
  mode: "create" | "edit";
  id?: string;
  name: string;
  description: string;
  prompt: string;
} | null;

export type OpenEditorMode = "create" | "edit" | "template" | "scratch";

export interface UsePersonasApi {
  // Read state
  personas: PersonaRow[];
  activePersonaId: string;
  templatePrompt: string;
  busy: string | null;
  // Editor surface — setEditor uses React's standard SetStateAction so
  // callers can pass either a value or a functional updater.
  editor: PersonaEditorState;
  setEditor: Dispatch<SetStateAction<PersonaEditorState>>;
  saving: boolean;
  // AI-generate sub-state
  genPrompt: string;
  setGenPrompt: Dispatch<SetStateAction<string>>;
  generating: boolean;
  genError: string | null;
  // Actions
  fetchPersonas: () => Promise<void>;
  clearPersonas: () => void;
  setActiveOnServer: (id: string) => Promise<void>;
  save: () => Promise<void>;
  remove: (id: string, name: string) => Promise<void>;
  clone: (presetId: string) => Promise<void>;
  generate: () => Promise<void>;
  openEditor: (mode: OpenEditorMode, persona?: PersonaRow) => void;
}

/**
 * Owns dashboard state for Personas. Fetches stay tolerant of a 404 from
 * /api/personas — treated as "no personas to render" rather than an error —
 * so a dashboard tab left open across an upgrade degrades quietly.
 */
export function usePersonas(): UsePersonasApi {
  const [personas, setPersonas] = useState<PersonaRow[]>([]);
  const [activePersonaId, setActivePersonaId] = useState<string>("chronicler");
  const [templatePrompt, setTemplatePrompt] = useState<string>("");
  const [busy, setBusy] = useState<string | null>(null);
  const [editor, setEditor] = useState<PersonaEditorState>(null);
  const [saving, setSaving] = useState(false);
  const [genPrompt, setGenPrompt] = useState("");
  const [generating, setGenerating] = useState(false);
  const [genError, setGenError] = useState<string | null>(null);

  const fetchPersonas = useCallback(async () => {
    try {
      const res = await fetch("/api/personas");
      if (res.status === 404) {
        setPersonas([]);
        return;
      }
      const data = await res.json();
      setPersonas(data.personas || []);
      if (data.activePersonaId) setActivePersonaId(data.activePersonaId);
      if (typeof data.templatePrompt === "string") setTemplatePrompt(data.templatePrompt);
    } catch (err) {
      console.error("Failed to fetch personas", err);
    }
  }, []);

  const clearPersonas = useCallback(() => {
    setPersonas([]);
  }, []);

  const setActiveOnServer = useCallback(async (id: string) => {
    setBusy(id);
    try {
      const res = await fetch("/api/personas/active", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id }),
      });
      if (res.ok) {
        setActivePersonaId(id);
      }
    } catch (err) {
      console.error("Failed to switch persona", err);
    } finally {
      setBusy(null);
    }
  }, []);

  const save = useCallback(async () => {
    if (!editor) return;
    if (!editor.name.trim() || !editor.prompt.trim()) return;
    setSaving(true);
    try {
      const body = JSON.stringify({
        name: editor.name,
        description: editor.description,
        prompt: editor.prompt,
      });
      const res = editor.mode === "edit" && editor.id
        ? await fetch(`/api/personas/${editor.id}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body,
          })
        : await fetch("/api/personas", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body,
          });
      if (res.ok) {
        await fetchPersonas();
        setEditor(null);
        setGenError(null);
        setGenPrompt("");
      } else {
        const data = await res.json().catch(() => ({}));
        console.error("Save persona failed:", data.error || res.status);
      }
    } catch (err) {
      console.error("Save persona failed:", err);
    } finally {
      setSaving(false);
    }
  }, [editor, fetchPersonas]);

  const remove = useCallback(async (id: string, name: string) => {
    if (!confirm(`Delete the "${name}" persona?\n\nIf it's currently active, the bot falls back to The Chronicler.`)) return;
    setBusy(id);
    try {
      const res = await fetch(`/api/personas/${id}`, { method: "DELETE" });
      if (res.ok) await fetchPersonas();
    } catch (err) {
      console.error("Delete persona failed:", err);
    } finally {
      setBusy(null);
    }
  }, [fetchPersonas]);

  const clone = useCallback(async (presetId: string) => {
    setBusy(presetId);
    try {
      const res = await fetch(`/api/personas/clone/${presetId}`, { method: "POST" });
      if (res.ok) {
        const created = await res.json();
        await fetchPersonas();
        // Open the cloned copy in the editor so the user can immediately customise it.
        setEditor({
          mode: "edit",
          id: created.id,
          name: created.name,
          description: created.description,
          prompt: created.prompt,
        });
      }
    } catch (err) {
      console.error("Clone persona failed:", err);
    } finally {
      setBusy(null);
    }
  }, [fetchPersonas]);

  const generate = useCallback(async () => {
    if (!genPrompt.trim()) return;
    setGenerating(true);
    setGenError(null);
    try {
      const res = await fetch("/api/personas/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt: genPrompt }),
      });
      const data = await res.json();
      if (!res.ok) {
        setGenError(data.error || "Could not generate a persona.");
        return;
      }
      // Drop the generated draft into the editor — user reviews + clicks Save
      // to actually create the row. We do NOT auto-persist; this gives the
      // user a chance to tweak before committing.
      setEditor({
        mode: "create",
        name: data.name || "Generated persona",
        description: data.description || "",
        prompt: data.prompt || "",
      });
    } catch (err) {
      setGenError("Network error: " + (err as Error).message);
    } finally {
      setGenerating(false);
    }
  }, [genPrompt]);

  const openEditor = useCallback((mode: OpenEditorMode, persona?: PersonaRow) => {
    if (mode === "edit" && persona) {
      setEditor({
        mode: "edit",
        id: persona.id,
        name: persona.name,
        description: persona.description,
        prompt: persona.prompt,
      });
    } else if (mode === "template") {
      setEditor({
        mode: "create",
        name: "",
        description: "",
        prompt: templatePrompt,
      });
    } else if (mode === "scratch") {
      setEditor({
        mode: "create",
        name: "",
        description: "",
        prompt: "",
      });
    }
    setGenError(null);
  }, [templatePrompt]);

  return {
    personas,
    activePersonaId,
    templatePrompt,
    busy,
    editor,
    setEditor,
    saving,
    genPrompt,
    setGenPrompt,
    generating,
    genError,
    fetchPersonas,
    clearPersonas,
    setActiveOnServer,
    save,
    remove,
    clone,
    generate,
    openEditor,
  };
}
