import { createClient } from '@supabase/supabase-js';
const url = 'https://wbrculvtacfkjzqhhoue.supabase.co';
const serviceKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6IndicmN1bHZ0YWNma2p6cWhob3VlIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc4NDY1MDg0OCwiZXhwIjoyMTAwMjI2ODQ4fQ.EkMtjAbpdPVrlrR5n0Py-5x-sD36WN2UDOMGheUQpR0';
const supabase = createClient(url, serviceKey);

const { data: rows, error } = await supabase.from('cor_form_submissions').select('*').eq('form_code', 'LURC_CHECKLIST').order('submitted_at', { ascending: false });
console.log('LURC rows', rows?.length, error?.message);
for (const r of rows || []) console.log(JSON.stringify({ id: r.id, user_id: r.user_id, status: r.status, submitted_at: r.submitted_at, reviewed_at: r.reviewed_at, reviewed_by: r.reviewed_by, review_notes: r.review_notes, company_id: r.company_id, payload_keys: Object.keys(r.payload || {}) }));

const { data: profiles } = await supabase.from('profiles').select('id,email,full_name,role').limit(50);
console.log('profiles count', profiles?.length);
for (const p of profiles || []) if (p.role === 'driver') console.log('DRIVER', p.id, p.email, p.full_name);

const { data: cp } = await supabase.from('contractor_profiles').select('*').limit(50);
console.log('contractor_profiles count', cp?.length);
