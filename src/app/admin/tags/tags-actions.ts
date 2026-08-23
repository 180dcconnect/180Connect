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
  const result = await createTag(name);
  if (result.ok) {
    revalidatePath("/admin/tags");
  }
  return result;
}
