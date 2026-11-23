#!/usr/bin/env bash
# Dati privati di persone e macchine — Job Hunter Team
#
# Un solo insieme di regole per .githooks/pre-commit e .githooks/pre-push.
# Il repo e' PUBBLICO e la storia di git e' per sempre: un IP di VPS o la mail
# di un beta tester, una volta pubblicati, non si cancellano — si revocano.
# Il pre-commit si aggira con --no-verify, quindi il pre-push riapplica le
# stesse regole a ogni commit che sta per raggiungere il remote.
#
# Uso:
#   private-data.sh --staged     l'indice (pre-commit)
#   private-data.sh --commits    gli SHA letti da stdin, uno per riga (pre-push)
#
# Uscita 0 = niente trovato. Uscita 1 = trovato: su stdout una riga per
# commit, file e regola. Nessuna rete: solo git, grep, awk, sed.
#
# Verificato il 2026-08-04: nel repo tracciato non esiste alcun IP pubblico e le
# uniche mail sono @jobhunterteam.ai piu' gli esempi delle skill (nome.jht@...),
# tutti in whitelist. Il controllo quindi non blocca nulla di preesistente.

set -euo pipefail

RED='\033[0;31m'
YELLOW='\033[0;33m'
NC='\033[0m'

# Quanti valori per regola e per file si stampano: bastano a capire cosa togliere.
MAX_VALUES=3

# ── REGOLE ───────────────────────────────────────────────────
# Ognuna legge il contenuto delle righe aggiunte su stdin e stampa i valori
# trovati, uno per riga.

# IPv4 pubblici. Esclusi: loopback, RFC1918, link-local, multicast/broadcast e
# i range di documentazione (192.0.2 / 198.51.100 / 203.0.113).
# Prima degli allowlist accetta solo IPv4 canonici: i path SVG contengono spesso
# sequenze decimali come `1.067.133.167` o ottetti >255, che non sono indirizzi.
rule_ip() {
    grep -vE 'Chrome/[0-9]+(\.[0-9]+){3}|<path[[:space:]][^>]*d=' \
        | grep -oE '\b([0-9]{1,3}\.){3}[0-9]{1,3}\b' \
        | awk -F. '{ valid=1; for (i=1; i<=4; i++) if ($i !~ /^(0|[1-9][0-9]*)$/ || $i > 255) valid=0; if (valid) print }' \
        | grep -vE '^(127\.|0\.|10\.|192\.168\.|169\.254\.|192\.0\.2\.|198\.51\.100\.|203\.0\.113\.|255\.|22[4-9]\.|23[0-9]\.|172\.(1[6-9]|2[0-9]|3[01])\.)' \
        || true
}

# Email reali. Whitelist: domini del progetto, esempi, pacchetti npm scoped e i
# segnaposto usati nelle skill (nome.jht@, your_name@, ...).
# Il local-part deve iniziare con un carattere alfanumerico: così un decoratore
# aggiunto nel diff (`+@pytest.fixture`) non viene interpretato come una mail.
rule_email() {
    grep -oE '[a-zA-Z0-9][a-zA-Z0-9._%+-]*@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}' \
        | grep -vE '^user-runtime-dir@[0-9]+\.service$' \
        | grep -vE '@(jobhunterteam\.ai|example\.(com|org|net)|[a-z-]+\.invalid|users\.noreply\.github\.com|anthropic\.com)$' \
        | grep -vE '^(nome|name|nombre|nom|user|utente|tuo|your|your_name|email)[._-]?[a-z]*@' \
        | grep -vE '^((deinname|nev|oteunome|tunombre|tuonome|votrenom|yourname)\.jht@gmail\.com|nev@gmx\.com|(jobalerts-noreply|jobs-listings)@linkedin\.com)$' \
        | grep -vE '@(types|supabase|vercel|next|radix-ui|testing-library|eslint|babel|playwright|tailwindcss)/' \
        || true
}

# Token e chiavi con un prefisso riconoscibile. Il valore non si stampa intero.
SECRET_PATTERNS='(sbp_[a-zA-Z0-9]{30,}|ghp_[a-zA-Z0-9]{30,}|gho_[a-zA-Z0-9]{30,}|sk-[a-zA-Z0-9]{30,}|eyJhbG[a-zA-Z0-9]{50,}|AKIA[A-Z0-9]{16}|AIza[a-zA-Z0-9_-]{35}|GOCSPX-[a-zA-Z0-9_-]{20,})'
rule_secret() {
    grep -oE "$SECRET_PATTERNS" | sed -E 's/^(.{15}).*/\1.../' || true
}

RULES="ip email secret"
rule_label() {
    case "$1" in
        ip) echo "IP pubblico" ;;
        email) echo "email" ;;
        secret) echo "possibile segreto" ;;
    esac
}

# ── RIGHE AGGIUNTE ───────────────────────────────────────────
# Da un diff a righe «file<TAB>contenuto», solo per le righe aggiunte.
# PLUS = quante colonne di prefisso ha una riga: 1 nel diff normale, il numero
# dei genitori nel diff combinato (--cc) di un merge. In un merge conta solo la
# riga nuova rispetto a TUTTI i genitori (prefisso tutto «+»): quella che arriva
# da un genitore e' gia' nel suo commit, controllato a parte o gia' pubblico.
added_lines() {
    awk -v plus="$1" '
        function prefix_is_all_plus(s,    i) {
            for (i = 1; i <= plus; i++) if (substr(s, i, 1) != "+") return 0
            return 1
        }
        /^diff / { header = 1; next }
        header && /^\+\+\+ / {
            path = substr($0, 5)
            if (path ~ /^"/) { path = substr(path, 2, length(path) - 2) }
            sub(/^b\//, "", path)
            next
        }
        /^@@/ { header = 0; next }
        !header && prefix_is_all_plus($0) {
            line = substr($0, plus + 1)
            gsub(/\t/, " ", line)
            print path "\t" line
        }
    '
}

commit_added_lines() {
    local commit="$1" parents
    parents=$(git rev-list --parents -n 1 "$commit" | awk '{ print NF - 1 }')
    if [ "$parents" -le 1 ]; then
        git -c core.quotePath=false diff-tree --no-commit-id --root -p -U0 -r \
            --no-renames --no-ext-diff --diff-filter=ACM "$commit" | added_lines 1
    else
        git -c core.quotePath=false diff-tree --no-commit-id --cc -U0 \
            --no-renames --no-ext-diff "$commit" | added_lines "$parents"
    fi
}

staged_added_lines() {
    git -c core.quotePath=false diff --cached -U0 --no-renames --no-ext-diff \
        --diff-filter=ACM | added_lines 1
}

# ── CONTROLLO ────────────────────────────────────────────────
HITS=""

# $1 = etichetta (SHA breve o «indice»), stdin = righe «file<TAB>contenuto».
check_lines() {
    local label="$1" tsv rule values value files file found
    tsv=$(cat)
    [ -z "$tsv" ] && return 0
    for rule in $RULES; do
        # Prima tutto il contenuto insieme: un commit pulito costa un passaggio.
        values=$(printf '%s\n' "$tsv" | cut -f2- | "rule_$rule" | sort -u || true)
        [ -z "$values" ] && continue
        # Poi, solo se c'e' qualcosa, il file preciso: i file che contengono il
        # valore, confermati con la regola sulle sole righe di quel file.
        files=$(
            while IFS= read -r value; do
                [ -z "$value" ] && continue
                printf '%s\n' "$tsv" | grep -F -- "${value%...}" | cut -f1 || true
            done <<< "$values" | sort -u
        )
        while IFS= read -r file; do
            [ -z "$file" ] && continue
            found=$(printf '%s\n' "$tsv" \
                | awk -F'\t' -v f="$file" '$1 == f' | cut -f2- \
                | "rule_$rule" | sort -u | head -"$MAX_VALUES" || true)
            [ -z "$found" ] && continue
            HITS="$HITS\n  $label  $file  $(rule_label "$rule"): $(echo "$found" | tr '\n' ' ')"
        done <<< "$files"
    done
}

case "${1:-}" in
    --staged)
        check_lines "indice" < <(staged_added_lines)
        ;;
    --commits)
        while IFS= read -r commit; do
            [ -z "$commit" ] && continue
            check_lines "${commit:0:9}" < <(commit_added_lines "$commit")
        done
        ;;
    *)
        echo "uso: $0 --staged | --commits (SHA su stdin)" >&2
        exit 2
        ;;
esac

if [ -n "$HITS" ]; then
    echo -e "${RED}BLOCCATO: possibili dati privati (commit, file, regola).${NC}"
    echo -e "$HITS"
    echo ""
    echo -e "${YELLOW}Il repo e' pubblico e la storia di git e' per sempre: IP di VPS,${NC}"
    echo -e "${YELLOW}email, token e dati di beta tester non entrano in un commit.${NC}"
    echo -e "${YELLOW}Se e' un esempio, usa 192.0.2.x (documentazione) o example.com.${NC}"
    exit 1
fi

exit 0
