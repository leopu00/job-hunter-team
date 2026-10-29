import { useState } from "react";
import { SupportCopyNote } from "./SupportCopyNote";
import type { Locale } from "@/i18n/config";
import type { OperationalStage } from "../lib/onboarding";
import {
  createSetupSupportReport, deliverSetupSupportReport, operatingSystem, readSetupSupportContext,
  type SetupSupportReport,
} from "../lib/onboarding-support";

/** The status lines (preparing, sending, sent, mail, saved, failed, cancel, preview) are reused by the Help and Settings report. */
export const SUPPORT_REPORT_COPY: Record<Locale, Record<string, string>> = {
  it: { copy: "Copia salvata su questo computer", show: "Mostra nella cartella", copyFailed: "La copia su questo computer non è stata salvata.", showFailed: "Non riesco ad aprire la cartella.", open: "Segnala al supporto", title: "Segnalazione al supporto", intro: "Controlla l’anteprima redatta prima dell’invio.", preview: "Anteprima del report", cancel: "Annulla", confirm: "Conferma e invia", preparing: "Preparo il report…", sending: "Invio…", sent: "Segnalazione inviata", mail: "Apri l’app email", saved: "Report da allegare", failed: "Non riesco a preparare la segnalazione. Riprova." },
  en: { copy: "Copy kept on this computer", show: "Show in folder", copyFailed: "The copy could not be saved on this computer.", showFailed: "The folder could not be opened.", open: "Report to support", title: "Support report", intro: "Review the redacted preview before it is sent.", preview: "Report preview", cancel: "Cancel", confirm: "Confirm and send", preparing: "Preparing report…", sending: "Sending…", sent: "Report sent", mail: "Open email app", saved: "Report to attach", failed: "The report could not be prepared. Try again." },
  de: { copy: "Kopie auf diesem Computer gespeichert", show: "Im Ordner anzeigen", copyFailed: "Die Kopie konnte auf diesem Computer nicht gespeichert werden.", showFailed: "Der Ordner konnte nicht geöffnet werden.", open: "Support kontaktieren", title: "Supportmeldung", intro: "Prüfe die bereinigte Vorschau vor dem Senden.", preview: "Vorschau", cancel: "Abbrechen", confirm: "Bestätigen und senden", preparing: "Bericht wird vorbereitet…", sending: "Wird gesendet…", sent: "Meldung gesendet", mail: "E-Mail-App öffnen", saved: "Anzuhängender Bericht", failed: "Der Bericht konnte nicht vorbereitet werden. Bitte erneut versuchen." },
  es: { copy: "Copia guardada en este equipo", show: "Mostrar en la carpeta", copyFailed: "No se pudo guardar la copia en este equipo.", showFailed: "No se pudo abrir la carpeta.", open: "Informar a soporte", title: "Informe de soporte", intro: "Revisa la vista previa redactada antes de enviarla.", preview: "Vista previa", cancel: "Cancelar", confirm: "Confirmar y enviar", preparing: "Preparando informe…", sending: "Enviando…", sent: "Informe enviado", mail: "Abrir aplicación de correo", saved: "Informe para adjuntar", failed: "No se pudo preparar el informe. Inténtalo de nuevo." },
  fr: { copy: "Copie conservée sur cet ordinateur", show: "Afficher dans le dossier", copyFailed: "La copie n’a pas pu être enregistrée sur cet ordinateur.", showFailed: "Le dossier n’a pas pu être ouvert.", open: "Signaler au support", title: "Rapport au support", intro: "Vérifiez l’aperçu expurgé avant l’envoi.", preview: "Aperçu du rapport", cancel: "Annuler", confirm: "Confirmer et envoyer", preparing: "Préparation du rapport…", sending: "Envoi…", sent: "Rapport envoyé", mail: "Ouvrir l’application e-mail", saved: "Rapport à joindre", failed: "Le rapport n’a pas pu être préparé. Réessayez." },
  hu: { copy: "Másolat ezen a számítógépen mentve", show: "Megjelenítés a mappában", copyFailed: "A másolatot nem sikerült ezen a számítógépen elmenteni.", showFailed: "A mappát nem sikerült megnyitni.", open: "Jelentés a támogatásnak", title: "Támogatási jelentés", intro: "Küldés előtt nézd át a kitakart előnézetet.", preview: "Jelentés előnézete", cancel: "Mégse", confirm: "Megerősítés és küldés", preparing: "Jelentés előkészítése…", sending: "Küldés…", sent: "Jelentés elküldve", mail: "Levelező megnyitása", saved: "Csatolandó jelentés", failed: "A jelentés nem készíthető el. Próbáld újra." },
  pt: { copy: "Cópia guardada neste computador", show: "Mostrar na pasta", copyFailed: "Não foi possível guardar a cópia neste computador.", showFailed: "Não foi possível abrir a pasta.", open: "Reportar ao suporte", title: "Relatório de suporte", intro: "Revê a pré-visualização redigida antes do envio.", preview: "Pré-visualização", cancel: "Cancelar", confirm: "Confirmar e enviar", preparing: "A preparar relatório…", sending: "A enviar…", sent: "Relatório enviado", mail: "Abrir aplicação de e-mail", saved: "Relatório para anexar", failed: "Não foi possível preparar o relatório. Tenta novamente." },
};

/** Available all through the setup, not only after a failure: without a `code` the report says it was sent while the setup was running. */
export function SetupSupportReport({ stage, code, locale }: { stage: OperationalStage | "host" | "provider"; code?: string | null; locale: Locale }) {
  const t = SUPPORT_REPORT_COPY[locale];
  const [report, setReport] = useState<SetupSupportReport | null>(null);
  const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState<{ message: string; href?: string; saved?: string | null; attach?: boolean; copyFailed?: boolean } | null>(null);

  async function prepare() {
    setBusy(true); setOutcome(null);
    try {
      const context = await readSetupSupportContext();
      setReport(createSetupSupportReport({ stage, code, locale, appVersion: context.appVersion, platform: operatingSystem(), logTail: context.logTail }));
    } catch { setOutcome({ message: t.failed }); }
    finally { setBusy(false); }
  }
  async function confirm() {
    if (!report) return;
    setBusy(true);
    const next = await deliverSetupSupportReport(report);
    setBusy(false);
    if (next.kind === "sent") { setOutcome({ message: `${t.sent}: ${next.ticket}`, saved: next.savedReport, copyFailed: next.copyFailed }); setReport(null); return; }
    if (next.kind === "mailto") {
      // Confirmation is the person's single action: do not make them click a
      // second link merely to hand the already-prepared message to their mail app.
      window.location.assign(next.href);
      setOutcome({ message: t.mail, saved: next.savedReport, attach: next.attach, copyFailed: next.copyFailed }); setReport(null); return;
    }
    setOutcome({ message: t.failed });
  }
  if (report) return <section className="onboarding-support" aria-label={t.title}>
    <h3>{t.title}</h3><p>{t.intro}</p><label>{t.preview}<textarea readOnly value={report.preview} aria-label={t.preview} /></label>
    <div><button className="onboarding-secondary" type="button" disabled={busy} onClick={() => setReport(null)}>{t.cancel}</button><button className="onboarding-primary" type="button" disabled={busy} onClick={() => void confirm()}>{busy ? t.sending : t.confirm}</button></div>
  </section>;
  return <section className="onboarding-support">
    {outcome && <p role="status">{outcome.message} {outcome.href && <a href={outcome.href}>{t.mail}</a>} <SupportCopyNote saved={outcome.saved} failed={outcome.copyFailed} attach={outcome.attach} copy={t} /></p>}
    <button className="onboarding-secondary" type="button" disabled={busy} onClick={() => void prepare()}>{busy ? t.preparing : t.open}</button>
  </section>;
}
