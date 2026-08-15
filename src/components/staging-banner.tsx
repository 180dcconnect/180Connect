/**
 * Shown on every signed-in page when NEXT_PUBLIC_ENV=staging, so external
 * accounts (e.g. a client preview) know this is not production: data can
 * change under them and the environment can be briefly unstable mid-deploy.
 */
export function StagingBanner() {
  if (process.env.NEXT_PUBLIC_ENV !== "staging") return null;

  return (
    <div
      role="status"
      className="bg-amber-50 px-4 py-2 text-center text-sm font-bold text-amber-900"
    >
      Preview environment — data here may change or reset, and the app can be briefly
      unstable during deploys.
    </div>
  );
}
