// @vitest-environment jsdom
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import path from "node:path";
import { JSDOM } from "jsdom";
import { describe, expect, it, vi } from "vitest";
import ContactForm, {
  type ContactStrings,
} from "../../../web/app/contact/ContactForm";
import {
  publicContactPayload,
  validReplyEmail,
} from "../../../web/lib/feedback-contact";

const REPO = path.resolve(__dirname, "../../..");
const webRequire = createRequire(path.join(REPO, "web/package.json"));
const { createElement } = webRequire("react");
const { act } = webRequire("react");
const { createRoot } = webRequire("react-dom/client");
const { renderToStaticMarkup } = webRequire("react-dom/server");

const STRINGS: ContactStrings = {
  kind_label: "Topic",
  kind_support: "Support",
  kind_question: "Question",
  kind_partnership: "Partnership",
  kind_privacy: "Privacy",
  name: "Name",
  name_ph: "Your name",
  email: "Email (optional)",
  email_ph: "name@example.com",
  subject: "Subject",
  subject_ph: "What is it about",
  report_intro: "Add your email only if you want a reply.",
  message: "Message",
  message_ph: "What happened",
  data_title: "Data being sent",
  data_body: "Email is used only as a reply address.",
  data_page: "Page",
  data_language: "Language",
  data_client: "Website",
  send: "Send",
  sending: "Sending",
  sent_title: "Sent",
  sent_body: "Delivered",
  sent_ticket: "Reference: %s",
  sent_again: "Send another",
  error_subject: "Add a subject",
  error_email: "Invalid email",
  error_short: "Too short",
  error_send: "Not sent",
  error_offline: "Offline",
  error_rate: "Rate limited",
};

describe("O-87 — recapito del modulo pubblico", () => {
  it("rende un campo email facoltativo con il nome del contratto server", () => {
    const document = new JSDOM(
      renderToStaticMarkup(
        createElement(ContactForm, { t: STRINGS, locale: "en" }),
      ),
    ).window.document;
    const email = document.querySelector<HTMLInputElement>(
      'input[name="reply_to"]',
    );

    expect(email?.type).toBe("email");
    expect(email?.autocomplete).toBe("email");
    expect(email?.required).toBe(false);
    expect(document.querySelector('label[for="c-email"]')?.textContent).toBe(
      "Email (optional)",
    );
  });

  it("consegna il recapito come reply_to, distinto dal racconto", () => {
    const payload = publicContactPayload({
      message: "The public page stays blank",
      email: "  reporter@example.com ",
      locale: "en",
      website: "",
    });

    expect(payload).toMatchObject({
      client: "web-contact",
      happened: "The public page stays blank",
      reply_to: "reporter@example.com",
    });
    expect(payload.happened).not.toContain(payload.reply_to);
  });

  it("la submit reale inoltra il recapito al confine HTTP", async () => {
    const fetchMock = vi.fn(async () =>
      Response.json({ ok: true, ticket: "JHT-E2E" }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const container = document.createElement("div");
    const root = createRoot(container);
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;

    await act(async () => {
      root.render(createElement(ContactForm, { t: STRINGS, locale: "en" }));
    });
    const email = container.querySelector<HTMLInputElement>("#c-email")!;
    const message = container.querySelector<HTMLTextAreaElement>("#c-msg")!;
    const setInput = Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value",
    )!.set!;
    const setTextarea = Object.getOwnPropertyDescriptor(
      HTMLTextAreaElement.prototype,
      "value",
    )!.set!;
    await act(async () => {
      setInput.call(email, "reporter@example.com");
      email.dispatchEvent(new Event("input", { bubbles: true }));
      setTextarea.call(message, "The public page stays blank");
      message.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => {
      container
        .querySelector("form")!
        .dispatchEvent(
          new Event("submit", { bubbles: true, cancelable: true }),
        );
    });

    expect(fetchMock).toHaveBeenCalledOnce();
    const [, init] = fetchMock.mock.calls[0]!;
    expect(JSON.parse(String(init?.body))).toMatchObject({
      happened: "The public page stays blank",
      reply_to: "reporter@example.com",
    });

    await act(async () => root.unmount());
    vi.unstubAllGlobals();
  });

  it("preserva l'invio anonimo e rifiuta recapiti non validi prima della rete", () => {
    expect(
      publicContactPayload({
        message: "The public page stays blank",
        email: "",
        locale: "en",
        website: "",
      }).reply_to,
    ).toBe("");
    expect(validReplyEmail("")).toBe(true);
    expect(validReplyEmail("reporter@example.com")).toBe(true);
    expect(
      validReplyEmail("reporter@example.com\nBcc: other@example.com"),
    ).toBe(false);
  });

  it("spiega uso e facoltatività del recapito in tutte le sette lingue", () => {
    const source = readFileSync(
      path.join(REPO, "web/app/contact/page.tsx"),
      "utf8",
    );
    const catalogue = source.slice(
      source.indexOf("const T:"),
      source.indexOf("const SUPPORT"),
    );
    for (const label of [
      "Email (facoltativa)",
      "Email (optional)",
      "Correo (opcional)",
      "Email (facultatif)",
      "E-Mail (optional)",
      "Email (opcional)",
      "E-mail (nem kötelező)",
    ]) {
      expect(source).toContain(`email: "${label}"`);
    }
    expect(catalogue.match(/privacy_note:/g)).toHaveLength(7);
    expect(catalogue.match(/report_intro:/g)).toHaveLength(7);
    expect(catalogue.match(/data_body:/g)).toHaveLength(7);
  });
});
