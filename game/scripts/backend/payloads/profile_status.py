import json, os, sys

sys.path.insert(0, '/app/shared/skills')
try:
    import profile_review
except Exception:
    profile_review = None
prof = {}
try:
    import yaml
    prof = yaml.safe_load(open('/jht_home/profile/candidate_profile.yml')) or {}
except Exception:
    pass
def s(v):
    return str(v).strip() if v is not None else ''
skills = prof.get('skills') or {}
skill_list = []
if isinstance(skills, dict):
    for v in skills.values():
        if isinstance(v, list):
            skill_list += [s(x) for x in v if s(x)]
elif isinstance(skills, list):
    skill_list = [s(x) for x in skills if s(x)]
def lang_str(x):
    if isinstance(x, dict):
        return ' '.join(s(v) for v in x.values() if s(v))
    return s(x)
langs = prof.get('languages') or []
if not isinstance(langs, list):
    langs = [langs]
langs = [lang_str(x) for x in langs if lang_str(x)]
pos = prof.get('positioning') or {}
contacts = pos.get('contacts') or {}
email = s(prof.get('email')) or s(contacts.get('email'))
seniority = s(prof.get('seniority_target')) or s(pos.get('seniority_target'))
required = dict(
    name=s(prof.get('name')) != '',
    email=email != '',
    target_role=s(prof.get('target_role')) != '',
    location=s(prof.get('location')) != '',
    experience_years=prof.get('experience_years') is not None,
    seniority_target=seniority != '',
    skills=len(skill_list) >= 2,
    languages=len(langs) >= 1,
)
ready = os.path.exists('/jht_home/profile/ready.flag') or all(required.values())
view = dict(
    name=s(prof.get('name')), email=email,
    target_role=s(prof.get('target_role')), location=s(prof.get('location')),
    experience_years=s(prof.get('experience_years')),
    seniority_target=seniority, skills=skill_list[:12], languages=langs[:8],
)
review = None
review_error = ''
if profile_review is not None:
    try:
        review = profile_review.status()
    except Exception:
        # A malformed or unreadable review must never become a confirmable UI
        # action.  Keep the persisted badge available and fail the review lane
        # closed with a finite, non-sensitive error.
        review_error = 'review_unavailable'
else:
    review_error = 'review_helper_unavailable'
print(json.dumps(dict(profile=view, required=required, ready=ready,
                       review=review, review_error=review_error),
                 ensure_ascii=False))
