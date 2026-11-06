# Current-season roster, rounds and admission

Approved organizer changes on 2026-11-05:

- Thirteen obsolete club labels are corrected to current clubs, retaining the legacy club IDs so fixture IDs, ownership, results and points remain attached. The correction is explicit, visible in the static catalog and also applied to cached HTTP payloads. Other seasons are not relabeled by HTTP normalization.
- Conference League is disabled in the participation policy and removed from the season-two catalog and draw-preview API. Stored historical data is retained.
- Selecting or opening the next round no longer requires previous games to finish. Advancing a league keeps prior gates available and sets the reached-round result-entry watermark. Explicit admin locks still take priority; scores and confirmation state are never changed by advancing.
- No automatic round-opening schedule was added. That schedule is deferred by the organizer.
- Starting staged club admission enables automatic progression. Only the active league accepts new claims; incomplete leagues cannot be skipped. The last claim and the next admission stage commit in the same transaction. Existing full leagues and withdrawn season-one Ligue 1 are skipped. Released clubs do not rewind the queue.
- Order: Premier League, La Liga, Serie A, Bundesliga, Ligue 1, Uzbekistan, Saudi Arabia, Japan, Turkey. Each league uses its own season roster size; counts do not assume 20 for every league.

Validation includes parallel last-club claims, nine-league progression, stable IDs/results/owners, disabled Conference endpoints, past unfinished results, backward navigation, explicit locks and current-round controls.

Roster references: current La Liga and Bundesliga official tables, Lega Serie A/Como official standings, PSG official Ligue 1 standings; the verified season-two roster catalog records the source season and original URLs. No real-world match results or standings are imported into EFL.
