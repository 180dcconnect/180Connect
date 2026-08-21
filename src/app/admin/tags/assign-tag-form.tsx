"use client";

// F191: assign an existing tag to a client, from the standalone /admin/tags
// page. Kept simple and admin-tool-shaped (organisation id, not a search
// picker) since a full client search UI is out of scope here — the
// tested, reusable assignTags function is what matters; a nicer picker can
// wrap it later once it has a home on a real client-facing page.

import { useState, useTransition } from "react";
import { assignTagAction } from "@/lib/tags/assign-tag-action";

export type AssignableTag = { id: string; name: string };

export function AssignTagForm({ tags }: { tags: AssignableTag[] }) {
  const [tagId, setTagId] = useState(tags[0]?.id ?? "");
  const [organisationId, setOrganisationId] = useState("");
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<{ text: string; isError: boolean } | null>(null);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setMessage(null);

    startTransition(async () => {
      const result = await assignTagAction(organisationId.trim(), tagId);

      if (!result.ok) {
        setMessage({ text: result.message, isError: true });
        return;
      }

      if (result.result.assigned.length > 0) {
        setMessage({ text: "Tag assigned.", isError: false });
      } else if (result.result.alreadyAssigned.length > 0) {
        setMessage({ text: "That client already has this tag.", isError: false });
      } else if (result.result.failed.length > 0) {
        setMessage({ text: result.result.failed[0].message, isError: true });
      }
    });
  }

  if (tags.length === 0) {
    return <p className="mt-3 text-sm text-black/50">No tags exist yet. Create one first.</p>;
  }

  return (
    <form onSubmit={handleSubmit} className="mt-6 flex flex-wrap items-end gap-3">
      <label className="flex flex-col gap-1 text-sm">
        <span className="text-black/55">Tag</span>
        <select
          value={tagId}
          onChange={(e) => setTagId(e.target.value)}
          disabled={pending}
          className="rounded-xl border border-black/[0.08] px-3 py-2 text-sm"
        >
          {tags.map((tag) => (
            <option key={tag.id} value={tag.id}>
              {tag.name}
            </option>
          ))}
        </select>
      </label>
      <label className="flex flex-col gap-1 text-sm">
        <span className="text-black/55">Organisation ID</span>
        <input
          type="text"
          value={organisationId}
          onChange={(e) => setOrganisationId(e.target.value)}
          placeholder="Paste a client's organisation id"
          disabled={pending}
          className="rounded-xl border border-black/[0.08] px-3 py-2 text-sm w-72"
        />
      </label>
      <button
        type="submit"
        disabled={pending || !organisationId.trim()}
        className="rounded-full bg-[--brand] px-5 py-2 text-sm font-bold text-white hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
      >
        {pending ? "Assigning…" : "Assign tag"}
      </button>
      {message && (
        <p
          className={`w-full text-sm font-medium ${message.isError ? "text-red-700" : "text-[--brand]"}`}
          role={message.isError ? "alert" : "status"}
        >
          {message.text}
        </p>
      )}
    </form>
  );
}
