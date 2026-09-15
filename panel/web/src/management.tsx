import { useState, type FormEvent, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, Check, RefreshCw, Save, Search, Shield, Trash2, UserCog } from "lucide-react";
import {
  ADMIN_FLAGS,
  ACTIONS_REQUIRING_REASON,
  ACTIONS_WITH_DURATION,
  type AdminEntry,
  type AdminGroup,
  type MapEntry,
  type MapGroup,
  type Player,
  type PlayerAction,
  type WorkshopItem,
} from "@cs2ze/shared";
import { api } from "./api.js";

function Notice({ children, danger = false }: { children: ReactNode; danger?: boolean }): ReactNode {
  return <div className={`management-notice ${danger ? "danger" : ""}`}>{danger ? <AlertTriangle /> : <Check />}{children}</div>;
}

function ErrorLine({ error }: { error: Error | null }): ReactNode {
  return error ? <p className="form-error" role="alert">{error.message}</p> : null;
}

function optionalNumber(value: string): number | undefined {
  return value.trim() === "" ? undefined : Number(value);
}

export function MapsContent(): ReactNode {
  const client = useQueryClient();
  const maps = useQuery({ queryKey: ["maps"], queryFn: api.maps, refetchInterval: 10_000 });
  const [name, setName] = useState("");
  const [workshopId, setWorkshopId] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [lookupItems, setLookupItems] = useState<WorkshopItem[]>([]);
  const [groupName, setGroupName] = useState("");
  const [groupCooldown, setGroupCooldown] = useState("");
  const refresh = async (): Promise<void> => { await client.invalidateQueries({ queryKey: ["maps"] }); };
  const add = useMutation({
    mutationFn: () => api.addMap({ name, workshop_id: workshopId ? Number(workshopId) : undefined, display_name: displayName || undefined, enabled: true, groups: [] }),
    onSuccess: async () => { setName(""); setWorkshopId(""); setDisplayName(""); setLookupItems([]); await refresh(); },
  });
  const lookup = useMutation({
    mutationFn: async (collection: boolean) => collection ? (await api.workshopCollection(workshopId)).items : [await api.workshopItem(workshopId)],
    onSuccess: (items) => { setLookupItems(items); if (items[0]) { setName(items[0].suggestedMapName); setDisplayName(items[0].title); if (items.length === 1) setWorkshopId(items[0].id); } },
  });
  const groups = useMutation({
    mutationFn: (next: Record<string, MapGroup>) => api.putMapGroups(next),
    onSuccess: refresh,
  });
  const reload = useMutation({ mutationFn: api.reloadMaps, onSuccess: refresh });
  const setNext = useMutation({ mutationFn: api.setNextMap, onSuccess: refresh });
  const change = useMutation({ mutationFn: api.changeMap, onSuccess: refresh });
  const busyError = add.error ?? lookup.error ?? groups.error ?? reload.error ?? setNext.error ?? change.error;
  const addGroup = (): void => {
    if (!groupName.trim()) return;
    groups.mutate({ ...(maps.data?.groups ?? {}), [groupName.trim()]: { enabled: true, cooldown: optionalNumber(groupCooldown) } });
    setGroupName(""); setGroupCooldown("");
  };

  return <>
    <header><div><p className="eyebrow">Rotation control</p><h1>Maps</h1><p className="muted">Edit the CS2Fixes map catalog, resolve Workshop metadata, and choose when live changes take effect.</p></div><button className="theme-button" onClick={() => void refresh()} aria-label="Refresh maps"><RefreshCw /></button></header>
    {maps.data?.liveOutOfSync && <Notice danger><div><strong>Live copy is out of sync</strong><span>The source is saved. A reload is blocked until it can be copied into the game container.</span></div></Notice>}
    <section className="management-grid">
      <article className="panel-card management-form">
        <div className="card-head"><div><p className="eyebrow">Workshop</p><h2>Add a map</h2></div><Search /></div>
        <label>Workshop item or collection ID<input value={workshopId} inputMode="numeric" onChange={(event) => setWorkshopId(event.target.value.replace(/\D/g, ""))} placeholder="3144617784" /></label>
        <div className="inline-actions"><button className="control" disabled={!workshopId || lookup.isPending} onClick={() => lookup.mutate(false)}>Lookup item</button><button className="control" disabled={!workshopId || lookup.isPending} onClick={() => lookup.mutate(true)}>Lookup collection</button></div>
        {lookupItems.length > 1 && <select onChange={(event) => { const item = lookupItems.find((candidate) => candidate.id === event.target.value); if (item) { setWorkshopId(item.id); setName(item.suggestedMapName); setDisplayName(item.title); } }}><option>Select a collection map…</option>{lookupItems.map((item) => <option value={item.id} key={item.id}>{item.title}</option>)}</select>}
        <label>Map name<input value={name} onChange={(event) => setName(event.target.value)} placeholder="ze_map_name" /></label>
        <label>Display name<input value={displayName} onChange={(event) => setDisplayName(event.target.value)} placeholder="Optional vote label" /></label>
        <button className="primary" disabled={!name || add.isPending} onClick={() => add.mutate()}>Add to rotation</button>
      </article>
      <article className="panel-card management-form">
        <div className="card-head"><div><p className="eyebrow">Live controls</p><h2>Current rotation</h2></div><span className="pill running">{maps.data?.currentMap ?? "RCON offline"}</span></div>
        <label>Forced next map<select defaultValue="" onChange={(event) => { if (event.target.value) setNext.mutate(event.target.value); }}><option value="">Choose a map…</option>{maps.data?.maps.filter((map) => map.enabled).map((map) => <option key={map.name}>{map.name}</option>)}</select></label>
        <div className="inline-actions"><button className="control" onClick={() => setNext.mutate(null)}>Use automatic vote</button><button className="danger-button" onClick={() => { if (window.confirm("Reloading the map list also reloads the CURRENT MAP and disconnects active play. Continue?")) reload.mutate(); }}>Reload list &amp; current map</button></div>
        <p className="hint">Saved catalog edits are copied live immediately. Leave reload deferred to activate them on the next map change without disruption.</p>
      </article>
    </section>
    <section className="panel-card group-editor">
      <div className="card-head"><div><p className="eyebrow">Shared rules</p><h2>Map groups</h2></div><span>{Object.keys(maps.data?.groups ?? {}).length} groups</span></div>
      <div className="chip-list">{Object.entries(maps.data?.groups ?? {}).map(([group, value]) => <span className="editable-chip" key={group}>{group}{value.cooldown !== undefined ? ` · ${value.cooldown}h` : ""}<button title={`Delete ${group}`} onClick={() => { const next = { ...(maps.data?.groups ?? {}) }; delete next[group]; groups.mutate(next); }}><Trash2 /></button></span>)}</div>
      <div className="inline-form"><input placeholder="Group name" value={groupName} onChange={(event) => setGroupName(event.target.value)} /><input type="number" min="0" step="0.5" placeholder="Cooldown hours" value={groupCooldown} onChange={(event) => setGroupCooldown(event.target.value)} /><button className="control" onClick={addGroup}>Add group</button></div>
    </section>
    <section className="management-list">
      {maps.isPending ? <div className="center"><div className="spinner" /></div> : maps.data?.maps.map((map) => <MapRow key={map.name} map={map} groups={maps.data.groups} current={maps.data.currentMap === map.name} onChanged={refresh} onChangeNow={() => { if (window.confirm(`Change to ${map.name}? CS2Fixes announces the change and loads it after 5 seconds.`)) change.mutate(map.name); }} />)}
      {!maps.isPending && !maps.data?.maps.length && <div className="panel-card empty-state">No maps configured yet.</div>}
    </section>
    <ErrorLine error={maps.error ?? busyError} />
  </>;
}

function MapRow({ map, groups, current, onChanged, onChangeNow }: { map: MapEntry & { name: string }; groups: Record<string, MapGroup>; current: boolean; onChanged: () => Promise<void>; onChangeNow: () => void }): ReactNode {
  const [draft, setDraft] = useState({ display_name: map.display_name ?? "", workshop_id: map.workshop_id ? String(map.workshop_id) : "", min_players: map.min_players === undefined ? "" : String(map.min_players), max_players: map.max_players === undefined ? "" : String(map.max_players), cooldown: map.cooldown === undefined ? "" : String(map.cooldown), enabled: map.enabled, groups: map.groups ?? [] });
  const save = useMutation({ mutationFn: () => api.updateMap(map.name, { ...draft, workshop_id: optionalNumber(draft.workshop_id), min_players: optionalNumber(draft.min_players), max_players: optionalNumber(draft.max_players), cooldown: optionalNumber(draft.cooldown) }), onSuccess: onChanged });
  const remove = useMutation({ mutationFn: () => api.deleteMap(map.name), onSuccess: onChanged });
  return <article className={`panel-card map-row ${draft.enabled ? "" : "disabled-row"}`}>
    <div className="row-title"><div><h2>{draft.display_name || map.name}</h2><code>{map.name}</code></div><label className="switch"><input type="checkbox" checked={draft.enabled} onChange={(event) => setDraft({ ...draft, enabled: event.target.checked })} /><span /></label></div>
    <div className="compact-fields"><label>Display<input value={draft.display_name} onChange={(event) => setDraft({ ...draft, display_name: event.target.value })} /></label><label>Workshop<input inputMode="numeric" value={draft.workshop_id} onChange={(event) => setDraft({ ...draft, workshop_id: event.target.value.replace(/\D/g, "") })} /></label><label>Min players<input type="number" min="0" value={draft.min_players} onChange={(event) => setDraft({ ...draft, min_players: event.target.value })} /></label><label>Max players<input type="number" min="0" value={draft.max_players} onChange={(event) => setDraft({ ...draft, max_players: event.target.value })} /></label><label>Cooldown h<input type="number" min="0" step="0.5" value={draft.cooldown} onChange={(event) => setDraft({ ...draft, cooldown: event.target.value })} /></label></div>
    <div className="chip-list">{Object.keys(groups).map((group) => <label className={`select-chip ${draft.groups.includes(group) ? "selected" : ""}`} key={group}><input type="checkbox" checked={draft.groups.includes(group)} onChange={(event) => setDraft({ ...draft, groups: event.target.checked ? [...draft.groups, group] : draft.groups.filter((item) => item !== group) })} />{group}</label>)}</div>
    <div className="row-actions">{current && <span className="pill running">Current</span>}<button className="control" disabled={current} onClick={onChangeNow}>Change now</button><button className="control" onClick={() => save.mutate()} disabled={save.isPending}><Save />Save</button><button className="icon-action danger-icon" title={`Delete ${map.name}`} onClick={() => { if (window.confirm(`Remove ${map.name} from the rotation?`)) remove.mutate(); }}><Trash2 /></button></div>
    <ErrorLine error={save.error ?? remove.error} />
  </article>;
}

export function AdminsContent(): ReactNode {
  const client = useQueryClient();
  const admins = useQuery({ queryKey: ["admins"], queryFn: api.admins });
  const [steamid, setSteamid] = useState("");
  const [name, setName] = useState("");
  const [flags, setFlags] = useState("b");
  const [immunity, setImmunity] = useState("0");
  const [groupName, setGroupName] = useState("");
  const [groupFlags, setGroupFlags] = useState("");
  const refresh = async (): Promise<void> => { await client.invalidateQueries({ queryKey: ["admins"] }); };
  const add = useMutation({ mutationFn: () => api.addAdmin({ steamid, name, flags, immunity: Number(immunity), groups: [] }), onSuccess: async () => { setSteamid(""); setName(""); await refresh(); } });
  const groups = useMutation({ mutationFn: api.putAdminGroups, onSuccess: refresh });
  const reload = useMutation({ mutationFn: api.reloadAdmins, onSuccess: refresh });
  const migrate = useMutation({ mutationFn: api.migrateEnvAdmin, onSuccess: refresh });
  const addGroup = (): void => { if (groupName.trim()) groups.mutate({ ...(admins.data?.groups ?? {}), [groupName.trim()]: { flags: groupFlags, immunity: 0 } }); };
  return <>
    <header><div><p className="eyebrow">Access control</p><h1>Admins</h1><p className="muted">Manage SteamID64 identities, inherited groups, permission flags, and immunity.</p></div><button className="theme-button" onClick={() => void refresh()}><RefreshCw /></button></header>
    {admins.data?.envOverrideActive && <Notice danger><div><strong>Legacy environment override is active</strong><span><code>CS2_ADMIN_STEAMID={admins.data.envOverrideSteamId}</code> replaces this file on every boot.</span><button className="danger-button" disabled={migrate.isPending} onClick={() => { if (window.confirm("Copy the legacy owner into admins.jsonc and clear CS2_ADMIN_STEAMID? Both files will be backed up.")) migrate.mutate(); }}>Migrate legacy admin</button></div></Notice>}
    {admins.data?.liveOutOfSync && !admins.data.envOverrideActive && <Notice danger><div><strong>Live admin copy is out of sync</strong><span>Edits remain saved and backed up in config/.</span></div></Notice>}
    <section className="management-grid">
      <article className="panel-card management-form"><div className="card-head"><div><p className="eyebrow">Identity</p><h2>Add admin</h2></div><UserCog /></div><label>SteamID64<input inputMode="numeric" maxLength={17} value={steamid} onChange={(event) => setSteamid(event.target.value.replace(/\D/g, ""))} /></label><label>Name<input value={name} maxLength={64} onChange={(event) => setName(event.target.value)} /></label><label>Immunity<input type="number" min="0" value={immunity} onChange={(event) => setImmunity(event.target.value)} /></label><FlagPicker value={flags} onChange={setFlags} /><button className="primary" disabled={admins.data?.envOverrideActive || steamid.length !== 17 || !name || add.isPending} onClick={() => add.mutate()}>Add admin</button></article>
      <article className="panel-card management-form"><div className="card-head"><div><p className="eyebrow">Reusable permissions</p><h2>Admin groups</h2></div><Shield /></div><div className="chip-list">{Object.entries(admins.data?.groups ?? {}).map(([group, value]) => <span className="editable-chip" key={group}>{group} · {value.flags || "no flags"}<button onClick={() => { const next = { ...(admins.data?.groups ?? {}) }; delete next[group]; groups.mutate(next); }}><Trash2 /></button></span>)}</div><label>Group name<input value={groupName} onChange={(event) => setGroupName(event.target.value)} /></label><label>Flags<input value={groupFlags} onChange={(event) => setGroupFlags(event.target.value.toLowerCase().replace(/[^a-z]/g, ""))} /></label><button className="control" disabled={admins.data?.envOverrideActive || !groupName} onClick={addGroup}>Add group</button><button className="primary" disabled={admins.data?.envOverrideActive || reload.isPending} onClick={() => reload.mutate()}><RefreshCw />Reload admins live</button></article>
    </section>
    <section className="management-list">{admins.isPending ? <div className="center"><div className="spinner" /></div> : admins.data?.admins.filter((admin) => !admin.isPlaceholder).map((admin) => <AdminRow admin={admin} groups={admins.data.groups} disabled={admins.data.envOverrideActive} onChanged={refresh} key={admin.steamid} />)}{!admins.isPending && !admins.data?.admins.some((admin) => !admin.isPlaceholder) && <div className="panel-card empty-state">No real admins configured yet.</div>}</section>
    <ErrorLine error={admins.error ?? add.error ?? groups.error ?? reload.error ?? migrate.error} />
  </>;
}

function FlagPicker({ value, onChange }: { value: string; onChange: (value: string) => void }): ReactNode {
  const toggle = (flag: string, checked: boolean): void => onChange([...new Set(checked ? `${value}${flag}` : value.replaceAll(flag, ""))].sort().join(""));
  return <fieldset className="flag-picker"><legend>Permission flags</legend>{ADMIN_FLAGS.map((item) => <label title={item.description} className={value.includes(item.flag) ? "selected" : ""} key={item.flag}><input type="checkbox" checked={value.includes(item.flag)} onChange={(event) => toggle(item.flag, event.target.checked)} /><b>{item.flag}</b><span>{item.label}</span></label>)}</fieldset>;
}

function AdminRow({ admin, groups, disabled, onChanged }: { admin: AdminEntry & { steamid: string }; groups: Record<string, AdminGroup>; disabled: boolean; onChanged: () => Promise<void> }): ReactNode {
  const [draft, setDraft] = useState({ name: admin.name, flags: admin.flags ?? "", immunity: admin.immunity ?? 0, groups: admin.groups ?? [] });
  const save = useMutation({ mutationFn: () => api.updateAdmin(admin.steamid, draft), onSuccess: onChanged });
  const remove = useMutation({ mutationFn: () => api.deleteAdmin(admin.steamid), onSuccess: onChanged });
  return <article className="panel-card admin-row"><div className="row-title"><div><h2>{draft.name}</h2><code>{admin.steamid}</code></div><span className="pill">Immunity {draft.immunity}</span></div><div className="compact-fields"><label>Name<input disabled={disabled} value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} /></label><label>Immunity<input disabled={disabled} type="number" min="0" value={draft.immunity} onChange={(event) => setDraft({ ...draft, immunity: Number(event.target.value) })} /></label></div><FlagPicker value={draft.flags} onChange={(flags) => setDraft({ ...draft, flags })} /><div className="chip-list">{Object.keys(groups).map((group) => <label className={`select-chip ${draft.groups.includes(group) ? "selected" : ""}`} key={group}><input disabled={disabled} type="checkbox" checked={draft.groups.includes(group)} onChange={(event) => setDraft({ ...draft, groups: event.target.checked ? [...draft.groups, group] : draft.groups.filter((item) => item !== group) })} />{group}</label>)}</div><div className="row-actions"><button className="control" disabled={disabled || save.isPending} onClick={() => save.mutate()}><Save />Save</button><button className="icon-action danger-icon" disabled={disabled} onClick={() => { if (window.confirm(`Remove admin ${draft.name}?`)) remove.mutate(); }}><Trash2 /></button></div><ErrorLine error={save.error ?? remove.error} /></article>;
}

const PLAYER_ACTIONS: PlayerAction[] = ["kick", "ban", "gag", "ungag", "mute", "unmute", "slay", "slap", "infect", "beacon", "glow", "leader", "revive", "ztele"];

export function PlayersContent(): ReactNode {
  const client = useQueryClient();
  const players = useQuery({ queryKey: ["players"], queryFn: api.players, refetchInterval: 5_000 });
  const [selection, setSelection] = useState<{ player: Player; action: PlayerAction } | null>(null);
  const [unbanId, setUnbanId] = useState("");
  const unban = useMutation({ mutationFn: () => api.playerAction(unbanId, "unban"), onSuccess: () => setUnbanId("") });
  return <>
    <header><div><p className="eyebrow">Live moderation</p><h1>Players</h1><p className="muted">Roster data comes from authenticated RCON. Targets are re-checked immediately before every action.</p></div><button className="theme-button" onClick={() => void client.invalidateQueries({ queryKey: ["players"] })}><RefreshCw /></button></header>
    {!players.data?.connected && <Notice danger><div><strong>RCON unavailable</strong><span>{players.data?.error ?? "Waiting for the game server"}</span></div></Notice>}
    <section className="panel-card player-toolbar"><div><strong>{players.data?.players.length ?? 0} connected</strong><span>{players.data?.game?.currentMap ?? "No live map"}</span></div><form onSubmit={(event) => { event.preventDefault(); if (window.confirm(`Unban SteamID64 ${unbanId}?`)) unban.mutate(); }}><input aria-label="SteamID64 to unban" placeholder="SteamID64 to unban" maxLength={17} value={unbanId} onChange={(event) => setUnbanId(event.target.value.replace(/\D/g, ""))} /><button className="control" disabled={unbanId.length !== 17 || unban.isPending}>Unban</button></form></section>
    <section className="player-list">{players.data?.players.map((player) => <PlayerRow player={player} onSelect={(action) => setSelection({ player, action })} key={player.userid} />)}{players.data?.connected && !players.data.players.length && <div className="panel-card empty-state">The server is online with no connected players.</div>}</section>
    <ErrorLine error={players.error ?? unban.error} />
    {selection && <PlayerActionDialog selection={selection} onClose={() => setSelection(null)} onDone={async () => { setSelection(null); await client.invalidateQueries({ queryKey: ["players"] }); }} />}
  </>;
}

function PlayerRow({ player, onSelect }: { player: Player; onSelect: (action: PlayerAction) => void }): ReactNode {
  const [action, setAction] = useState<PlayerAction>("kick");
  return <article className="panel-card player-row"><div className="player-identity"><div className="avatar">{player.name.slice(0, 2).toUpperCase()}</div><div><h2>{player.name}</h2><span>#{player.userid} · {player.steamid ?? "Unauthenticated"}</span></div>{player.isAdmin && <span className="pill running">Admin</span>}{player.isBot && <span className="pill">Bot</span>}</div><dl><div><dt>Ping</dt><dd>{player.ping ?? "—"}</dd></div><div><dt>Time</dt><dd>{player.time ?? "—"}</dd></div><div><dt>State</dt><dd>{player.state}</dd></div></dl><div className="player-action"><select value={action} onChange={(event) => setAction(event.target.value as PlayerAction)}>{PLAYER_ACTIONS.map((item) => <option key={item}>{item}</option>)}</select><button className="control" onClick={() => onSelect(action)}>Review action</button></div></article>;
}

function PlayerActionDialog({ selection, onClose, onDone }: { selection: { player: Player; action: PlayerAction }; onClose: () => void; onDone: () => Promise<void> }): ReactNode {
  const [reason, setReason] = useState("");
  const [duration, setDuration] = useState("0");
  const [amount, setAmount] = useState("0");
  const action = useMutation({ mutationFn: () => api.playerAction(selection.player.userid, selection.action, { reason: reason || undefined, durationMinutes: ACTIONS_WITH_DURATION.includes(selection.action) ? Number(duration) : undefined, amount: selection.action === "slap" ? Number(amount) : undefined }), onSuccess: onDone });
  const requiresReason = ACTIONS_REQUIRING_REASON.includes(selection.action);
  const submit = (event: FormEvent): void => { event.preventDefault(); action.mutate(); };
  return <div className="dialog-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}><form className="confirm-dialog action-dialog" onSubmit={submit}><div className="icon-box danger"><UserCog /></div><h2>{selection.action} {selection.player.name}?</h2><p className="muted">Target <code>#{selection.player.userid}</code> will be revalidated against the live roster before the command runs.</p>{ACTIONS_WITH_DURATION.includes(selection.action) && <label>Duration in minutes (0 = permanent)<input type="number" min="0" max="525600" value={duration} onChange={(event) => setDuration(event.target.value)} /></label>}{selection.action === "slap" && <label>Damage (0–500)<input type="number" min="0" max="500" value={amount} onChange={(event) => setAmount(event.target.value)} /></label>}<label>Reason {requiresReason ? "(required)" : "(audit note)"}<textarea maxLength={200} value={reason} onChange={(event) => setReason(event.target.value)} /></label><ErrorLine error={action.error} /><div className="dialog-actions"><button type="button" className="control" onClick={onClose}>Cancel</button><button className="danger-button" disabled={action.isPending || requiresReason && !reason.trim()}>{action.isPending ? "Running…" : `Confirm ${selection.action}`}</button></div></form></div>;
}
