import pathlib

import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
from matplotlib.patches import Patch

OUT=str(pathlib.Path(__file__).resolve().parent)
GREEN="#16a34a"; RED="#dc2626"; ORANGE="#ea580c"; GREY="#94a3b8"; BLUE="#2563eb"; DARK="#0f172a"

# ---------- CHART 1: 5h-window usage in una giornata (gate 8-20) ----------
# Finestre 5h ancorate all'inizio giornata lavorativa (08:00): W1 08-13, W2 13-18, W3 18-23 (gate chiude 20).
TARGET=50.0   # % del cap 5h (weekly-aware, ~40-61)
OLD=92.0
active=(8,20)
wins=[(8,13),(13,18),(18,23)]
ts=[i/10 for i in range(0,241)]  # 0..24 step 0.1
usage=[]
for t in ts:
    if not (active[0] <= t < active[1]):
        usage.append(0.0); continue
    # finestra corrente
    w=next(((a,b) for (a,b) in wins if a<=t<b), None)
    if w is None: usage.append(0.0); continue
    a,b=w
    # porzione attiva della finestra (clip al gate)
    act_end=min(b, active[1])
    span=act_end-a
    prog=(t-a)/span if span>0 else 0
    usage.append(min(TARGET, TARGET*prog))

fig,ax=plt.subplots(figsize=(11,5.2))
# notte/idle shading
ax.axvspan(0,8,color=GREY,alpha=0.10); ax.axvspan(20,24,color=GREY,alpha=0.10)
# cap + vecchio target
ax.axhline(100,color=RED,ls="--",lw=1.6,label="Cap finestra 5h (100%)")
ax.axhline(OLD,color=ORANGE,ls=":",lw=1.8,label="Vecchio target fisso (92%) — brucia il weekly")
ax.axhspan(40,61,color=GREEN,alpha=0.12,label="Banda target weekly-aware (~40-61%)")
ax.plot(ts,usage,color=GREEN,lw=2.6,label="Usage 5h COME DOVREBBE")
# boundary finestre
for x in (13,18):
    ax.axvline(x,color=DARK,ls="--",lw=0.8,alpha=0.4)
ax.text(10.5,TARGET+3,"W1 08-13",ha="center",color=DARK,fontsize=9)
ax.text(15.5,TARGET+3,"W2 13-18",ha="center",color=DARK,fontsize=9)
ax.text(19,28,"W3 18-20\n(gate chiude)",ha="center",color=DARK,fontsize=8)
ax.text(4,50,"IDLE\n(fuori 8-20)",ha="center",color=GREY,fontsize=10,style="italic")
ax.text(22,50,"IDLE",ha="center",color=GREY,fontsize=10,style="italic")
ax.set_xlim(0,24); ax.set_ylim(0,108); ax.set_xticks(range(0,25,2))
ax.set_xlabel("Ora del giorno (Europe/Rome)"); ax.set_ylabel("Usage finestra 5h (% del cap)")
ax.set_title("Usage 5h — come DOVREBBE mostrarsi (gate 8-20, target weekly-aware)",fontsize=13,weight="bold")
ax.legend(loc="upper left",fontsize=8.5,framealpha=0.95)
ax.grid(axis="y",alpha=0.25)
fig.tight_layout(); fig.savefig(f"{OUT}/01-usage-5h-giornata.png",dpi=130); plt.close(fig)

# ---------- CHART 2: burn-down weekly — vecchio (92% 24/7) vs corretto (gate) ----------
RATIO=14.7  # 1 finestra 5h piena = 14.7% weekly
# OLD: 24/7 a 92% del cap -> per finestra 0.92*14.7=13.52% weekly; 4.8 finestre/giorno -> ~64.9%/giorno
old_rate_per_h = 0.92*RATIO/5.0   # %weekly per ora wallclock (24/7)
# CORRECT: distribuisci 100% su 84h attive (7g x 12h) -> 1.19%/h attivo, 0 di notte
days=7
hrs=[h/2 for h in range(0,days*48+1)]  # 0..7 giorni step 0.5h
def is_active(hod): return 8 <= (hod%24) < 20
old=[]; cor=[]; o=0.0; c=0.0
prev=0.0
for h in hrs:
    dt=h-prev; prev=h
    # OLD: 24/7 fino a 100 poi cap (rate-limited, lavoro perso)
    o=min(100.0, o + old_rate_per_h*dt)
    old.append(o)
    # CORRECT: solo ore attive, 1.19%/h
    if is_active(h%24):
        c=min(100.0, c + 1.19*dt)
    cor.append(c)

fig,ax=plt.subplots(figsize=(11,5.2))
# shading notti
for d in range(days):
    ax.axvspan(d*24+20, d*24+24+8, color=GREY, alpha=0.07)
ax.axhline(100,color=RED,ls="--",lw=1.5,label="Weekly cap (100%)")
ax.plot(hrs,old,color=ORANGE,lw=2.4,label="OGGI: 92% 24/7 → esaurito in ~1.5 giorni, poi 5 giorni idle")
ax.plot(hrs,cor,color=GREEN,lw=2.6,label="CORRETTO: weekly-aware + gate 8-20 → arriva a ~100% al reset")
# annot
ax.annotate("esaurito qui\n→ team forzato idle", xy=(36,100), xytext=(50,72),
            color=ORANGE,fontsize=9,arrowprops=dict(arrowstyle="->",color=ORANGE))
ax.annotate("scalini = lavora di giorno,\nfermo di notte", xy=(24*5+14, cor[int((24*5+14)*2)]), xytext=(70,30),
            color=GREEN,fontsize=9,arrowprops=dict(arrowstyle="->",color=GREEN))
ax.set_xlim(0,days*24); ax.set_ylim(0,108)
ax.set_xticks([d*24 for d in range(days+1)]); ax.set_xticklabels([f"g{d}" for d in range(days+1)])
ax.set_xlabel("Giorni dal reset weekly"); ax.set_ylabel("Weekly budget consumato (%)")
ax.set_title("Weekly burn-down — come DOVREBBE (sostenibile 7gg) vs oggi (brucia in 2gg)",fontsize=13,weight="bold")
ax.legend(loc="lower right",fontsize=8.5,framealpha=0.95)
ax.grid(axis="y",alpha=0.25)
fig.tight_layout(); fig.savefig(f"{OUT}/02-weekly-burndown.png",dpi=130); plt.close(fig)

import os
for f in sorted(os.listdir(OUT)):
    p=os.path.join(OUT,f); print(f, os.path.getsize(p),"bytes")
print("DONE")
