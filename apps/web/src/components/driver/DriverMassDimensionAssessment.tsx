import { useEffect, useState } from "react";
import { ClipboardCheck, Loader2, Send } from "lucide-react";
import { supabase } from "../../lib/supabase";
import { SessionState } from "../../types";

const QUESTIONS = [
  { q: "Which of the following are mass limit allowance schemes?", options: ["General Mass Limits","Concessional Mass Limits","Higher Mass Limits","Mass limits allowed under PBS","Mass limits allowed under a gazette or notice","Livestock Loading Scheme","Grain Harvest Management Scheme","All of the above"] },
  { q: "How can you typically gain access to CML and HML weights?", options: ["The weights are allowed for any heavy vehicle operator as long as the combination's GCM is not exceeded.","You need to obtain Mass Management Accreditation and Road Friendly Suspension (RFS) for HML, with some states having additional restrictions such as TMA.","Only Road Friendly Suspension (RFS) needs to be fitted."] },
  { q: "Name one requirement (out of the four listed in the official source) for a vehicle to be eligible for the 0.5-tonne steer exemption.", options: [] as string[] },
  { q: "What is the typical maximum mass limit of a B-Double operating under Mass Management Accreditation, excluding the 7.1-tonne steer allowance?", options: ["62.5 (63.0) tonnes","70.0 (70.5) tonnes","68.0 (68.5) tonnes"] },
  { q: "How often should a calibration be undertaken on a weighing method?", options: ["Every 3 months or 6 months","Not at all","Only if you have Mass Management Accreditation"] },
  { q: "True or False: PBS stands for Performance Based Standards.", options: ["True","False"] },
  { q: "Generally, the maximum width allowed is:", options: ["2.5 metres (2.55 metres for new prime movers)","2.6 metres","3.0 metres"] },
  { q: "The height limit for a truck is 4.3 metres unless it is a vehicle built to carry cattle, horses, pigs or sheep, or a vehicle built with at least two decks for carrying vehicles.", options: ["True","False"] },
  { q: "What is the general maximum length for a road train?", options: [] as string[] },
  { q: "A large indivisible item is an item that:", options: ["Cannot be divided without extreme effort, expense or risk of damage.","Cannot be carried on any heavy vehicle without contravening a mass or dimension requirement.","All of the above."] }
];

export function DriverMassDimensionAssessment({ session }: { session: SessionState }) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [answers, setAnswers] = useState<Record<number, string>>({});
  const [profile, setProfile] = useState<any | null>(null);

  useEffect(() => {
    (async () => {
      setLoading(true);
      try {
        const { data, error: err } = await supabase.from("profiles").select("id, full_name, email").eq("id", session.user.id).maybeSingle();
        if (err) throw err;
        setProfile(data || null);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Unable to load profile.");
      } finally {
        setLoading(false);
      }
    })();
  }, [session.user.id]);

  const allAnswered = QUESTIONS.every((_, idx) => (answers[idx] || "").trim() !== "");

  const submit = async () => {
    if (!allAnswered) {
      setError("All 10 questions must be answered.");
      return;
    }
    setSubmitting(true);
    setError("");
    setSuccess("");
    try {
      const now = new Date().toISOString();
      const { error: err } = await supabase.from("cor_form_submissions").insert({
        user_id: session.user.id,
        form_code: "MDASSESS",
        form_title: "Mass and Dimension Awareness Assessment (Driver)",
        payload: {
          candidate_name: profile?.full_name || profile?.email || session.user.id,
          candidate_user_id: session.user.id,
          assessment_date: now.slice(0, 10),
          method: "Written",
          answers: QUESTIONS.map((q, idx) => ({ question: q.q, answer: answers[idx] })),
          outcome: "Pending Review",
          assessor_name: "",
          assessor_signature: "",
          completion_date: now.slice(0, 10),
          notes: "Driver self-submission; official grading pending confirmation of missing details."
        },
        status: "Submitted",
        submitted_at: now
      });
      if (err) throw err;
      setSuccess("Assessment submitted for review.");
      setAnswers({});
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unable to submit assessment.");
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return <p role="status" className="text-sm text-slate-300">Loading assessment...</p>;
  }
  return (
    <div className="space-y-4">
      {error && (
        <div className="rounded-xl border border-red-500/40 bg-red-500/10 px-4 py-3 text-sm text-red-200">
          {error}
        </div>
      )}
      {success && (
        <div className="rounded-xl border border-emerald-500/40 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-200">
          {success}
        </div>
      )}

      <div className="rounded-xl border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-sm text-amber-200">
        Note: Official grading is disabled until the missing requirements for Question 3 and the official answer for Question 9 are confirmed. Your submission will be reviewed by an assessor.
      </div>

      <div className="space-y-4">
        {QUESTIONS.map((q, idx) => (
          <div key={idx} className="rounded-xl border border-slate-700 bg-slate-800/50 p-4 space-y-2">
            <p className="text-sm font-semibold text-white">{q.q}</p>
            {q.options.length === 0 ? (
              <textarea
                value={answers[idx] || ""}
                onChange={(e) => setAnswers((prev) => ({ ...prev, [idx]: e.target.value }))}
                rows={2}
                className="mt-2 block w-full rounded-lg border border-slate-600 bg-slate-900 px-3 py-2 text-sm text-white"
                placeholder="Enter your answer"
              />
            ) : (
              <div className="space-y-1">
                {q.options.map((opt, oi) => (
                  <label key={oi} className="flex items-center gap-2 text-sm text-slate-200">
                    <input
                      type="radio"
                      name={`q-${idx}`}
                      checked={answers[idx] === opt}
                      onChange={() => setAnswers((prev) => ({ ...prev, [idx]: opt }))}
                    />
                    {opt}
                  </label>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>

      <button
        type="button"
        onClick={() => void submit()}
        disabled={submitting || !allAnswered}
        className="inline-flex items-center gap-2 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-500 disabled:opacity-60"
      >
        {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />} Submit Assessment
      </button>
    </div>
  );
}