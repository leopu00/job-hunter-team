"""The deterministic half of the cover letter's quality control (cover_letter_check.py).

A cover letter used to leave the team with no second reader: the Critic refused it (CR-04) and nothing else looked
at it. This script is the part of the review that needs no model: numbers and tools the profile does not have,
placeholders, the wrong language, the wrong length, a banned opening, a letter that never names the company. The
profile, the letters and the company below are made up.
"""

from __future__ import annotations

import datetime
import json
import subprocess
import sys
from pathlib import Path

import pytest

SKILLS = Path(__file__).resolve().parents[1] / "shared" / "skills"
sys.path.insert(0, str(SKILLS))

import cover_letter_check as clc  # noqa: E402

TODAY = datetime.date(2026, 11, 12)

PROFILE = """\
# name and contacts: nothing here is a fact about the work
name: Ada Example
email: ada@example.org
experience:
  - company: Acme Analytics
    title: Data analyst
    years: 5
    highlights:
      - cut the time of the weekly report by 40% with Python and SQL
      - built the dashboards of the sales team in Power BI
skills: [Python, SQL, Power BI, Excel]
"""
SUMMARY = "Ada has worked five years on reporting; she led a team of 3 analysts for one year.\n"
JD = "Beta Corp looks for a data analyst with 2 years of SQL. Nice to have: dbt, Snowflake. 30 days to onboard.\n"

# Eight sentences a person could write to Beta Corp, per language: 150+ words, in the language, naming the company,
# with numbers from the profile only (5 years, 40%) and Python, SQL, Power BI as the tools.
LETTERS = {
    "en": [
        "I am applying for the data analyst role at Beta Corp because the work you describe is the work I have done for five years.",
        "At Acme Analytics I cut the time of the weekly report by 40% with Python and SQL, and the people who read it noticed the change in a week.",
        "The dashboards I built in Power BI are used by the sales team every morning, and I keep them simple so that anyone can read them without help.",
        "What I noticed about Beta Corp is that you publish how your analysts work, and that tells me the team cares about the details of the data.",
        "I would like to bring the same care to your reporting, starting with the numbers that the managers ask for most often and trust least.",
        "I do not have experience with dbt yet, and I would rather say it now than pretend; I learn tools quickly when I have a real problem to solve with them.",
        "In the first 90 days I would map the reports that exist, remove the ones nobody reads and make the three that matter fast and correct.",
        "I am happy to discuss this in more detail whenever it suits you, and I can share the dashboards I am allowed to show in a conversation.",
    ],
    "it": [
        "Mi candido al ruolo di analista dati in Beta Corp perché il lavoro che descrivete è quello che faccio da cinque anni.",
        "In Acme Analytics ho ridotto del 40% il tempo del report settimanale con Python e SQL, e chi lo legge se n'è accorto in una settimana.",
        "I cruscotti che ho costruito in Power BI sono usati ogni mattina dal team vendite, e li tengo semplici perché chiunque possa leggerli senza aiuto.",
        "Quello che ho notato di Beta Corp è che raccontate come lavorano i vostri analisti, e questo mi dice che il team cura i dettagli dei dati.",
        "Vorrei portare la stessa cura nei vostri report, cominciando dai numeri che i responsabili chiedono più spesso e di cui si fidano meno.",
        "Non ho ancora esperienza con dbt e preferisco dirlo adesso che far finta; imparo in fretta gli strumenti quando ho un problema vero da risolvere.",
        "Nei primi 90 giorni mapperei i report che esistono, toglierei quelli che nessuno legge e renderei veloci e corretti i tre che contano.",
        "Sono felice di parlarne in dettaglio quando vi fa comodo, e posso condividere i cruscotti che posso mostrare durante un colloquio.",
    ],
    "es": [
        "Me presento al puesto de analista de datos en Beta Corp porque el trabajo que describen es el que hago desde hace cinco años.",
        "En Acme Analytics reduje un 40% el tiempo del informe semanal con Python y SQL, y las personas que lo leen lo notaron en una semana.",
        "Los paneles que construí en Power BI los usa cada mañana el equipo de ventas, y los mantengo sencillos para que cualquiera pueda leerlos sin ayuda.",
        "Lo que he notado de Beta Corp es que ustedes cuentan cómo trabajan sus analistas, y eso me dice que el equipo cuida los detalles de los datos.",
        "Me gustaría aportar el mismo cuidado a sus informes, empezando por los números que los responsables piden con más frecuencia y en los que menos confían.",
        "Todavía no tengo experiencia con dbt y prefiero decirlo ahora antes que fingir; aprendo rápido las herramientas cuando tengo un problema real que resolver.",
        "En los primeros 90 días haría un mapa de los informes que existen, quitaría los que nadie lee y haría rápidos y correctos los tres que importan.",
        "Estaré encantada de hablarlo con más detalle cuando les venga bien, y puedo compartir los paneles que me permiten mostrar en una conversación.",
    ],
    "fr": [
        "Je me porte candidate au poste d'analyste de données chez Beta Corp parce que le travail que vous décrivez est celui que je fais depuis cinq ans.",
        "Chez Acme Analytics j'ai réduit de 40% le temps du rapport hebdomadaire avec Python et SQL, et les personnes qui le lisent l'ont remarqué en une semaine.",
        "Les tableaux de bord que j'ai construits dans Power BI sont utilisés chaque matin par l'équipe des ventes, et je les garde simples pour que chacun puisse les lire sans aide.",
        "Ce que j'ai remarqué chez Beta Corp, c'est que vous racontez comment travaillent vos analystes, et cela me dit que l'équipe soigne les détails des données.",
        "J'aimerais apporter le même soin à vos rapports, en commençant par les chiffres que les responsables demandent le plus souvent et auxquels ils font le moins confiance.",
        "Je n'ai pas encore d'expérience avec dbt et je préfère le dire maintenant plutôt que de faire semblant; j'apprends vite les outils quand j'ai un vrai problème à résoudre.",
        "Pendant les 90 premiers jours je ferais la carte des rapports qui existent, je supprimerais ceux que personne ne lit et je rendrais rapides et justes les trois qui comptent.",
        "Je serais heureuse d'en discuter plus en détail quand cela vous convient, et je peux partager les tableaux de bord que j'ai le droit de montrer pendant un entretien.",
    ],
    "de": [
        "Ich bewerbe mich als Datenanalystin bei Beta Corp, weil die Arbeit, die Sie beschreiben, genau die ist, die ich seit fünf Jahren mache.",
        "Bei Acme Analytics habe ich die Zeit für den wöchentlichen Bericht mit Python und SQL um 40% verkürzt, und die Leser haben es innerhalb einer Woche bemerkt.",
        "Die Dashboards, die ich in Power BI gebaut habe, werden jeden Morgen vom Vertriebsteam benutzt, und ich halte sie einfach, damit sie jeder ohne Hilfe lesen kann.",
        "Was mir an Beta Corp aufgefallen ist: Sie erzählen, wie Ihre Analysten arbeiten, und das sagt mir, dass das Team die Details der Daten ernst nimmt.",
        "Ich möchte dieselbe Sorgfalt in Ihre Berichte bringen, und zwar zuerst bei den Zahlen, nach denen die Führungskräfte am häufigsten fragen und denen sie am wenigsten vertrauen.",
        "Ich habe noch keine Erfahrung mit dbt und sage das lieber jetzt, statt etwas vorzutäuschen; ich lerne Werkzeuge schnell, wenn ich ein echtes Problem damit lösen kann.",
        "In den ersten 90 Tagen würde ich die vorhandenen Berichte erfassen, die streichen, die niemand liest, und die drei wichtigen schnell und korrekt machen.",
        "Ich freue mich darauf, das in Ruhe zu besprechen, wann immer es Ihnen passt, und ich kann die Dashboards zeigen, die ich in einem Gespräch zeigen darf.",
    ],
    "pt": [
        "Candidato-me ao cargo de analista de dados na Beta Corp porque o trabalho que descrevem é o que faço há cinco anos.",
        "Na Acme Analytics reduzi em 40% o tempo do relatório semanal com Python e SQL, e as pessoas que o leem notaram a mudança numa semana.",
        "Os painéis que construí em Power BI são usados todas as manhãs pela equipa de vendas, e mantenho-os simples para que qualquer pessoa os possa ler sem ajuda.",
        "O que notei na Beta Corp é que vocês contam como trabalham os vossos analistas, e isso diz-me que a equipa cuida dos detalhes dos dados.",
        "Gostaria de trazer o mesmo cuidado aos vossos relatórios, começando pelos números que os responsáveis pedem com mais frequência e em que menos confiam.",
        "Ainda não tenho experiência com dbt e prefiro dizê-lo agora do que fingir; aprendo depressa as ferramentas quando tenho um problema real para resolver com elas.",
        "Nos primeiros 90 dias mapearia os relatórios que existem, tiraria os que ninguém lê e tornaria rápidos e corretos os três que contam.",
        "Terei todo o gosto em falar disto com mais detalhe quando lhes convier, e posso partilhar os painéis que me é permitido mostrar numa conversa.",
    ],
    "hu": [
        "Az adatelemzői állásra jelentkezem a Beta Corpnál, mert az a munka, amelyet leírnak, ugyanaz, amit öt éve végzek.",
        "Az Acme Analyticsnél 40%-kal csökkentettem a heti jelentés elkészítési idejét Python és SQL segítségével, és akik olvassák, egy héten belül észrevették a változást.",
        "A Power BI-ban épített irányítópultokat minden reggel használja az értékesítési csapat, és egyszerűen tartom őket, hogy bárki segítség nélkül el tudja olvasni.",
        "A Beta Corpról azt vettem észre, hogy elmesélik, hogyan dolgoznak az elemzőik, és ez azt mutatja, hogy a csapat odafigyel az adatok részleteire.",
        "Ugyanezt a gondosságot szeretném behozni a jelentéseikbe, azokkal a számokkal kezdve, amelyeket a vezetők a leggyakrabban kérnek és amelyekben a legkevésbé bíznak.",
        "A dbt-vel még nincs tapasztalatom, és inkább most mondom ki, mint hogy tettessem magam; gyorsan tanulom az eszközöket, ha van valódi problémám, amit velük megoldhatok.",
        "Az első 90 napban feltérképezném a meglévő jelentéseket, kivenném azokat, amelyeket senki sem olvas, és gyorssá és helyessé tenném a három fontosat.",
        "Szívesen beszélek erről részletesebben, amikor önöknek megfelel, és megmutathatom azokat az irányítópultokat, amelyeket egy beszélgetésen mutathatok.",
    ],
}
GAP_SENTENCE_INDEX = 5  # the sentence of each letter that admits it has no dbt


def letter(lang: str, *, replace: dict[int, str] | None = None, drop: set[int] | None = None) -> str:
    sentences = list(LETTERS[lang])
    for index, text in (replace or {}).items():
        sentences[index] = text
    kept = [s for i, s in enumerate(sentences) if i not in (drop or set())]
    return "# Ada Example\n\n" + "\n\n".join(kept) + "\n"


def run(text: str, *, lang: str = "en", company: str = "Beta Corp", jd: str = JD, profile: str = PROFILE + SUMMARY) -> dict:
    return clc.analyze(text, profile=profile, jd=jd, company=company, lang=lang, today=TODAY)


def codes(report: dict) -> list[str]:
    return [finding["code"] for finding in report["hard"]]


@pytest.mark.parametrize("lang", clc.LANGUAGES)
def test_a_letter_that_says_only_what_the_profile_says_passes_in_every_language(lang: str) -> None:
    report = run(letter(lang), lang=lang)
    assert report["ok"], report["hard"]
    assert report["info"]["words"] >= clc.MIN_WORDS_HARD
    assert report["info"]["language"] in (lang, None)


@pytest.mark.parametrize("lang", clc.LANGUAGES)
def test_a_tool_the_letter_admits_it_lacks_is_a_declared_gap_not_an_invention(lang: str) -> None:
    report = run(letter(lang), lang=lang)
    assert "dbt" in report["info"]["gaps_declared"], report


@pytest.mark.parametrize("lang", clc.LANGUAGES)
def test_a_tool_the_profile_does_not_have_fails_when_the_letter_claims_it(lang: str) -> None:
    claim = {
        "en": "At Acme Analytics I built the Snowflake warehouse of the whole company.",
        "it": "In Acme Analytics ho costruito il data warehouse Snowflake di tutta l'azienda.",
        "es": "En Acme Analytics construí el almacén de datos Snowflake de toda la empresa.",
        "fr": "Chez Acme Analytics j'ai construit l'entrepôt de données Snowflake de toute l'entreprise.",
        "de": "Bei Acme Analytics habe ich das Snowflake-Data-Warehouse des ganzen Unternehmens gebaut.",
        "pt": "Na Acme Analytics construí o armazém de dados Snowflake de toda a empresa.",
        "hu": "Az Acme Analyticsnél én építettem fel a teljes cég Snowflake adattárházát.",
    }[lang]
    report = run(letter(lang, replace={1: claim}), lang=lang)
    assert "unsupported_term" in codes(report)
    detail = next(f["detail"] for f in report["hard"] if f["code"] == "unsupported_term")
    assert "Snowflake" in detail


def test_a_number_the_profile_and_the_job_ad_do_not_have_fails() -> None:
    report = run(letter("en", replace={1: "At Acme Analytics I cut the time of the weekly report by 73% with Python and SQL."}))
    assert codes(report) == ["unsupported_number"]
    assert report["hard"][0]["detail"] == "73"


def test_numbers_from_the_job_ad_and_the_first_90_days_are_not_inventions() -> None:
    text = letter("en", replace={0: "I am applying for the data analyst role at Beta Corp, where 2 years of SQL are asked and I bring five."})
    assert run(text)["ok"]  # 90 is the schema of the letter, 2 is in the ad, 5 is in the profile


def test_this_years_date_and_a_phone_or_email_are_not_claims() -> None:
    header = "12.11.2026\nada@example.org, +39 051 1234567\n\n"
    assert run(header + letter("en"))["ok"]


def test_a_placeholder_left_in_the_letter_fails() -> None:
    for left in ("[Your name]", "<company>", "{{role}}", "TODO", "XXX", "Lorem ipsum"):
        report = run(letter("en", replace={0: f"I am applying for the role at Beta Corp, {left}, because the work is mine."}))
        assert "placeholder" in codes(report), left


def test_a_letter_in_another_language_than_the_users_fails() -> None:
    report = run(letter("en"), lang="it")
    assert "wrong_language" in codes(report)
    assert report["info"]["expected_language"] == "it"


def test_a_letter_that_is_too_short_or_too_long_fails() -> None:
    assert "length" in codes(run(letter("en", drop={2, 3, 4, 5, 6, 7})))
    long = letter("en") + ("\n\n" + " ".join(LETTERS["en"][4:6])) * 8
    assert "length" in codes(run(long))


def test_a_length_between_the_two_ranges_is_only_a_signal() -> None:
    report = run(letter("en", drop={3, 4}))
    if report["info"]["words"] < clc.MIN_WORDS_SOFT:
        assert report["ok"] and any(f["code"] == "words_out_of_range" for f in report["soft"])


def test_a_letter_that_never_names_the_company_fails() -> None:
    text = letter("en").replace("Beta Corp", "your company")
    assert codes(run(text)) == ["no_company"]  # "your company" is ordinary words, not a placeholder


@pytest.mark.parametrize(
    "lang,opening",
    [
        ("en", "I am writing to express my interest in the data analyst role"),
        ("en", "Please find attached my CV for the role at Beta Corp"),
        ("it", "Scrivo per esprimere il mio interesse per il ruolo in Beta Corp"),
        ("es", "Escribo para expresar mi interés por el puesto en Beta Corp"),
        ("fr", "Je vous écris pour exprimer mon intérêt pour le poste chez Beta Corp"),
        ("de", "Hiermit möchte ich mein Interesse an der Stelle bei Beta Corp bekunden"),
        ("pt", "Escrevo para expressar o meu interesse no cargo da Beta Corp"),
    ],
)
def test_the_openings_the_skill_bans_fail_in_every_language(lang: str, opening: str) -> None:
    report = run(letter(lang, replace={0: opening + "."}), lang=lang)
    assert "opening_cliche" in codes(report), opening


def test_a_buzzword_is_a_signal_and_never_a_failure() -> None:
    report = run(letter("en", replace={3: "I am passionate about data and Beta Corp looks like a team that is too."}))
    assert report["ok"] and [f["detail"] for f in report["soft"] if f["code"] == "buzzword"] == ["passionate about"]


def test_a_tool_shaped_name_that_is_on_no_list_is_still_caught() -> None:
    report = run(letter("en", replace={1: "At Acme Analytics I wrote the PipelineForge jobs that fed the report."}))
    assert "unsupported_term" in codes(report)


def test_a_name_the_profile_writes_differently_is_the_same_tool() -> None:
    profile = PROFILE.replace("Power BI", "PowerBI") + SUMMARY
    assert run(letter("en"), profile=profile)["ok"]


def test_the_company_name_is_not_taken_for_a_tool() -> None:
    text = letter("en").replace("Beta Corp", "NovaWorks")
    assert run(text, company="NovaWorks")["ok"]


def test_a_comment_in_the_profile_is_not_a_fact(tmp_path: Path) -> None:
    folder = tmp_path / "profile"
    folder.mkdir()
    (folder / "candidate_profile.yml").write_text(PROFILE + "# I know Snowflake very well\n", encoding="utf-8")
    text = letter("en", replace={1: "At Acme Analytics I built the Snowflake warehouse."})
    report = clc.analyze(text, profile=clc.profile_text(folder), jd=JD, company="Beta Corp", lang="en", today=TODAY)
    assert "unsupported_term" in codes(report)


def test_the_profile_folder_is_read_with_its_summaries_and_sources(tmp_path: Path) -> None:
    folder = tmp_path / "profile"
    (folder / "summaries").mkdir(parents=True)
    (folder / "sources").mkdir()
    (folder / "candidate_profile.yml").write_text(PROFILE, encoding="utf-8")
    (folder / "summaries" / "work.md").write_text("She worked with Tableau for two years.\n", encoding="utf-8")
    (folder / "sources" / "cv.txt").write_text("Led a team of 12 colleagues.\n", encoding="utf-8")
    (folder / "sources" / "cv.pdf").write_bytes(b"%PDF-1.4 \xff\xfe not text")
    text = clc.profile_text(folder)
    assert "Tableau" in text and "12 colleagues" in text and "Snowflake" not in text


def script(*args: str) -> subprocess.CompletedProcess:
    return subprocess.run(
        [sys.executable, "-I", str(SKILLS / "cover_letter_check.py"), *args],
        capture_output=True, text=True, timeout=60, check=False,
    )


def test_the_script_exits_0_1_and_2(tmp_path: Path) -> None:
    folder = tmp_path / "profile"
    folder.mkdir()
    (folder / "candidate_profile.yml").write_text(PROFILE, encoding="utf-8")
    (folder / "extra.md").write_text("ignored: only summaries and sources are read\n", encoding="utf-8")
    good = tmp_path / "good.md"
    good.write_text(letter("en"), encoding="utf-8")
    bad = tmp_path / "bad.md"
    bad.write_text(letter("en", replace={1: "I cut the report by 73% with Snowflake."}), encoding="utf-8")
    jd = tmp_path / "jd.txt"
    jd.write_text(JD, encoding="utf-8")
    common = ["--profile-dir", str(folder), "--company", "Beta Corp", "--lang", "en", "--jd", str(jd), "--json"]

    ok = script("--letter", str(good), *common)
    assert ok.returncode == 0, ok.stdout + ok.stderr
    assert json.loads(ok.stdout)["ok"] is True

    failed = script("--letter", str(bad), *common)
    assert failed.returncode == 1
    found = {f["code"] for f in json.loads(failed.stdout)["hard"]}
    assert {"unsupported_number", "unsupported_term"} <= found

    no_letter = script("--letter", str(tmp_path / "missing.md"), *common)
    no_profile = script("--letter", str(good), "--profile-dir", str(tmp_path / "nowhere"), "--company", "Beta Corp", "--json")
    empty = tmp_path / "empty.md"
    empty.write_text("  \n", encoding="utf-8")
    assert no_letter.returncode == 2 and "cannot check" in no_letter.stderr
    assert no_profile.returncode == 2 and no_profile.stdout == ""
    assert script("--letter", str(empty), *common).returncode == 2


def test_the_plain_report_names_the_codes(tmp_path: Path) -> None:
    folder = tmp_path / "profile"
    folder.mkdir()
    (folder / "candidate_profile.yml").write_text(PROFILE, encoding="utf-8")
    bad = tmp_path / "bad.md"
    bad.write_text(letter("en", replace={1: "I cut the report by 73%."}), encoding="utf-8")
    result = script("--letter", str(bad), "--profile-dir", str(folder), "--company", "Beta Corp", "--lang", "en")
    assert result.returncode == 1
    assert "HARD unsupported_number: 73" in result.stdout


def test_a_file_too_big_to_be_a_letter_is_refused_not_checked(tmp_path: Path) -> None:
    folder = tmp_path / "profile"
    folder.mkdir()
    (folder / "candidate_profile.yml").write_text(PROFILE, encoding="utf-8")
    huge = tmp_path / "huge.md"
    huge.write_text("1 " * (clc.MAX_BYTES // 2 + 10), encoding="utf-8")
    result = script("--letter", str(huge), "--profile-dir", str(folder), "--company", "Beta Corp", "--json")
    assert result.returncode == 2 and "larger than" in result.stderr


def test_a_long_run_of_digits_or_of_characters_without_a_space_is_checked_in_no_time() -> None:
    start = datetime.datetime.now()
    run(letter("en") + "\n" + "1" * 200_000 + "\n" + "a" * 200_000 + "\n" + "9 " * 100_000)
    assert (datetime.datetime.now() - start).total_seconds() < 10
