# Data Model

Markdown export of the Data Model spreadsheet — the source of truth for the
180Connect schema (SOP §7).

**These files are generated. Do not edit them.** Change the spreadsheet, then:

```bash
npm run export:data-model
```

and commit the result alongside your migration. A schema change should be visible
as a line diff in the pull request, so the reviewer can check the migration against
it — that is what the SOP §7 approval record asks for.

The `.xlsx` itself is not committed. It is binary (no diff, no merge — two people
editing it in one week means one of them loses work silently) and ~1.3 MB, mostly
System Map images. Keep your copy wherever the team shares it; this export is the
version the repository and its tooling read.

| Tab | Rows |
| :--- | ---: |
| [01 Data Lifecycle](01-data-lifecycle.md) | 16 |
| [02 Data Dictionary](02-data-dictionary.md) | 493 |
| [03 Raw Data](03-raw-data.md) | 145 |
| [04 Entities](04-entities.md) | 234 |
| [05 - Feature Store](05-feature-store.md) | 50 |
| [06 - Predictions](06-predictions.md) | 44 |
| [07 Outreach & Outcomes](07-outreach-outcomes.md) | 52 |
| [08 System Analytics](08-system-analytics.md) | 51 |
| [09 CAM Analytics](09-cam-analytics.md) | 45 |
| [11 Supasbase Migration Sequence](11-supasbase-migration-sequence.md) | 43 |

Source spreadsheet: `~/Downloads/Data Model.xlsx`
