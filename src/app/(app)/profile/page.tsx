import { redirect } from "next/navigation";

/**
 * The profile screen moved into the settings area (F200), where it sits beside
 * the form that edits it. This route stays as a redirect rather than being
 * deleted: `/profile` is a URL people have in their history and in links, and a
 * 404 is a worse answer than the page they wanted.
 */
export default function ProfilePage() {
  redirect("/settings/profile");
}
