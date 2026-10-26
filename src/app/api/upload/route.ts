import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { STUDIO_SESSION_COOKIE } from "@/lib/studio/session";
import { saveUpload, isSaveUploadError } from "@/lib/uploads/saveUpload";

// Quote-wizard / Mystery-Designer's-Choice file attachment. Previously wrote straight to Google
// Drive with no Supabase row at all — now goes through the same saveUpload() path Studio's own
// upload route uses (same bucket, a real Asset row), with Drive kept as a best-effort secondary
// mirror so staff's existing click-to-view-in-Sheets workflow keeps working.
export async function POST(request: Request) {
  // The client is responsible for calling getOrCreateClientSessionToken() before uploading (same
  // pattern every product configurator already uses before entering Studio) — this route just
  // requires the resulting cookie to exist, exactly like /api/studio/upload does, so every Asset
  // row this produces is owner-scoped the same way regardless of which form uploaded it.
  const cookieStore = await cookies();
  const sessionToken = cookieStore.get(STUDIO_SESSION_COOKIE)?.value;
  if (!sessionToken) {
    return NextResponse.json({ error: "Missing session. Reload the page and try again." }, { status: 400 });
  }

  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return NextResponse.json({ error: "Invalid upload request." }, { status: 400 });
  }

  const file = formData.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "No file provided." }, { status: 400 });
  }

  const result = await saveUpload({ sessionToken, file, category: "production-file", mirrorToDrive: true });
  if (isSaveUploadError(result)) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }

  // Response shape kept backward-compatible with the old Drive-only response (fileId/fileName/
  // webViewLink) for any caller that only reads those, with assetId/publicUrl added.
  return NextResponse.json({
    fileId: result.assetId,
    fileName: result.fileName,
    webViewLink: result.driveLink,
    assetId: result.assetId,
    publicUrl: result.publicUrl,
  });
}
