import { useEffect, useState } from "react";
import { Settings } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Slider } from "@/components/ui/slider";
import { Button } from "@/components/ui/button";
import { getSettings, saveSettings, getTtsStatus, type SettingsMap, type TtsVoice, type AudioOutputDevice } from "@/lib/assistant";

interface SettingsPanelProps {
  onSaved?: () => void;
}

const DEFAULTS: SettingsMap = {
  backend_type: "llamacpp",
  llm_base_url: "http://192.168.1.151:18080",
  llm_model: "gemma-3-1b-it-Q4_K_M.gguf",
  llm_timeout_ms: "30000",
  assistant_system_prompt:
    "You are a concise local desktop assistant. Answer clearly, stay grounded in available context, and do not invent facts when the app can look them up instead.",
  assistant_personality_preset: "balanced",
  assistant_personality_custom: "",
  stt_backend: "whispercpp",
  whisper_cpp_path: "",
  whisper_model_path: "",
  stt_language: "en",
  stt_threads: "4",
  llm_control_base_url: "http://192.168.1.151:18082",
  searxng_url: "http://192.168.1.151:8888",
  tts_voice: "Microsoft Zira Desktop",
  tts_output_device: "",
  tts_rate: "1.0",
  tts_volume: "1.0",
  tts_pitch: "0.0",
};

function field(values: SettingsMap, key: string): string {
  return values[key] ?? DEFAULTS[key] ?? "";
}

export function SettingsPanel({ onSaved }: SettingsPanelProps) {
  const [open, setOpen] = useState(false);
  const [values, setValues] = useState<SettingsMap>({});
  const [voices, setVoices] = useState<TtsVoice[]>([]);
  const [outputDevices, setOutputDevices] = useState<AudioOutputDevice[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setError(null);

    getSettings()
      .then((db) => setValues({ ...DEFAULTS, ...db }))
      .catch((err) => setError(String(err)));

    getTtsStatus()
      .then((status) => {
        setVoices(status.voices);
        setOutputDevices(status.outputDevices);
      })
      .catch(() => {
        // non-fatal — voice lists are optional
      });
  }, [open]);

  function set(key: string, value: string) {
    setValues((prev) => ({ ...prev, [key]: value }));
  }

  async function handleSave() {
    setSaving(true);
    setError(null);
    try {
      await saveSettings(values);
      setOpen(false);
      onSaved?.();
    } catch (err) {
      setError(String(err));
    } finally {
      setSaving(false);
    }
  }

  const backendType = field(values, "backend_type");
  const isLlamaCpp = backendType === "llamacpp";
  const isOllama = backendType === "ollama";

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="ghost" size="icon" title="Settings">
          <Settings className="h-4 w-4" />
        </Button>
      </DialogTrigger>

      <DialogContent className="max-w-xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Settings</DialogTitle>
        </DialogHeader>

        <Tabs defaultValue="backend">
          <TabsList className="w-full">
            <TabsTrigger value="backend" className="flex-1">Backend</TabsTrigger>
            <TabsTrigger value="voice" className="flex-1">Voice</TabsTrigger>
            <TabsTrigger value="assistant" className="flex-1">Assistant</TabsTrigger>
          </TabsList>

          {/* ── Backend tab ── */}
          <TabsContent value="backend" className="space-y-4 mt-4">
            <div className="space-y-1.5">
              <Label>Backend type</Label>
              <Select
                value={field(values, "backend_type")}
                onValueChange={(v) => {
                  set("backend_type", v);
                  if (v === "ollama") {
                    set("llm_base_url", "http://localhost:11434");
                  } else if (v === "openai_compat") {
                    set("llm_base_url", "");
                  }
                }}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="llamacpp">llama.cpp</SelectItem>
                  <SelectItem value="ollama">Ollama</SelectItem>
                  <SelectItem value="openai_compat">OpenAI-compatible</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label>Base URL</Label>
              <Input
                value={field(values, "llm_base_url")}
                onChange={(e) => set("llm_base_url", e.target.value)}
                placeholder="http://…"
              />
              <p className="text-xs text-muted-foreground">
                {isOllama
                  ? "Ollama default: http://localhost:11434"
                  : "Chat and models endpoints are derived from this URL unless overridden."}
              </p>
            </div>

            <div className="space-y-1.5">
              <Label>Model</Label>
              <Input
                value={field(values, "llm_model")}
                onChange={(e) => set("llm_model", e.target.value)}
                placeholder={isOllama ? "llama3.2:latest" : "model-name.gguf"}
              />
              {isOllama && (
                <p className="text-xs text-muted-foreground">Use name:tag format, e.g. llama3.2:latest</p>
              )}
            </div>

            <div className="space-y-1.5">
              <Label>Timeout (ms)</Label>
              <Input
                value={field(values, "llm_timeout_ms")}
                onChange={(e) => set("llm_timeout_ms", e.target.value)}
                placeholder="30000"
              />
            </div>

            {isLlamaCpp && (
              <div className="space-y-1.5">
                <Label>Control API base URL</Label>
                <Input
                  value={field(values, "llm_control_base_url")}
                  onChange={(e) => set("llm_control_base_url", e.target.value)}
                  placeholder="http://…"
                />
                <p className="text-xs text-muted-foreground">
                  Used for model switching. Leave blank if not running the control sidecar.
                </p>
              </div>
            )}

            <div className="space-y-1.5">
              <Label>System prompt</Label>
              <Textarea
                value={field(values, "assistant_system_prompt")}
                onChange={(e) => set("assistant_system_prompt", e.target.value)}
                rows={4}
                className="resize-none"
              />
            </div>
          </TabsContent>

          {/* ── Voice tab ── */}
          <TabsContent value="voice" className="space-y-4 mt-4">
            <div className="space-y-1.5">
              <Label>STT backend</Label>
              <Select
                value={field(values, "stt_backend")}
                onValueChange={(v) => set("stt_backend", v)}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="whispercpp">whisper.cpp</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label>whisper.cpp binary</Label>
              <Input
                value={field(values, "whisper_cpp_path")}
                onChange={(e) => set("whisper_cpp_path", e.target.value)}
                placeholder="C:\\path\\to\\whisper-cli.exe or its folder"
              />
            </div>

            <div className="space-y-1.5">
              <Label>Whisper model path</Label>
              <Input
                value={field(values, "whisper_model_path")}
                onChange={(e) => set("whisper_model_path", e.target.value)}
                placeholder="C:\\path\\to\\ggml-base.en.bin"
              />
            </div>

            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-1.5">
                <Label>STT language</Label>
                <Input
                  value={field(values, "stt_language")}
                  onChange={(e) => set("stt_language", e.target.value)}
                  placeholder="en"
                />
              </div>

              <div className="space-y-1.5">
                <Label>STT threads</Label>
                <Input
                  value={field(values, "stt_threads")}
                  onChange={(e) => set("stt_threads", e.target.value)}
                  placeholder="4"
                />
              </div>
            </div>

            <div className="rounded-lg border bg-muted/25 p-3 text-xs text-muted-foreground">
              Click-to-talk records on the PC, then sends the WAV to local `whisper.cpp` for
              transcription. Start with a small English model and optimize later.
            </div>

            <div className="space-y-1.5">
              <Label>Voice</Label>
              {voices.length > 0 ? (
                <Select
                  value={field(values, "tts_voice")}
                  onValueChange={(v) => set("tts_voice", v)}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Select voice" />
                  </SelectTrigger>
                  <SelectContent>
                    {voices.map((v) => (
                      <SelectItem key={v.id} value={v.name}>
                        {v.name} ({v.language})
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              ) : (
                <Input
                  value={field(values, "tts_voice")}
                  onChange={(e) => set("tts_voice", e.target.value)}
                  placeholder="Microsoft Zira Desktop"
                />
              )}
            </div>

            <div className="space-y-1.5">
              <Label>Output device</Label>
              {outputDevices.length > 0 ? (
                <Select
                  value={field(values, "tts_output_device") || "__default__"}
                  onValueChange={(v) => set("tts_output_device", v === "__default__" ? "" : v)}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="System default" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__default__">System default</SelectItem>
                    {outputDevices.map((d) => (
                      <SelectItem key={d.id} value={d.id}>
                        {d.name}{d.isDefault ? " (default)" : ""}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              ) : (
                <Input
                  value={field(values, "tts_output_device")}
                  onChange={(e) => set("tts_output_device", e.target.value)}
                  placeholder="System default"
                />
              )}
            </div>

            <div className="space-y-1.5">
              <div className="flex justify-between">
                <Label>Speed</Label>
                <span className="text-xs text-muted-foreground">
                  {parseFloat(field(values, "tts_rate")).toFixed(2)}×
                </span>
              </div>
              <Slider
                min={0.5}
                max={3.0}
                step={0.05}
                value={[parseFloat(field(values, "tts_rate")) || 1.0]}
                onValueChange={([v]) => set("tts_rate", v.toFixed(2))}
              />
            </div>

            <div className="space-y-1.5">
              <div className="flex justify-between">
                <Label>Volume</Label>
                <span className="text-xs text-muted-foreground">
                  {Math.round(parseFloat(field(values, "tts_volume")) * 100)}%
                </span>
              </div>
              <Slider
                min={0}
                max={1}
                step={0.05}
                value={[parseFloat(field(values, "tts_volume")) || 1.0]}
                onValueChange={([v]) => set("tts_volume", v.toFixed(2))}
              />
            </div>

            <div className="space-y-1.5">
              <div className="flex justify-between">
                <Label>Pitch</Label>
                <span className="text-xs text-muted-foreground">
                  {(parseFloat(field(values, "tts_pitch")) * 50).toFixed(0)}%
                </span>
              </div>
              <Slider
                min={-1}
                max={1}
                step={0.05}
                value={[parseFloat(field(values, "tts_pitch")) || 0.0]}
                onValueChange={([v]) => set("tts_pitch", v.toFixed(2))}
              />
            </div>
          </TabsContent>

          {/* ── Assistant tab ── */}
          <TabsContent value="assistant" className="space-y-4 mt-4">
            <div className="space-y-1.5">
              <Label>SearXNG URL</Label>
              <Input
                value={field(values, "searxng_url")}
                onChange={(e) => set("searxng_url", e.target.value)}
                placeholder="http://192.168.1.151:8888"
              />
              <p className="text-xs text-muted-foreground">
                Self-hosted SearXNG instance used for web-grounded answers.
              </p>
            </div>

            <div className="space-y-1.5">
              <Label>Personality preset</Label>
              <Select
                value={field(values, "assistant_personality_preset")}
                onValueChange={(v) => set("assistant_personality_preset", v)}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select personality" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="balanced">Balanced</SelectItem>
                  <SelectItem value="calm">Calm</SelectItem>
                  <SelectItem value="direct">Direct</SelectItem>
                  <SelectItem value="playful">Playful</SelectItem>
                  <SelectItem value="custom">Custom only</SelectItem>
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                Shapes reply tone without changing the tool-first grounding rules.
              </p>
            </div>

            <div className="space-y-1.5">
              <Label>Custom personality guidance</Label>
              <Textarea
                value={field(values, "assistant_personality_custom")}
                onChange={(e) => set("assistant_personality_custom", e.target.value)}
                rows={4}
                className="resize-none"
                placeholder="Example: warm, observant, a little sarcastic, but never verbose."
              />
              <p className="text-xs text-muted-foreground">
                Optional. Appended after the preset, or used by itself when preset is `custom`.
              </p>
            </div>
          </TabsContent>
        </Tabs>

        {error && (
          <p className="text-sm text-destructive mt-2">{error}</p>
        )}

        <div className="flex justify-end gap-2 mt-4">
          <Button variant="outline" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button onClick={handleSave} disabled={saving}>
            {saving ? "Saving…" : "Save"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
