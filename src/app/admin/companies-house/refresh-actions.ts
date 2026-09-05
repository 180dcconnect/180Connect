"use server";

import { getCurrentActor, actorFailureMessage } from "@/lib/auth/actor";
import { reportError } from "@/lib/error-logging";

/**
 * The "Refresh register" button for the companies register, which asks GitHub
 * to rebuild the file.
 *
 * The twin of the charity register's refresh-actions: the rebuild streams ~2GB
 * of CSV and takes about twenty minutes, which no serverless function will
 * hold. So this does not do the work — it dispatches the workflow that does,
 * and reports back on it.
 *
 * ── What it needs ──
 *
 * `GITHUB_REGISTER_TOKEN`: a fine-grained token with **Actions: read and write**
 * on this repository only — the same token the charity refresh uses, since it
 * is scoped to the repository rather than the workflow.
 */

const WORKFLOW = "refresh-companies-register.yml";
const REPO = process.env.REGISTER_REPO?.trim() || "180dcconnect/180Connect";
// The repository's default branch, which is `dev` here rather than `main`.
// GitHub only exposes a workflow to `workflow_dispatch` — and only fires its
// `schedule` — once the file exists on the default branch, so dispatching
// against anything else fails with a 404 that reads like a missing workflow.
const BRANCH = process.env.REGISTER_WORKFLOW_REF?.trim() || "dev";

export type CompaniesRefreshState =
  | { kind: "idle" }
  | { kind: "error"; message: string }
  | { kind: "started"; message: string }
  | {
      kind: "running";
      status: string;
      startedAt: string | null;
      url: string | null;
    }
  | { kind: "finished"; success: boolean; message: string; url: string | null };

function token(): string | null {
  return process.env.GITHUB_REGISTER_TOKEN?.trim() || null;
}

async function github(path: string, init?: RequestInit): Promise<Response> {
  return fetch(`https://api.github.com${path}`, {
    ...init,
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${token()}`,
      "X-GitHub-Api-Version": "2022-11-28",
      ...(init?.headers ?? {}),
    },
    cache: "no-store",
  });
}

/**
 * Asks GitHub to run the refresh workflow.
 *
 * Gated on `platform-settings:manage` rather than the `client:edit` the rest of
 * this screen uses: choosing which companies to import is everyday work, but
 * spending a CI run and redeploying the app is not, and a stuck refresh is the
 * kind of thing one person should own.
 */
export async function refreshCompaniesRegister(): Promise<CompaniesRefreshState> {
  const authorization = await getCurrentActor("platform-settings:manage");
  if (!authorization.ok) {
    return { kind: "error", message: actorFailureMessage(authorization.reason) };
  }
  if (!token()) {
    return {
      kind: "error",
      message:
        "Refreshing from here is not configured on this deployment (GITHUB_REGISTER_TOKEN).",
    };
  }

  try {
    const response = await github(
      `/repos/${REPO}/actions/workflows/${WORKFLOW}/dispatches`,
      {
        method: "POST",
        body: JSON.stringify({
          ref: BRANCH,
          inputs: {
            reason: `Requested from the app by ${authorization.actor.id}`,
          },
        }),
      },
    );

    // 204 with no body is the documented success for a dispatch.
    if (response.status !== 204) {
      const detail = await response.text();
      throw new Error(`GitHub returned ${response.status}: ${detail.slice(0, 300)}`);
    }

    return {
      kind: "started",
      message:
        "Refresh started. It takes about twenty minutes, then the app redeploys " +
        "with the new register. You can leave this page.",
    };
  } catch (error) {
    await reportError(error, {
      operation: "admin.companies_register.refresh",
      actorUserId: authorization.actor.id,
    });
    return {
      kind: "error",
      message: "The refresh could not be started. The failure was recorded.",
    };
  }
}

/**
 * The most recent refresh run, so the button can show progress.
 *
 * Polled by the client while a refresh is in flight. Deliberately reports only
 * status and timing — the run's logs are GitHub's business, and the person on
 * this screen wants "is it done yet", not a build log.
 */
export async function companiesRefreshStatus(): Promise<CompaniesRefreshState> {
  const authorization = await getCurrentActor("platform-settings:manage");
  if (!authorization.ok) {
    return { kind: "error", message: actorFailureMessage(authorization.reason) };
  }
  if (!token()) return { kind: "idle" };

  try {
    const response = await github(
      `/repos/${REPO}/actions/workflows/${WORKFLOW}/runs?per_page=1`,
    );
    if (!response.ok) return { kind: "idle" };

    const body = (await response.json()) as {
      workflow_runs?: Array<{
        status: string;
        conclusion: string | null;
        run_started_at: string | null;
        html_url: string | null;
      }>;
    };
    const run = body.workflow_runs?.[0];
    if (!run) return { kind: "idle" };

    if (run.status !== "completed") {
      return {
        kind: "running",
        status: run.status,
        startedAt: run.run_started_at,
        url: run.html_url,
      };
    }

    const success = run.conclusion === "success";
    return {
      kind: "finished",
      success,
      url: run.html_url,
      message: success
        ? "The register was rebuilt. It reaches the app on the next deployment, which the refresh triggers automatically."
        : `The last refresh ${run.conclusion ?? "did not finish"}. The register still holds the previous data.`,
    };
  } catch {
    // A status check that fails is not worth an error banner: the refresh
    // either ran or it did not, and the next poll will say.
    return { kind: "idle" };
  }
}
