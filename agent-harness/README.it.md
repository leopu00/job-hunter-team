# agent-harness — il loop scritto a mano

*English version: [`README.md`](README.md).*

**Non è codice di produzione ed è deliberatamente incompleto.** È l'harness che sto costruendo io,
riga per riga, senza farlo scrivere a un agente. Il valore sta nel gesto, non nel risultato:
l'orchestrazione vera di Job Hunter Team resta quella tmux/CLI, questo nasce accanto.

## Da dove viene

Il file di partenza è `app/main.py`, nato come soluzione del corso CodeCrafters
*Build your own Claude Code* e da lì cresciuto. Lo stesso file vive anche sul PC di lavoro dentro un
altro progetto, dove si chiama `FincoBot/app/fincobot.py`: **stessa base di codice, due
destinazioni**, così l'esercizio prosegue da qualunque macchina.

Usa l'SDK `openai` contro un endpoint OpenAI-compatible, che è già la forma dell'adapter
multi-provider: un solo client copre Claude, GPT e Kimi cambiando `BASE_URL` e `MODEL`.

## Come si lancia

```sh
cp .env.example .env      # e metti dentro chiave, base url e modello
./run.sh -p "What is the content of pyproject.toml?"
```

Su Windows, dal PC di lavoro:

```powershell
.\run.ps1 -p "What is the content of pyproject.toml?"
```

Entrambi gli script fanno la stessa cosa: entrano nella cartella dello script (così i percorsi
restano relativi), caricano `.env` e lanciano `uv run --project . -m app.main`. L'ambiente è isolato
dal resto della repo — `pyproject.toml` vale solo qui dentro.

Il programma stampa **la risposta finale su `stdout`** e **tutta l'osservabilità su `stderr`**:
numero del giro, token in input e output, totali cumulati, costo marginale del turno e il dump JSON
dei messaggi nuovi. Per leggere solo la risposta: `./run.sh -p "..." 2>/dev/null`.

## Cosa manca

`TODO.md` — otto buchi noti, scritti come sintomo più criterio di verifica e **senza soluzione**,
di proposito: l'implementazione è l'esercizio. Tre sono chiusi, sei restano aperti. Il prossimo è
lo step cap.

## Gli appunti

Il ragionamento riga per riga, le misure sul campo e i vicoli ciechi stanno in
`docs/internal/private/lezioni/fincobot.md`, che è fuori dal repo (`docs/internal/private/` è
ignorata). Lì c'è il *perché*; qui c'è il *cosa*.

## Perimetro

L'esercizio vive in questa cartella. Non tocca nient'altro della repo.
