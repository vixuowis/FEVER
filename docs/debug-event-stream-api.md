# Debug Session: event-stream-api [OPEN]

## Symptom
- Frontend appears unable to fetch real event stream.
- User wants to verify whether the API is actually working.

## Scope
- Check backend API availability and response shape for event-stream related endpoints.
- Do not modify business logic before runtime evidence is collected.

## Hypotheses
1. Event-stream backend route is missing or registered on a different path.
2. Route exists, but upstream real-market fetch fails and returns fallback or error.
3. Route returns successfully, but payload shape does not match frontend expectations.
4. Refresh/cache branch behaves differently and breaks real-time fetching.

## Evidence Plan
- Inspect backend route registration.
- Hit relevant APIs directly and compare status codes and payloads.
- Inspect backend runtime logs for the failing request path.
- Add instrumentation only if direct runtime evidence is insufficient.

## Status
- Session opened.
- No business logic changed.

## Runtime Evidence
- `GET /health` returns `200` with `{"status":"ok","maas":"configured","qveris":"configured"}`.
- `GET /api/dashboard?refresh=true` returns `200`, but payload contains `"events":[]`.
- `GET /api/research/autonomous?event_id=1&refresh=true` returns `404 {"detail":"Event not found"}`.
- Backend runtime log shows repeated `200` for `/api/dashboard` and repeated `404` for `/api/research/autonomous`.
- Direct runtime check of `build_live_dashboard(get_settings(), force_refresh=True)` shows `events 0`.
- Direct runtime check of parser inputs shows `macro=0, earn=0, news=0, watch_news=0, watch_earn=0`.
- Direct upstream tool execution evidence:
  - `qveris_finance.event_calendar_macro` returns `success: false`
  - `result: null`
  - `error: HTTP 402 ... Insufficient credits`

## Interim Conclusion
- Hypothesis 1 is rejected: routes are registered and responding.
- Hypothesis 2 is confirmed: upstream real-event fetching is failing before parsing, due to insufficient credits.
- Hypothesis 3 is not the primary blocker in the current run, because the payload is empty before frontend consumption.
- Hypothesis 4 is rejected as primary cause: refresh path also returns empty events because upstream fetch still fails.

## Rate-Limit Findings
- Frontend currently issues duplicate dashboard fetches on mount:
  - one initial `refreshDashboard()` effect
  - one live-mode `refreshDashboard(force=true)` effect
- Frontend also independently polls:
  - dashboard
  - live insight
  - autonomous research
- Development build uses React `StrictMode`, which can re-run mount effects and amplify request count during local testing.

## Practical Impact
- Even without user interaction, local dev can send repeated requests for:
  - `/api/dashboard`
  - `/api/live/insight`
  - `/api/research/autonomous`
- Under insufficient credits, this creates repeated failing upstream attempts unless guarded.

## Recharge Re-test
- User indicated credits were recharged.
- Re-test used a single direct request:
  - `GET /api/dashboard?refresh=true`
- Result:
  - response `200`
  - `events` recovered from `0` to `5`
  - sample event id observed: `1650898925`
- Existing backend runtime logs now show:
  - `/api/dashboard?refresh=true` -> `200`
  - `/api/live/insight?event_id=1650898925` -> `200`
  - `/api/research/autonomous?event_id=1650898925&case_id=...&refresh=true` -> `200`

## Updated Conclusion
- Real event stream API is working again after recharge.
- Autonomous research chain is also working again.
- The remaining issue is request amplification in frontend dev mode, not API availability.
