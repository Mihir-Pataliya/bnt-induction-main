p='apps/web/src/components/driver/DriverNcrIncidentReport.tsx'
lines=open(p,encoding='utf-8').read().splitlines()
start=None
for i,l in enumerate(lines):
    if l.strip()=='if (loading) {':
        start=i; break
replacement=[
'          submitted_at: submit ? now : null',
'        });',
'        if (err) throw err;',
'      }',
'      setSuccess(submit ? "Report submitted. Your report number is " + form.report_number + "." : "Draft saved.");',
'      setShowForm(false);',
'      setEditing(null);',
'      await load();',
'    } catch (e) {',
'      setError(e instanceof Error ? e.message : "Unable to save report.");',
'    } finally {',
'      setSaving(false);',
'    }',
'  };',
'',
'  if (loading) {',
'    return <p role="status" className="text-sm text-slate-300">Loading your incident reports...</p>;',
'  }'
]
lines=lines[:start]+replacement+lines[start+3:]
open(p,'w',encoding='utf-8').write('\n'.join(lines))
print('done')