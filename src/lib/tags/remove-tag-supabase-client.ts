// F192: the real Supabase write for Remove Tag from Client, extracted from
// remove-tag.ts into its own module so the actual query shape — a DELETE
// scoped by (organisation_id, tag_id) together, per AC1 — is unit-testable
// without a real Next.js request context. Same reasoning as F188's
// create-tag-supabase-client.ts.

export interface OrgTagSupabase {
  from(table: string): {
    delete(): {
      eq(column: string, value: string): {
        eq(
          column: string,
          value: string,
        ): PromiseLike<{ error: { message: string } | null }>;
      };
    };
  };
}

export type ReportFn = (
  error: unknown,
  context: Record<string, unknown>,
) => Promise<void>;

export function buildSupabaseOrgTagDeleteClient(
  supabase: OrgTagSupabase,
  reportError: ReportFn,
  actorUserId: string,
) {
  return {
    async deleteOrgTag(
      organisationId: string,
      tagId: string,
    ): Promise<{ ok: true } | { ok: false; message: string }> {
      const { error } = await supabase
        .from("org_tags")
        .delete()
        .eq("organisation_id", organisationId)
        .eq("tag_id", tagId);

      if (error) {
        await reportError(error, {
          operation: "tags.remove",
          actorUserId,
          organisationId,
          tagId,
        });
        return { ok: false, message: error.message };
      }
      return { ok: true };
    },
  };
}
