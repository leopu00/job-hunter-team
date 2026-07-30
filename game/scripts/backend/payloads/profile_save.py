import json, base64, shutil, time, yaml
data = json.loads(base64.b64decode('%s').decode('utf-8'))
path = '/jht_home/profile/candidate_profile.yml'
try:
    prof = yaml.safe_load(open(path)) or {}
except Exception:
    prof = {}
try:
    shutil.copy2(path, path + '.bak-' + time.strftime('%%Y%%m%%dT%%H%%M%%S'))
except Exception:
    pass
for key in ['name', 'email', 'target_role', 'location', 'experience_years',
            'seniority_target', 'industry', 'nationality', 'work_mode',
            'runtime_location', 'career_priority', 'search_style',
            'mentor_cadence']:
    if key in data and str(data[key]).strip() != '':
        v = str(data[key]).strip()
        # i numerici restano numeri nel yml (experience_years: 1, non '1')
        try:
            v = int(v)
        except ValueError:
            try:
                v = float(v)
            except ValueError:
                pass
        prof[key] = v
if 'skills_primary' in data:
    skills = [s.strip() for s in str(data['skills_primary']).split(',') if s.strip()]
    prof.setdefault('skills', {})['primary'] = skills
if 'languages' in data:
    prof['languages'] = [s.strip() for s in str(data['languages']).split(',') if s.strip()]
if data.get('salary_min') or data.get('salary_max'):
    sal_key = 'salary_target' if 'salary_target' in prof or 'salary' not in prof else 'salary'
    sal = prof.get(sal_key) if isinstance(prof.get(sal_key), dict) else {}
    lo_key = 'lo' if 'lo' in sal else 'min'
    hi_key = 'hi' if 'hi' in sal else 'max'
    if data.get('salary_min'):
        sal[lo_key] = int(float(data['salary_min']))
    if data.get('salary_max'):
        sal[hi_key] = int(float(data['salary_max']))
    sal['currency'] = str(data.get('salary_currency', sal.get('currency', 'EUR')))
    prof[sal_key] = sal
yaml.safe_dump(prof, open(path, 'w'), allow_unicode=True, sort_keys=False)
print(json.dumps(dict(ok=True)))
