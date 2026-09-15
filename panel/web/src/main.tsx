import { StrictMode, useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import {
  createRootRoute,
  createRoute,
  createRouter,
  Link,
  Outlet,
  RouterProvider,
  useNavigate,
} from "@tanstack/react-router";
import { QueryClient, QueryClientProvider, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Activity,
  AlertTriangle,
  BookOpenText,
  Check,
  ChevronDown,
  Download,
  Eye,
  EyeOff,
  Gamepad2,
  LayoutDashboard,
  LogOut,
  Moon,
  Play,
  Power,
  RefreshCw,
  RotateCcw,
  Save,
  Server,
  Settings,
  ShieldCheck,
  Sun,
  TerminalSquare,
  Users,
} from "lucide-react";
import {
  DANGEROUS_RCON_COMMANDS,
  ENV_GROUP_LABELS,
  ENV_SCHEMA_BY_KEY,
  validateEnvPatch,
  type AuthResponse,
  type DriftResponse,
  type EnvGroup,
  type EnvKeySpec,
  type EnvPatchResult,
  type Job,
  type JobKind,
  type LogEntry,
  type ServerStatus,
} from "@cs2ze/shared";
import { api, ApiError } from "./api.js";
import { AdminsContent, MapsContent, PlayersContent } from "./management.js";
import "./styles.css";

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: false, staleTime: 15_000 } },
});

function SetupErrorScreen(): ReactNode {
  const health = useQuery({ queryKey: ["health"], queryFn: api.health, refetchInterval: 15_000 });
  if (health.isPending) return <div className="center"><div className="spinner" aria-label="Loading" /></div>;
  if (health.isError) {
    return <MessageScreen title="Panel API unavailable" detail="The browser could not reach /api/health." />;
  }
  if (health.data.setupError) {
    const error = health.data.setupError;
    return (
      <main className="setup-screen">
        <div className="setup-card">
          <div className="icon-box danger"><AlertTriangle /></div>
          <p className="eyebrow">Setup needs attention</p>
          <h1>{error.message}</h1>
          <p className="muted">{error.detail}</p>
          {(error.expected || error.actual) && (
            <dl className="diagnostic">
              {error.expected && <><dt>Expected</dt><dd>{error.expected}</dd></>}
              {error.actual && <><dt>Actual</dt><dd>{error.actual}</dd></>}
            </dl>
          )}
          <p className="code-label">Error code: {error.code}</p>
        </div>
      </main>
    );
  }
  return <Outlet />;
}

function MessageScreen({ title, detail }: { title: string; detail: string }): ReactNode {
  return <main className="setup-screen"><div className="setup-card"><h1>{title}</h1><p className="muted">{detail}</p></div></main>;
}

function LoginPage(): ReactNode {
  const navigate = useNavigate();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  // Unauthenticated: tells you which stack this panel is attached to before you
  // sign in, which matters when you run more than one.
  const health = useQuery({ queryKey: ["health"], queryFn: api.health, retry: false, staleTime: 60_000 });
  const mutation = useMutation({
    mutationFn: () => api.login(username, password),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["me"] });
      await navigate({ to: "/" });
    },
  });
  const submit = (event: FormEvent): void => { event.preventDefault(); mutation.mutate(); };

  return (
    <main className="login-page">
      <form className="login-card" onSubmit={submit}>
        <div className="login-head">
          <span className="brand-mark"><Gamepad2 /></span>
          <div>
            <h1>CS2 ZE Panel</h1>
            <p className="login-target">
              {health.data?.project
                ? <><code>{health.data.project}</code> · {health.data.workingDir}</>
                : "Connecting to the Docker stack…"}
            </p>
          </div>
        </div>

        <label>Username<input autoFocus autoComplete="username" value={username} onChange={(e) => setUsername(e.target.value)} /></label>
        <label>Password<input type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} /></label>

        {mutation.error && <p className="form-error" role="alert">{mutation.error.message}</p>}

        <button className="primary" disabled={mutation.isPending || !username || !password}>
          {mutation.isPending ? "Signing in…" : "Sign in"}
        </button>

        <p className="hint">First run? The generated password is in <code>docker compose logs cs2-panel</code>.</p>
      </form>
      <PanelFooter />
    </main>
  );
}

function ChangePassword({ username }: { username: string }): ReactNode {
  const client = useQueryClient();
  const [currentPassword, setCurrent] = useState("");
  const [newPassword, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const mutation = useMutation({
    mutationFn: () => api.changePassword(currentPassword, newPassword),
    onSuccess: (auth) => client.setQueryData(["me"], auth),
  });
  const submit = (event: FormEvent): void => {
    event.preventDefault();
    if (newPassword !== confirm) return;
    mutation.mutate();
  };
  return (
    <main className="setup-screen">
      <form className="login-card password-card" onSubmit={submit}>
        <div className="icon-box"><ShieldCheck /></div>
        <div><p className="eyebrow">First sign-in · {username}</p><h2>Choose a permanent password</h2></div>
        <p className="muted">The bootstrap password is temporary. Use at least 12 characters.</p>
        <label>Current password<input type="password" autoComplete="current-password" value={currentPassword} onChange={(e) => setCurrent(e.target.value)} /></label>
        <label>New password<input type="password" autoComplete="new-password" value={newPassword} onChange={(e) => setNext(e.target.value)} /></label>
        <label>Confirm new password<input type="password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} /></label>
        {confirm && newPassword !== confirm && <p className="form-error">Passwords do not match.</p>}
        {mutation.error && <p className="form-error" role="alert">{mutation.error.message}</p>}
        <button className="primary" disabled={mutation.isPending || newPassword.length < 12 || newPassword !== confirm}>Save password</button>
      </form>
    </main>
  );
}

const nav = [
  { icon: LayoutDashboard, label: "Overview", to: "/" },
  { icon: BookOpenText, label: "Maps", to: "/maps" },
  { icon: Users, label: "Players", to: "/players" },
  { icon: ShieldCheck, label: "Admins", to: "/admins" },
  { icon: Activity, label: "Logs", to: "/logs" },
  { icon: TerminalSquare, label: "Console", to: "/console", ownerOnly: true },
  { icon: Settings, label: "Settings", to: "/settings", ownerOnly: true },
] as const;

function PanelFooter(): ReactNode {
  return (
    <footer className="panel-footer">
      <span>
        Built by{" "}
        <a href="https://steamcommunity.com/id/Stella667/" target="_blank" rel="noopener noreferrer">@queeniemella</a>
      </span>
      <span aria-hidden="true">·</span>
      <a href="https://github.com/InterStella0/cs2ze-docker" target="_blank" rel="noopener noreferrer">Source code</a>
      <span aria-hidden="true">·</span>
      <span>MIT License</span>
    </footer>
  );
}

function PanelShell({ me, active, children }: { me: AuthResponse; active: string; children: ReactNode }): ReactNode {
  const navigate = useNavigate();
  const client = useQueryClient();
  const logout = useMutation({
    mutationFn: api.logout,
    onSuccess: async () => { client.clear(); await navigate({ to: "/login" }); },
  });
  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand"><span className="brand-mark"><Gamepad2 /></span><span>CS2 <b>ZE</b></span></div>
        <nav>{nav.filter((item) => !("ownerOnly" in item) || !item.ownerOnly || me.user.role === "owner").map((item) => {
          const Icon = item.icon;
          return <Link to={item.to} className={active === item.to ? "active" : ""} key={item.label}><Icon />{item.label}</Link>;
        })}</nav>
        <div className="profile"><div className="avatar">{me.user.username.slice(0, 2).toUpperCase()}</div><div><strong>{me.user.username}</strong><small>{me.user.role}</small></div><button title="Sign out" onClick={() => logout.mutate()}><LogOut /></button></div>
      </aside>
      <div className="shell-content">
        <PendingRestartBanner me={me} />
        {children}
        <PanelFooter />
      </div>
    </div>
  );
}

function PendingRestartBanner({ me }: { me: AuthResponse }): ReactNode {
  const client = useQueryClient();
  const [reviewing, setReviewing] = useState(false);
  const [jobId, setJobId] = useState<string | null>(null);
  const drift = useQuery({
    queryKey: ["drift"],
    queryFn: api.drift,
    enabled: me.user.role === "owner" && !me.user.mustChangePassword,
    refetchInterval: 20_000,
  });
  const apply = useMutation({
    mutationFn: () => api.lifecycle("apply"),
    onSuccess: ({ jobId: id }) => {
      setJobId(id);
      setReviewing(false);
      const source = new EventSource(`/api/jobs/${encodeURIComponent(id)}/stream`);
      source.addEventListener("job", (event) => {
        const job = JSON.parse((event as MessageEvent<string>).data) as Job;
        if (job.state !== "running") {
          source.close();
          setJobId(null);
          void client.invalidateQueries({ queryKey: ["drift"] });
          void client.invalidateQueries({ queryKey: ["server-status"] });
          void client.invalidateQueries({ queryKey: ["jobs"] });
        }
      });
    },
  });
  if (me.user.role !== "owner" || !drift.data?.needsRestart) return null;
  const pendingEnv = drift.data.envDrift.filter((item) => item.restartRequired);
  const pendingConfig = drift.data.configDrift.filter((item) => !item.hotReloadable);
  const count = pendingEnv.length + pendingConfig.length;
  return <>
    <div className="restart-banner" role="status">
      <AlertTriangle />
      <div><strong>{count} pending {count === 1 ? "change" : "changes"}</strong><span>Apply &amp; Restart is required for these settings to take effect.</span></div>
      <button onClick={() => setReviewing(true)}>Review</button>
      <button className="banner-apply" disabled={apply.isPending || jobId !== null} onClick={() => setReviewing(true)}>{jobId ? "Applying…" : "Apply & Restart"}</button>
    </div>
    {reviewing && <DriftReview drift={drift.data} pending={apply.isPending} error={apply.error} onClose={() => setReviewing(false)} onApply={() => apply.mutate()} />}
  </>;
}

function DriftReview({ drift, pending, error, onClose, onApply }: { drift: DriftResponse; pending: boolean; error: Error | null; onClose: () => void; onApply: () => void }): ReactNode {
  const env = drift.envDrift.filter((item) => item.restartRequired);
  const files = drift.configDrift.filter((item) => !item.hotReloadable);
  return <div className="dialog-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <section className="confirm-dialog drift-dialog" role="alertdialog" aria-modal="true" aria-labelledby="drift-title">
      <div className="icon-box danger"><RefreshCw /></div>
      <h2 id="drift-title">Review pending restart</h2>
      <p className="muted">This recreates the game-server container and disconnects current players. The panel remains online.</p>
      <div className="drift-list">
        {env.map((item) => <div key={item.key}><strong>{item.key}</strong>{item.isSecret ? <span>Secret changed</span> : <code>{item.running ?? "(unset)"} → {item.current ?? "(unset)"}</code>}</div>)}
        {files.map((item) => <div key={item.path}><strong>{item.path}</strong><span>Configuration changed</span></div>)}
      </div>
      {error && <p className="form-error" role="alert">{error.message}</p>}
      <div className="dialog-actions"><button className="control" onClick={onClose} disabled={pending}>Cancel</button><button className="danger-button" onClick={onApply} disabled={pending}>{pending ? "Starting…" : "Apply & Restart"}</button></div>
    </section>
  </div>;
}

function DashboardPage(): ReactNode {
  const navigate = useNavigate();
  const client = useQueryClient();
  const me = useQuery({ queryKey: ["me"], queryFn: api.me });
  const canLoadServer = me.data !== undefined && !me.data.user.mustChangePassword;
  const status = useQuery({
    queryKey: ["server-status"],
    queryFn: api.serverStatus,
    enabled: canLoadServer,
    refetchInterval: 5_000,
  });
  const jobs = useQuery({
    queryKey: ["jobs"],
    queryFn: api.jobs,
    enabled: canLoadServer,
    refetchInterval: 10_000,
  });
  const [activeJobId, setActiveJobId] = useState<string | null>(null);
  const [confirmKind, setConfirmKind] = useState<JobKind | null>(null);
  const lifecycle = useMutation({
    mutationFn: api.lifecycle,
    onSuccess: async ({ jobId }) => {
      setActiveJobId(jobId);
      setConfirmKind(null);
      await client.invalidateQueries({ queryKey: ["jobs"] });
    },
  });
  useEffect(() => {
    if (me.error instanceof ApiError && me.error.status === 401) void navigate({ to: "/login" });
  }, [me.error, navigate]);

  if (me.isPending) return <div className="center"><div className="spinner" /></div>;
  if (me.isError) return null;
  if (me.data.user.mustChangePassword) return <ChangePassword username={me.data.user.username} />;

  const currentJob = jobs.data?.find((job) => job.state === "running") ?? jobs.data?.[0] ?? null;
  const shownJobId = activeJobId ?? currentJob?.id ?? null;
  const busy = lifecycle.isPending || jobs.data?.some((job) => job.state === "running") === true;
  const requestAction = (kind: JobKind): void => {
    if (["stop", "restart", "apply"].includes(kind)) setConfirmKind(kind);
    else lifecycle.mutate(kind);
  };

  return <>
    <PanelShell me={me.data} active="/">
      <main className="dashboard">
        <header><div><p className="eyebrow">Control panel</p><h1>Good to see you, {me.data.user.username}.</h1><p className="muted">Monitor the container and run one safe lifecycle operation at a time.</p></div><ThemeButton /></header>
        <section className="metric-grid">
          <StatusMetric status={status.data} loading={status.isPending} />
          <article className="metric"><div className="metric-icon"><Activity /></div><p>Container uptime</p><h2>{formatUptime(status.data?.uptimeSeconds)}</h2><span>{status.data?.startedAt ? `Started ${new Date(status.data.startedAt).toLocaleString()}` : "Not currently running"}</span></article>
          <article className="metric"><div className="metric-icon"><TerminalSquare /></div><p>Container image</p><h2 className="image-name">{status.data?.image || "—"}</h2><span>{status.data?.health ? `Health: ${status.data.health}` : "No container health status"}</span></article>
        </section>
        <GameSnapshot status={status.data} />
        <section className="content-grid">
          <article className="panel-card lifecycle-card">
            <div className="card-head"><div><p className="eyebrow">Lifecycle</p><h2>Server controls</h2></div>{busy && <span className="pill running">Operation running</span>}</div>
            <p className="muted">Restart keeps the current environment. Apply &amp; Restart recreates the container and re-reads <code>.env</code>.</p>
            <div className="action-grid">
              <button className="control start" disabled={busy || status.data?.state === "running"} onClick={() => requestAction("start")}><Play />Start</button>
              <button className="control stop" disabled={busy || !isActive(status.data)} onClick={() => requestAction("stop")}><Power />Stop</button>
              <button className="control" disabled={busy || !isActive(status.data)} onClick={() => requestAction("restart")}><RefreshCw />Restart</button>
              <button className="control apply" disabled={busy} onClick={() => requestAction("apply")}><RefreshCw />Apply &amp; Restart</button>
              <button className="control pull" disabled={busy} onClick={() => requestAction("pull")}><Download />Pull image</button>
            </div>
            {lifecycle.error && <p className="form-error action-error" role="alert">{lifecycle.error.message}</p>}
          </article>
          <JobMonitor jobId={shownJobId} fallback={currentJob} />
        </section>
      </main>
    </PanelShell>
    {confirmKind && (
      <ConfirmLifecycle
        kind={confirmKind}
        pending={lifecycle.isPending}
        onCancel={() => setConfirmKind(null)}
        onConfirm={() => lifecycle.mutate(confirmKind)}
      />
    )}
  </>;
}

function GameSnapshot({ status }: { status: ServerStatus | undefined }): ReactNode {
  const game = status?.game;
  return (
    <section className="game-snapshot panel-card">
      <div><p className="eyebrow">Live game</p><h2>{game?.currentMap ?? "Waiting for RCON"}</h2><span className={`status ${status?.rcon.connected ? "good" : "quiet"}`}><i />{status?.rcon.connected ? "RCON connected" : status?.rcon.error ?? "RCON unavailable"}</span></div>
      <dl>
        <div><dt>Players</dt><dd>{game ? `${game.players} + ${game.bots} bots / ${game.maxPlayers}` : "—"}</dd></div>
        <div><dt>Time left</dt><dd>{formatClock(game?.timeleftSeconds)}</dd></div>
        <div><dt>Next map</dt><dd>{game?.nextMap ?? "Automatic"}</dd></div>
      </dl>
      <div className="plugin-list">{status?.plugins.length ? status.plugins.map((plugin) => <span key={plugin.index}>{plugin.name} <b>{plugin.version}</b></span>) : <span>No plugin data yet</span>}</div>
    </section>
  );
}

function formatClock(seconds: number | null | undefined): string {
  if (seconds === null || seconds === undefined) return "—";
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const rest = seconds % 60;
  return hours > 0 ? `${hours}:${String(minutes).padStart(2, "0")}:${String(rest).padStart(2, "0")}` : `${minutes}:${String(rest).padStart(2, "0")}`;
}

function isActive(status: ServerStatus | undefined): boolean {
  return status ? ["running", "paused", "restarting"].includes(status.state) : false;
}

function formatUptime(seconds: number | null | undefined): string {
  if (seconds === null || seconds === undefined) return "—";
  const days = Math.floor(seconds / 86_400);
  const hours = Math.floor((seconds % 86_400) / 3_600);
  const minutes = Math.floor((seconds % 3_600) / 60);
  return days > 0 ? `${days}d ${hours}h` : hours > 0 ? `${hours}h ${minutes}m` : `${minutes}m`;
}

function StatusMetric({ status, loading }: { status: ServerStatus | undefined; loading: boolean }): ReactNode {
  const state = loading ? "Checking…" : status?.state ?? "Unavailable";
  const healthy = status?.state === "running";
  return (
    <article className="metric featured">
      <div className="metric-icon"><Server /></div><p>Game server</p>
      <h2 className="capitalize">{state}</h2>
      <span className={`status ${healthy ? "good" : "quiet"}`}><i />{status?.health ?? status?.status ?? "Waiting for Docker"}</span>
    </article>
  );
}

function JobMonitor({ jobId, fallback }: { jobId: string | null; fallback: Job | null }): ReactNode {
  const client = useQueryClient();
  const [job, setJob] = useState<Job | null>(fallback);

  useEffect(() => { setJob(fallback); }, [fallback]);
  useEffect(() => {
    if (!jobId) return;
    const source = new EventSource(`/api/jobs/${encodeURIComponent(jobId)}/stream`);
    const receive = (event: Event): void => {
      const next = JSON.parse((event as MessageEvent<string>).data) as Job;
      setJob(next);
      client.setQueryData<Job[]>(["jobs"], (old) => old
        ? [next, ...old.filter((item) => item.id !== next.id)]
        : [next]);
      if (next.state !== "running") {
        source.close();
        void client.invalidateQueries({ queryKey: ["server-status"] });
        void client.invalidateQueries({ queryKey: ["jobs"] });
      }
    };
    source.addEventListener("job", receive);
    return () => source.close();
  }, [jobId, client]);

  return (
    <article className="panel-card job-card">
      <div className="card-head"><div><p className="eyebrow">Latest operation</p><h2>{job ? job.kind === "apply" ? "Apply & Restart" : job.kind : "No jobs yet"}</h2></div>{job && <span className={`job-state ${job.state}`}>{job.state}</span>}</div>
      {job ? <>
        <dl className="job-meta"><div><dt>Started by</dt><dd>{job.startedBy}</dd></div><div><dt>Exit code</dt><dd>{job.exitCode ?? "—"}</dd></div></dl>
        <pre className="job-output" aria-live="polite">{job.output || (job.state === "running" ? "Waiting for output…" : "Command completed without output.")}</pre>
      </> : <p className="muted empty-job">Start, stop, restart, apply, and pull operations will stream their output here and remain in SQLite.</p>}
    </article>
  );
}

const actionCopy: Record<JobKind, { title: string; detail: string; confirm: string }> = {
  start: { title: "Start server?", detail: "Starts the existing CS2 container.", confirm: "Start" },
  stop: { title: "Stop the game server?", detail: "Connected players will be disconnected. The control panel stays online.", confirm: "Stop server" },
  restart: { title: "Restart the game server?", detail: "This interrupts players but does not re-read changes from .env.", confirm: "Restart" },
  apply: { title: "Apply and restart?", detail: "The CS2 container will be force-recreated, applying current .env values. The panel stays online.", confirm: "Apply & Restart" },
  pull: { title: "Pull image?", detail: "Downloads the configured server image without restarting the server.", confirm: "Pull" },
};

function ConfirmLifecycle({ kind, pending, onCancel, onConfirm }: { kind: JobKind; pending: boolean; onCancel: () => void; onConfirm: () => void }): ReactNode {
  const copy = actionCopy[kind];
  return <div className="dialog-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onCancel(); }}><section className="confirm-dialog" role="alertdialog" aria-modal="true" aria-labelledby="confirm-title"><div className="icon-box danger"><AlertTriangle /></div><h2 id="confirm-title">{copy.title}</h2><p className="muted">{copy.detail}</p><div className="dialog-actions"><button className="control" onClick={onCancel} disabled={pending}>Cancel</button><button className={kind === "stop" ? "danger-button" : "primary"} onClick={onConfirm} disabled={pending}>{pending ? "Starting…" : copy.confirm}</button></div></section></div>;
}

function useSessionRedirect(): ReturnType<typeof useQuery<AuthResponse>> {
  const navigate = useNavigate();
  const me = useQuery({ queryKey: ["me"], queryFn: api.me });
  useEffect(() => {
    if (me.error instanceof ApiError && me.error.status === 401) void navigate({ to: "/login" });
  }, [me.error, navigate]);
  return me;
}

const SETTINGS_GROUPS: EnvGroup[] = [
  "server", "network", "gameplay", "zombiereborn", "voting", "mods", "addons", "cstv", "logging", "bots", "docker", "admin",
];

function SettingsPage(): ReactNode {
  const me = useSessionRedirect();
  const client = useQueryClient();
  const [group, setGroup] = useState<EnvGroup>("server");
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [secretOriginals, setSecretOriginals] = useState<Record<string, string>>({});
  const [clearSecrets, setClearSecrets] = useState<Set<string>>(new Set());
  const [visibleSecrets, setVisibleSecrets] = useState<Set<string>>(new Set());
  const [result, setResult] = useState<EnvPatchResult | null>(null);
  const isOwner = me.data?.user.role === "owner" && !me.data.user.mustChangePassword;
  const schema = useQuery({ queryKey: ["env-schema"], queryFn: api.envSchema, enabled: isOwner, staleTime: Infinity });
  const environment = useQuery({ queryKey: ["env"], queryFn: api.env, enabled: isOwner });

  useEffect(() => {
    if (!environment.data || !schema.data) return;
    const values = Object.fromEntries(environment.data.values.map((item) => [item.key, item.value ?? ""]));
    setDraft(Object.fromEntries(schema.data.map((spec) => [spec.key, values[spec.key] ?? spec.default])));
    setSecretOriginals({});
    setClearSecrets(new Set());
    setVisibleSecrets(new Set());
  }, [environment.data, schema.data]);

  const baseline = Object.fromEntries((environment.data?.values ?? []).map((item) => [
    item.key,
    item.isSecret ? secretOriginals[item.key] ?? "" : item.value ?? ENV_SCHEMA_BY_KEY[item.key]?.default ?? "",
  ]));
  const changes: Record<string, string> = {};
  for (const spec of schema.data ?? []) {
    if (spec.panelManaged) continue;
    const value = clearSecrets.has(spec.key) ? "" : draft[spec.key] ?? spec.default;
    if (spec.secret) {
      if (clearSecrets.has(spec.key) || value !== "" && value !== (secretOriginals[spec.key] ?? "")) changes[spec.key] = value;
    } else if (value !== (baseline[spec.key] ?? spec.default)) changes[spec.key] = value;
  }
  const findings = validateEnvPatch(baseline, changes);
  const errors = findings.filter((finding) => finding.severity === "error");
  const warnings = findings.filter((finding) => finding.severity === "warning");

  const save = useMutation({
    mutationFn: async () => {
      const checked = await api.validateEnv(changes);
      if (!checked.valid) throw new Error(checked.findings.find((finding) => finding.severity === "error")?.message ?? "Settings are invalid");
      return api.patchEnv(changes, true);
    },
    onSuccess: async (saved) => {
      setResult(saved);
      await Promise.all([
        client.invalidateQueries({ queryKey: ["env"] }),
        client.invalidateQueries({ queryKey: ["drift"] }),
        client.invalidateQueries({ queryKey: ["server-status"] }),
      ]);
    },
  });
  const reveal = useMutation({
    mutationFn: api.revealEnv,
    onSuccess: ({ key, value }) => {
      setDraft((old) => ({ ...old, [key]: value }));
      setSecretOriginals((old) => ({ ...old, [key]: value }));
      setVisibleSecrets((old) => new Set(old).add(key));
      setClearSecrets((old) => { const next = new Set(old); next.delete(key); return next; });
    },
  });
  const discard = (): void => {
    if (!environment.data || !schema.data) return;
    const values = Object.fromEntries(environment.data.values.map((item) => [item.key, item.value ?? ""]));
    setDraft(Object.fromEntries(schema.data.map((spec) => [spec.key, values[spec.key] ?? spec.default])));
    setSecretOriginals({}); setClearSecrets(new Set()); setVisibleSecrets(new Set()); setResult(null);
  };

  if (me.isPending) return <div className="center"><div className="spinner" /></div>;
  if (me.isError) return null;
  if (me.data.user.mustChangePassword) return <ChangePassword username={me.data.user.username} />;
  if (me.data.user.role !== "owner") return <PanelShell me={me.data} active="/settings"><main className="dashboard"><MessageScreen title="Owner access required" detail="Environment settings can expose secrets and recreate the server, so they are restricted to owners." /></main></PanelShell>;

  const groupSpecs = (schema.data ?? []).filter((spec) => spec.group === group && (showAdvanced || !spec.advanced));
  return <PanelShell me={me.data} active="/settings">
    <main className="dashboard settings-page">
      <header><div><p className="eyebrow">Configuration</p><h1>Server settings</h1><p className="muted">Edit the existing <code>.env</code> without losing its comments. Live-capable cvars are pushed over RCON when saved.</p></div><ThemeButton /></header>
      <div className="settings-layout">
        <aside className="settings-tabs" aria-label="Settings groups">
          {SETTINGS_GROUPS.map((item) => <button className={group === item ? "active" : ""} onClick={() => setGroup(item)} key={item}><span>{item === "admin" ? "Legacy Admin" : ENV_GROUP_LABELS[item]}</span><ChevronDown /></button>)}
          <label className="advanced-toggle"><input type="checkbox" checked={showAdvanced} onChange={(event) => setShowAdvanced(event.target.checked)} />Show advanced fields</label>
        </aside>
        <section className="panel-card settings-card">
          <div className="settings-heading"><div><p className="eyebrow">{ENV_GROUP_LABELS[group]}</p><h2>{group === "addons" ? "MultiAddonManager" : ENV_GROUP_LABELS[group]}</h2></div><span>{groupSpecs.length} fields</span></div>
          {environment.isPending || schema.isPending ? <div className="settings-loading"><div className="spinner" /></div> : environment.error || schema.error ? <p className="form-error">{environment.error?.message ?? schema.error?.message}</p> : <div className="settings-fields">
            {groupSpecs.length ? groupSpecs.map((spec) => <SettingField
              key={spec.key}
              spec={spec}
              value={draft[spec.key] ?? spec.default}
              configured={environment.data?.values.find((item) => item.key === spec.key)?.hasValue === true}
              visible={visibleSecrets.has(spec.key)}
              clearing={clearSecrets.has(spec.key)}
              revealing={reveal.isPending && reveal.variables === spec.key}
              error={errors.find((finding) => finding.keys.includes(spec.key))?.message}
              onChange={(value) => { setDraft((old) => ({ ...old, [spec.key]: value })); setClearSecrets((old) => { const next = new Set(old); next.delete(spec.key); return next; }); setResult(null); }}
              onReveal={() => reveal.mutate(spec.key)}
              onClear={() => { setDraft((old) => ({ ...old, [spec.key]: "" })); setClearSecrets((old) => new Set(old).add(spec.key)); setVisibleSecrets((old) => new Set(old).add(spec.key)); setResult(null); }}
            />) : <p className="muted empty-settings">No {showAdvanced ? "" : "basic "}settings in this group.</p>}
          </div>}
          {(warnings.length > 0 || environment.data?.findings.some((finding) => finding.severity === "warning")) && <div className="settings-warning"><AlertTriangle />{[...warnings, ...(environment.data?.findings ?? [])].filter((finding) => finding.severity === "warning").map((finding) => <span key={finding.message}>{finding.message}</span>)}</div>}
          {result && <div className="save-result"><Check /><div><strong>Saved {result.written.length} {result.written.length === 1 ? "setting" : "settings"}</strong><span>{result.appliedLive.filter((item) => item.ok).length} applied live · {result.pendingRestart.length} pending restart</span>{result.appliedLive.filter((item) => !item.ok).map((item) => <small key={item.key}>{item.key}: {item.error}</small>)}</div></div>}
          {(save.error || reveal.error) && <p className="form-error settings-error" role="alert">{save.error?.message ?? reveal.error?.message}</p>}
        </section>
      </div>
      <footer className="settings-footer">
        <div><strong>{Object.keys(changes).length} unsaved {Object.keys(changes).length === 1 ? "change" : "changes"}</strong><span>{errors.length ? `${errors.length} validation ${errors.length === 1 ? "error" : "errors"}` : "Compatible with the current mod versions"}</span></div>
        <button className="control" onClick={discard} disabled={!Object.keys(changes).length || save.isPending}><RotateCcw />Discard</button>
        <button className="primary save-button" onClick={() => save.mutate()} disabled={!Object.keys(changes).length || errors.length > 0 || save.isPending}><Save />{save.isPending ? "Saving…" : "Save & apply live"}</button>
      </footer>
    </main>
  </PanelShell>;
}

function SettingField({ spec, value, configured, visible, clearing, revealing, error, onChange, onReveal, onClear }: { spec: EnvKeySpec; value: string; configured: boolean; visible: boolean; clearing: boolean; revealing: boolean; error?: string; onChange: (value: string) => void; onReveal: () => void; onClear: () => void }): ReactNode {
  const id = `setting-${spec.key}`;
  const control = spec.type === "boolean01"
    ? <label className="switch"><input id={id} type="checkbox" checked={value === "1"} disabled={spec.panelManaged} onChange={(event) => onChange(event.target.checked ? "1" : "0")} /><span /></label>
    : spec.type === "select"
      ? <select id={id} value={value} disabled={spec.panelManaged} onChange={(event) => onChange(event.target.value)}>{spec.options?.map((option) => <option value={option} key={option}>{option}</option>)}</select>
      : <div className="field-input-row"><input id={id} type={spec.secret && !visible ? "password" : spec.type === "number" || spec.type === "float" ? "number" : "text"} value={clearing ? "" : value} min={spec.min} max={spec.max} step={spec.step ?? (spec.type === "float" ? "any" : undefined)} disabled={spec.panelManaged} placeholder={spec.secret && configured && !visible ? "Configured — leave blank to keep" : spec.placeholder} autoComplete="off" onChange={(event) => onChange(event.target.value)} />{spec.secret && <><button className="icon-action" type="button" title={visible ? "Hide secret" : "Reveal secret"} onClick={onReveal} disabled={revealing}>{visible ? <EyeOff /> : <Eye />}</button>{configured && <button className="clear-secret" type="button" onClick={onClear}>Clear</button>}</>}</div>;
  return <div className={`setting-field ${error ? "invalid" : ""}`}>
    <div className="field-copy"><label htmlFor={id}>{spec.label}</label><code>{spec.key}</code>{spec.description && <p>{spec.description}</p>}{spec.cvar && <span className="live-label"><Activity />Applies live as {spec.cvar}</span>}{!spec.cvar && !spec.panelManaged && <span className="restart-label"><RefreshCw />Requires restart</span>}</div>
    <div className="field-control">{control}{error && <small className="field-error">{error}</small>}{spec.panelManaged && <small>Managed elsewhere and read-only.</small>}</div>
  </div>;
}

function LogsPage(): ReactNode {
  const me = useSessionRedirect();
  const [source, setSource] = useState<"docker" | "game">("docker");
  const [entries, setEntries] = useState<LogEntry[]>([]);
  const [filter, setFilter] = useState("");
  const [follow, setFollow] = useState(true);
  const [connection, setConnection] = useState("Connecting");
  const outputRef = useRef<HTMLDivElement>(null);
  const files = useQuery({ queryKey: ["log-files"], queryFn: api.logFiles, enabled: me.data !== undefined });

  useEffect(() => {
    if (!me.data || me.data.user.mustChangePassword) return;
    setEntries([]);
    setConnection("Connecting");
    const stream = new EventSource(`/api/logs/stream?source=${source}&tail=500`);
    stream.addEventListener("ready", () => setConnection("Live"));
    stream.addEventListener("log", (event) => {
      const entry = JSON.parse((event as MessageEvent<string>).data) as LogEntry;
      setEntries((old) => [...old.slice(-1_999), entry]);
    });
    stream.addEventListener("stream-error", () => setConnection("Error"));
    stream.onerror = () => setConnection("Reconnecting");
    return () => stream.close();
  }, [me.data, source]);

  const normalizedFilter = filter.trim().toLowerCase();
  const shown = normalizedFilter ? entries.filter((entry) => entry.line.toLowerCase().includes(normalizedFilter)) : entries;
  useEffect(() => {
    if (follow) outputRef.current?.scrollTo({ top: outputRef.current.scrollHeight });
  }, [shown.length, follow]);

  if (me.isPending) return <div className="center"><div className="spinner" /></div>;
  if (me.isError) return null;
  if (me.data.user.mustChangePassword) return <ChangePassword username={me.data.user.username} />;
  return (
    <PanelShell me={me.data} active="/logs">
      <main className="dashboard page-dashboard">
        <header><div><p className="eyebrow">Observability</p><h1>Live logs</h1><p className="muted">Follow container startup output or the newest CS2 game log without loading unbounded history.</p></div><ThemeButton /></header>
        <section className="panel-card log-panel">
          <div className="log-toolbar">
            <div className="tabs" role="tablist" aria-label="Log source">
              <button className={source === "docker" ? "active" : ""} onClick={() => setSource("docker")} role="tab">Container</button>
              <button className={source === "game" ? "active" : ""} onClick={() => setSource("game")} role="tab">Game</button>
            </div>
            <label className="log-filter"><span className="sr-only">Filter logs</span><input placeholder="Filter lines…" value={filter} onChange={(event) => setFilter(event.target.value)} /></label>
            <button className={`follow-toggle ${follow ? "active" : ""}`} aria-pressed={follow} onClick={() => setFollow((value) => !value)}>Follow</button>
            <span className={`stream-badge ${connection === "Live" ? "live" : ""}`}>{connection}</span>
          </div>
          <div className="log-output" ref={outputRef} aria-live="polite" onScroll={(event) => {
            const element = event.currentTarget;
            if (element.scrollHeight - element.scrollTop - element.clientHeight > 40 && follow) setFollow(false);
          }}>
            {shown.length ? shown.map((entry) => <div className="log-line" key={`${entry.source}-${entry.id}`}><time>{new Date(entry.receivedAt).toLocaleTimeString()}</time><span>{entry.line || " "}</span></div>) : <p className="terminal-empty">{connection === "Live" ? "No matching log lines." : "Waiting for the log stream…"}</p>}
          </div>
          <footer><span>{shown.length} of {entries.length} buffered lines</span>{source === "game" && <span>{files.data?.length ?? 0} game log files · newest file streams automatically</span>}</footer>
        </section>
      </main>
    </PanelShell>
  );
}

interface ConsoleEntry { command: string; output: string; executedAt: string }

function isDangerousCommand(command: string): boolean {
  const value = command.trim().toLowerCase();
  return DANGEROUS_RCON_COMMANDS.some((dangerous) => value === dangerous || value.startsWith(`${dangerous} `) || value.startsWith(`${dangerous};`));
}

function ConsolePage(): ReactNode {
  const me = useSessionRedirect();
  const [command, setCommand] = useState("");
  const [history, setHistory] = useState<ConsoleEntry[]>([]);
  const [pendingDanger, setPendingDanger] = useState<string | null>(null);
  const outputRef = useRef<HTMLDivElement>(null);
  const isOwner = me.data?.user.role === "owner" && !me.data.user.mustChangePassword;
  const status = useQuery({ queryKey: ["rcon-status"], queryFn: api.rconStatus, enabled: isOwner, refetchInterval: 10_000 });
  const commands = useQuery({ queryKey: ["rcon-commands"], queryFn: api.rconCommands, enabled: isOwner, staleTime: 10 * 60_000 });
  const execution = useMutation({
    mutationFn: api.rconExec,
    onSuccess: (result) => {
      setHistory((old) => [...old, result]);
      setCommand("");
      setPendingDanger(null);
    },
  });
  useEffect(() => { outputRef.current?.scrollTo({ top: outputRef.current.scrollHeight }); }, [history.length]);

  const execute = (value: string): void => {
    const trimmed = value.trim();
    if (!trimmed || execution.isPending) return;
    if (isDangerousCommand(trimmed) && pendingDanger !== trimmed) setPendingDanger(trimmed);
    else execution.mutate(trimmed);
  };
  const submit = (event: FormEvent): void => { event.preventDefault(); execute(command); };

  if (me.isPending) return <div className="center"><div className="spinner" /></div>;
  if (me.isError) return null;
  if (me.data.user.mustChangePassword) return <ChangePassword username={me.data.user.username} />;
  if (me.data.user.role !== "owner") return <PanelShell me={me.data} active="/console"><main className="dashboard"><MessageScreen title="Owner access required" detail="Raw RCON can fully control the server and is restricted to owners." /></main></PanelShell>;

  return <>
    <PanelShell me={me.data} active="/console">
      <main className="dashboard page-dashboard">
        <header><div><p className="eyebrow">Owner tools</p><h1>RCON console</h1><p className="muted">Commands are serialized through one authenticated connection. Output is capped at 8 MB per response.</p></div><ThemeButton /></header>
        <section className="panel-card console-panel">
          <div className="console-head"><span className={`stream-badge ${status.data?.connected ? "live" : ""}`}>{status.isPending ? "Checking RCON" : status.data?.connected ? "Connected" : "Disconnected"}</span><span>{commands.isPending ? "Loading command index…" : `${commands.data?.commands.length ?? 0} commands indexed`}</span><button onClick={() => setHistory([])} disabled={!history.length}>Clear</button></div>
          <div className="console-output" ref={outputRef} aria-live="polite">
            {history.length ? history.map((entry, index) => <div className="console-entry" key={`${entry.executedAt}-${index}`}><div><time>{new Date(entry.executedAt).toLocaleTimeString()}</time><b>&gt; {entry.command}</b></div><pre>{entry.output || "Command completed without output."}</pre></div>) : <p className="terminal-empty">Run a command to see its sanitized RCON response here.</p>}
          </div>
          <form className="console-form" onSubmit={submit}>
            <span aria-hidden="true">&gt;</span><input autoFocus list="rcon-command-list" placeholder="status" value={command} onChange={(event) => { setCommand(event.target.value); setPendingDanger(null); }} maxLength={1024} autoComplete="off" />
            <datalist id="rcon-command-list">{commands.data?.commands.map((item) => <option value={item} key={item} />)}</datalist>
            <button className="primary" disabled={!command.trim() || execution.isPending}>{execution.isPending ? "Running…" : "Run"}</button>
          </form>
          {execution.error && <p className="form-error console-error" role="alert">{execution.error.message}</p>}
        </section>
      </main>
    </PanelShell>
    {pendingDanger && <div className="dialog-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setPendingDanger(null); }}><section className="confirm-dialog" role="alertdialog" aria-modal="true"><div className="icon-box danger"><AlertTriangle /></div><h2>Run a disruptive command?</h2><p className="muted"><code>{pendingDanger}</code> can stop, restart, or materially alter the game server.</p><div className="dialog-actions"><button className="control" onClick={() => setPendingDanger(null)}>Cancel</button><button className="danger-button" onClick={() => execution.mutate(pendingDanger)}>Run command</button></div></section></div>}
  </>;
}

function ManagementPage({ active, children }: { active: string; children: ReactNode }): ReactNode {
  const me = useSessionRedirect();
  if (me.isPending) return <div className="center"><div className="spinner" /></div>;
  if (me.isError) return null;
  if (me.data.user.mustChangePassword) return <ChangePassword username={me.data.user.username} />;
  return <PanelShell me={me.data} active={active}><main className="dashboard management-page">{children}</main></PanelShell>;
}

function MapsPage(): ReactNode {
  return <ManagementPage active="/maps"><MapsContent /></ManagementPage>;
}

function PlayersPage(): ReactNode {
  return <ManagementPage active="/players"><PlayersContent /></ManagementPage>;
}

function AdminsPage(): ReactNode {
  return <ManagementPage active="/admins"><AdminsContent /></ManagementPage>;
}

function ThemeButton(): ReactNode {
  const [dark, setDark] = useState(() => document.documentElement.classList.contains("dark"));
  const toggle = (): void => {
    document.documentElement.classList.toggle("dark");
    setDark(document.documentElement.classList.contains("dark"));
  };
  return <button className="theme-button" onClick={toggle} aria-label={`Use ${dark ? "light" : "dark"} theme`}>{dark ? <Sun /> : <Moon />}</button>;
}

const rootRoute = createRootRoute({ component: SetupErrorScreen });
const indexRoute = createRoute({ getParentRoute: () => rootRoute, path: "/", component: DashboardPage });
const loginRoute = createRoute({ getParentRoute: () => rootRoute, path: "/login", component: LoginPage });
const logsRoute = createRoute({ getParentRoute: () => rootRoute, path: "/logs", component: LogsPage });
const consoleRoute = createRoute({ getParentRoute: () => rootRoute, path: "/console", component: ConsolePage });
const settingsRoute = createRoute({ getParentRoute: () => rootRoute, path: "/settings", component: SettingsPage });
const mapsRoute = createRoute({ getParentRoute: () => rootRoute, path: "/maps", component: MapsPage });
const playersRoute = createRoute({ getParentRoute: () => rootRoute, path: "/players", component: PlayersPage });
const adminsRoute = createRoute({ getParentRoute: () => rootRoute, path: "/admins", component: AdminsPage });
const routeTree = rootRoute.addChildren([indexRoute, loginRoute, logsRoute, consoleRoute, settingsRoute, mapsRoute, playersRoute, adminsRoute]);
const router = createRouter({ routeTree, defaultPreload: "intent" });

declare module "@tanstack/react-router" {
  interface Register { router: typeof router }
}

createRoot(document.getElementById("root")!).render(
  <StrictMode><QueryClientProvider client={queryClient}><RouterProvider router={router} /></QueryClientProvider></StrictMode>,
);
