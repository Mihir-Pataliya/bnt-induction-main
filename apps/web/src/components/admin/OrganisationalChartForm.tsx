import { useEffect, useRef, useState } from "react";
import {
  ArrowLeft,
  Building2,
  ClipboardList,
  Download,
  FileCheck2,
  Maximize2,
  Network,
  Package,
  Pencil,
  Plus,
  Save,
  Search,
  ShieldCheck,
  Truck,
  UserCog,
  Users,
  Wrench,
  ZoomIn,
  ZoomOut,
  Trash2
} from "lucide-react";
import { api } from "../../lib/api";
import { organizationName } from "../../lib/supabase";
import type { OrganisationalChartRole, SessionState } from "../../types";
import { createInitialOrganisationalChartRoles } from "./organisationalChartRoles";
import "./organisationalChart.css";

const actionClass = "oc-button";

function roleIcon(title: string) {
  const normalized = title.toLowerCase();
  if (normalized.includes("operator")) return Building2;
  if (normalized.includes("record")) return ClipboardList;
  if (normalized.includes("manager")) return UserCog;
  if (normalized.includes("administrator")) return ShieldCheck;
  if (normalized.includes("loader")) return Package;
  if (normalized.includes("workshop")) return Wrench;
  if (normalized.includes("compliance")) return FileCheck2;
  if (normalized.includes("driver")) return Truck;
  return Users;
}

export function OrganisationalChartForm({ session, onBack }: { session: SessionState; onBack: () => void }) {
  const [companyName, setCompanyName] = useState(organizationName);
  const [dateCompleted, setDateCompleted] = useState("");
  const [roles, setRoles] = useState(createInitialOrganisationalChartRoles);
  const [employees, setEmployees] = useState<Array<{ id: string; fullName: string }>>([]);
  const [loading, setLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);
  const [busy, setBusy] = useState<"save" | "pdf" | null>(null);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [dirty, setDirty] = useState(false);
  const [updatedAt, setUpdatedAt] = useState("");
  const [attempted, setAttempted] = useState(false);
  const [reload, setReload] = useState(0);
  const [searchQuery, setSearchQuery] = useState("");
  const [zoom, setZoom] = useState(1);
  const companyInputRef = useRef<HTMLInputElement | null>(null);
  const chartViewportRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    let active = true;
    setLoading(true); setLoadFailed(false); setError("");
    Promise.all([api.getOrganisationalChart(session), api.getOrganisationalChartEmployees(session)])
      .then(([chart, people]) => {
        if (!active) return;
        setEmployees(people);
        if (chart) { setCompanyName(chart.companyName); setDateCompleted(chart.dateCompleted); setRoles(chart.roles); setUpdatedAt(chart.updatedAt); }
        setDirty(false);
      })
      .catch((cause: unknown) => {
        if (!active) return;
        setLoadFailed(true);
        setError(cause instanceof Error ? cause.message : "Could not load the chart. Please try again.");
      }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [session, reload]);

  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ""; };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  function changed() { setDirty(true); setMessage(""); setError(""); }
  function updateRole(id: string, update: Partial<OrganisationalChartRole>) {
    changed(); setRoles((current) => current.map((role) => role.id === id ? { ...role, ...update } : role));
  }
  const unavailable = (role: OrganisationalChartRole) => Boolean(role.employeeId && !employees.some((person) => person.id === role.employeeId));
  const invalidRole = (role: OrganisationalChartRole) => !role.notApplicable && (!role.employeeId || unavailable(role));

  async function submit(action: "save" | "pdf") {
    setAttempted(true); setError(""); setMessage("");
    if (!companyName.trim() || !dateCompleted || roles.some(invalidRole)) {
      setError("Enter the company name and date completed, then assign an available employee to every role or select N/A."); return;
    }
    const driverIds = roles.filter((role) => role.title === "Driver" && role.employeeId).map((role) => role.employeeId);
    if (new Set(driverIds).size !== driverIds.length) { setError("The same employee cannot occupy two Driver positions."); return; }
    setBusy(action);
    try {
      const input = { companyName: companyName.trim(), dateCompleted, roles };
      if (action === "save") {
        const chart = await api.saveOrganisationalChart(session, input);
        setCompanyName(chart.companyName); setRoles(chart.roles); setUpdatedAt(chart.updatedAt); setDirty(false);
        setMessage("Organisational chart saved successfully.");
      } else {
        const blob = await api.downloadOrganisationalChartPdf(session, input);
        const url = URL.createObjectURL(blob);
        const anchor = document.createElement("a"); anchor.href = url; anchor.download = `organisational-chart-${dateCompleted}.pdf`;
        document.body.appendChild(anchor); anchor.click(); anchor.remove();
        window.setTimeout(() => URL.revokeObjectURL(url), 10_000);
        setMessage(dirty ? "PDF exported. You still have unsaved changes." : "PDF exported successfully.");
      }
    } catch (cause) { setError(cause instanceof Error ? cause.message : "The operation failed. Please try again."); }
    finally { setBusy(null); }
  }

  function renderRole(role: OrganisationalChartRole, index?: number) {
    const invalid = attempted && invalidRole(role);
    const Icon = roleIcon(role.title);
    const assigned = employeeName(role.employeeId);
    const matches = roleMatches(role);
    return (
      <article
        key={role.id}
        className={`oc-role ${role.notApplicable ? "oc-role-na" : ""} ${normalizedSearch && !matches ? "oc-role-dim" : ""} ${matches && normalizedSearch ? "oc-role-match" : ""}`}
      >
        <div className="oc-role-heading">
          <span className="oc-role-icon">
            <Icon size={16} aria-hidden="true" />
          </span>
          <h3>
            {role.title}
            {index !== undefined ? ` ${index + 1}` : ""}
          </h3>
          {index !== undefined && index > 0 && (
            <button
              className="oc-remove"
              type="button"
              aria-label={`Remove Driver ${index + 1}`}
              onClick={() => {
                changed();
                setRoles((current) => current.filter((item) => item.id !== role.id));
              }}
            >
              <Trash2 size={16} />
            </button>
          )}
        </div>
        <div className="oc-role-employee">
          <span>{role.notApplicable ? "Not applicable" : assigned}</span>
          <small>{role.notApplicable ? "N/A" : role.employeeId ? role.employeeId.slice(0, 8) : "Unassigned"}</small>
        </div>
        <label htmlFor={`employee-${role.id}`} className="oc-label">
          Assigned employee
        </label>
        <select
          id={`employee-${role.id}`}
          value={role.employeeId ?? ""}
          disabled={role.notApplicable}
          aria-invalid={invalid}
          aria-describedby={invalid ? `error-${role.id}` : undefined}
          onChange={(event) => updateRole(role.id, { employeeId: event.target.value || null })}
        >
          <option value="">{role.notApplicable ? "Not applicable" : "Select an employee"}</option>
          {unavailable(role) && <option value={role.employeeId!}>Employee unavailable — reassign</option>}
          {employees.map((person) => (
            <option key={person.id} value={person.id}>
              {person.fullName} · {person.id.slice(0, 8)}
            </option>
          ))}
        </select>
        {invalid && <p id={`error-${role.id}`} className="oc-field-error">Select an available employee or N/A.</p>}
        <label className="oc-na">
          <input
            type="checkbox"
            checked={role.notApplicable}
            onChange={(event) => updateRole(role.id, { notApplicable: event.target.checked, employeeId: null })}
          />{" "}
          N/A <span>Not applicable to our business</span>
        </label>
      </article>
    );
  }

  const employeeName = (employeeId: string | null) =>
    employeeId ? employees.find((person) => person.id === employeeId)?.fullName ?? "Unavailable employee" : "Unassigned";
  const totalPositions = roles.length;
  const assignedPositions = roles.filter((role) => !!role.employeeId).length;
  const unassignedPositions = roles.filter((role) => !role.notApplicable && !role.employeeId).length;
  const naPositions = roles.filter((role) => role.notApplicable).length;
  const normalizedSearch = searchQuery.trim().toLowerCase();
  const roleMatches = (role: OrganisationalChartRole) =>
    !normalizedSearch ||
    role.title.toLowerCase().includes(normalizedSearch) ||
    employeeName(role.employeeId).toLowerCase().includes(normalizedSearch);
  const zoomIn = () => setZoom((value) => Math.min(2, Number((value + 0.1).toFixed(2))));
  const zoomOut = () => setZoom((value) => Math.max(0.5, Number((value - 0.1).toFixed(2))));
  const fitToScreen = () => {
    setZoom(1);
    chartViewportRef.current?.scrollTo({ left: 0, top: 0, behavior: "smooth" });
  };
  const editChart = () => {
    companyInputRef.current?.focus();
    companyInputRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
  };

  const drivers = roles.filter((role) => role.id.startsWith("driver-"));
  const disabled = loading || loadFailed || busy !== null;
  return <section className="oc-page" aria-label="Organisational Chart">
    <button type="button" className="oc-back" disabled={busy !== null} onClick={() => { if (!dirty || window.confirm("Leave without saving your changes?")) onBack(); }}><ArrowLeft size={16} /> Back to Inductions and Training</button>
    <header className="oc-header"><div><div className="oc-eyebrow">COR / INDUCTIONS & TRAINING</div><h2><Network aria-hidden="true" /> Organisational Chart</h2><p>Define your people. Connect your responsibilities.</p></div><span className="oc-badge">Company structure</span></header>
    <div className="oc-intro"><Network size={20} aria-hidden="true" /><p>Document your company’s Chain of Responsibility. Assign an existing employee to each position, or mark roles that don’t apply as N/A. An employee can hold more than one responsibility.</p></div>
    {error && <div role="alert" className="oc-alert oc-error">{error}{loadFailed && <button type="button" className={actionClass} onClick={() => setReload((value) => value + 1)}>Retry loading</button>}</div>}
    {message && <div role="status" className="oc-alert oc-success">{message}</div>}
    {loading && <p role="status">Loading saved chart and employee records…</p>}
      <div className="oc-summary-grid" aria-label="Organisational chart summary">
        <div className="oc-summary-card">
          <span>Total positions</span>
          <strong>{totalPositions}</strong>
        </div>
        <div className="oc-summary-card">
          <span>Assigned</span>
          <strong>{assignedPositions}</strong>
        </div>
        <div className="oc-summary-card">
          <span>Unassigned</span>
          <strong>{unassignedPositions}</strong>
        </div>
        <div className="oc-summary-card">
          <span>N/A</span>
          <strong>{naPositions}</strong>
        </div>
      </div>


    <form noValidate onSubmit={(event) => { event.preventDefault(); void submit("save"); }}>
      <fieldset disabled={disabled} className="oc-fieldset">
        <div className="oc-details">
          <label>
            Company name <span aria-hidden="true">*</span>
            <input
              ref={companyInputRef}
              value={companyName}
              maxLength={200}
              required
              aria-invalid={attempted && !companyName.trim()}
              onChange={(event) => {
                changed();
                setCompanyName(event.target.value);
              }}
              placeholder="Enter company name"
            />
          </label>
          <label>
            Date completed <span aria-hidden="true">*</span>
            <input
              type="date"
              value={dateCompleted}
              required
              aria-invalid={attempted && !dateCompleted}
              onChange={(event) => {
                changed();
                setDateCompleted(event.target.value);
              }}
            />
          </label>
        </div>
        {!loading && !loadFailed && employees.length === 0 && <p className="oc-alert">No employee records are available. Add employees through existing employee management, then reopen this chart. You may mark inapplicable roles N/A.</p>}
        <div className="oc-toolbar">
          <label className="oc-search">
            <Search size={16} aria-hidden="true" />
            <input
              type="search"
              value={searchQuery}
              onChange={(event) => setSearchQuery(event.target.value)}
              placeholder="Search roles or employees"
              aria-label="Search chart"
            />
          </label>
          <div className="oc-zoom-controls">
            <button type="button" className={actionClass} aria-label="Zoom out" onClick={zoomOut}>
              <ZoomOut size={16} />
            </button>
            <span className="oc-zoom-level">{Math.round(zoom * 100)}%</span>
            <button type="button" className={actionClass} aria-label="Zoom in" onClick={zoomIn}>
              <ZoomIn size={16} />
            </button>
            <button type="button" className={actionClass} onClick={fitToScreen}>
              <Maximize2 size={16} /> Fit to Screen
            </button>
            <button type="button" className={actionClass} onClick={editChart}>
              <Pencil size={16} /> Edit Chart
            </button>
          </div>
        </div>

        <div className="oc-chart-viewport" ref={chartViewportRef}>
          <div className="oc-chart-inner" style={{ transform: `scale(${zoom})` }}>
            <div className="oc-chart">
              <div className="oc-root">{roles.filter((role) => role.id === "operator").map((role) => renderRole(role))}</div>
              <div className="oc-tier">
                {["record-keeper", "manager", "administrator"]
                  .map((id) => roles.find((role) => role.id === id))
                  .filter((role): role is OrganisationalChartRole => Boolean(role))
                  .map((role) => renderRole(role))}
              </div>
              <div className="oc-tier">
                {["loader", "workshop", "compliance"]
                  .map((id) => roles.find((role) => role.id === id))
                  .filter((role): role is OrganisationalChartRole => Boolean(role))
                  .map((role) => renderRole(role))}
              </div>
              <div className="oc-driver-label">DRIVER POSITIONS</div>
              <div className="oc-tier oc-drivers">{drivers.map((role, index) => renderRole(role, index))}</div>
            </div>
          </div>
        </div>
        <button className={`${actionClass} oc-add`} type="button" disabled={drivers.length >= 100} onClick={() => { changed(); setRoles((current) => [...current, { id: `driver-${crypto.randomUUID()}`, title: "Driver", employeeId: null, notApplicable: false }]); }}><Plus size={16} /> Add Another Driver</button>
      </fieldset>
      <footer className="oc-footer"><div><strong>{dirty ? "Unsaved changes" : updatedAt ? "All changes saved" : "New organisational chart"}</strong><p>{updatedAt ? `Last saved ${new Date(updatedAt).toLocaleString("en-AU")}` : "Save your chart to retain it for future reviews."}</p></div><div className="oc-actions"><button type="button" className={actionClass} disabled={disabled} onClick={() => void submit("pdf")}><Download size={16} />{busy === "pdf" ? "Exporting…" : "Export PDF"}</button><button type="submit" className={`${actionClass} oc-primary`} disabled={disabled}><Save size={16} />{busy === "save" ? "Saving…" : "Save Changes"}</button></div></footer>
    </form>
  </section>;
}