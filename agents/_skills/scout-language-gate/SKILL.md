---
name: scout-language-gate
description: "Choose countries and queries from the profile's languages, and drop a candidate whose ad needs a language the user does not speak BEFORE you fetch the full ad. Run `plan` once, and `screen` on each candidate from its title and snippet. Real run: 100 of 100 candidates of one portal were dropped for language after the full fetch."
allowed-tools: Bash(python3 /app/shared/skills/scout_language.py *)
---

# scout-language-gate — languages first, fetch later

Language is the cut that most often kills a candidate AFTER the search, the fetch of the full ad and sometimes the INSERT were already paid for. This skill applies it in code, before the fetch, from what the list already shows. It never invents: it drops only on evidence, and a language the profile speaks, an English ad or a text too short to say are never dropped.

## 1. Plan the search

`plan` gives each country a mode. `local`: the profile speaks a working language there. `english_friendly`: roles in English are common and the profile speaks English: search it, adding the qualifiers it prints (`English-speaking`, `international team`, `English required`). `english_only`: only ads in English are worth opening. Nothing is excluded (priority yes, exclusion no, SC-04): start from the `order` it prints and do not spend the first passes on `english_only` countries.

## 2. Screen each candidate before the fetch

Give `screen` the title and, if the source shows one, the snippet. `skip_language` (exit 10): do not fetch it; with `--log` it already leaves its line in the pass log (outcome `language`, not opened). `ok` or `unknown`: go on to the gates as usual. It reads only the list's text: after the full fetch the ad is checked by the Gate 4 filters and by the Analista as before.

```bash
# once, before choosing countries and queries: the plan for THIS profile's languages
python3 /app/shared/skills/scout_language.py plan

# for each candidate, from what the LIST shows, BEFORE you fetch the full ad (exit 10 = drop it)
python3 /app/shared/skills/scout_language.py screen --title "<title>" --snippet "<the list's snippet, if any>" \
    --country nl --source greenhouse --log
```

## Rules

- Never skip a candidate that `screen` did not drop because you guess its language: the tool drops on evidence, you do not.
- Pass the text as it is on the list. The answer is codes only (`required_language`, `ad_language`, `title_language`) and nothing of the ad is stored.
- No profile languages readable: `screen` answers `unknown` for everything and drops nothing.
