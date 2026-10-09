# EFL UZ — Runtime Firestore Request & Read Map

## Overview & Architecture

This document maps all runtime request flows between the React frontend, Express API routes, and Firestore database collections. It details exact read counts, caching policies, and quota conservation guarantees.

---

## 1. UI View to Firestore Query Mapping

| Frontend View / Component | API Endpoint | Backend Store Function | Firestore Collections Queried | Read Count (Cold) | Read Count (Warm / Cache Hit) | Caching Strategy & TTL |
|---|---|---|---|---|---|---|
| **App Startup / Auth** (`AuthContext`) | `/api/seasons` | Static Seed Data | None | **0** | **0** | Client: 30 min / Memory |
| **Telegram Auth** (`AuthContext`) | `/api/auth/telegram` | `getUserByTelegramIdFirestore`, `getCurrentClubOccupancyFirestore` | `users`, `club_occupancies` | **2** | **0** | Server: 30s TTL, Client: 15s TTL |
| **Dev Auth** (`AuthContext`) | `/api/auth/dev` | `getUserByIdFirestore`, `getCurrentClubOccupancyFirestore` | `users`, `club_occupancies` | **2** | **0** | Server: 30s TTL, Client: 15s TTL |
| **Dashboard** (`DashboardView`) | `/api/users/me` | `getMe` | `users`, `club_occupancies` | **0** (Deduplicated with Auth) | **0** | Client: 15s TTL + in-flight dedupe |
| **Dashboard / My Matches** (`DashboardView`, `MyMatchesView`) | `/api/fixtures/my` | `getMyMatchesFirestore` | `fixtures` (home + away indexed query) | **2** | **0** | Server: 15s TTL, Client: 15s TTL |
| **Clubs List** (`ClubsView`) | `/api/leagues/:id/clubs` | `getClubsByLeagueFirestore` | `club_occupancies` (seeds cached in memory) | **1** | **0** | Server: 60s TTL, Client: 120s TTL |
| **Standings** (`StandingsView`) | `/api/competitions/:id/standings` | `getCompetitionStandingsFirestore` | `standings` (single document) | **1** | **0** | Server: 60s TTL, Client: 120s TTL |
| **Cup Brackets** (`CupBracketsView`) | `/api/competitions/:id/knockout` | `getKnockoutBracketFirestore` | `fixtures` (single competition query) | **1** | **0** | Server: 60s TTL, Client: 60s TTL |
| **Admin Overview** (`AdminView`) | `/api/admin/overview` | Aggregated Admin Overview | `users` (count), `club_occupancies` (count), `competitions`, `disputes`, `audit_logs` | **4** | **0** | Server: 15s TTL, Client: 15s TTL |
| **Admin Clubs** (`AdminView`) | `/api/admin/clubs` | `getAllClubsWithOccupancyFirestore` | `club_occupancies` | **1** | **0** | Server: 30s TTL, Client: 60s TTL |
| **Admin Matches** (`AdminView`) | `/api/admin/fixtures` | `getFixturesFirestore` | `fixtures` | **1** | **0** | Server: 20s TTL, Client: 30s TTL |
| **Admin Disputes** (`AdminView`, `App`) | `/api/admin/disputes` | `getDisputesFirestore` | `disputes` | **1** | **0** | Server: 20s TTL, Client: 30s TTL |
| **Admin Users** (`AdminView`) | `/api/admin/users` | `getAllUsersFirestore` | `users` | **1** | **0** | Server: 30s TTL, Client: 30s TTL |
| **Admin Audit Logs** (`AdminView`) | `/api/admin/audit-logs` | `getAuditLogsFirestore` | `audit_logs` | **1** | **0** | Server: 20s TTL, Client: 30s TTL |
| **Read Metrics & Quota** (`AdminView`) | `/api/admin/read-metrics` | `getReadMetrics` | In-memory server tracker (No Firestore reads) | **0** | **0** | Live Server Memory |

---

## 2. Quota Consumption Analysis

### A. Regular User Session
- **Cold Boot (App Load + Dashboard)**:
  - Auth lookup: 2 reads
  - User fixtures query: 2 reads
  - **Total Cold Reads**: **4 reads** (Under the 5-read ceiling)
- **Warm Navigation (Switching between Dashboard, My Matches, Standings, Clubs)**:
  - All responses served from memory cache (TTL 15s–120s)
  - **Total Warm Reads**: **0 reads**

### B. Administrator Session
- **Cold Overview Load**:
  - Aggregated overview query: 4 reads
  - **Total Cold Reads**: **4 reads** (Under the 10-read ceiling)
- **Warm Tab Navigation (Switching between Overview, Clubs, Matches, Results, System)**:
  - Already-loaded tabs retain state without refetching (`loadedTabs` set)
  - Memory-cached queries return instantaneously
  - **Total Warm Reads**: **0 reads**

---

## 3. Background Polling Policy

- **Passive Users**: ZERO background polling.
- **Administrators**: Dispute checks execute ONLY when:
  1. The user is an authenticated administrator.
  2. The active view is currently the Admin panel (`activeTab === 'admin'`).
  3. The browser tab is active/visible (`!document.hidden`).
  4. Minimum polling interval: **5 minutes (300,000 ms)**.

---

## 4. Result Submission & Write Safety

When a user submits a match result:
1. **Validation**: Verified against occupancy and fixture state.
2. **Atomic Firestore Write / Update**: Result or confirmation written in 1 atomic write operation.
3. **Standings Incremental Update**: Recalculated and persisted in 1 write.
4. **Cache Invalidation**: Target fixture cache and standings cache keys are cleanly purged so subsequent reads retrieve fresh data.
5. **SQLite Fallback**: In the event of network disconnection or Firestore quota exhaustion (`RESOURCE_EXHAUSTED` / HTTP 429), results and submissions are saved to local SQLite storage with status queued for sync, preventing user data loss.
