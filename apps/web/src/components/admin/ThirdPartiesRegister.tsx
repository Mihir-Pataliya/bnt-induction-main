import { useEffect, useState } from "react";
import { Building2, Pencil, Plus, Power, Search } from "lucide-react";
import { supabase } from "../../lib/supabase";
import { SessionState } from "../../types";

type RegisterRow = {
  id: string;
  user_id: string;
  business_name: string;
  trading_name: string;
  acn: string | null;
  postal_address: string;
  contact_person: string;
  position: string;
  mobile: string;
  email: string;
  business_activity: string;
  accreditation_type: string;
  accreditation_number: string;
  accreditation_expiry: string | null;
  certification_details: string;
  certification_expiry: string | null;
  engagement_application_status: "Not Started" | "Submitted" | "Under Review" | "Accepted" | "Rejected";
  mutual_obligation_status: "Not Issued" | "Pending Signatures" | "Signed by Both Parties";
  status: "Active" | "Inactive";
  created_at: string;
  updated_at: string;
};

const EMPTY_FORM = {
  business_name: "",
  trading_name: "",
  acn: "",
  postal_address: "",
  contact_person: "",
  position: "",
  mobile: "",
  email: "",
  business_activity: "",
  accreditation_type: "",
  accreditation_number: "",
  accreditation_expiry: "",
  certification_details: "",
  certification_expiry: "",
  engagement_application_status: "Not Started" as RegisterRow["engagement_application_status"],
  mutual_obligation_status: "Not Issued" as RegisterRow["mutual_obligation_status"],
  status: "Active" as RegisterRow["status"]
};

export function ThirdPartiesRegister({ session }: { session: SessionState }) {
  const [rows, setRows] = useState<RegisterRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [query, setQuery] = useState("");
  const [filterStatus, setFilterStatus] = useState<"All" | "Active" | "Inactive">("All");
  const [editing, setEditing] = useState<RegisterRow | null>(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [showForm, setShowForm] = useState(false);

  const load = async () => {
    setLoading(true);
    setError("");
    try {
      const { data, error: err } = await supabase
        .from("third_party_register")
        .select("*")
        .order("updated_at", { ascending: false });
      if (err) throw err;
      setRows((data || []) as RegisterRow[]);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unable to load third party register.");
      setRows([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const filtered = rows.filter((row) => {
    const needle = query.trim().toLowerCase();
    const matchesQuery =
      !needle ||
      [
        row.business_name,
        row.trading_name,
        row.acn,
        row.contact_person,
        row.email,
        row.business_activity
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase()
        .includes(needle);
    const matchesStatus = filterStatus === "All" || row.status === filterStatus;
    return matchesQuery && matchesStatus;
  });

  const openNew = () => {
    setEditing(null);
    setForm(EMPTY_FORM);
    setShowForm(true);
    setSuccess("");
    setError("");
  };

  const openEdit = (row: RegisterRow) => {
    setEditing(row);
    setForm({
      business_name: row.business_name,
      trading_name: row.trading_name,
      acn: row.acn || "",
      postal_address: row.postal_address,
      contact_person: row.contact_person,
      position: row.position,
      mobile: row.mobile,
      email: row.email,
      business_activity: row.business_activity,
      accreditation_type: row.accreditation_type,
      accreditation_number: row.accreditation_number,
      accreditation_expiry: row.accreditation_expiry || "",
      certification_details: row.certification_details,
      certification_expiry: row.certification_expiry || "",
      engagement_application_status: row.engagement_application_status,
      mutual_obligation_status: row.mutual_obligation_status,
      status: row.status
    });
    setShowForm(true);
    setSuccess("");
    setError("");
  };

  const closeForm = () => {
    setShowForm(false);
    setEditing(null);
    setForm(EMPTY_FORM);
  };

  const validate = () => {
    if (!form.business_name.trim()) return "Business name is required.";
    if (!form.contact_person.trim()) return "Contact person is required.";
    if (!form.email.trim()) return "Email is required.";
    return "";
  };

  const save = async () => {
    const validationError = validate();
    if (validationError) {
      setError(validationError);
      return;
    }
    setSaving(true);
    setError("");
    setSuccess("");
    try {
      const payload = {
        user_id: session.user.id,
        business_name: form.business_name.trim(),
        trading_name: form.trading_name.trim(),
        acn: form.acn.trim() || null,
        postal_address: form.postal_address.trim(),
        contact_person: form.contact_person.trim(),
        position: form.position.trim(),
        mobile: form.mobile.trim(),
        email: form.email.trim(),
        business_activity: form.business_activity.trim(),
        accreditation_type: form.accreditation_type.trim(),
        accreditation_number: form.accreditation_number.trim(),
        accreditation_expiry: form.accreditation_expiry || null,
        certification_details: form.certification_details.trim(),
        certification_expiry: form.certification_expiry || null,
        engagement_application_status: form.engagement_application_status,
        mutual_obligation_status: form.mutual_obligation_status,
        status: form.status,
        updated_at: new Date().toISOString()
      };

      if (editing) {
        const { error: err } = await supabase
          .from("third_party_register")
          .update(payload)
          .eq("id", editing.id);
        if (err) throw err;
        setSuccess("Third party record updated.");
      } else {
        const { error: err } = await supabase
          .from("third_party_register")
          .insert(payload);
        if (err) throw err;
        setSuccess("Third party record added.");
      }
      closeForm();
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unable to save third party record.");
    } finally {
      setSaving(false);
    }
  };

  const deactivate = async (row: RegisterRow) => {
    if (!window.confirm(`Deactivate ${row.business_name}? Historical records will be preserved.`)) return;
    setError("");
    setSuccess("");
    try {
      const { error: err } = await supabase
        .from("third_party_register")
        .update({ status: "Inactive", updated_at: new Date().toISOString() })
        .eq("id", row.id);
      if (err) throw err;
      setSuccess("Third party record deactivated.");
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unable to deactivate third party record.");
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h3 className="flex items-center gap-2 text-lg font-bold text-white">
            <Building2 className="h-5 w-5 text-emerald-400" />
            Third Parties Register
          </h3>
          <p className="mt-1 text-sm text-slate-300">
            Searchable register of third-party and subcontractor businesses.
          </p>
        </div>
        <button
          type="button"
          onClick={openNew}
          className="inline-flex items-center gap-2 rounded-xl bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-500"
        >
          <Plus className="h-4 w-4" /> Add Third Party
        </button>
      </div>

      {error && <div className="rounded-xl border border-red-500/40 bg-red-500/10 px-4 py-3 text-sm text-red-200">{error}</div>}
      {success && <div className="rounded-xl border border-emerald-500/40 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-200">{success}</div>}

      <div className="flex flex-wrap gap-3">
        <div className="relative min-w-[220px] flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search register..."
            className="w-full rounded-lg border border-slate-600 bg-slate-900 px-9 py-2 text-sm text-white placeholder-slate-400 focus:border-emerald-500 focus:outline-none"
          />
        </div>
        <select
          value={filterStatus}
          onChange={(e) => setFilterStatus(e.target.value as "All" | "Active" | "Inactive")}
          className="rounded-lg border border-slate-600 bg-slate-900 px-3 py-2 text-sm text-white focus:border-emerald-500 focus:outline-none"
        >
          <option value="All">All statuses</option>
          <option value="Active">Active</option>
          <option value="Inactive">Inactive</option>
        </select>
      </div>

      {loading ? (
        <p className="text-sm text-slate-300">Loading third party register...</p>
      ) : filtered.length === 0 ? (
        <p className="rounded-xl border border-slate-700 p-5 text-sm text-slate-400">
          No third party records found.
        </p>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-slate-700">
          <table className="min-w-full divide-y divide-slate-700 text-sm text-slate-200">
            <thead className="bg-slate-800/80 text-xs uppercase tracking-wider text-slate-300">
              <tr>
                <th className="px-4 py-3 text-left">Business</th>
                <th className="px-4 py-3 text-left">Contact</th>
                <th className="px-4 py-3 text-left">Engagement</th>
                <th className="px-4 py-3 text-left">Mutual Obligation</th>
                <th className="px-4 py-3 text-left">Status</th>
                <th className="px-4 py-3 text-left">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-700 bg-slate-900/40">
              {filtered.map((row) => (
                <tr key={row.id}>
                  <td className="px-4 py-3">
                    <div className="font-semibold text-white">{row.business_name}</div>
                    <div className="text-xs text-slate-400">{row.trading_name || "No trading name"}</div>
                    <div className="text-xs text-slate-500">{row.business_activity || "No activity recorded"}</div>
                  </td>
                  <td className="px-4 py-3">
                    <div>{row.contact_person}</div>
                    <div className="text-xs text-slate-400">{row.position}</div>
                    <div className="text-xs text-slate-400">{row.email}</div>
                    <div className="text-xs text-slate-400">{row.mobile}</div>
                  </td>
                  <td className="px-4 py-3">{row.engagement_application_status}</td>
                  <td className="px-4 py-3">{row.mutual_obligation_status}</td>
                  <td className="px-4 py-3">
                    <span className={`rounded-full px-2 py-1 text-xs font-bold ${row.status === "Active" ? "bg-emerald-500/15 text-emerald-300" : "bg-slate-500/15 text-slate-400"}`}>
                      {row.status}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex gap-2">
                      <button type="button" onClick={() => openEdit(row)} className="rounded border border-slate-600 p-2 text-slate-200 hover:bg-slate-800" title="Edit">
                        <Pencil className="h-4 w-4" />
                      </button>
                      {row.status === "Active" && (
                        <button type="button" onClick={() => deactivate(row)} className="rounded border border-rose-500/30 p-2 text-rose-400 hover:bg-rose-500/10" title="Deactivate">
                          <Power className="h-4 w-4" />
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {showForm && (
        <div className="fixed inset-0 z-[120] flex items-center justify-center overflow-y-auto bg-black/60 p-4">
          <div className="glass my-6 max-h-[92vh] w-full max-w-4xl overflow-y-auto rounded-2xl p-6 shadow-2xl">
            <div className="mb-5 flex items-center justify-between">
              <h3 className="text-xl font-bold text-white">{editing ? "Edit Third Party" : "Add Third Party"}</h3>
              <button type="button" onClick={closeForm} className="rounded border border-slate-600 px-3 py-2 text-sm text-slate-200 hover:bg-slate-800">
                Close
              </button>
            </div>

            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <label className="text-xs font-medium text-slate-200">
                Business/Owner Name *
                <input value={form.business_name} onChange={(e) => setForm({ ...form, business_name: e.target.value })} className="mt-1 block w-full rounded-lg border border-slate-600 bg-slate-900 px-3 py-2 text-sm text-white" />
              </label>
              <label className="text-xs font-medium text-slate-200">
                Trading Name
                <input value={form.trading_name} onChange={(e) => setForm({ ...form, trading_name: e.target.value })} className="mt-1 block w-full rounded-lg border border-slate-600 bg-slate-900 px-3 py-2 text-sm text-white" />
              </label>
              <label className="text-xs font-medium text-slate-200">
                ACN
                <input value={form.acn} onChange={(e) => setForm({ ...form, acn: e.target.value })} className="mt-1 block w-full rounded-lg border border-slate-600 bg-slate-900 px-3 py-2 text-sm text-white" />
              </label>
              <label className="text-xs font-medium text-slate-200">
                Postal Address
                <input value={form.postal_address} onChange={(e) => setForm({ ...form, postal_address: e.target.value })} className="mt-1 block w-full rounded-lg border border-slate-600 bg-slate-900 px-3 py-2 text-sm text-white" />
              </label>
              <label className="text-xs font-medium text-slate-200">
                Contact Person *
                <input value={form.contact_person} onChange={(e) => setForm({ ...form, contact_person: e.target.value })} className="mt-1 block w-full rounded-lg border border-slate-600 bg-slate-900 px-3 py-2 text-sm text-white" />
              </label>
              <label className="text-xs font-medium text-slate-200">
                Position
                <input value={form.position} onChange={(e) => setForm({ ...form, position: e.target.value })} className="mt-1 block w-full rounded-lg border border-slate-600 bg-slate-900 px-3 py-2 text-sm text-white" />
              </label>
              <label className="text-xs font-medium text-slate-200">
                Mobile Number
                <input value={form.mobile} onChange={(e) => setForm({ ...form, mobile: e.target.value })} className="mt-1 block w-full rounded-lg border border-slate-600 bg-slate-900 px-3 py-2 text-sm text-white" />
              </label>
              <label className="text-xs font-medium text-slate-200">
                Email *
                <input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} className="mt-1 block w-full rounded-lg border border-slate-600 bg-slate-900 px-3 py-2 text-sm text-white" />
              </label>
              <label className="text-xs font-medium text-slate-200 md:col-span-2">
                Business Activity
                <textarea value={form.business_activity} onChange={(e) => setForm({ ...form, business_activity: e.target.value })} className="mt-1 block w-full rounded-lg border border-slate-600 bg-slate-900 px-3 py-2 text-sm text-white" rows={3} />
              </label>
              <label className="text-xs font-medium text-slate-200">
                Accreditation Type
                <input value={form.accreditation_type} onChange={(e) => setForm({ ...form, accreditation_type: e.target.value })} className="mt-1 block w-full rounded-lg border border-slate-600 bg-slate-900 px-3 py-2 text-sm text-white" />
              </label>
              <label className="text-xs font-medium text-slate-200">
                Accreditation Number
                <input value={form.accreditation_number} onChange={(e) => setForm({ ...form, accreditation_number: e.target.value })} className="mt-1 block w-full rounded-lg border border-slate-600 bg-slate-900 px-3 py-2 text-sm text-white" />
              </label>
              <label className="text-xs font-medium text-slate-200">
                Accreditation Expiry
                <input type="date" value={form.accreditation_expiry} onChange={(e) => setForm({ ...form, accreditation_expiry: e.target.value })} className="mt-1 block w-full rounded-lg border border-slate-600 bg-slate-900 px-3 py-2 text-sm text-white" />
              </label>
              <label className="text-xs font-medium text-slate-200 md:col-span-2">
                Certification Details
                <textarea value={form.certification_details} onChange={(e) => setForm({ ...form, certification_details: e.target.value })} className="mt-1 block w-full rounded-lg border border-slate-600 bg-slate-900 px-3 py-2 text-sm text-white" rows={2} />
              </label>
              <label className="text-xs font-medium text-slate-200">
                Certification Expiry
                <input type="date" value={form.certification_expiry} onChange={(e) => setForm({ ...form, certification_expiry: e.target.value })} className="mt-1 block w-full rounded-lg border border-slate-600 bg-slate-900 px-3 py-2 text-sm text-white" />
              </label>
              <label className="text-xs font-medium text-slate-200">
                Engagement Application Status
                <select value={form.engagement_application_status} onChange={(e) => setForm({ ...form, engagement_application_status: e.target.value as RegisterRow["engagement_application_status"] })} className="mt-1 block w-full rounded-lg border border-slate-600 bg-slate-900 px-3 py-2 text-sm text-white">
                  <option>Not Started</option>
                  <option>Submitted</option>
                  <option>Under Review</option>
                  <option>Accepted</option>
                  <option>Rejected</option>
                </select>
              </label>
              <label className="text-xs font-medium text-slate-200">
                Mutual Obligation Statement Status
                <select value={form.mutual_obligation_status} onChange={(e) => setForm({ ...form, mutual_obligation_status: e.target.value as RegisterRow["mutual_obligation_status"] })} className="mt-1 block w-full rounded-lg border border-slate-600 bg-slate-900 px-3 py-2 text-sm text-white">
                  <option>Not Issued</option>
                  <option>Pending Signatures</option>
                  <option>Signed by Both Parties</option>
                </select>
              </label>
              <label className="text-xs font-medium text-slate-200">
                Record Status
                <select value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value as RegisterRow["status"] })} className="mt-1 block w-full rounded-lg border border-slate-600 bg-slate-900 px-3 py-2 text-sm text-white">
                  <option value="Active">Active</option>
                  <option value="Inactive">Inactive</option>
                </select>
              </label>
            </div>

            <div className="mt-6 flex justify-end gap-3">
              <button type="button" onClick={closeForm} className="rounded-lg border border-slate-600 px-4 py-2 text-sm font-semibold text-slate-200 hover:bg-slate-800">
                Cancel
              </button>
              <button type="button" onClick={save} disabled={saving} className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-500 disabled:opacity-60">
                {saving ? "Saving..." : editing ? "Update Record" : "Save Record"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
);
}

