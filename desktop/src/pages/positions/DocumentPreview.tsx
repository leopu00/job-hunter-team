import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import SafeMarkdown from "../../components/SafeMarkdown";
import { appLocale } from "../../lib/app-locale";
import { describeError } from "../../lib/error-catalog";
import { fill } from "../../lib/text-slots";
import { parseMarkdown, type ParsedMarkdown } from "../../lib/safe-markdown";
import {
  documentPreviewApi,
  previewErrorCode,
  type DocumentPreviewApi,
  type DocumentPreviewRequest,
} from "../../lib/team-document";
import { DOCUMENT_PREVIEW_TEXT } from "./document-preview.i18n";
import "./document-preview.css";

type Loaded<T> = { state: "idle" } | { state: "loading" } | { state: "ready"; value: T } | { state: "failed"; code: string };
interface Sheets {
  total: number;
  truncated: boolean;
  /** One entry per sheet: the PNG's base64 once it is there. */
  images: (string | null)[];
}

const FOCUSABLE = 'button:not([disabled]), [href], [tabindex]:not([tabindex="-1"])';

/**
 * A CV or a cover letter of the team, shown inside the app: the markdown as text and the PDF as the team's own
 * pictures of its sheets. The app never opens a PDF and never builds HTML from a document: the pictures are PNGs the
 * native side has already checked, the text goes through `parseMarkdown` into text nodes. The window opens only on a
 * click, shows the KIND of document and never its file name, and its document text is not a live region.
 */
export default function DocumentPreview({
  request,
  onClose,
  api = documentPreviewApi,
}: {
  request: DocumentPreviewRequest;
  onClose: () => void;
  api?: DocumentPreviewApi;
}) {
  const locale = appLocale();
  const t = DOCUMENT_PREVIEW_TEXT[locale];
  const [tab, setTab] = useState<"pdf" | "text">("pdf");
  const [sheets, setSheets] = useState<Loaded<Sheets>>({ state: "loading" });
  const [text, setText] = useState<Loaded<ParsedMarkdown>>({ state: "idle" });
  const [attempt, setAttempt] = useState(0);
  const [status, setStatus] = useState<{ kind: "saved" | "opened" } | { kind: "failed"; code: string } | null>(null);
  const [busy, setBusy] = useState<"save" | "open" | null>(null);
  const dialog = useRef<HTMLDivElement>(null);
  const opener = useRef<Element | null>(typeof document === "undefined" ? null : document.activeElement);
  const alive = useRef(true);

  // The window is the person's for as long as it is open; closing it gives the focus back to what opened it.
  useEffect(() => {
    alive.current = true;
    dialog.current?.focus();
    const back = opener.current;
    return () => {
      alive.current = false;
      if (back instanceof HTMLElement) back.focus();
    };
  }, []);

  // The sheets: how many there are, then one picture at a time, in order.
  useEffect(() => {
    let live = true;
    setSheets({ state: "loading" });
    (async () => {
      try {
        const described = await api.pages(request.name);
        if (!live) return;
        const images: (string | null)[] = Array.from({ length: described.pages }, () => null);
        setSheets({ state: "ready", value: { total: described.pages, truncated: described.truncated, images } });
        for (let page = 1; page <= described.pages; page++) {
          const png = await api.page(request.name, page, described.sha256);
          if (!live) return;
          images[page - 1] = png;
          setSheets({ state: "ready", value: { total: described.pages, truncated: described.truncated, images: [...images] } });
        }
      } catch (error) {
        if (live) setSheets({ state: "failed", code: previewErrorCode(error) });
      }
    })();
    return () => {
      live = false;
    };
  }, [api, request.name, attempt]);

  // The text, when its tab is asked for.
  useEffect(() => {
    if (tab !== "text" || text.state !== "idle" || !request.textName) return;
    let live = true;
    setText({ state: "loading" });
    api.text(request.textName).then(
      (markdown) => { if (live) setText({ state: "ready", value: parseMarkdown(markdown) }); },
      (error) => { if (live) setText({ state: "failed", code: previewErrorCode(error) }); },
    );
    return () => {
      live = false;
    };
  }, [api, request.textName, tab, text.state]);

  const act = useCallback(
    async (kind: "save" | "open") => {
      setBusy(kind);
      setStatus(null);
      try {
        if (kind === "save") {
          const outcome = await api.save(request.name);
          if (alive.current && outcome === "saved") setStatus({ kind: "saved" });
        } else {
          await api.open(request.name);
          if (alive.current) setStatus({ kind: "opened" });
        }
      } catch (error) {
        if (alive.current) setStatus({ kind: "failed", code: previewErrorCode(error) });
      } finally {
        if (alive.current) setBusy(null);
      }
    },
    [api, request.name],
  );

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Escape") {
      event.stopPropagation();
      onClose();
      return;
    }
    if (event.key !== "Tab" || !dialog.current) return;
    const items = Array.from(dialog.current.querySelectorAll<HTMLElement>(FOCUSABLE));
    if (items.length === 0) return;
    const first = items[0];
    const last = items[items.length - 1];
    const active = document.activeElement;
    if (event.shiftKey && (active === first || active === dialog.current)) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && active === last) {
      event.preventDefault();
      first.focus();
    }
  };

  const title = request.kind === "cv" ? t.kindCv : t.kindLetter;
  const failure = useMemo(() => {
    const code = status?.kind === "failed" ? status.code : tab === "pdf" ? (sheets.state === "failed" ? sheets.code : null) : text.state === "failed" ? text.code : null;
    return code ? describeError(code, { fallback: "read_failed", locale }) : null;
  }, [locale, sheets, status, tab, text]);

  return (
    <div className="docprev" role="presentation">
      <div
        ref={dialog}
        className="docprev__dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="docprev-title"
        tabIndex={-1}
        onKeyDown={onKeyDown}
      >
        <header className="docprev__header">
          <h2 id="docprev-title">{title}</h2>
          <button type="button" className="docprev__close" onClick={onClose}>{t.close}</button>
        </header>
        <div className="docprev__bar">
          <div role="tablist" aria-label={t.tabsLabel} className="docprev__tabs">
            {(["pdf", "text"] as const).map((id) => (
              <button
                key={id}
                type="button"
                role="tab"
                id={`docprev-tab-${id}`}
                aria-selected={tab === id}
                aria-controls="docprev-panel"
                className={`docprev__tab${tab === id ? " docprev__tab--on" : ""}`}
                onClick={() => setTab(id)}
              >
                {id === "pdf" ? t.tabPdf : t.tabText}
              </button>
            ))}
          </div>
          <div className="docprev__actions">
            <button type="button" disabled={busy !== null} onClick={() => void act("open")}>{t.openInReader}</button>
            <button type="button" disabled={busy !== null} onClick={() => void act("save")}>{t.save}</button>
          </div>
        </div>
        {/* what the window says about itself, never the document: a status line and an error line, nothing of the file */}
        <p role="status" className="docprev__status">
          {sheets.state === "loading" && tab === "pdf" ? t.loading : text.state === "loading" && tab === "text" ? t.loading : ""}
          {status?.kind === "saved" ? t.saved : status?.kind === "opened" ? t.opened : ""}
        </p>
        {failure && (
          <p role="alert" className="docprev__error">
            {failure.text} {failure.action}{" "}
            {status === null && tab === "pdf" && (
              <button type="button" className="docprev__retry" onClick={() => setAttempt((n) => n + 1)}>{t.retry}</button>
            )}
          </p>
        )}
        <div id="docprev-panel" role="tabpanel" aria-labelledby={`docprev-tab-${tab}`} className="docprev__panel">
          <div className="docprev__sheet" data-testid="document-sheet">
            {tab === "pdf" && sheets.state === "ready" && (
              <>
                {sheets.value.images.map((png, index) =>
                  png ? (
                    <img
                      key={index}
                      className="docprev__page"
                      alt={fill(t.sheetAlt, { n: index + 1, total: sheets.value.total })}
                      src={`data:image/png;base64,${png}`}
                    />
                  ) : null,
                )}
                {sheets.value.truncated && <p className="docprev__note">{fill(t.sheetsCut, { n: sheets.value.total })}</p>}
              </>
            )}
            {tab === "text" && !request.textName && <p className="docprev__note">{t.noText}</p>}
            {tab === "text" && text.state === "ready" && (
              <>
                <SafeMarkdown parsed={text.value} />
                {text.value.truncated && <p className="docprev__note">{t.textCut}</p>}
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
