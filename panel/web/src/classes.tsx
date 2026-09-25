import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, Check, Copy, Plus, RefreshCw, Save, Sparkles, Trash2 } from "lucide-react";
import {
  buildGflPlayerClasses,
  playerClassesSchema,
  type GflPresetMode,
  type PlayerClasses,
  type ZrClass,
  type ZrModel,
} from "@cs2ze/shared";
import { api } from "./api.js";
import { Alert, AlertDescription, AlertTitle } from "./components/ui/alert.js";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "./components/ui/alert-dialog.js";
import { Badge } from "./components/ui/badge.js";
import { Button } from "./components/ui/button.js";
import { Card } from "./components/ui/card.js";
import { Input } from "./components/ui/input.js";
import { Label } from "./components/ui/label.js";
import { NativeSelect } from "./components/ui/native-select.js";
import { Switch } from "./components/ui/switch.js";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "./components/ui/tabs.js";

type Team = "Human" | "Zombie";

function cloneClasses(classes: PlayerClasses): PlayerClasses {
  return structuredClone(classes);
}

function numberValue(value: string): number {
  return value === "" ? 0 : Number(value);
}

function optionalNumber(value: string): number | undefined {
  return value === "" ? undefined : Number(value);
}

function newClass(team: Team): ZrClass {
  return team === "Human"
    ? { enabled: true, team_default: false, health: 100, models: [{ modelname: "agents/models/ctm_fbi/ctm_fbi.vmdl", color: "255 255 255", skins: [0] }], scale: 1, speed: 1, gravity: 1, admin_flag: "" }
    : { enabled: true, team_default: false, health: 10000, models: [{ modelname: "agents/models/s2ze/zombie_basic/zombie_basic.vmdl", color: "255 255 255", skins: [0] }], scale: 1, speed: 1, gravity: 1, knockback: 1, admin_flag: "", health_regen_count: 250, health_regen_interval: 5 };
}

function Notice({ children, danger = false }: { children: ReactNode; danger?: boolean }): ReactNode {
  return <Alert variant={danger ? "warning" : "success"} className="management-notice">
    {danger ? <AlertTriangle /> : <Check />}
    <AlertTitle>{danger ? "Attention required" : "Saved"}</AlertTitle>
    <AlertDescription>{children}</AlertDescription>
  </Alert>;
}

export function PlayerClassesContent(): ReactNode {
  const client = useQueryClient();
  const classes = useQuery({ queryKey: ["player-classes"], queryFn: api.playerClasses });
  const status = useQuery({ queryKey: ["server-status"], queryFn: api.serverStatus, refetchInterval: 10_000 });
  const [draft, setDraft] = useState<PlayerClasses | null>(null);
  const [mode, setMode] = useState<GflPresetMode>("both");
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (classes.data) setDraft(cloneClasses(classes.data.classes));
  }, [classes.dataUpdatedAt]);

  const validation = useMemo(() => draft ? playerClassesSchema.safeParse(draft) : null, [draft]);
  const dirty = Boolean(draft && classes.data && JSON.stringify(draft) !== JSON.stringify(classes.data.classes));
  const save = useMutation({
    mutationFn: async () => {
      if (!draft) throw new Error("Player classes have not loaded");
      const checked = playerClassesSchema.safeParse(draft);
      if (!checked.success) throw new Error(checked.error.issues[0]?.message ?? "Invalid player classes");
      return api.putPlayerClasses(checked.data);
    },
    onSuccess: async (result) => {
      client.setQueryData(["player-classes"], result);
      setDraft(cloneClasses(result.classes));
      setSaved(true);
      await client.invalidateQueries({ queryKey: ["drift"] });
    },
  });
  const reload = useMutation({ mutationFn: async () => {
    const map = status.data?.game?.currentMap;
    if (!map) throw new Error("The current map is unavailable");
    return api.changeMap({ map });
  } });

  if (classes.error) return <p className="form-error" role="alert">{classes.error.message}</p>;
  if (classes.isPending || !draft) return <div className="center"><div className="spinner" /></div>;

  return <>
    <header><div><p className="eyebrow">ZombieReborn</p><h1>Player Classes</h1><p className="muted">Manage the classes and model pools shown by <code>!zclass</code>. Saved changes activate on the next map.</p></div><Button variant="outline" size="icon" onClick={() => void client.invalidateQueries({ queryKey: ["player-classes"] })} aria-label="Refresh player classes"><RefreshCw /></Button></header>
    {classes.data.liveOutOfSync && <Notice danger><div><strong>Live class copy is out of sync</strong><span>Saving again will retry copying the file into the game container.</span></div></Notice>}
    {saved && <Notice><div><strong>Classes saved and copied live</strong><span>They will load automatically on the next map, or reload the current map below.</span></div></Notice>}
    <Card className="panel-card class-preset-card">
      <div><Sparkles /><div><p className="eyebrow">GFL content pack</p><h2>Generate skin classes</h2><p className="muted">Build from all {classes.data.presets.length} models mounted from Workshop item 3160448201.</p></div></div>
      <NativeSelect value={mode} onChange={(event) => setMode(event.target.value as GflPresetMode)} aria-label="GFL preset mode">
        <option value="random">Random pools only</option><option value="individual">Individual classes only</option><option value="both">Random + individual classes</option>
      </NativeSelect>
      <AlertDialog><AlertDialogTrigger asChild><Button variant="outline"><Sparkles />Apply preset</Button></AlertDialogTrigger><AlertDialogContent><AlertDialogHeader><AlertDialogTitle>Replace the class draft?</AlertDialogTitle><AlertDialogDescription>This replaces the unsaved editor contents with the complete GFL {mode} preset. Nothing is written until you click Save classes.</AlertDialogDescription></AlertDialogHeader><AlertDialogFooter><AlertDialogCancel>Cancel</AlertDialogCancel><AlertDialogAction onClick={() => { setDraft(buildGflPlayerClasses(mode)); setSaved(false); }}>Apply preset</AlertDialogAction></AlertDialogFooter></AlertDialogContent></AlertDialog>
    </Card>
    <Tabs defaultValue="Human" className="class-tabs">
      <TabsList><TabsTrigger value="Human">Humans ({Object.keys(draft.Human).length})</TabsTrigger><TabsTrigger value="Zombie">Zombies ({Object.keys(draft.Zombie).length})</TabsTrigger></TabsList>
      {(["Human", "Zombie"] as Team[]).map((team) => <TabsContent value={team} key={team}><TeamEditor team={team} classes={draft[team]} onChange={(next) => { setDraft({ ...draft, [team]: next }); setSaved(false); }} /></TabsContent>)}
    </Tabs>
    {(save.error || reload.error) && <p className="form-error" role="alert">{save.error?.message ?? reload.error?.message}</p>}
    {validation && !validation.success && <p className="form-error" role="alert">{validation.error.issues[0]?.message}</p>}
    <div className="class-save-bar">
      <div><strong>{dirty ? "Unsaved class changes" : "Class configuration is saved"}</strong><span>{validation?.success ? "Configuration is valid" : "Fix validation errors before saving"}</span></div>
      <Button variant="outline" disabled={!dirty || save.isPending} onClick={() => { setDraft(cloneClasses(classes.data.classes)); setSaved(false); }}>Discard</Button>
      <Button disabled={!dirty || !validation?.success || save.isPending} onClick={() => save.mutate()}><Save />{save.isPending ? "Saving…" : "Save classes"}</Button>
      <AlertDialog><AlertDialogTrigger asChild><Button variant="destructive" disabled={dirty || !status.data?.game?.currentMap || reload.isPending}>Reload current map</Button></AlertDialogTrigger><AlertDialogContent><AlertDialogHeader><AlertDialogTitle>Reload {status.data?.game?.currentMap}?</AlertDialogTitle><AlertDialogDescription>This interrupts the current round and reloads all player classes. Save any changes first.</AlertDialogDescription></AlertDialogHeader><AlertDialogFooter><AlertDialogCancel>Cancel</AlertDialogCancel><AlertDialogAction onClick={() => reload.mutate()} className="bg-destructive text-white hover:bg-destructive/90">Reload map</AlertDialogAction></AlertDialogFooter></AlertDialogContent></AlertDialog>
    </div>
  </>;
}

function TeamEditor({ team, classes, onChange }: { team: Team; classes: Record<string, ZrClass>; onChange: (classes: Record<string, ZrClass>) => void }): ReactNode {
  const [name, setName] = useState("");
  const validName = /^[A-Za-z0-9_-]{1,64}$/.test(name) && !classes[name];
  const add = (): void => { if (validName) { onChange({ ...classes, [name]: newClass(team) }); setName(""); } };
  return <>
    <Card className="panel-card class-add-card"><div><h2>Add {team.toLowerCase()} class</h2><p className="muted">The class name is shown in the <code>!zclass</code> menu.</p></div><Input value={name} maxLength={64} placeholder={team === "Human" ? "NewHumanClass" : "NewZombieClass"} onChange={(event) => setName(event.target.value.replace(/[^A-Za-z0-9_-]/g, ""))} /><Button disabled={!validName} onClick={add}><Plus />Add class</Button></Card>
    <section className="class-list">{Object.entries(classes).map(([className, entry]) => <ClassEditor key={className} team={team} name={className} value={entry} onChange={(next) => onChange({ ...classes, [className]: next })} onDuplicate={() => { let copy = `${className}Copy`; let index = 2; while (classes[copy]) copy = `${className}Copy${index++}`; onChange({ ...classes, [copy]: structuredClone(entry) }); }} onDelete={() => { const next = { ...classes }; delete next[className]; onChange(next); }} />)}</section>
  </>;
}

function SkinIndicesInput({ value, onChange }: { value: number[]; onChange: (value: number[]) => void }): ReactNode {
  const joined = value.join(", ");
  const [text, setText] = useState(joined);
  useEffect(() => setText(joined), [joined]);
  const commit = (): void => {
    const next = text.split(",")
      .map((part) => part.trim())
      .filter(Boolean)
      .map(Number)
      .filter((part) => Number.isInteger(part) && part >= 0);
    onChange(next);
  };
  return <Input value={text} placeholder="0, 1, 2" onChange={(event) => setText(event.target.value)} onBlur={commit} />;
}

function ClassEditor({ team, name, value, onChange, onDuplicate, onDelete }: { team: Team; name: string; value: ZrClass; onChange: (value: ZrClass) => void; onDuplicate: () => void; onDelete: () => void }): ReactNode {
  const patch = (next: Partial<ZrClass>): void => onChange({ ...value, ...next });
  const setModel = (index: number, model: ZrModel): void => patch({ models: value.models.map((entry, at) => at === index ? model : entry) });
  const zombie = team === "Zombie";
  return <Card className={`panel-card class-card ${value.enabled ? "" : "disabled-row"}`}>
    <div className="class-card-head"><div><h2>{name}</h2><div className="class-badges">{value.team_default && <Badge className="running">Default</Badge>}{name === "MotherZombie" && <Badge variant="secondary">Special</Badge>}<Badge variant="secondary">{value.models.length} model{value.models.length === 1 ? "" : "s"}</Badge></div></div><div className="class-toggles"><Label>Enabled <Switch checked={value.enabled} onCheckedChange={(enabled) => patch({ enabled })} /></Label><Label>Team default <Switch checked={value.team_default} onCheckedChange={(team_default) => patch({ team_default })} /></Label></div></div>
    <div className="class-stat-grid">
      <Label>Health<Input type="number" min="1" value={value.health} onChange={(event) => patch({ health: numberValue(event.target.value) })} /></Label>
      <Label>Scale<Input type="number" min="0.01" step="0.05" value={value.scale} onChange={(event) => patch({ scale: numberValue(event.target.value) })} /></Label>
      <Label>Speed<Input type="number" min="0.01" step="0.05" value={value.speed} onChange={(event) => patch({ speed: numberValue(event.target.value) })} /></Label>
      <Label>Gravity<Input type="number" min="0.01" step="0.05" value={value.gravity} onChange={(event) => patch({ gravity: numberValue(event.target.value) })} /></Label>
      {zombie && <Label>Knockback<Input type="number" min="0" step="0.05" value={value.knockback ?? ""} onChange={(event) => patch({ knockback: optionalNumber(event.target.value) })} /></Label>}
      {zombie && <Label>Regen amount<Input type="number" min="0" value={value.health_regen_count ?? ""} onChange={(event) => patch({ health_regen_count: optionalNumber(event.target.value) })} /></Label>}
      {zombie && <Label>Regen interval<Input type="number" min="0" step="0.1" value={value.health_regen_interval ?? ""} onChange={(event) => patch({ health_regen_interval: optionalNumber(event.target.value) })} /></Label>}
      <Label>Admin flag<Input maxLength={26} value={value.admin_flag} onChange={(event) => patch({ admin_flag: event.target.value.toLowerCase().replace(/[^a-z]/g, "") })} placeholder="Blank = everyone" /></Label>
    </div>
    <div className="model-list"><h3>Model pool</h3>{value.models.map((model, index) => <div className="model-row" key={`${model.modelname}-${index}`}>
      <Label>Model path<Input value={model.modelname} onChange={(event) => setModel(index, { ...model, modelname: event.target.value })} /></Label>
      <Label>RGB color<Input value={model.color} onChange={(event) => setModel(index, { ...model, color: event.target.value })} /></Label>
      <Label>Skin indices<SkinIndicesInput value={model.skins} onChange={(skins) => setModel(index, { ...model, skins })} /></Label>
      <Button variant="ghost" size="icon" className="danger-icon" disabled={value.models.length === 1} onClick={() => patch({ models: value.models.filter((_, at) => at !== index) })} aria-label={`Remove model ${index + 1}`}><Trash2 /></Button>
    </div>)}<Button variant="outline" size="sm" onClick={() => patch({ models: [...value.models, { modelname: "agents/models/ctm_fbi/ctm_fbi.vmdl", color: "255 255 255", skins: [0] }] })}><Plus />Add model</Button></div>
    <div className="row-actions"><Button variant="outline" onClick={onDuplicate}><Copy />Duplicate</Button><AlertDialog><AlertDialogTrigger asChild><Button variant="ghost" className="danger-icon" disabled={name === "MotherZombie"}><Trash2 />Delete</Button></AlertDialogTrigger><AlertDialogContent><AlertDialogHeader><AlertDialogTitle>Delete {name}?</AlertDialogTitle><AlertDialogDescription>This removes the class from the <code>!zclass</code> menu after the next map load.</AlertDialogDescription></AlertDialogHeader><AlertDialogFooter><AlertDialogCancel>Cancel</AlertDialogCancel><AlertDialogAction onClick={onDelete} className="bg-destructive text-white hover:bg-destructive/90">Delete class</AlertDialogAction></AlertDialogFooter></AlertDialogContent></AlertDialog></div>
  </Card>;
}
