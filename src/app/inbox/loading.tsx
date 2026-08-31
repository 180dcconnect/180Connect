import { ThreadList } from "@/components/inbox/thread-list";

export default function InboxLoading() {
  return (
    <div className="p-6">
      <h2 className="text-xl font-semibold mb-4">Outreach Threads</h2>
      <ThreadList threads={[]} />
    </div>
  );
}
