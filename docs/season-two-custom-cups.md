# Season two: EFL custom domestic cups

The organizer selected the existing EFL cup format for all nine prepared leagues.
These are EFL competitions named after domestic cups; real federation entrant totals and lower divisions do not apply.

| League size | Direct to last 16 | Play-in positions | Play-in games | Total games |
| --- | --- | --- | --- | --- |
| 20 | 1–12 | 13–20 | 4 | 19 |
| 18 | 1–14 | 15–18 | 2 | 17 |
| 16 | 1–16 | None | 0 | 15 |

All ties are one match. After any play-in: last 16, quarter-finals, semi-finals, final.
Only clubs in that league's verified season-two roster are eligible (168 across nine cups).
Standings positions are from EFL season two, never the alphabetical roster order or real-world results.
Actual pairing remains a pending draw; the structural preview contains rank slots, not assigned clubs.

GET /api/seasons/preparation/cups/:cupId/bracket returns a non-persisted rank-slot template.
It cannot create fixtures or modify the live season.

The existing live cup administration remains season-one scoped. Runtime transition, super cup plans,
UEFA access lists/entrants, source-season archival and a start date remain separate preparation tasks.
This change does not activate a season or alter the approved 32-team ACL or 36-team UEFA plans.
