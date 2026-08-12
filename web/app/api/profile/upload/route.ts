import { NextRequest, NextResponse } from "next/server";
import { requireAuth, requireLocalWrite } from "@/lib/auth";
import {
  saveUserDocument,
  UserDocumentUploadError,
} from "@/lib/user-document-upload.server";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const denied = await requireAuth();
  if (denied) return denied;
  const ro = await requireLocalWrite();
  if (ro) return ro;
  let formData: FormData;
  try {
    formData = await req.formData();
  } catch {
    return NextResponse.json(
      { error: "form data non valido" },
      { status: 400 },
    );
  }

  const files = formData.getAll("files") as File[];
  if (!files.length) {
    return NextResponse.json(
      { error: "nessun file ricevuto" },
      { status: 400 },
    );
  }

  const saved: string[] = [];
  const errors: string[] = [];

  for (const file of files) {
    try {
      saved.push((await saveUserDocument(file)).name);
    } catch (error) {
      errors.push(
        error instanceof UserDocumentUploadError
          ? error.message
          : `${file.name}: errore di scrittura`,
      );
    }
  }

  return NextResponse.json({ ok: true, saved, errors });
}
