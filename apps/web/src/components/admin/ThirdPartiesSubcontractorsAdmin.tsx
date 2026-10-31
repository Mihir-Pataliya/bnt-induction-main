import { useEffect, useState } from "react";
import {
  ClipboardCheck,
  ClipboardList,
  FileText,
  LayoutDashboard,
  ShieldCheck
} from "lucide-react";
import { SessionState } from "../../types";
import { ThirdPartiesChecklist } from "./ThirdPartiesChecklist";
import { ThirdPartiesRegister } from "./ThirdPartiesRegister";
import { ThirdPartyEngagementApplication } from "./ThirdPartyEngagementApplication";
import { MutualObligationStatementAdmin } from "./MutualObligationStatementAdmin";

const STORAGE_KEY = "bnt.thirdParties.engages";

export function ThirdPartiesSubcontractorsAdmin({
  session: _session
}: {
  session: SessionState;
}) {
  const [tab, setTab] = useState<
    "overview" | "checklist" | "register" | "engagement" | "mutual"
  >("overview");
  const [engages, setEngages] = useState<boolean>(() => {
    try {
      const stored = window.localStorage.getItem(STORAGE_KEY);
      if (stored === "false") return false;
      if (stored === "true") return true;
    } catch {
      // Ignore storage errors and fall back to the default.
    }
    return true;
  });

  useEffect(() => {
    try {
      window.localStorage.setItem(STORAGE_KEY, String(engages));
    } catch {
      // Ignore storage errors.
    }
  }, [engages]);

  const tabs = [
    { id: "overview", label: "Overview", icon: LayoutDashboard },
    { id: "checklist", label: "Checklist", icon: ClipboardCheck },
    { id: "register", label: "Third Parties Register", icon: ClipboardList },
    { id: "engagement", label: "Engagement Application", icon: FileText },
    { id: "mutual", label: "Mutual Obligation Statement", icon: ShieldCheck }
  ] as const;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2">
        {tabs.map((t) => {
          const Icon = t.icon;
          return (
            <button
              key={t.id}
              type="button"
              onClick={() => {
                if (t.id !== "overview" && t.id !== "mutual" && !engages) {
                  setEngages(true);
                }
                setTab(t.id);
              }}
              className={`inline-flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-semibold ${
                tab === t.id
                  ? "bg-blue-600 text-white"
                  : "bg-slate-800 text-slate-200 hover:bg-slate-700"
              }`}
            >
              <Icon className="h-4 w-4" /> {t.label}
            </button>
          );
        })}
      </div>

      {tab === "overview" && (
        <div className="space-y-4">
          <div className="rounded-xl border border-slate-700 bg-slate-800/50 p-5 md:p-6">
            <h3 className="text-sm font-extrabold uppercase tracking-wider text-emerald-300">
              Engagement
            </h3>
            <div className="mt-3 flex flex-wrap items-center gap-4">
              <label
                htmlFor="tp-engages"
                className="text-sm font-medium text-slate-200"
              >
                Does the business engage third parties/subcontractors?
              </label>
              <select
                id="tp-engages"
                value={engages ? "yes" : "no"}
                onChange={(event) => setEngages(event.target.value === "yes")}
                className="rounded-lg border border-slate-600 bg-slate-900 px-3 py-2 text-sm text-white focus:border-emerald-500 focus:outline-none"
              >
                <option value="yes">Yes</option>
                <option value="no">No</option>
              </select>
              <div className="flex items-center gap-2" role="group" aria-label="Engagement toggle">
                <button
                  type="button"
                  onClick={() => setEngages(true)}
                  aria-pressed={engages}
                  className={`rounded-lg border px-3 py-2 text-sm font-semibold transition-colors ${
                    engages
                      ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-300"
                      : "border-slate-600 text-slate-300 hover:bg-slate-800"
                  }`}
                >
                  Yes
                </button>
                <button
                  type="button"
                  onClick={() => setEngages(false)}
                  aria-pressed={!engages}
                  className={`rounded-lg border px-3 py-2 text-sm font-semibold transition-colors ${
                    !engages
                      ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-300"
                      : "border-slate-600 text-slate-300 hover:bg-slate-800"
                  }`}
                >
                  No
                </button>
              </div>
            </div>
            {!engages && (
              <div className="mt-4 rounded-xl border border-slate-600 bg-slate-900/60 p-4 text-sm text-slate-300">
                Not Applicable
              </div>
            )}

          </div>
          {engages && (
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
              {[
                { title: "Third Parties/Subcontractors Checklist", tab: "checklist", status: "Implemented" },
                { title: "Third Parties/Subcontractors Register", tab: "register", status: "Implemented" },
                { title: "Third Party Engagement Application", tab: "engagement", status: "Implemented" },
                { title: "Mutual Obligation Statement", tab: "mutual", status: "Implemented" }
              ].map((item) => (
                <button
                  key={item.title}
                  type="button"
                  onClick={() => {
                    if (!engages && item.tab !== "mutual") setEngages(true);
                    setTab(item.tab as typeof tab);
                  }}
                  className="rounded-xl border border-slate-700 bg-slate-800/50 p-5 text-left hover:bg-slate-800"
                >
                  <p className="font-bold text-white">{item.title}</p>
                  <p className="mt-2 text-xs text-slate-400">{item.status}</p>
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {tab === "checklist" && (
        engages ? (
          <ThirdPartiesChecklist session={_session} />
        ) : (
          <div className="rounded-xl border border-slate-600 bg-slate-900/60 p-4 text-sm text-slate-300">
            Not Applicable
          </div>
        )
      )}

      {tab === "register" && (
        engages ? (
          <ThirdPartiesRegister session={_session} />
        ) : (
          <div className="rounded-xl border border-slate-600 bg-slate-900/60 p-4 text-sm text-slate-300">
            Not Applicable
          </div>
        )
      )}

      {tab === "engagement" && (
        engages ? (
          <ThirdPartyEngagementApplication session={_session} />
        ) : (
          <div className="rounded-xl border border-slate-600 bg-slate-900/60 p-4 text-sm text-slate-300">
            Not Applicable
          </div>
        )
      )}

      {tab === "mutual" && (
        engages ? (
          <MutualObligationStatementAdmin session={_session} />
        ) : (
          <div className="rounded-xl border border-slate-600 bg-slate-900/60 p-4 text-sm text-slate-300">
            Not Applicable
          </div>
        )
      )}
    </div>
  );
}
