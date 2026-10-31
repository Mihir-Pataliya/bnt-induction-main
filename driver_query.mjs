import { createClient } from 'c:/Users/Dell/Downloads/bnt-induction-main/bnt-induction-main/node_modules/@supabase/supabase-js/dist/index.mjs';
const url='https://wbrculvtacfkjzqhhoue.supabase.co';
const anon='eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6IndicmN1bHZ0YWNma2p6cWhob3VlIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODQ2NTA4NDgsImV4cCI6MjEwMDIyNjg0OH0.vxmD4mpvPaG0IhlS7i8FisLXRy6CZdq48ur_4Fr8KN4';
const supabase=createClient(url,anon);
const {data:auth,error:authErr}=await supabase.auth.signInWithPassword({email:'driver@bntlogistics.com.au',password:'Driver@2001'});
console.log('auth', auth?.user?.id, authErr?.message);
const {data,error}=await supabase.from('cor_form_submissions').select('id,user_id,form_code,payload').eq('form_code','F-10');
console.log('rows', data?.length, error?.message);
(data||[]).forEach(r=>console.log(r.id,'user_id='+r.user_id,'source='+(r.payload?.source),'driverId='+(r.payload?.driverId),'month='+(r.payload?.month),'year='+(r.payload?.year)));
