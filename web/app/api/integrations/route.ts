import { NextResponse } from "next/server";
import fs from "fs";
import path from "path";
import { JHT_HOME } from "@/lib/jht-paths";
import type { Integration } from "@/lib/types";
import { requireAuth } from "@/lib/auth";

export const dynamic = "force-dynamic";

const JHT = JHT_HOME;
const CONFIG_PATH = path.join(JHT, "jht.config.json");
const CREDS_DIR = path.join(JHT, "credentials");

function modTime(p: string): string | null {
  try {
    return fs.statSync(p).mtime.toISOString().slice(0, 19).replace("T", " ");
  } catch {
    return null;
  }
}

function credFile(...names: string[]): string | null {
  for (const n of names) {
    const p = path.join(CREDS_DIR, n);
    if (fs.existsSync(p)) return p;
  }
  return null;
}

function checkTelegram(): Omit<Integration, "id" | "name" | "description"> {
  try {
    if (!fs.existsSync(CONFIG_PATH))
      return { status: "disconnected", detail: null, last_sync: null };
    const cfg = JSON.parse(fs.readFileSync(CONFIG_PATH, "utf-8"));
    const bots = cfg?.channels?.telegram?.bots;
    const roles = ["assistente", "capitano", "mentor"] as const;
    const configured = roles.filter((r) => bots?.[r]?.bot_token);
    if (configured.length === 0)
      return { status: "disconnected", detail: null, last_sync: null };
    if (configured.length < roles.length) {
      return {
        status: "configured",
        detail: `${configured.length}/3 bot configurati`,
        last_sync: modTime(CONFIG_PATH),
      };
    }
    return {
      status: "connected",
      detail: "3 bot configurati",
      last_sync: modTime(CONFIG_PATH),
    };
  } catch {
    return { status: "disconnected", detail: null, last_sync: null };
  }
}

function checkEnvOrCred(
  envKeys: string[],
  credNames: string[],
  label: string,
): Omit<Integration, "id" | "name" | "description"> {
  const envHit = envKeys.find((k) => process.env[k]);
  if (envHit)
    return {
      status: "connected",
      detail: `via env ${envHit}`,
      last_sync: null,
    };
  const file = credFile(...credNames);
  if (file)
    return {
      status: "configured",
      detail: path.basename(file),
      last_sync: modTime(file),
    };
  return { status: "disconnected", detail: null, last_sync: null };
}

export async function GET() {
  // Non restituisce segreti, ma dice quali esistono, con che nome di file e
  // quale variabile d'ambiente: è la mappa di dove cercarli.
  const denied = await requireAuth();
  if (denied) return denied;
  const integrations: Integration[] = [
    {
      id: "telegram",
      name: "Telegram",
      description: "Bot per notifiche e comandi del team",
      ...checkTelegram(),
    },
    {
      id: "github",
      name: "GitHub",
      description: "Push commit, PR e webhook repository",
      ...checkEnvOrCred(
        ["GITHUB_TOKEN", "GH_TOKEN"],
        ["github_token", "github.json"],
        "GitHub",
      ),
    },
    {
      id: "linkedin",
      name: "LinkedIn",
      description: "Ricerca posizioni e candidature automatiche",
      ...checkEnvOrCred(
        ["LINKEDIN_EMAIL", "LINKEDIN_PASS"],
        ["linkedin_cookies.json", "linkedin.json"],
        "LinkedIn",
      ),
    },
    {
      id: "gmail",
      name: "Gmail",
      description: "Invio email e gestione candidature",
      ...checkEnvOrCred(
        ["GMAIL_USER", "GMAIL_PASS", "GOOGLE_CREDENTIALS"],
        ["gmail_credentials.json", "gmail.json", "google_credentials.json"],
        "Gmail",
      ),
    },
    {
      id: "vercel",
      name: "Vercel",
      description: "Deploy automatico del frontend",
      ...checkEnvOrCred(
        ["VERCEL_TOKEN", "VERCEL_ORG_ID"],
        ["vercel_token", "vercel.json"],
        "Vercel",
      ),
    },
  ];
  const summary = {
    connected: integrations.filter((i) => i.status === "connected").length,
    configured: integrations.filter((i) => i.status === "configured").length,
    disconnected: integrations.filter((i) => i.status === "disconnected")
      .length,
  };
  return NextResponse.json({ integrations, summary });
}
