import json, base64, re, shutil, time, yaml
data = json.loads(base64.b64decode('%s').decode('utf-8'))
TARGET_ROLE_SPECIALTIES = {
    'software': {'backend', 'frontend', 'fullstack', 'platform', 'embedded', 'open'},
    'data': {'data_science', 'ml', 'genai', 'data_engineering', 'research', 'open'},
    'product': {'product', 'project', 'technical_pm', 'delivery', 'founder'},
    'design': {'specialist', 'generalist', 'leadership', 'individual', 'explore'},
    'business': {'specialist', 'generalist', 'leadership', 'individual', 'explore'},
    'security': {'specialist', 'generalist', 'leadership', 'individual', 'explore'},
    'other': {'specialist', 'generalist', 'leadership', 'individual', 'explore'},
}
category = data.get('target_role_category_id')
specialty = data.get('target_specialty')
if category is not None:
    category = str(category).strip()
    if category not in TARGET_ROLE_SPECIALTIES:
        print(json.dumps(dict(ok=False, error='invalid target role category')))
        raise SystemExit(2)
    if specialty is not None:
        specialty = str(specialty).strip()
        if specialty not in TARGET_ROLE_SPECIALTIES[category]:
            print(json.dumps(dict(ok=False, error='invalid target role specialty')))
            raise SystemExit(2)
else:
    # Stato wizard legacy: prima questo campo non entrava nel profilo. Senza
    # categoria non gli inventiamo ora un significato o una migrazione.
    specialty = None
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
if category is not None:
    prof['target_role_category_id'] = category
    if specialty is not None:
        prof['target_specialty'] = specialty
if 'skills_primary' in data:
    skills = [s.strip() for s in str(data['skills_primary']).split(',') if s.strip()]
    prof.setdefault('skills', {})['primary'] = skills
if 'languages' in data:
    # La UI presenta gli oggetti YAML in forma umana e reversibile:
    # "Italiano (madrelingua), Inglese (C1)". Prima riceveva invece la
    # repr dei dict e la spezzava sulle virgole, corrompendo il profilo anche
    # con un semplice Salva senza modifiche.
    existing = prof.get('languages') if isinstance(prof.get('languages'), list) else []
    existing_by_name = {
        str(item.get('language', item.get('name', ''))).strip().casefold(): item
        for item in existing if isinstance(item, dict)
    }
    languages = []
    for raw in str(data['languages']).split(','):
        value = raw.strip()
        if not value:
            continue
        match = re.fullmatch(r'(.+?)\s*\(([^()]*)\)\s*', value)
        if match:
            languages.append({'language': match.group(1).strip(),
                              'level': match.group(2).strip()})
            continue
        previous = existing_by_name.get(value.casefold())
        languages.append(dict(previous) if previous is not None else value)
    prof['languages'] = languages
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
