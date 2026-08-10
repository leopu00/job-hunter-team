"use client";

import Link from "next/link";
import {
  LandingI18nProvider,
  useLandingI18n,
} from "../components/landing/LandingI18n";
import LandingNav from "../components/landing/LandingNav";
import { LandingFooter } from "../components/landing/LandingCTA";
import ScrollToTop from "../components/landing/ScrollToTop";

const T = {
  it: {
    title: "Privacy Policy",
    updated: "Ultimo aggiornamento: Agosto 2026",
    intro:
      "Job Hunter Team (JHT) rispetta la tua privacy. Questa pagina spiega come vengono trattati i tuoi dati.",
    s1_title: "Dati raccolti",
    s1_body:
      "JHT gira dentro un container Docker sul tuo computer. Non raccogliamo, trasmettiamo o memorizziamo dati personali sui nostri server. Profilo, CV, candidature e preferenze restano nella cartella di lavoro locale creata al primo avvio.",
    s2_title: "Provider AI",
    s2_body:
      "Gli agenti girano su una delle tre CLI supportate (Claude Code, Codex, Kimi) che richiedono un tuo abbonamento attivo col rispettivo provider. Quando un agente lavora, la CLI invia la richiesta al provider scelto e il testo passa dai loro server: vale la privacy policy del provider. JHT non intermedia quelle chiamate.",
    s3_title: "Autenticazione provider",
    s3_body:
      "La sessione del provider la apri tu direttamente dentro il container con il login del tuo CLI (claude login / codex login / kimi login). JHT non chiede ne memorizza chiavi API; i token di sessione restano gestiti dalla CLI stessa, sempre in locale.",
    s4_title: "Modalita locale e cloud",
    s4_body:
      "JHT puo girare solo in locale (nessun account, nessun cookie) oppure in una modalita cloud che usa Supabase per autenticazione e backup dei dati. Le due modalita sono alternative: se attivi il cloud, usa solo cookie tecnici necessari al login.",
    s5_title: "Click di download",
    s5_body:
      "Contiamo i click di download in forma aggregata e anonima, senza cookie né identificativi. Conserviamo solo il totale per ora, sistema operativo e parametri campagna validi. Allo stesso modo contiamo le visite arrivate dai link delle campagne (/r, /t): solo il totale per ora e per canale.",
    s6_title: "Open source",
    s6_body:
      "JHT e completamente open source. Puoi verificare in qualsiasi momento cosa fa il codice esaminando il repository su GitHub.",
    s7_title: "Contatti",
    s7_body: "Per domande sulla privacy, scrivi a support@jobhunterteam.ai.",
    nav_home: "Home",
    nav_privacy: "Privacy",
    nav_terms: "Termini",
  },
  en: {
    title: "Privacy Policy",
    updated: "Last updated: August 2026",
    intro:
      "Job Hunter Team (JHT) respects your privacy. This page explains how your data is handled.",
    s1_title: "Data collected",
    s1_body:
      "JHT runs inside a Docker container on your computer. We do not collect, transmit, or store personal data on our servers. Profile, CV, applications, and preferences stay in the local workspace folder created at first launch.",
    s2_title: "AI providers",
    s2_body:
      "Agents run on one of three supported CLIs (Claude Code, Codex, Kimi), each requiring your own active subscription with the respective provider. When an agent works, the CLI sends the request to the chosen provider and the text passes through their servers: their privacy policy applies. JHT does not intermediate those calls.",
    s3_title: "Provider authentication",
    s3_body:
      "You open the provider session yourself inside the container via the CLI login (claude login / codex login / kimi login). JHT never asks for or stores API keys; session tokens remain managed by the CLI itself, always locally.",
    s4_title: "Local and cloud mode",
    s4_body:
      "JHT can run purely locally (no account, no cookies) or in a cloud mode that uses Supabase for authentication and data backup. The two modes are alternatives: if you enable cloud, it only uses technical cookies strictly needed for login.",
    s5_title: "Download clicks",
    s5_body:
      "We count download clicks in anonymous aggregate form, without cookies or identifiers. We retain only the total by hour, operating system, and valid campaign parameters. We count visits arriving from campaign links (/r, /t) the same way: only the total by hour and channel.",
    s6_title: "Open source",
    s6_body:
      "JHT is fully open source. You can verify what the code does at any time by examining the repository on GitHub.",
    s7_title: "Contact",
    s7_body: "For privacy questions, write to support@jobhunterteam.ai.",
    nav_home: "Home",
    nav_privacy: "Privacy",
    nav_terms: "Terms",
  },
  hu: {
    title: "Adatvédelmi irányelvek",
    updated: "Utolsó frissítés: 2026 augusztus",
    intro:
      "A Job Hunter Team (JHT) tiszteletben tartja a magánéletedet. Ez az oldal elmagyarázza, hogyan kezeljük az adataidat.",
    s1_title: "Gyűjtött adatok",
    s1_body:
      "A JHT a számítógépeden futó Docker konténeren belül működik. Nem gyűjtünk, nem továbbítunk és nem tárolunk személyes adatokat a szervereinken. A profil, önéletrajz, jelentkezések és beállítások az első indításkor létrehozott helyi munkamappában maradnak.",
    s2_title: "AI szolgáltatók",
    s2_body:
      "Az ügynökök három támogatott CLI valamelyikén futnak (Claude Code, Codex, Kimi), amelyekhez saját aktív előfizetés kell az adott szolgáltatónál. Amikor egy ügynök dolgozik, a CLI a kiválasztott szolgáltatóhoz küldi a kérést, és a szöveg áthalad a szervereiken: az ő adatvédelmi szabályzatuk érvényes. A JHT nem közvetíti ezeket a hívásokat.",
    s3_title: "Szolgáltatói hitelesítés",
    s3_body:
      "A szolgáltatói munkamenetet te magad nyitod meg a konténeren belül a CLI bejelentkezéssel (claude login / codex login / kimi login). A JHT soha nem kér és nem tárol API kulcsot; a munkamenet tokenek a CLI kezelésében maradnak, mindig helyben.",
    s4_title: "Helyi és felhő mód",
    s4_body:
      "A JHT futhat tisztán helyben (fiók és süti nélkül) vagy felhő módban, amely Supabase-t használ hitelesítésre és adatok biztonsági mentésére. A két mód alternatív: ha a felhő módot választod, csak a bejelentkezéshez feltétlenül szükséges technikai sütiket használja.",
    s5_title: "Letöltési kattintások",
    s5_body:
      "A letöltési kattintásokat névtelen, összesített formában számoljuk, sütik és azonosítók nélkül. Csak az óránkénti, operációs rendszerenkénti és érvényes kampányparaméterenkénti összeget őrizzük meg. A kampánylinkekről (/r, /t) érkező látogatásokat ugyanígy számoljuk: csak az óránkénti és csatornánkénti összeget.",
    s6_title: "Nyílt forráskód",
    s6_body:
      "A JHT teljesen nyílt forráskódú. Bármikor ellenőrizheted, hogy mit csinál a kód, a GitHub-on található repository átvizsgálásával.",
    s7_title: "Kapcsolat",
    s7_body:
      "Adatvédelmi kérdések esetén írj az support@jobhunterteam.ai címre.",
    nav_home: "Főoldal",
    nav_privacy: "Adatvédelem",
    nav_terms: "Feltételek",
  },
  es: {
    title: "Política de Privacidad",
    updated: "Última actualización: Agosto de 2026",
    intro:
      "Job Hunter Team (JHT) respeta tu privacidad. Esta página explica cómo se tratan tus datos.",
    s1_title: "Datos recopilados",
    s1_body:
      "JHT se ejecuta dentro de un contenedor Docker en tu ordenador. No recopilamos, transmitimos ni almacenamos datos personales en nuestros servidores. El perfil, el CV, las candidaturas y las preferencias permanecen en la carpeta de trabajo local creada en el primer arranque.",
    s2_title: "Proveedores de IA",
    s2_body:
      "Los agentes se ejecutan en una de las tres CLI compatibles (Claude Code, Codex, Kimi), cada una de las cuales requiere tu propia suscripción activa con el proveedor correspondiente. Cuando un agente trabaja, la CLI envía la solicitud al proveedor elegido y el texto pasa por sus servidores: se aplica su política de privacidad. JHT no intermedia esas llamadas.",
    s3_title: "Autenticación del proveedor",
    s3_body:
      "La sesión del proveedor la abres tú mismo dentro del contenedor mediante el inicio de sesión de la CLI (claude login / codex login / kimi login). JHT nunca solicita ni almacena claves API; los tokens de sesión los gestiona la propia CLI, siempre en local.",
    s4_title: "Modo local y en la nube",
    s4_body:
      "JHT puede ejecutarse de forma puramente local (sin cuenta, sin cookies) o en un modo en la nube que utiliza Supabase para la autenticación y la copia de seguridad de los datos. Los dos modos son alternativos: si activas la nube, solo utiliza cookies técnicas estrictamente necesarias para el inicio de sesión.",
    s5_title: "Clics de descarga",
    s5_body:
      "Contamos los clics de descarga de forma agregada y anónima, sin cookies ni identificadores. Solo conservamos el total por hora, sistema operativo y parámetros de campaña válidos. Contamos igual las visitas que llegan desde los enlaces de campaña (/r, /t): solo el total por hora y canal.",
    s6_title: "Código abierto",
    s6_body:
      "JHT es completamente de código abierto. Puedes verificar en cualquier momento lo que hace el código examinando el repositorio en GitHub.",
    s7_title: "Contacto",
    s7_body:
      "Para cuestiones de privacidad, escribe a support@jobhunterteam.ai.",
    nav_home: "Inicio",
    nav_privacy: "Privacidad",
    nav_terms: "Términos",
  },
  de: {
    title: "Datenschutzerklärung",
    updated: "Letzte Aktualisierung: August 2026",
    intro:
      "Job Hunter Team (JHT) respektiert deine Privatsphäre. Diese Seite erklärt, wie deine Daten verarbeitet werden.",
    s1_title: "Erhobene Daten",
    s1_body:
      "JHT läuft in einem Docker-Container auf deinem Computer. Wir erheben, übertragen oder speichern keine personenbezogenen Daten auf unseren Servern. Profil, Lebenslauf, Bewerbungen und Einstellungen verbleiben im beim ersten Start angelegten lokalen Arbeitsordner.",
    s2_title: "KI-Anbieter",
    s2_body:
      "Die Agenten laufen über eine der drei unterstützten CLIs (Claude Code, Codex, Kimi), die jeweils dein eigenes aktives Abonnement beim entsprechenden Anbieter voraussetzen. Wenn ein Agent arbeitet, sendet die CLI die Anfrage an den gewählten Anbieter und der Text läuft über deren Server: Es gilt deren Datenschutzerklärung. JHT vermittelt diese Aufrufe nicht.",
    s3_title: "Anbieter-Authentifizierung",
    s3_body:
      "Die Anbieter-Sitzung öffnest du selbst innerhalb des Containers über den CLI-Login (claude login / codex login / kimi login). JHT fragt niemals nach API-Schlüsseln und speichert sie auch nicht; die Sitzungstoken werden weiterhin von der CLI selbst verwaltet, stets lokal.",
    s4_title: "Lokaler und Cloud-Modus",
    s4_body:
      "JHT kann rein lokal laufen (kein Konto, keine Cookies) oder in einem Cloud-Modus, der Supabase für Authentifizierung und Datensicherung verwendet. Die beiden Modi sind Alternativen: Wenn du die Cloud aktivierst, werden nur technische Cookies verwendet, die für den Login zwingend erforderlich sind.",
    s5_title: "Download-Klicks",
    s5_body:
      "Wir zählen Download-Klicks anonym und zusammengefasst, ohne Cookies oder Kennungen. Gespeichert werden nur Summen pro Stunde, Betriebssystem und gültigen Kampagnenparametern. Besuche über die Kampagnenlinks (/r, /t) zählen wir genauso: nur Summen pro Stunde und Kanal.",
    s6_title: "Open Source",
    s6_body:
      "JHT ist vollständig Open Source. Du kannst jederzeit überprüfen, was der Code tut, indem du das Repository auf GitHub untersuchst.",
    s7_title: "Kontakt",
    s7_body: "Bei Fragen zum Datenschutz schreibe an support@jobhunterteam.ai.",
    nav_home: "Startseite",
    nav_privacy: "Datenschutz",
    nav_terms: "Bedingungen",
  },
  fr: {
    title: "Politique de Confidentialité",
    updated: "Dernière mise à jour : août 2026",
    intro:
      "Job Hunter Team (JHT) respecte votre vie privée. Cette page explique comment vos données sont traitées.",
    s1_title: "Données collectées",
    s1_body:
      "JHT s'exécute dans un conteneur Docker sur votre ordinateur. Nous ne collectons, ne transmettons ni ne stockons de données personnelles sur nos serveurs. Le profil, le CV, les candidatures et les préférences restent dans le dossier de travail local créé au premier lancement.",
    s2_title: "Fournisseurs d'IA",
    s2_body:
      "Les agents fonctionnent sur l'une des trois CLI prises en charge (Claude Code, Codex, Kimi), chacune nécessitant votre propre abonnement actif auprès du fournisseur concerné. Lorsqu'un agent travaille, la CLI envoie la requête au fournisseur choisi et le texte transite par leurs serveurs : leur politique de confidentialité s'applique. JHT n'intermédie pas ces appels.",
    s3_title: "Authentification du fournisseur",
    s3_body:
      "Vous ouvrez vous-même la session du fournisseur à l'intérieur du conteneur via la connexion CLI (claude login / codex login / kimi login). JHT ne demande ni ne stocke jamais de clés API ; les jetons de session restent gérés par la CLI elle-même, toujours en local.",
    s4_title: "Mode local et cloud",
    s4_body:
      "JHT peut fonctionner uniquement en local (aucun compte, aucun cookie) ou dans un mode cloud qui utilise Supabase pour l'authentification et la sauvegarde des données. Les deux modes sont des alternatives : si vous activez le cloud, il n'utilise que les cookies techniques strictement nécessaires à la connexion.",
    s5_title: "Clics de téléchargement",
    s5_body:
      "Nous comptons les clics de téléchargement sous forme agrégée et anonyme, sans cookies ni identifiants. Nous conservons uniquement le total par heure, système d’exploitation et paramètres de campagne valides. Nous comptons de la même façon les visites venant des liens de campagne (/r, /t) : uniquement le total par heure et par canal.",
    s6_title: "Open source",
    s6_body:
      "JHT est entièrement open source. Vous pouvez vérifier à tout moment ce que fait le code en examinant le dépôt sur GitHub.",
    s7_title: "Contact",
    s7_body:
      "Pour toute question relative à la confidentialité, écrivez à support@jobhunterteam.ai.",
    nav_home: "Accueil",
    nav_privacy: "Confidentialité",
    nav_terms: "Conditions",
  },
  pt: {
    title: "Política de Privacidade",
    updated: "Última atualização: agosto de 2026",
    intro:
      "A Job Hunter Team (JHT) respeita a sua privacidade. Esta página explica como os seus dados são tratados.",
    s1_title: "Dados recolhidos",
    s1_body:
      "O JHT é executado dentro de um contentor Docker no seu computador. Não recolhemos, transmitimos nem armazenamos dados pessoais nos nossos servidores. Perfil, CV, candidaturas e preferências permanecem na pasta de trabalho local criada no primeiro arranque.",
    s2_title: "Fornecedores de IA",
    s2_body:
      "Os agentes funcionam numa das três CLI suportadas (Claude Code, Codex, Kimi), cada uma exigindo a sua própria subscrição ativa junto do respetivo fornecedor. Quando um agente trabalha, a CLI envia o pedido ao fornecedor escolhido e o texto passa pelos seus servidores: aplica-se a política de privacidade deles. O JHT não intermedeia essas chamadas.",
    s3_title: "Autenticação do fornecedor",
    s3_body:
      "A sessão do fornecedor é aberta por si próprio dentro do contentor através do início de sessão da CLI (claude login / codex login / kimi login). O JHT nunca solicita nem armazena chaves de API; os tokens de sessão continuam a ser geridos pela própria CLI, sempre localmente.",
    s4_title: "Modo local e na nuvem",
    s4_body:
      "O JHT pode funcionar de forma puramente local (sem conta, sem cookies) ou num modo na nuvem que utiliza o Supabase para autenticação e cópia de segurança dos dados. Os dois modos são alternativos: se ativar a nuvem, utiliza apenas cookies técnicos estritamente necessários para o início de sessão.",
    s5_title: "Cliques de download",
    s5_body:
      "Contamos os cliques de download de forma agregada e anónima, sem cookies nem identificadores. Conservamos apenas o total por hora, sistema operativo e parâmetros de campanha válidos. Contamos da mesma forma as visitas vindas dos links de campanha (/r, /t): apenas o total por hora e por canal.",
    s6_title: "Código aberto",
    s6_body:
      "O JHT é totalmente de código aberto. Pode verificar a qualquer momento o que o código faz examinando o repositório no GitHub.",
    s7_title: "Contacto",
    s7_body:
      "Para questões de privacidade, escreva para support@jobhunterteam.ai.",
    nav_home: "Início",
    nav_privacy: "Privacidade",
    nav_terms: "Termos",
  },
};

type TKey = keyof typeof T.it;

function Section({ title, body }: { title: string; body: string }) {
  return (
    <div className="mb-6">
      <h2 className="text-[14px] font-bold text-[var(--color-white)] mb-2">
        {title}
      </h2>
      <p className="text-[12px] text-[var(--color-muted)] leading-relaxed">
        {body}
      </p>
    </div>
  );
}

function PrivacyContent() {
  const { lang } = useLandingI18n();
  const tx = T[lang as keyof typeof T] ?? T.en;
  const t = (k: TKey) => tx[k] ?? k;

  const sections: [TKey, TKey][] = [
    ["s1_title", "s1_body"],
    ["s2_title", "s2_body"],
    ["s3_title", "s3_body"],
    ["s4_title", "s4_body"],
    ["s5_title", "s5_body"],
    ["s6_title", "s6_body"],
    ["s7_title", "s7_body"],
  ];

  return (
    <main
      style={{
        position: "relative",
        zIndex: 1,
      }}
    >
      <LandingNav />
      <div className="max-w-3xl mx-auto px-5 pt-32 pb-20">
        <div className="mb-8 pb-6 border-b border-[var(--color-border)]">
          <div className="flex items-center gap-2 mb-3">
            <Link
              href="/"
              className="text-[10px] text-[var(--color-dim)] hover:text-[var(--color-muted)] no-underline transition-colors"
            >
              {t("nav_home")}
            </Link>
            <span className="text-[var(--color-border)]">/</span>
            <span className="text-[10px] text-[var(--color-muted)]">
              {t("nav_privacy")}
            </span>
          </div>
          <h1 className="text-2xl font-bold tracking-tight text-[var(--color-white)]">
            {t("title")}
          </h1>
          <p className="text-[var(--color-dim)] text-[10px] mt-2">
            {t("updated")}
          </p>
          <p className="text-[var(--color-muted)] text-[12px] mt-3 leading-relaxed">
            {t("intro")}
          </p>
        </div>

        {sections.map(([titleKey, bodyKey]) => (
          <Section key={titleKey} title={t(titleKey)} body={t(bodyKey)} />
        ))}

        <div className="mt-12 pt-6 border-t border-[var(--color-border)] flex items-center justify-between">
          <Link
            href="/"
            className="text-[11px] text-[var(--color-dim)] hover:text-[var(--color-green)] transition-colors no-underline"
          >
            &larr; {t("nav_home")}
          </Link>
          <Link
            href="/terms"
            className="text-[11px] text-[var(--color-dim)] hover:text-[var(--color-green)] transition-colors no-underline"
          >
            {t("nav_terms")} &rarr;
          </Link>
        </div>
      </div>
      <LandingFooter />
      <ScrollToTop />
    </main>
  );
}

export default function PrivacyPage() {
  return (
    <LandingI18nProvider>
      <PrivacyContent />
    </LandingI18nProvider>
  );
}
