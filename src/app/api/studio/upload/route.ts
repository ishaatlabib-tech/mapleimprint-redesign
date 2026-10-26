import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { STUDIO_SESSION_COOKIE } from "@/lib/studio/session";
import { saveUpload, isSaveUploadError } from "@/lib/uploads/saveUpload";

export async function POST(request: Request) {
  const cookieStore = await cookies();
  const sessionToken = cookieStore.get(STUDIO_SESSION_COOKIE)?.value;
  if (!sessionToken) {
    return NextResponse.json({ error: "Missing Studio session. Reload the page and try again." }, { status: 400 });
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

  const result = await saveUpload({ sessionToken, file, category: "studio-image", mirrorToDrive: false });
  if (isSaveUploadError(result)) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }

  // `url` kept as the primary field for every existing caller that only reads it; `assetId` is
  // additive so Studio can start threading it onto DesignObjectRecord.assetId.
  return NextResponse.json({ url: result.publicUrl, assetId: result.assetId });
}
