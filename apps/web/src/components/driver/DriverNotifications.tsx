import { useEffect, useState } from "react";
import { api } from "../../lib/api";
import { SessionState } from "../../types";

export function DriverNotifications({ session, module }: { session: SessionState; module?: string }) {
  const [messages, setMessages] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [replyText, setReplyText] = useState<Record<string, string>>({});

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await api.getDriverMessages(session, module);
      setMessages(Array.isArray(data) ? data : []);
    } catch (e: any) {
      setError(e?.message ?? "Unable to load notifications.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void load(); }, [session]);

  const markRead = async (id: string) => {
    try {
      await api.markDriverMessageRead(session, id);
      setMessages((prev) => prev.map((m) => (m.id === id ? { ...m, status: "Read" } : m)));
    } catch (e: any) {
      setError(e?.message ?? "Unable to mark as read.");
    }
  };

  const reply = async (id: string) => {
    const content = replyText[id]?.trim();
    if (!content) return;
    try {
      await api.replyDriverMessage(session, id, content);
      setReplyText((prev) => ({ ...prev, [id]: "" }));
      await load();
    } catch (e: any) {
      setError(e?.message ?? "Unable to reply.");
    }
  };

  if (loading) return <p className="text-sm text-slate-400">Loading notifications…</p>;

  return (
    <div className="space-y-3">
      {error && <p className="text-sm text-red-400">{error}</p>}
      {messages.length === 0 && <p className="text-sm text-slate-400">No notifications.</p>}
      {messages.map((m) => (
        <div key={m.id} className="rounded-xl border border-slate-700 bg-slate-800/50 p-4">
          <div className="flex items-center justify-between gap-2">
            <p className="text-sm font-semibold text-white">{m.subject ?? "Feedback"}</p>
            <span className={`rounded-full px-2 py-0.5 text-xs font-bold ${m.status === "Unread" ? "bg-amber-500/20 text-amber-300" : "bg-slate-600 text-slate-200"}`}>{m.status}</span>
          </div>
          <p className="mt-1 text-xs text-slate-400">{m.message_type} · {new Date(m.created_at).toLocaleString()}</p>
          <p className="mt-2 text-sm text-slate-200 whitespace-pre-wrap">{m.message}</p>
          {m.status === "Unread" && (
            <button type="button" onClick={() => void markRead(m.id)} className="mt-2 rounded-lg bg-slate-700 px-3 py-1.5 text-xs font-semibold text-white hover:bg-slate-600">Mark as Read</button>
          )}
          <div className="mt-3">
            <textarea
              value={replyText[m.id] ?? ""}
              onChange={(e) => setReplyText((prev) => ({ ...prev, [m.id]: e.target.value }))}
              placeholder="Reply..."
              className="w-full rounded-lg border border-slate-600 bg-slate-900 px-3 py-2 text-sm text-white"
              rows={2}
            />
            <button type="button" onClick={() => void reply(m.id)} className="mt-2 rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-emerald-500">Send Reply</button>
          </div>
        </div>
      ))}
    </div>
  );
}