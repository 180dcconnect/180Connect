import { NextResponse } from "next/server";
import { getViewingActor, actorFailureMessage } from "@/lib/auth/actor";
import { createClient } from "@/lib/supabase/server";
import { reportError } from "@/lib/error-logging";
import { safeValidate, uuidField } from "@/lib/validation";
import {
  createDiscrepancyDetectionStore,
  previewFieldDiscrepancies,
} from "@/lib/discrepancies/detect-field-discrepancies";

/**
 * F042 merge dialog data — the dry run behind "Same charity, keep one record".
 *
 * Returns the fields where the incoming record and the existing client
 * disagree (both values, plus which side source priority would pick), without
 * writing anything. The admin picks the winners from these rows; confirming
 * then runs the same comparison with those picks as overrides, so the dialog
 * can never offer a different list from the one that gets applied.
 *
 * Read-only like the queue's own GET: viewers are refused by the same
 * permission, and the store only reads admin-only rows RLS already guards.
 */

function denied(reason: Parameters<typeof actorFailureMessage>[0]) {
  const status = reason === "unauthenticated" ? 401 : 403;
  return NextResponse.json({ error: actorFailureMessage(reason) }, { status });
}

export async function GET(request: Request) {
  const authorization = await getViewingActor("approval:manage", {
    route: "/admin/duplicates",
  });
  if (!authorization.ok) return denied(authorization.reason);

  const candidateId = new URL(request.url).searchParams.get("candidateId");
  const parsed = safeValidate(uuidField(), candidateId);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "That record could not be opened. Close and try again." },
      { status: 400 },
    );
  }

  try {
    const supabase = await createClient();
    const conflicts = await previewFieldDiscrepancies(
      parsed.data,
      createDiscrepancyDetectionStore(supabase),
    );
    return NextResponse.json({ conflicts });
  } catch (error) {
    await reportError(error instanceof Error ? error : new Error(String(error)), {
      operation: "admin.duplicates.preview",
    });
    return NextResponse.json(
      {
        error:
          "The two copies could not be compared. You can still keep one record — anything they disagree on will be flagged under Data discrepancies instead.",
      },
      { status: 500 },
    );
  }
}
