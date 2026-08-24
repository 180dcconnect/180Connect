"use server";

import { revalidatePath } from "next/cache";
import { createTag } from "@/lib/tags/create-tag.ts";
import type { CreateTagResult } from "@/lib/tags/create-tag-core.ts";

export async function createTagFormAction(
  previous: CreateTagResult | null,
  formData: FormData,
): Promise<CreateTagResult> {
  void previous;
  const name = String(formData.get("name") ?? "");
  // F194 AC1: "" (no swatch chosen) means colourless — createTagCore's
  // parser treats absent as null, so the raw form value can go straight in.
  const colour = formData.get("colour");
  const result = await createTag(name, colour);
  if (result.ok) {
    revalidatePath("/admin/tags");
  }
  return result;
}
