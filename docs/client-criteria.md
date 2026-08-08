# Client criteria (F047)

The reviewed configuration is `src/lib/client-criteria-config.ts`; the decision
function is `src/lib/client-criteria.ts`. Imports and future Manual Entry must call
that shared function rather than copying these rules.

- Charities and organisations registered as both charity and company meet the criteria.
- A company or `other` record is held for admin review until there is evidence that it
  is a non-profit, social enterprise, NGO, or socially focused startup.
- Sheffield and South Yorkshire organisations are prioritised, using Sheffield,
  Rotherham, Barnsley, Doncaster and `S`/`DN` postcode signals.
- National and international organisations remain eligible; geography is not an
  exclusion rule.
- Healthcare alignment is desirable and recorded as a signal, not required.
- An unknown organisation type does not meet the criteria.

Records that need human review and records that definitely do not meet the
criteria are both kept out of the active client list, but they are not collapsed:
`DATA_QUALITY_EVENTS.rule_name` stores `client_criteria_needs_review` or
`client_criteria_does_not_meet`, together with the configured reasons. Admins can
therefore query the review candidates independently from definite failures.

To change the policy, update the exported `CLIENT_CRITERIA` object and its tests in
the same pull request so the change is explicit and reviewable.

Manual Entry is not yet present in the application. Its save path must call
`checkClientCriteria` before it can satisfy F047 AC1 end-to-end.
