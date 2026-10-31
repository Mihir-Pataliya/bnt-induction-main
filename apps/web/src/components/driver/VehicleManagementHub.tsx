import React, { useState } from "react";
import { useTranslation } from "react-i18next";
import QRCode from "qrcode";
import { VehicleRecord } from "../../types";
import { tStatus } from "../../i18n";
import { api } from "../../lib/api";
import { Truck, QrCode, Plus, CheckCircle2, AlertTriangle, Building2, Calendar, X } from "lucide-react";

interface VehicleManagementHubProps {
  vehicles: VehicleRecord[];
  onAddVehicle: (newVehicle: VehicleRecord) => void;
  onUpdateVehicle?: (vehicle: VehicleRecord) => void | Promise<void>;
  userId?: string;
  driverName?: string;
  driverNumber?: string;
  contactNumber?: string;
}

export const VehicleManagementHub: React.FC<VehicleManagementHubProps> = ({
  vehicles,
  onAddVehicle,
  onUpdateVehicle,
  userId,
  driverName,
  driverNumber,
  contactNumber,
}) => {
  const [showAddModal, setShowAddModal] = useState(false);
  const [selectedPassVehicle, setSelectedPassVehicle] = useState<VehicleRecord | null>(null);
  const [documentBusy, setDocumentBusy] = useState<string | null>(null);
  const [documentExpiry, setDocumentExpiry] = useState<Record<string, string>>({});

  const [rego, setRego] = useState("");
  const [makeModel, setMakeModel] = useState("");
  const [bodyType, setBodyType] = useState("Heavy B-Double Combination");
  const [branchName, setBranchName] = useState("Melbourne Freight Terminal - BNT Depot");
  const [regoExpiryDate, setRegoExpiryDate] = useState("2027-12-31");
  const [dgExpiryDate, setDgExpiryDate] = useState("2028-06-30");
  const [scbaServiceDueDate, setScbaServiceDueDate] = useState("2027-03-15");
  const { t } = useTranslation();

  const uploadVehicleDocument = async (vehicle: VehicleRecord, kind: "rego" | "insurance" | "inspection", file: File) => {
    const key = `${vehicle.id}:${kind}`;
    setDocumentBusy(key);
    try {
      await api.uploadVehicleComplianceDocument(vehicle.id, kind, file, kind === "rego" ? vehicle.regoExpiryDate : documentExpiry[key]);
      const refreshed = userId ? await api.getVehicles(userId) : [];
      const updated = refreshed.find((item) => item.id === vehicle.id);
      if (updated) await onUpdateVehicle?.(updated);
    } catch (error) {
      window.alert(error instanceof Error ? error.message : "Could not upload this vehicle document.");
    } finally { setDocumentBusy(null); }
  };

  const handleCreateVehicle = (e: React.FormEvent) => {
    e.preventDefault();
    if (!rego || !makeModel) return;

    const newVeh: VehicleRecord = {
      id: `veh-${Date.now()}`,
      rego: rego.toUpperCase(),
      makeModel,
      bodyType,
      branchName,
      driverNumber: driverNumber || `DRV-${rego.toUpperCase().slice(0, 4)}`,
      driverName: driverName || t("common_driver"),
      regoExpiryDate,
      dgExpiryDate,
      scbaServiceDueDate,
      vehicleCheckApproved: true,
      regoCheckApproved: true,
      status: "Active",
      qrPassCode: `BNT-PASS-${rego.toUpperCase()}-${Math.floor(1000 + Math.random() * 9000)}`,
      contactNumber: contactNumber || "",
    };

    onAddVehicle(newVeh);
    setShowAddModal(false);
    setRego("");
    setMakeModel("");
  };

  return (
    <div className="space-y-6 animate-fadeIn">
      {/* Header Banner */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 bg-slate-900/80 border border-slate-800 p-6 rounded-2xl shadow-xl backdrop-blur-xl">
        <div className="space-y-1">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-amber-500/10 border border-amber-500/30 text-amber-400 text-xs font-semibold">
            <Truck className="w-3.5 h-3.5" /> {t("vh_badge")}
          </div>
          <h1 className="text-2xl font-extrabold text-white tracking-tight">
            {t("vh_title", { count: vehicles.length })}
          </h1>
          <p className="text-slate-400 text-sm">
            {t("vh_sub")}
          </p>
        </div>

        <button
          onClick={() => setShowAddModal(true)}
          className="px-5 py-2.5 rounded-xl bg-gradient-to-r from-amber-500 to-orange-600 hover:from-amber-400 hover:to-orange-500 text-white text-xs font-bold transition-all shadow-lg shrink-0 flex items-center gap-1.5"
        >
          <Plus className="w-4 h-4" /> {t("vh_register")}
        </button>
      </div>

      {/* Vehicle Grid */}
      {vehicles.length === 0 ? (
        <div className="bg-slate-900/80 border border-slate-800 rounded-2xl p-12 text-center shadow-xl">
          <Truck className="w-10 h-10 text-slate-500 mx-auto mb-3" />
          <h3 className="text-base font-bold text-white mb-1">{t("vh_empty_title")}</h3>
          <p className="text-xs text-slate-400 max-w-md mx-auto mb-6">
            {t("vh_empty_sub")}
          </p>
          <button
            onClick={() => setShowAddModal(true)}
            className="px-5 py-2.5 rounded-xl bg-amber-600 hover:bg-amber-500 text-white text-xs font-bold transition-all shadow-lg inline-flex items-center gap-2"
          >
            <Plus className="w-4 h-4" /> {t("vh_register")}
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {vehicles.map((veh) => (
            <div
              key={veh.id}
              className="bg-slate-900/80 border border-slate-800 hover:border-amber-500/40 rounded-2xl p-6 flex flex-col justify-between gap-6 transition-all shadow-xl"
            >
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-mono font-extrabold text-amber-400 bg-amber-500/10 border border-amber-500/30 px-3 py-1 rounded-lg">
                     {t("vh_rego", { rego: veh.rego })}
                  </span>
                  <span
                    className={`px-3 py-1 rounded-full text-xs font-bold ${
                      veh.status === "Active"
                        ? "bg-emerald-500/10 text-emerald-400 border border-emerald-500/30"
                        : "bg-rose-500/10 text-rose-400 border border-rose-500/30"
                    }`}
                  >
                    {tStatus(veh.status, t)}
                  </span>
                </div>

                <div>
                  <h3 className="text-xl font-bold text-white">{veh.makeModel}</h3>
                  <p className="text-xs text-slate-400">{veh.bodyType}</p>
                </div>

                <div className="p-4 rounded-xl bg-slate-800/50 border border-slate-800 text-xs text-slate-300 space-y-2">
                  <div className="flex justify-between">
                    <span>{t("vh_branch")}</span>
                    <span className="font-medium text-white truncate max-w-[200px]">{veh.branchName}</span>
                  </div>
                  <div className="flex justify-between">
                    <span>{t("vh_rego_expiry")}</span>
                    <span className="font-mono text-emerald-400">{veh.regoExpiryDate}</span>
                  </div>
                  {veh.dgExpiryDate && (
                    <div className="flex justify-between">
                      <span>{t("vh_dg_expiry")}</span>
                      <span className="font-mono text-amber-400">{veh.dgExpiryDate}</span>
                    </div>
                  )}
                  {veh.scbaServiceDueDate && (
                    <div className="flex justify-between">
                      <span>{t("vh_scba_due")}</span>
                      <span className="font-mono text-blue-400">{veh.scbaServiceDueDate}</span>
                    </div>
                  )}
                  <div className="flex justify-between pt-1 border-t border-slate-800">
                    <span>{t("vh_check_approved")}</span>
                    <span className={veh.vehicleCheckApproved ? "text-emerald-400 font-bold" : "text-rose-400"}>
                      {veh.vehicleCheckApproved ? t("vh_yes") : t("vh_no")}
                    </span>
                  </div>
                </div>
              </div>

              <div className="pt-4 border-t border-slate-800 flex items-center justify-between">
                <span className="text-[11px] text-slate-500">{t("vh_pass_code", { code: veh.qrPassCode })}</span>
                <button
                  onClick={() => setSelectedPassVehicle(veh)}
                  className="px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 border border-slate-700 text-amber-300 text-xs font-bold transition-all"
                >
                  {t("vh_digital_pass")}
                </button>
              </div>
              <div className="border-t border-slate-800 pt-3 space-y-2">
                <p className="m-0 text-[11px] font-semibold text-slate-300">Vehicle compliance evidence</p>
                {(["rego", "insurance", "inspection"] as const).map((kind) => {
                  const label = kind === "rego" ? "Registration" : kind === "insurance" ? "Vehicle insurance" : "Safety inspection";
                  const fileUrl = kind === "rego" ? veh.regoDocumentUrl : kind === "insurance" ? veh.insuranceDocumentUrl : veh.inspectionDocumentUrl;
                  const status = kind === "rego" ? veh.regoDocumentStatus : kind === "insurance" ? veh.insuranceDocumentStatus : veh.inspectionDocumentStatus;
                  const rejection = kind === "rego" ? veh.regoDocumentRejectionReason : kind === "insurance" ? veh.insuranceDocumentRejectionReason : veh.inspectionDocumentRejectionReason;
                  const key = `${veh.id}:${kind}`;
                  return <div key={kind} className="flex flex-wrap items-center gap-2 text-[10px] text-slate-400">
                    <span className="min-w-28">{label}: {status ?? "missing"}</span>
                    {fileUrl && <a href={fileUrl} target="_blank" rel="noreferrer" className="text-blue-300 underline">View file</a>}
                    {kind !== "rego" && <input aria-label={`${label} expiry`} type="date" value={documentExpiry[key] ?? (kind === "insurance" ? veh.insuranceDocumentExpiry ?? "" : veh.inspectionDocumentExpiry ?? "")} onChange={(event) => setDocumentExpiry((current) => ({ ...current, [key]: event.target.value }))} className="rounded border border-slate-700 bg-slate-900 px-2 py-1" />}
                    <label className="cursor-pointer rounded border border-slate-700 px-2 py-1 text-indigo-300">{documentBusy === key ? "Uploading…" : fileUrl ? "Replace" : "Upload"}<input className="hidden" type="file" accept=".pdf,.png,.jpg,.jpeg" disabled={documentBusy !== null} onChange={(event) => { const file = event.target.files?.[0]; if (file) void uploadVehicleDocument(veh, kind, file); event.target.value = ""; }} /></label>
                    {rejection && <span className="text-rose-300">Reason: {rejection}</span>}
                  </div>;
                })}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* MODAL: REGISTER VEHICLE */}
      {showAddModal && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-md flex items-center justify-center p-4 animate-fadeIn">
          <div className="bg-slate-900 border border-amber-500/30 rounded-2xl max-w-lg w-full p-6 shadow-2xl space-y-6">
            <div className="flex items-center justify-between border-b border-slate-800 pb-4">
              <h2 className="text-lg font-bold text-white">{t("vh_modal_title")}</h2>
              <button onClick={() => setShowAddModal(false)} className="text-slate-400 hover:text-white p-1">
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleCreateVehicle} className="space-y-4">
              <div className="space-y-1">
                <label htmlFor="veh-rego" className="text-xs font-semibold text-slate-300">{t("vh_rego_label")}</label>
                <input
                  id="veh-rego"
                  name="rego"
                  type="text"
                  required
                  placeholder={t("vh_rego_ph")}
                  value={rego}
                  onChange={(e) => setRego(e.target.value)}
                  className="w-full px-4 py-2 rounded-xl bg-slate-800 border border-slate-700 text-white text-sm focus:outline-none focus:border-amber-500"
                />
              </div>

              <div className="space-y-1">
                <label htmlFor="veh-makeModel" className="text-xs font-semibold text-slate-300">{t("vh_make_label")}</label>
                <input
                  id="veh-makeModel"
                  name="makeModel"
                  type="text"
                  required
                  placeholder={t("vh_make_ph")}
                  value={makeModel}
                  onChange={(e) => setMakeModel(e.target.value)}
                  className="w-full px-4 py-2 rounded-xl bg-slate-800 border border-slate-700 text-white text-sm focus:outline-none focus:border-amber-500"
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1">
                   <label htmlFor="veh-regoExpiry" className="text-xs font-semibold text-slate-300">{t("vh_rego_date_label")}</label>
                  <input
                    id="veh-regoExpiry"
                    name="regoExpiryDate"
                    type="date"
                    value={regoExpiryDate}
                    onChange={(e) => setRegoExpiryDate(e.target.value)}
                    className="w-full px-3 py-2 rounded-xl bg-slate-800 border border-slate-700 text-white text-xs"
                  />
                </div>
                <div className="space-y-1">
                   <label htmlFor="veh-dgExpiry" className="text-xs font-semibold text-slate-300">{t("vh_dg_date_label")}</label>
                  <input
                    id="veh-dgExpiry"
                    name="dgExpiryDate"
                    type="date"
                    value={dgExpiryDate}
                    onChange={(e) => setDgExpiryDate(e.target.value)}
                    className="w-full px-3 py-2 rounded-xl bg-slate-800 border border-slate-700 text-white text-xs"
                  />
                </div>
              </div>

              <div className="pt-4 flex justify-end gap-3 border-t border-slate-800">
                <button
                  type="button"
                  onClick={() => setShowAddModal(false)}
                  className="px-4 py-2 rounded-xl bg-slate-800 text-slate-300 hover:bg-slate-700 text-xs font-semibold"
                >
                  {t("vh_cancel")}
                </button>
                <button
                  type="submit"
                  className="px-5 py-2 rounded-xl bg-amber-500 hover:bg-amber-400 text-slate-950 text-xs font-bold shadow-lg transition-all"
                >
                  {t("vh_save")}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL: DIGITAL QR SITE PASS */}
      {selectedPassVehicle && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-md flex items-center justify-center p-4 animate-fadeIn">
          <div className="bg-slate-900 border border-amber-500/40 rounded-3xl max-w-sm w-full p-6 shadow-2xl text-center space-y-6">
            <div className="space-y-1">
              <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 text-[10px] font-extrabold uppercase tracking-wider">
                {t("vh_active_pass")}
              </div>
              <h2 className="text-xl font-extrabold text-white">{selectedPassVehicle.rego}</h2>
              <p className="text-xs text-slate-400">{selectedPassVehicle.makeModel}</p>
            </div>

              {/* Offline Canvas QR Code Container */}
              <div className="p-6 rounded-2xl bg-white flex flex-col items-center justify-center shadow-inner mx-auto max-w-[220px]">
                <canvas
                  ref={(el) => {
                    if (el && selectedPassVehicle) {
                      // Vehicle-specific verification page: the QR identifies
                      // the truck, not the driver's induction certificate.
                      const passUrl = `${window.location.origin}/vehicle/verify/${selectedPassVehicle.qrPassCode}`;
                      QRCode.toCanvas(
                        el,
                        passUrl,
                        { width: 160, margin: 1, color: { dark: "#0f172a", light: "#ffffff" } },
                        (err) => {
                          if (err) console.error("QR render error", err);
                        }
                      );
                    }
                  }}
                  className="w-40 h-40 rounded"
                />
                <span className="text-[10px] font-mono text-slate-800 font-bold mt-2 tracking-widest">
                  {selectedPassVehicle.qrPassCode}
                </span>
              </div>

            <div className="text-xs text-slate-300 space-y-1 bg-slate-800/60 p-3 rounded-xl text-left border border-slate-800">
              <div className="flex justify-between">
                <span>{t("vh_driver")}</span>
                <span className="font-bold text-white">{selectedPassVehicle.driverName}</span>
              </div>
              <div className="flex justify-between">
                <span>{t("vh_branch_label")}</span>
                <span className="text-slate-300 truncate max-w-[160px]">{selectedPassVehicle.branchName}</span>
              </div>
              <div className="flex justify-between items-center">
                <span>{t("vh_whs")}</span>
                <span className="text-emerald-400 font-bold inline-flex items-center gap-1">
                  <CheckCircle2 className="w-3.5 h-3.5" /> {t("vh_verified")}
                </span>
              </div>
            </div>

            <button
              onClick={() => setSelectedPassVehicle(null)}
              className="w-full py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-white text-xs font-bold transition-colors"
            >
              {t("vh_close_pass")}
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
