import { useEffect, useMemo, useState } from "react";
import {
  ArrowLeft,
  CalendarDays,
  CheckCircle,
  ChevronLeft,
  ChevronRight,
  Clock,
  Edit,
  Filter,
  Plus,
  Trash2,
  XCircle
} from "lucide-react";
import { api } from "../../lib/api";
import type { SessionState, TrainingCalendarEvent, TrainingCalendarEmployee } from "../../types";

type ViewMode = "calendar" | "list";
type FilterStatus = "all" | "scheduled" | "completed" | "overdue";

const STATUS_CONFIG: Record<string, { label: string; icon: any; color: string; bg: string; border: string }> = {
  scheduled: { label: "Scheduled", icon: Clock, color: "text-blue-400", bg: "bg-blue-500/10", border: "border-blue-500/30" },
  completed: { label: "Completed", icon: CheckCircle, color: "text-emerald-400", bg: "bg-emerald-500/10", border: "border-emerald-500/30" },
  overdue: { label: "Overdue", icon: XCircle, color: "text-rose-400", bg: "bg-rose-500/10", border: "border-rose-500/30" }
};

export function TrainingCalendar({ session, onBack, readOnly = false }: { session: SessionState; onBack: () => void; readOnly?: boolean }) {
  const [events, setEvents] = useState<TrainingCalendarEvent[]>([]);
  const [employees, setEmployees] = useState<TrainingCalendarEmployee[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [viewMode, setViewMode] = useState<ViewMode>("calendar");
  const [filterStatus, setFilterStatus] = useState<FilterStatus>("all");
  const [editingEvent, setEditingEvent] = useState<TrainingCalendarEvent | null>(null);
  const [showEditModal, setShowEditModal] = useState(false);
  const [addModalOpen, setAddModalOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [currentMonth, setCurrentMonth] = useState(new Date());
  const [selectedDate, setSelectedDate] = useState<string | null>(null);

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    setLoading(true);
    setLoadError("");
    try {
      if (readOnly) {
        const eventsData = await api.getDriverTrainingCalendarEvents(session);
        setEvents(eventsData);
        setEmployees([{ id: session.user.id, full_name: "You", email: session.user.email, role: "driver" }]);
      } else {
        const [eventsData, employeesData] = await Promise.all([
          api.getTrainingCalendarEvents(session),
          api.getTrainingCalendarEmployees(session)
        ]);
        setEvents(eventsData);
        setEmployees(employeesData);
      }
    } catch (err: unknown) {
      setLoadError(err instanceof Error ? err.message : "Failed to load training calendar data.");
    } finally {
      setLoading(false);
    }
  };

  const filteredEvents = useMemo(() => {
    return events.filter(event => {
      if (filterStatus !== "all" && event.status !== filterStatus) return false;
      if (searchQuery) {
        const q = searchQuery.toLowerCase();
        const emp = employees.find(e => e.id === event.employee_id);
        return (
          event.title.toLowerCase().includes(q) ||
          event.topic.toLowerCase().includes(q) ||
          event.trainer.toLowerCase().includes(q) ||
          (emp?.full_name?.toLowerCase() ?? "").includes(q)
        );
      }
      return true;
    });
  }, [events, filterStatus, searchQuery, employees]);
  const statusConfig = readOnly
    ? {
        scheduled: { label: "Upcoming", icon: Clock, color: "text-blue-400", bg: "bg-blue-500/10", border: "border-blue-500/30" },
        completed: { label: "Completed", icon: CheckCircle, color: "text-emerald-400", bg: "bg-emerald-500/10", border: "border-emerald-500/30" },
        overdue: { label: "Overdue", icon: XCircle, color: "text-rose-400", bg: "bg-rose-500/10", border: "border-rose-500/30" }
      }
    : STATUS_CONFIG;

  const nextSession = useMemo(() => {
    const now = new Date();
    return [...events]
      .filter((event) => new Date(event.scheduled_date) >= now && event.status !== "completed")
      .sort((a, b) => new Date(a.scheduled_date).getTime() - new Date(b.scheduled_date).getTime())[0];
  }, [events]);

  const openEditModal = (event: TrainingCalendarEvent) => {
    setEditingEvent(event);
    setShowEditModal(true);
  };

  const closeEditModal = () => {
    setEditingEvent(null);
    setShowEditModal(false);
  };

  const openAddModal = (dateStr?: string) => {
    setSelectedDate(dateStr ?? null);
    setAddModalOpen(true);
  };

  const closeAddModal = () => {
    setSelectedDate(null);
    setAddModalOpen(false);
  };

  const saveEvent = async (eventData: Partial<TrainingCalendarEvent>) => {
    const normalizedEvent: Partial<TrainingCalendarEvent> = {
      ...eventData,
      employee_id:
        eventData.employee_id === "" || eventData.employee_id === "all"
          ? null
          : eventData.employee_id ?? null,
      scheduled_date: eventData.scheduled_date
        ? new Date(eventData.scheduled_date).toISOString()
        : eventData.scheduled_date,
      refresher_due_date: eventData.refresher_due_date
        ? new Date(eventData.refresher_due_date).toISOString()
        : eventData.refresher_due_date ?? null
    };
    try {
      if (editingEvent) {
        await api.updateTrainingCalendarEvent(session, editingEvent.id, normalizedEvent);
      } else {
        await api.createTrainingCalendarEvent(session, normalizedEvent as any);
      }
      await loadData();
      closeEditModal();
      closeAddModal();
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : "Failed to save event.");
    }
  };

  const getEmployeeName = (employeeId: string | null) => {
    if (!employeeId) return "All Employees";
    const emp = employees.find(e => e.id === employeeId);
    return emp?.full_name || "Unknown";
  };

  const handleDelete = async (eventId: string) => {
    if (!window.confirm("Delete this training event? This cannot be undone.")) return;
    try {
      await api.deleteTrainingCalendarEvent(session, eventId);
      await loadData();
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : "Failed to delete event.");
    }
  };

  const handleStatusChange = async (eventId: string, newStatus: "scheduled" | "completed" | "overdue") => {
    try {
      await api.updateTrainingCalendarEvent(session, eventId, { status: newStatus });
      await loadData();
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : "Failed to update status.");
    }
  };

  const monthNames = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
  const weekDays = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

  return (
    <section className="rounded-2xl border border-slate-700 bg-slate-900 p-5 md:p-6 text-white">
      <div className="mb-4 flex items-center justify-between">
        <button
          type="button"
          onClick={onBack}
          className="inline-flex items-center gap-2 rounded-lg border border-slate-600 px-3 py-2 text-sm font-semibold text-slate-200 transition-colors hover:bg-slate-800"
        >
          <ArrowLeft className="h-4 w-4" aria-hidden="true" />
          Back to Inductions and Training
        </button>
        <p className="text-xs font-bold uppercase tracking-wider text-emerald-300">COR / Inductions &amp; Training</p>
      </div>

      <h2 className="text-2xl font-black mb-4">{readOnly ? "My Training Calendar" : "Training Calendar"}</h2>
      <p className="mb-4 text-sm text-slate-300">
        {readOnly
          ? "View your assigned training sessions, including upcoming sessions, dates, times, meeting details, trainer and status."
          : "Schedule training for employees and subcontractors. Shows all scheduled training with Upcoming, Overdue, and Completed status."}
      </p>
      {readOnly && nextSession && (
        <div className="mb-5 rounded-xl border border-teal-500/40 bg-teal-500/10 p-4">
          <p className="text-xs font-bold uppercase tracking-wider text-teal-300">Your Next Training Session</p>
          <h3 className="mt-1 text-lg font-bold text-white">{nextSession.title}</h3>
          <p className="text-sm text-slate-300">{nextSession.topic}</p>
          <div className="mt-3 flex flex-wrap gap-4 text-sm text-slate-200">
            <span>{new Date(nextSession.scheduled_date).toLocaleDateString()}</span>
            {(nextSession.start_time || nextSession.end_time) && (
              <span>
                {nextSession.start_time || "--:--"}{nextSession.end_time ? ` - ${nextSession.end_time}` : ""}
              </span>
            )}
            <span>{nextSession.trainer ? `Trainer: ${nextSession.trainer}` : "Trainer TBC"}</span>
            <span>{nextSession.notes?.trim() ? `Meeting details: ${nextSession.notes}` : "Location/meeting details TBC"}</span>
          </div>
        </div>
      )}

      {loadError && (
        <div className="mb-5 flex flex-wrap items-center gap-3 rounded-lg border border-rose-500/40 bg-rose-500/10 p-4 text-sm text-rose-200" role="alert">
          <span>{loadError}</span>
          <button type="button" onClick={loadData} className="rounded-md border border-rose-300/40 px-3 py-2 font-semibold hover:bg-rose-500/10">
            Retry
          </button>
        </div>
      )}

      <div className="mb-5 flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setViewMode("calendar")}
            className={`rounded-lg px-3 py-2 text-sm font-semibold transition-colors ${viewMode === "calendar" ? "bg-teal-600 text-white" : "border border-slate-600 text-slate-200 hover:bg-slate-800"}`}
          >
            Calendar
          </button>
          <button
            type="button"
            onClick={() => setViewMode("list")}
            className={`rounded-lg px-3 py-2 text-sm font-semibold transition-colors ${viewMode === "list" ? "bg-teal-600 text-white" : "border border-slate-600 text-slate-200 hover:bg-slate-800"}`}
          >
            List
          </button>
        </div>

        <div className="flex items-center gap-2">
          {!readOnly && (
            <button
              type="button"
              onClick={() => openAddModal()}
              className="inline-flex items-center gap-2 rounded-lg bg-teal-600 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-teal-500"
            >
              <Plus className="h-4 w-4" aria-hidden="true" />
              Add Training
            </button>
          )}
          <select
            value={filterStatus}
            onChange={(e) => setFilterStatus(e.target.value as FilterStatus)}
            className="rounded-lg border border-slate-600 bg-slate-950 px-3 py-2 text-sm text-slate-100"
          >
            <option value="all">All Statuses</option>
            <option value="scheduled">Scheduled</option>
            <option value="completed">Completed</option>
            <option value="overdue">Overdue</option>
          </select>
          <input
            type="search"
            placeholder="Search..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="rounded-lg border border-slate-600 bg-slate-950 px-3 py-2 text-sm text-slate-100 placeholder:text-slate-500 w-40"
          />
        </div>
      </div>

      {loading ? (
        <p className="text-slate-300">Loading training events...</p>
      ) : viewMode === "calendar" ? (
        <CalendarView
          currentMonth={currentMonth}
          setCurrentMonth={setCurrentMonth}
          events={events}
          filterStatus={filterStatus}
          STATUS_CONFIG={statusConfig}
          readOnly={readOnly}
          openEditModal={readOnly ? undefined : openEditModal}
        />
      ) : (
        <ListView
          events={filteredEvents}
          employees={employees}
          getEmployeeName={getEmployeeName}
          STATUS_CONFIG={statusConfig}
          readOnly={readOnly}
          openEditModal={readOnly ? undefined : openEditModal}
        />
      )}

      {!readOnly && showEditModal && editingEvent && (
        <EventEditModal
          event={editingEvent}
          employees={employees}
          onSave={saveEvent}
          onClose={closeEditModal}
          STATUS_CONFIG={STATUS_CONFIG}
        />
      )}
      {!readOnly && addModalOpen && (
        <AddTrainingModal
          employees={employees}
          onSave={saveEvent}
          onClose={closeAddModal}
          STATUS_CONFIG={STATUS_CONFIG}
        />
      )}
    </section>
  );
}
function CalendarView({
  currentMonth,
  setCurrentMonth,
  events,
  filterStatus,
  STATUS_CONFIG,
  readOnly,
  openEditModal
}: {
  currentMonth: Date;
  setCurrentMonth: (d: Date) => void;
  events: TrainingCalendarEvent[];
  filterStatus: FilterStatus;
  STATUS_CONFIG: any;
  readOnly: boolean;
  openEditModal?: (event: TrainingCalendarEvent) => void;
}) {
  const firstDay = new Date(currentMonth.getFullYear(), currentMonth.getMonth(), 1);
  const lastDay = new Date(currentMonth.getFullYear(), currentMonth.getMonth() + 1, 0);
  const startDate = new Date(firstDay);
  startDate.setDate(startDate.getDate() - startDate.getDay());
  const days: Date[] = [];
  const cursor = new Date(startDate);
  while (cursor <= lastDay || days.length < 35) {
    days.push(new Date(cursor));
    cursor.setDate(cursor.getDate() + 1);
    if (days.length >= 42) break;
  }

  const eventsByDate = useMemo(() => {
    const map = new Map<string, TrainingCalendarEvent[]>();
    events.forEach((ev) => {
      if (filterStatus !== "all" && ev.status !== filterStatus) return;
      const key = new Date(ev.scheduled_date).toDateString();
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(ev);
    });
    return map;
  }, [events, filterStatus]);

  const monthNames = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
  const weekDays = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

  return (
    <div>
      <div className="mb-3 flex items-center justify-between">
        <button type="button" onClick={() => setCurrentMonth(new Date(currentMonth.getFullYear(), currentMonth.getMonth() - 1, 1))} className="rounded-lg border border-slate-600 p-2 text-slate-200 hover:bg-slate-800">
          <ChevronLeft className="h-4 w-4" />
        </button>
        <h3 className="text-lg font-bold">{monthNames[currentMonth.getMonth()]} {currentMonth.getFullYear()}</h3>
        <button type="button" onClick={() => setCurrentMonth(new Date(currentMonth.getFullYear(), currentMonth.getMonth() + 1, 1))} className="rounded-lg border border-slate-600 p-2 text-slate-200 hover:bg-slate-800">
          <ChevronRight className="h-4 w-4" />
        </button>
      </div>
      <div className="grid grid-cols-7 gap-1 text-center text-xs font-bold text-slate-400 mb-1">
        {weekDays.map((d) => <div key={d}>{d}</div>)}
      </div>
      <div className="grid grid-cols-7 gap-1">
        {days.map((day, idx) => {
          const isCurrentMonth = day.getMonth() === currentMonth.getMonth();
          const dayEvents = eventsByDate.get(day.toDateString()) || [];
          return (
            <div
              key={idx}
              className={`min-h-[90px] rounded-lg border p-1 text-xs ${isCurrentMonth ? "border-slate-700 bg-slate-950" : "border-slate-800 bg-slate-900/50 text-slate-500"}`}
            >
              <div className="mb-1 font-semibold">{day.getDate()}</div>
              <div className="space-y-1">
                {dayEvents.map((ev) => {
                  const cfg = STATUS_CONFIG[ev.status] || STATUS_CONFIG.scheduled;
                  const Icon = cfg.icon;
                  return (
                    <button
                      key={ev.id}
                      type="button"
                      onClick={() => openEditModal?.(ev)}
                      className={`w-full rounded px-1 py-0.5 text-left text-[10px] font-semibold ${cfg.bg} ${cfg.color} border ${cfg.border} ${readOnly ? "cursor-default" : "hover:opacity-80"}`}
                    >
                      <Icon className="inline h-3 w-3 mr-1" />
                      {ev.title}
                    </button>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
function ListView({
  events,
  employees,
  getEmployeeName,
  STATUS_CONFIG,
  readOnly,
  openEditModal
}: {
  events: TrainingCalendarEvent[];
  employees: TrainingCalendarEmployee[];
  getEmployeeName: (id: string | null) => string;
  STATUS_CONFIG: any;
  readOnly: boolean;
  openEditModal?: (event: TrainingCalendarEvent) => void;
}) {
  if (readOnly && events.length === 0) {
    return <p className="text-slate-300">No training sessions scheduled for you.</p>;
  }
  if (events.length === 0) {
    return <p className="text-slate-300">No training events found.</p>;
  }
  return (
    <div className="space-y-3">
      {events.map((ev) => {
        const cfg = STATUS_CONFIG[ev.status] || STATUS_CONFIG.scheduled;
        const Icon = cfg.icon;
        return (
          <div key={ev.id} className="rounded-xl border border-slate-700 bg-slate-950 p-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h4 className="text-lg font-bold text-white">{ev.title}</h4>
                <p className="text-sm text-slate-300">{ev.topic}</p>
                <div className="mt-2 flex flex-wrap gap-4 text-xs text-slate-300">
                  <span>{new Date(ev.scheduled_date).toLocaleDateString()}</span>
                  {(ev.start_time || ev.end_time) && (
                    <span>{ev.start_time || "--:--"}{ev.end_time ? ` - ${ev.end_time}` : ""}</span>
                  )}
                  <span>Trainer: {ev.trainer || "TBC"}</span>
                  <span>Attendee: {getEmployeeName(ev.employee_id)}</span>
                  {ev.notes?.trim() && <span>Meeting details: {ev.notes}</span>}
                </div>
              </div>
              <div className="flex items-center gap-2">
                <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-1 text-xs font-semibold ${cfg.bg} ${cfg.color} ${cfg.border}`}>
                  <Icon className="h-3 w-3" />
                  {cfg.label}
                </span>
                {!readOnly && openEditModal && (
                  <button
                    type="button"
                    onClick={() => openEditModal(ev)}
                    className="rounded-lg border border-slate-600 p-2 text-slate-200 hover:bg-slate-800"
                  >
                    <Edit className="h-4 w-4" />
                  </button>
                )}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
function EventEditModal({
  event,
  employees,
  onSave,
  onClose,
  STATUS_CONFIG
}: {
  event: TrainingCalendarEvent;
  employees: TrainingCalendarEmployee[];
  onSave: (eventData: Partial<TrainingCalendarEvent>) => void;
  onClose: () => void;
  STATUS_CONFIG: Record<string, { label: string; icon: any; color: string; bg: string; border: string }>;
}) {
  const [editedEvent, setEditedEvent] = useState({
    ...event,
    notes: event.notes || ""
  });

  const handleSubmit = () => {
    onSave(editedEvent);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
      <div className="rounded-xl border border-slate-700 bg-slate-900 p-6 w-full max-w-2xl max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-xl font-bold text-white">Edit Training Event</h3>
          <button onClick={onClose} className="text-slate-400 hover:text-white">
            <XCircle className="h-6 w-6" />
          </button>
        </div>
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-semibold text-slate-200 mb-1">Title</label>
            <input
              type="text"
              value={editedEvent.title}
              onChange={(e) => setEditedEvent({ ...editedEvent, title: e.target.value })}
              className="w-full rounded-lg border border-slate-600 bg-slate-950 px-3 py-2 text-sm text-slate-100"
            />
          </div>
          <div>
            <label className="block text-sm font-semibold text-slate-200 mb-1">Topic / Training</label>
            <input
              type="text"
              value={editedEvent.topic}
              onChange={(e) => setEditedEvent({ ...editedEvent, topic: e.target.value })}
              className="w-full rounded-lg border border-slate-600 bg-slate-950 px-3 py-2 text-sm text-slate-100"
            />
          </div>
          <div>
            <label className="block text-sm font-semibold text-slate-200 mb-1">Trainer</label>
            <input
              type="text"
              value={editedEvent.trainer}
              onChange={(e) => setEditedEvent({ ...editedEvent, trainer: e.target.value })}
              className="w-full rounded-lg border border-slate-600 bg-slate-950 px-3 py-2 text-sm text-slate-100"
            />
          </div>
          <div>
            <label className="block text-sm font-semibold text-slate-200 mb-1">Employee</label>
            <select
              value={editedEvent.employee_id ?? ""}
              onChange={(e) => setEditedEvent({ ...editedEvent, employee_id: e.target.value || null })}
              className="w-full rounded-lg border border-slate-600 bg-slate-950 px-3 py-2 text-sm text-slate-100"
            >
              <option value="">Select employee</option>
              <option value="all">All Employees</option>
              {employees.map(emp => (
                <option key={emp.id} value={emp.id}>
                  {emp.full_name} ({emp.email})
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-sm font-semibold text-slate-200 mb-1">Scheduled Date</label>
            <input
              type="datetime-local"
              value={editedEvent.scheduled_date.slice(0, 16)}
              onChange={(e) => setEditedEvent({ ...editedEvent, scheduled_date: e.target.value })}
              className="w-full rounded-lg border border-slate-600 bg-slate-950 px-3 py-2 text-sm text-slate-100"
            />
          </div>
          <div>
            <label className="block text-sm font-semibold text-slate-200 mb-1">Refresher Due Date (optional)</label>
            <input
              type="date"
              value={editedEvent.refresher_due_date?.slice(0, 10) || ""}
              onChange={(e) => setEditedEvent({ ...editedEvent, refresher_due_date: e.target.value || null })}
              className="w-full rounded-lg border border-slate-600 bg-slate-950 px-3 py-2 text-sm text-slate-100"
            />
          </div>
          <div>
            <label className="block text-sm font-semibold text-slate-200 mb-1">Status</label>
            <select
              value={editedEvent.status}
              onChange={(e) => setEditedEvent({ ...editedEvent, status: e.target.value as any })}
              className="w-full rounded-lg border border-slate-600 bg-slate-950 px-3 py-2 text-sm text-slate-100"
            >
              {Object.entries(STATUS_CONFIG).map(([key, config]) => {
                const Icon = config.icon;
                return (
                  <option key={key} value={key}>
                    <span className="flex items-center gap-1">
                      <Icon className="h-4 w-4" />
                      {config.label}
                    </span>
                  </option>
                );
              })}
            </select>
          </div>
          <div>
            <label className="block text-sm font-semibold text-slate-200 mb-1">Notes</label>
            <textarea
              value={editedEvent.notes}
              onChange={(e) => setEditedEvent({ ...editedEvent, notes: e.target.value })}
              rows={3}
              className="w-full rounded-lg border border-slate-600 bg-slate-950 px-3 py-2 text-sm text-slate-100 resize-none"
            />
          </div>
        </div>
        <div className="mt-6 flex justify-end gap-3">
          <button
            onClick={onClose}
            className="rounded-lg border border-slate-600 px-4 py-2 text-sm font-semibold text-slate-200 hover:bg-slate-800"
          >
            Cancel
          </button>
          <button
            onClick={handleSubmit}
            className="rounded-lg bg-teal-600 px-4 py-2 text-sm font-semibold text-white hover:bg-teal-500"
          >
            Save Changes
          </button>
        </div>
      </div>
    </div>
  );
}

function AddTrainingModal({
  employees,
  onSave,
  onClose,
  STATUS_CONFIG,
}: {
  employees: TrainingCalendarEmployee[];
  onSave: (event: Partial<TrainingCalendarEvent>) => void;
  onClose: () => void;
  STATUS_CONFIG: Record<string, { label: string; icon: any; color: string; bg: string; border: string }>;
}) {
  const [newEvent, setNewEvent] = useState<Partial<TrainingCalendarEvent>>({
    title: "",
    topic: "",
    trainer: "",
    employee_id: "",
    scheduled_date: "",
    refresher_due_date: null,
    status: "scheduled",
    notes: ""
  });

  const handleSubmit = () => {
    onSave(newEvent);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
      <div className="rounded-xl border border-slate-700 bg-slate-900 p-6 w-full max-w-2xl max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-xl font-bold text-white">Add Training Event</h3>
          <button onClick={onClose} className="text-slate-400 hover:text-white">
            <XCircle className="h-6 w-6" />
          </button>
        </div>
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-semibold text-slate-200 mb-1">Title</label>
            <input
              type="text"
              value={newEvent.title}
              onChange={(e) => setNewEvent({ ...newEvent, title: e.target.value })}
              className="w-full rounded-lg border border-slate-600 bg-slate-950 px-3 py-2 text-sm text-slate-100"
            />
          </div>
          <div>
            <label className="block text-sm font-semibold text-slate-200 mb-1">Topic / Training</label>
            <input
              type="text"
              value={newEvent.topic}
              onChange={(e) => setNewEvent({ ...newEvent, topic: e.target.value })}
              className="w-full rounded-lg border border-slate-600 bg-slate-950 px-3 py-2 text-sm text-slate-100"
            />
          </div>
          <div>
            <label className="block text-sm font-semibold text-slate-200 mb-1">Trainer</label>
            <input
              type="text"
              value={newEvent.trainer}
              onChange={(e) => setNewEvent({ ...newEvent, trainer: e.target.value })}
              className="w-full rounded-lg border border-slate-600 bg-slate-950 px-3 py-2 text-sm text-slate-100"
            />
          </div>
          <div>
            <label className="block text-sm font-semibold text-slate-200 mb-1">Employee</label>
            <select
              value={newEvent.employee_id ?? ""}
              onChange={(e) => setNewEvent({ ...newEvent, employee_id: e.target.value || null })}
              className="w-full rounded-lg border border-slate-600 bg-slate-950 px-3 py-2 text-sm text-slate-100"
            >
              <option value="">All Employees</option>
              <option value="all">All Employees</option>
              {employees.map(emp => (
                <option key={emp.id} value={emp.id}>
                  {emp.full_name} ({emp.email})
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-sm font-semibold text-slate-200 mb-1">Scheduled Date</label>
            <input
              type="datetime-local"
              value={newEvent.scheduled_date}
              onChange={(e) => setNewEvent({ ...newEvent, scheduled_date: e.target.value })}
              className="w-full rounded-lg border border-slate-600 bg-slate-950 px-3 py-2 text-sm text-slate-100"
            />
          </div>
          <div>
            <label className="block text-sm font-semibold text-slate-200 mb-1">Refresher Due Date (optional)</label>
            <input
              type="date"
              value={newEvent.refresher_due_date || ""}
              onChange={(e) => setNewEvent({ ...newEvent, refresher_due_date: e.target.value || null })}
              className="w-full rounded-lg border border-slate-600 bg-slate-950 px-3 py-2 text-sm text-slate-100"
            />
          </div>
          <div>
            <label className="block text-sm font-semibold text-slate-200 mb-1">Status</label>
            <select
              value={newEvent.status}
              onChange={(e) => setNewEvent({ ...newEvent, status: e.target.value as any })}
              className="w-full rounded-lg border border-slate-600 bg-slate-950 px-3 py-2 text-sm text-slate-100"
            >
              {Object.entries(STATUS_CONFIG).map(([key, config]) => {
                const Icon = config.icon;
                return (
                  <option key={key} value={key}>
                    <span className="flex items-center gap-1">
                      <Icon className="h-4 w-4" />
                      {config.label}
                    </span>
                  </option>
                );
              })}
            </select>
          </div>
          <div>
            <label className="block text-sm font-semibold text-slate-200 mb-1">Notes</label>
            <textarea
              value={newEvent.notes}
              onChange={(e) => setNewEvent({ ...newEvent, notes: e.target.value })}
              rows={3}
              className="w-full rounded-lg border border-slate-600 bg-slate-950 px-3 py-2 text-sm text-slate-100 resize-none"
            />
          </div>
        </div>
        <div className="mt-6 flex justify-end gap-3">
          <button
            onClick={onClose}
            className="rounded-lg border border-slate-600 px-4 py-2 text-sm font-semibold text-slate-200 hover:bg-slate-800"
          >
            Cancel
          </button>
          <button
            onClick={handleSubmit}
            className="rounded-lg bg-teal-600 px-4 py-2 text-sm font-semibold text-white hover:bg-teal-500"
          >
            Add Training
          </button>
        </div>
      </div>
    </div>
  );
}
