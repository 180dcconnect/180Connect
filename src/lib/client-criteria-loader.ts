// The client criteria config with the branch's priority towns as saved in score
// settings.
//
// "Which places matter to this branch" is one decision. Score settings is where
// an admin makes it (MODEL_VERSIONS.config geography.priorityTowns), and both the
// geography score and the import criteria's "is this client local" test read the
// answer — so a town added there changes how clients score AND how new imports
// are flagged, never one without the other. CLIENT_CRITERIA.priorityCities stays
// as the fallback when the saved config cannot be read.
//
// Server-only: reading the active config needs the service role.

import "server-only";

// Relative imports: sits on write-organisations.ts's import chain, which runs
// under `node --test`.
import { CLIENT_CRITERIA, type ClientCriteriaConfig } from "./client-criteria-config.ts";
import { getActiveScoutConfig } from "./scoring/configured-weights.ts";
import { DEFAULT_SCORING_RULES, townsForCriteria } from "./scoring/scout-config.ts";

export async function loadClientCriteria(): Promise<ClientCriteriaConfig> {
  const config = await getActiveScoutConfig();
  return {
    ...CLIENT_CRITERIA,
    priorityCities: townsForCriteria(config.rules ?? DEFAULT_SCORING_RULES),
  };
}
