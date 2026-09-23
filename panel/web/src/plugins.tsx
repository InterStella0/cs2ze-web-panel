import { useEffect, useState, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, Check, Clock, Download, ExternalLink, PackageCheck, RefreshCw, Save } from "lucide-react";
import {
  DEFAULT_PLUGIN_UPDATE_SETTINGS,
  checkCompatibility,
  type CompatInput,
  type PluginId,
  type PluginStatus,
  type PluginUpdateResult,
  type PluginUpdateSettings,
  type PluginsResponse,
} from "@cs2ze/shared";
import { api } from "./api.js";
import { Alert, AlertDescription, AlertTitle } from "./components/ui/alert.js";
import { Badge } from "./components/ui/badge.js";
import { Button } from "./components/ui/button.js";
import { Card } from "./components/ui/card.js";
import { Checkbox } from "./components/ui/checkbox.js";
import { Input } from "./components/ui/input.js";
import { Label } from "./components/ui/label.js";
import { NativeSelect } from "./components/ui/native-select.js";
import { Switch } from "./components/ui/switch.js";

function formatWhen(value: string | null): string {
  if (!value) return "unknown";
  const stamp = Date.parse(value);
  if (Number.isNaN(stamp)) return "unknown";
  const minutes = Math.round((Date.now() - stamp) / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  if (minutes < 60 * 24) return `${Math.round(minutes / 60)}h ago`;
  return new Date(stamp).toLocaleDateString();
}

function VersionRow({ label, value, muted }: { label: string; value: string | null; muted?: boolean }): ReactNode {
  return <div className="mod-row">
    <span>{label}</span>
    <code className={muted ? "muted" : undefined}>{value ?? "—"}</code>
  </div>;
}

function PluginCard({ status, selection, onSelect, disabled }: {
  status: PluginStatus;
  selection: string;
  onSelect: (version: string) => void;
  disabled: boolean;
}): ReactNode {
  const changed = selection !== status.configuredVersion;
  const chosen = status.releases.find((release) => release.version === selection);
  // The configured version can predate the window the panel caches, so it is
  // offered explicitly rather than assumed to be in the release list.
  const options: Array<{ version: string; prerelease: boolean; assetAvailable: boolean }> =
    status.releases.some((release) => release.version === status.configuredVersion)
      ? status.releases
      : [{ version: status.configuredVersion, prerelease: false, assetAvailable: true }, ...status.releases];

  return <Card className={`panel-card mod-card ${changed ? "changed" : ""}`}>
    <div className="card-head">
      <div>
        <p className="eyebrow">{status.enabled ? "Installed" : "Disabled"}</p>
        <h2>{status.name}</h2>
      </div>
      <div className="mod-badges">
        {!status.enabled && <Badge variant="outline">{status.installKey}=0</Badge>}
        {status.urlOverride && <Badge variant="secondary">Pinned by {status.urlKey}</Badge>}
        {status.updateAvailable && <Badge>Update available</Badge>}
        {status.pendingInstall && <Badge variant="outline">Restart pending</Badge>}
      </div>
    </div>
    <div className="mod-rows">
      <VersionRow label="Configured" value={status.configuredVersion} />
      <VersionRow label="On disk" value={status.installedVersion} muted={status.installedVersion === null} />
      {status.loadedVersion !== null && <VersionRow label="Loaded" value={status.loadedVersion} />}
      <VersionRow label="Latest" value={status.latestVersion} muted={status.latestVersion === null} />
    </div>
    {status.error
      ? <p className="hint mod-error"><AlertTriangle /> {status.error}</p>
      : status.urlOverride
        ? <p className="hint">A direct archive URL is set, so the installer ignores {status.versionKey}. Clear {status.urlKey} in Settings to manage versions here.</p>
        : <Label className="mod-select">
            Install version
            <NativeSelect value={selection} disabled={disabled} onChange={(event) => onSelect(event.target.value)}>
              {options.map((release) => <option value={release.version} key={release.version}>
                {release.version}
                {release.prerelease ? " (pre-release)" : ""}
                {release.assetAvailable ? "" : " — no downloadable archive"}
                {release.version === status.configuredVersion ? " · current" : ""}
              </option>)}
            </NativeSelect>
          </Label>}
    <div className="mod-foot">
      <a href={chosen?.url ?? status.homepage} target="_blank" rel="noopener noreferrer">
        {chosen?.publishedAt ? `Released ${formatWhen(chosen.publishedAt)}` : "Project page"} <ExternalLink />
      </a>
      {changed && <span className="mod-change">{status.configuredVersion} → {selection}</span>}
    </div>
  </Card>;
}

function UpdaterSettings({ current, onSaved }: { current: PluginUpdateSettings; onSaved: () => Promise<void> }): ReactNode {
  const [draft, setDraft] = useState<PluginUpdateSettings>(current);
  // Same reason as the version selections: re-seed on a real change, not on the
  // new object identity every background refetch produces.
  const currentKey = JSON.stringify(current);
  useEffect(() => { setDraft(JSON.parse(currentKey) as PluginUpdateSettings); }, [currentKey]);
  const save = useMutation({ mutationFn: () => api.putPluginSettings(draft), onSuccess: onSaved });
  const dirty = JSON.stringify(draft) !== currentKey;
  const toggle = (id: PluginId, on: boolean): void => setDraft((old) => ({
    ...old,
    autoApplyPlugins: on ? [...old.autoApplyPlugins, id] : old.autoApplyPlugins.filter((item) => item !== id),
  }));

  return <Card className="panel-card updater-card">
    <div className="card-head">
      <div><p className="eyebrow">Automation</p><h2>Update checker</h2></div>
      <Clock />
    </div>
    <Label className="mod-toggle">
      <Switch checked={draft.checkEnabled} onCheckedChange={(on) => setDraft((old) => ({ ...old, checkEnabled: on }))} />
      <span><strong>Check for new releases</strong><small>Polls GitHub and AlliedMods in the background.</small></span>
    </Label>
    <Label className="mod-interval">
      Check every (hours)
      <Input type="number" min={1} max={168} value={draft.checkIntervalHours} disabled={!draft.checkEnabled}
        onChange={(event) => setDraft((old) => ({ ...old, checkIntervalHours: Math.max(1, Math.min(168, Number(event.target.value) || 1)) }))} />
    </Label>
    <Label className="mod-toggle">
      <Switch checked={draft.includePrereleases} onCheckedChange={(on) => setDraft((old) => ({ ...old, includePrereleases: on }))} />
      <span><strong>Offer pre-releases</strong><small>Include releases upstream marked as not ready.</small></span>
    </Label>
    <Label className="mod-toggle">
      <Switch checked={draft.autoApply} disabled={!draft.checkEnabled} onCheckedChange={(on) => setDraft((old) => ({ ...old, autoApply: on }))} />
      <span><strong>Apply updates automatically</strong><small>Writes the new version to .env and recreates the game server.</small></span>
    </Label>
    {draft.autoApply && <>
      <div className="mod-auto-picks">
        <p className="hint">Only these plugins are updated automatically. Anything left unchecked is reported and waits for you.</p>
        <div className="chip-list">
          {(["metamod", "cs2fixes", "multiaddonmanager", "strippercs2"] as PluginId[]).map((id) => <Label className="select-chip" key={id}>
            <Checkbox checked={draft.autoApplyPlugins.includes(id)} onCheckedChange={(on) => toggle(id, on === true)} />
            {id}
          </Label>)}
        </div>
      </div>
      <Label className="mod-toggle">
        <Switch checked={draft.applyWhenPlayersOnline} onCheckedChange={(on) => setDraft((old) => ({ ...old, applyWhenPlayersOnline: on }))} />
        <span><strong>Recreate even with players connected</strong><small>Off by default: the update waits for an empty server instead.</small></span>
      </Label>
    </>}
    {save.error && <p className="form-error" role="alert">{save.error.message}</p>}
    <Button disabled={!dirty || save.isPending} onClick={() => save.mutate()}><Save />{save.isPending ? "Saving…" : "Save automation"}</Button>
  </Card>;
}

function LastRun({ data }: { data: NonNullable<PluginsResponse["lastRun"]> }): ReactNode {
  const variant = data.outcome === "applied" ? "success" : data.outcome === "blocked" || data.outcome === "failed" ? "warning" : "default";
  const titles: Record<string, string> = {
    idle: "Updates are waiting for you",
    "up-to-date": "Everything is up to date",
    applied: "Updates applied automatically",
    deferred: "Automatic update deferred",
    blocked: "Automatic update refused",
    failed: "Automatic update failed",
  };
  return <Alert variant={variant} className="mod-lastrun">
    {data.outcome === "applied" ? <PackageCheck /> : data.outcome === "up-to-date" ? <Check /> : <AlertTriangle />}
    <AlertTitle>{titles[data.outcome] ?? data.outcome}</AlertTitle>
    <AlertDescription>{data.detail} · checked {formatWhen(data.at)}</AlertDescription>
  </Alert>;
}

export function PluginsContent({ isOwner }: { isOwner: boolean }): ReactNode {
  const client = useQueryClient();
  const plugins = useQuery({ queryKey: ["plugins"], queryFn: api.plugins, refetchInterval: 60_000 });
  const [selections, setSelections] = useState<Record<string, string>>({});
  const [result, setResult] = useState<PluginUpdateResult | null>(null);
  const [recreate, setRecreate] = useState(false);

  const list = plugins.data?.plugins ?? [];
  // Re-seed from .env only when the configured versions themselves change. The
  // query refetches on a timer, and resetting on every response would discard a
  // selection the operator is still deciding on.
  const configuredKey = list.map((status) => `${status.id}=${status.configuredVersion}`).join("|");
  useEffect(() => {
    if (!configuredKey) return;
    setSelections(Object.fromEntries(configuredKey.split("|").map((entry) => entry.split("=") as [string, string])));
  }, [configuredKey]);

  const refresh = async (): Promise<void> => {
    await Promise.all([
      client.invalidateQueries({ queryKey: ["plugins"] }),
      client.invalidateQueries({ queryKey: ["drift"] }),
      client.invalidateQueries({ queryKey: ["jobs"] }),
    ]);
  };
  const pending = list.filter((status) => selections[status.id] !== undefined && selections[status.id] !== status.configuredVersion);
  const check = useMutation({ mutationFn: api.checkPlugins, onSuccess: (data) => client.setQueryData(["plugins"], data) });
  const runCheck = useMutation({ mutationFn: api.runPluginCheck, onSuccess: refresh });
  const update = useMutation({
    mutationFn: () => api.updatePlugins(pending.map((status) => ({ id: status.id, version: selections[status.id]! })), recreate),
    onSuccess: async (data) => { setResult(data); await refresh(); },
  });

  // Preview the boot-blocking rules install-mods.sh enforces against the .env
  // this batch would produce, so an impossible combination is visible before it
  // is written rather than at the next container start.
  const prospective: Record<string, string> = {};
  for (const status of list) {
    prospective[status.versionKey] = selections[status.id] ?? status.configuredVersion;
    prospective[status.installKey] = status.enabled ? "1" : "0";
  }
  const findings = checkCompatibility(prospective as CompatInput);
  const errors = findings.filter((finding) => finding.severity === "error");
  const available = list.filter((status) => status.enabled && status.updateAvailable);

  return <>
    <header>
      <div>
        <p className="eyebrow">Mod stack</p>
        <h1>Plugins</h1>
        <p className="muted">
          Metamod and its plugins are downloaded by <code>install-mods.sh</code> from the versions in <code>.env</code>.
          Pick a release here and the panel writes it, refusing combinations the installer would reject at boot.
        </p>
      </div>
      <Button variant="outline" size="icon" className="theme-button" disabled={check.isPending}
        onClick={() => check.mutate()} aria-label="Check for updates"><RefreshCw /></Button>
    </header>

    {plugins.data?.lastRun && <LastRun data={plugins.data.lastRun} />}
    {available.length > 0 && <Alert variant="warning" className="mod-lastrun">
      <Download />
      <AlertTitle>{available.length} {available.length === 1 ? "plugin has" : "plugins have"} a newer release</AlertTitle>
      <AlertDescription>{available.map((status) => `${status.name} ${status.configuredVersion} → ${status.latestVersion}`).join(" · ")}</AlertDescription>
    </Alert>}

    {plugins.isPending ? <div className="center"><div className="spinner" /></div> : plugins.error ? <p className="form-error">{plugins.error.message}</p> : <>
      <section className="mod-grid">
        {list.map((status) => <PluginCard
          key={status.id}
          status={status}
          selection={selections[status.id] ?? status.configuredVersion}
          disabled={!isOwner || status.urlOverride !== null || update.isPending}
          onSelect={(version) => { setSelections((old) => ({ ...old, [status.id]: version })); setResult(null); }}
        />)}
      </section>

      {errors.length > 0 && <Alert variant="warning" className="mod-lastrun">
        <AlertTriangle />
        <AlertTitle>This combination cannot boot</AlertTitle>
        <AlertDescription>{errors.map((finding) => <span key={finding.message}>{finding.message}</span>)}</AlertDescription>
      </Alert>}
      {result && <Alert variant="success" className="mod-lastrun">
        <Check />
        <AlertTitle>{result.written.length ? `Updated ${result.written.length} ${result.written.length === 1 ? "plugin" : "plugins"}` : "Nothing to change"}</AlertTitle>
        <AlertDescription>
          {result.written.map((item) => <span key={item.key}>{item.key}: {item.from} → {item.to}</span>)}
          <span>{result.jobId ? "Recreating the server now — follow it on the Overview page." : "Apply & Restart to install the new archives."}</span>
        </AlertDescription>
      </Alert>}
      {update.error && <p className="form-error" role="alert">{update.error.message}</p>}

      {isOwner && <div className="mod-actions">
        <Label className="mod-toggle">
          <Switch checked={recreate} onCheckedChange={setRecreate} />
          <span><strong>Recreate the server after saving</strong><small>Downloads the archives immediately and disconnects players.</small></span>
        </Label>
        <Button variant="outline" disabled={runCheck.isPending} onClick={() => runCheck.mutate()}>
          <RefreshCw />{runCheck.isPending ? "Checking…" : "Run check now"}
        </Button>
        <Button disabled={!pending.length || errors.length > 0 || update.isPending} onClick={() => update.mutate()}>
          <Download />{update.isPending ? "Saving…" : `Update ${pending.length || ""} selected`.trim()}
        </Button>
      </div>}

      {isOwner && <UpdaterSettings current={plugins.data?.settings ?? DEFAULT_PLUGIN_UPDATE_SETTINGS} onSaved={refresh} />}
      <p className="hint mod-checked">
        Release lists last refreshed {formatWhen(plugins.data?.checkedAt ?? null)}
        {plugins.data?.playersOnline !== null && plugins.data?.playersOnline !== undefined ? ` · ${plugins.data.playersOnline} player(s) connected` : ""}
      </p>
    </>}
  </>;
}
