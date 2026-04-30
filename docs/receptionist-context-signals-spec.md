# Receptionist Workspace - Context Signals (MVP Spec)

> Status: Revised for MVP implementation
> Audience: Engineering and design
> Scope: Receptionist workspace center card ("The Desk") + minimal patient-app/check-in changes
> Non-scope: AI recommendations, arbitrary clinic-authored rules, cross-clinic history

---

## 1. Purpose

Receptionists handle many patients concurrently. They need a small, calm surface that tells them *why this patient is not a default queue entry* only when that changes what they should understand or do next.

This spec defines that surface ("context signals"), the data model, the **five** MVP signals, and how they render. It is deliberately smaller than the long-term AI-native context system, but it must be structured so future model recommendations can consume the same facts cleanly.

---

## 2. Definitions

### 2.1 Context

> A fact about a patient is **context** if and only if its presence would change **(a)** which lane the patient is routed into, **(b)** which physical action the receptionist takes next, or **(c)** the urgency with which she takes it.

If hiding it changes nothing, it is metadata, not context.

Examples of metadata:

- Age, unless a configured clinic policy makes age operationally relevant.
- Vitals, unless the clinic strictly requires vitals before queueing and the receptionist tried to queue without them.
- Doctor room, if the current lane/card already implies it.
- Complaint text, allergies, language, or clinical measurements by default.

### 2.2 Signal

A **signal** is a structured emission describing one operational fact about one token at one point in time.

Signals are:

- **Structured** - fixed schema, never free text at render time.
- **Advisory/read-only in MVP** - no signal row contains action buttons or disables a button.
- **Token-scoped** - a signal belongs to one token. Closed tokens' signals do not leak into new tokens.
- **Time-bounded** - every signal has an expiry rule tied to the decision it informs.
- **Policy-aware** - MVP ships default policy, but clinics can disable or re-weight signals in config.

### 2.3 Lane vs. Context

> **Lanes > badges > context.** Push as much as possible into the lane itself. Context only exists for facts the lane cannot express.

Example: a patient already in `buffer_lab_review` does not need a generic "Lab review" context signal. The lane already expresses that. Context may still carry what the lane cannot express: the prior visit, whether the patient declared this at check-in, or how many times they missed a call.

---

## 3. Locked Decisions

1. **Normal patients show no context.** Zero signals means zero UI. No placeholder, no empty card.
2. **Signals are read-only.** No suggested-action buttons on signal rows in MVP. The desk primary action remains driven by lifecycle and `deskTask`.
3. **Prior-visit lookup requires phone + selected patient profile.** Phone alone can identify a household; it must not reveal prior visits until a specific patient profile is selected.
4. **Prior-visit signal is broad.** Use `returning_about_prior_visit`, not `returning_with_reports`, because patients return for many reasons: reports, follow-up, prescription question, referral, unresolved symptoms, or other.
5. **Prior-visit context survives normal doctor queue.** It expires only when routed into a more specific lane that already encodes the reason, when the patient enters consult, or when the visit closes.
6. **Doctor-to-reception directives remain enum-bound when introduced.** No free-text doctor channel into reception context.
7. **Requeue-from-completed should be event-derived long term.** The preview may use a local timestamp field, but production should derive this from an audit/event row so refresh does not lose the signal.
8. **Vitals context is not default context.** It appears only after the receptionist attempts to queue without vitals and the clinic has a strict "vitals before queue" policy.
9. **MVP is configurable.** The default policy enables the five signals, but the architecture must support per-clinic enablement and weight overrides from day one.
10. **Maximum three signals visible per patient.** Anything beyond three goes into a `+N more` inline disclosure.
11. **No signals while actively calling.** When the desk is in `handoff` mode and the lifecycle is `handoff_ready`, hide the context block. At that moment the receptionist is doing a binary physical task: patient in room or no response.

---

## 4. Data Model

### 4.1 Signal Types

Add to `src/components/reception/workspace/types.ts`:

```ts
export type SignalId =
  | "returning_about_prior_visit"
  | "prior_visit_today"
  | "requeued_from_completed"
  | "miss_strikes"
  | "vitals_required";

export type SignalOrigin = "patient" | "staff" | "system";

export type SignalCategory =
  | "visit_intent"
  | "queue_history"
  | "operational_requirement";

export type SignalWeight = 1 | 2;

export type Signal = {
  id: SignalId;
  category: SignalCategory;
  origin: SignalOrigin;
  weight: SignalWeight;
  title: string;
  detail: string;
  dedupeKey: string;
  // Deterministic source timestamp. Never computed with Date.now() inside signalsFor.
  emittedAt: number;
};
```

### 4.2 Signal Policy

Add a policy block to clinic capabilities/config. MVP can seed defaults in fixtures; a settings UI is not required yet.

```ts
export type SignalPolicy = Record<
  SignalId,
  {
    enabled: boolean;
    weightOverride?: SignalWeight;
  }
>;

export type VitalsRequirement = "optional" | "required_before_queue";
```

Recommended defaults:

```ts
const DEFAULT_SIGNAL_POLICY: SignalPolicy = {
  returning_about_prior_visit: { enabled: true },
  prior_visit_today: { enabled: true },
  requeued_from_completed: { enabled: true },
  miss_strikes: { enabled: true },
  vitals_required: { enabled: true }
};
```

`vitals_required` also requires `ClinicCapabilities.vitalsAtReception === true` and `vitalsRequirement === "required_before_queue"`.

### 4.3 Deterministic Derivation

Signals are derived, not stored as a `signals: Signal[]` array on `Patient`.

Create:

```
src/components/reception/workspace/signals.ts
```

Export:

```ts
export type ClosedTokenRef = {
  tokenId: string;
  patientProfileId: string;
  closedAt: number;
  outcome: DoctorOutcomeKind | null;
  outcomeLabel: string | null;
  doctorName: string;
};

export function signalsFor(params: {
  patient: Patient;
  clinic: ClinicCapabilities;
  signalPolicy: SignalPolicy;
  sameDayClosedTokensForPatient: ClosedTokenRef[];
  now: number;
}): Signal[];
```

Rules:

- `signalsFor` must be pure.
- `now` is passed in by the caller for formatting and time comparisons.
- `emittedAt` must come from source state: `arrivedAt`, `lifecycleSince`, `requeuedFromCompletedAt`, a stored selected-prior-visit timestamp, or prior token close time.
- `signalsFor` must not call `Date.now()` internally.

### 4.4 Patient Fields

Add to the receptionist workspace `Patient` model:

```ts
// Stable patient profile id. Required for prior-visit matching.
patientProfileId: string;

export type ReturningReason =
  | "reports"
  | "follow_up"
  | "prescription_question"
  | "referral"
  | "symptoms_unresolved"
  | "other";

returningAboutPriorVisit: {
  priorTokenId: string;
  priorVisitDate: string; // ISO date
  priorDoctorName: string;
  priorOutcome: DoctorOutcomeKind | null;
  priorOutcomeLabel: string;
  reason: ReturningReason;
  selectedAt: number; // epoch ms, deterministic emittedAt source
} | null;

// Preview/local source for requeued_from_completed.
// Production should derive this from an audit/event row.
requeuedFromCompletedAt: number | null;

// Set only when the receptionist attempts to queue without vitals and the
// clinic requires vitals before queueing.
vitalsRequiredAttemptedAt: number | null;
```

Defaults:

- `returningAboutPriorVisit = null`
- `requeuedFromCompletedAt = null`
- `vitalsRequiredAttemptedAt = null`

### 4.5 RequeueReason

Current enum includes an unused `pharmacy_hold`. Remove it:

```ts
export type RequeueReason =
  | "lab_review"
  | "doctor_recall";
```

Notes:

- `doctor_recall` remains the staff-initiated "send back to doctor queue for review" reason.
- Doctor-initiated recall is not modeled in MVP.
- Staff requeues from Completed set/emit `requeued_from_completed`.
- Post-consult "Re-queue -> Doctor review" does not emit `requeued_from_completed`; the receptionist just performed that action herself.

---

## 5. MVP Signals

| # | id | category | origin | default weight | gated by |
|---|---|---|---|---|---|
| 1 | `returning_about_prior_visit` | `visit_intent` | `patient` | 2 | selected prior visit |
| 2 | `prior_visit_today` | `visit_intent` | `system` | 2 | same-day closed/no-show token |
| 3 | `requeued_from_completed` | `queue_history` | `staff` | 1 | completed/no-show requeue event |
| 4 | `miss_strikes` | `queue_history` | `system` | 1, or 2 if `missCount >= 2` | miss count |
| 5 | `vitals_required` | `operational_requirement` | `system` | 1 | strict vitals policy + failed queue attempt |

All signals also pass through `signalPolicy`.

### 5.1 `returning_about_prior_visit`

- **Trigger**: Patient selects a prior visit after entering phone and selecting the correct patient profile.
- **Stored as**: `patient.returningAboutPriorVisit`.
- **Emit when**:
  - `returningAboutPriorVisit !== null`
  - lifecycle is `arriving_pending_vitals`, `arriving_returned_from_missed`, or `buffer_normal`
- **Expire when**:
  - patient enters `serving`
  - patient enters `closed` or `skipped_no_show`
  - patient is routed into a specific review lane whose state already represents the reason, e.g. `buffer_lab_review` for reports or `buffer_doctor_recall` for doctor review
- **Title**:
  - `reports` -> `"Returning with reports"`
  - `follow_up` -> `"Returning for follow-up"`
  - `prescription_question` -> `"Prescription question"`
  - `referral` -> `"Referral request"`
  - `symptoms_unresolved` -> `"Symptoms unresolved"`
  - `other` -> `"Returning about prior visit"`
- **Detail template**: `"Re: ${priorVisitDate short} · ${priorDoctorName} · ${priorOutcomeLabel || "prior visit"}"`
- **Dedupe key**: `prior_token:${priorTokenId}`
- **emittedAt**: `returningAboutPriorVisit.selectedAt`

### 5.2 `prior_visit_today`

- **Trigger**: Same patient profile has another token today in the same clinic whose lifecycle is `closed` or `skipped_no_show`.
- **Emit when**:
  - lifecycle is `arriving_pending_vitals`, `arriving_returned_from_missed`, or `buffer_normal`
  - `sameDayClosedTokensForPatient.length > 0`
- **Expire when**: Same as `returning_about_prior_visit`.
- **Title**: `"Prior visit today"`
- **Detail template**: `"Closed ${time} · ${outcomeLabel || "no outcome recorded"}"`
- **Dedupe key**: `prior_token:${priorTokenId}`
- **emittedAt**: prior token `closedAt`
- **Dedupe with explicit selection**: if this and `returning_about_prior_visit` refer to the same prior token, keep `returning_about_prior_visit`.

### 5.3 `requeued_from_completed`

- **Trigger**: Receptionist requeues a patient from `closed` or `skipped_no_show`.
- **Preview implementation**: reducer stamps `requeuedFromCompletedAt = Date.now()` before transitioning to `buffer_doctor_recall`.
- **Production implementation**: write an audit/event row such as `patient_requeued_from_completed`; derive the signal from that event so refresh does not lose it.
- **Emit when**:
  - source event/timestamp exists
  - lifecycle is `buffer_doctor_recall`
- **Expire when**: patient leaves `buffer_doctor_recall`.
- **Title**: `"Requeued from completed"`
- **Detail template**: `"${time requeued} · by reception"`
- **Dedupe key**: `requeue:${eventId || requeuedFromCompletedAt}`
- **emittedAt**: event timestamp or `requeuedFromCompletedAt`

### 5.4 `miss_strikes`

- **Emit when**:
  - `patient.missCount >= 1`
  - lifecycle is `handoff_ready` or `missed_first_strike`
- **Hide when actively calling**: if desk mode is `handoff` and lifecycle is `handoff_ready`, UI hides context per §7.5 even though the signal can be derived.
- **Expire when**: patient transitions to `serving`, `closed`, or `skipped_no_show`.
- **Title**:
  - `missCount === 1` -> `"No response"`
  - `missCount >= 2` -> `"No response (${missCount})"`
- **Detail template**: `"Last tried ${time since lifecycleSince} ago"`
- **Dedupe key**: `miss:${patient.id}`
- **Weight**: 1 if `missCount === 1`; 2 if `missCount >= 2`
- **Overlap rule**: if `missCount === 1`, suppress the signal and let the existing badge carry it. If `missCount >= 2`, render the signal because the count changes the decision.
- **emittedAt**: `patient.lifecycleSince`

### 5.5 `vitals_required`

- **Category**: `operational_requirement`
- **Gate**:
  - `ClinicCapabilities.vitalsAtReception === true`
  - `ClinicCapabilities.vitalsRequirement === "required_before_queue"`
  - `signalPolicy.vitals_required.enabled === true`
- **Trigger**: Receptionist attempts to add the patient to the doctor queue without any vitals.
- **Emit when**:
  - gate passes
  - lifecycle is `arriving_pending_vitals`
  - no vital field has content
  - `patient.vitalsRequiredAttemptedAt !== null`
- **Expire when**:
  - any vital is entered
  - patient is successfully added to a queue
  - attempt state is cleared
- **Title**: `"Vitals required"`
- **Detail template**: `"Clinic policy · capture before doctor queue"`
- **Dedupe key**: `vitals:${patient.id}`
- **emittedAt**: `patient.vitalsRequiredAttemptedAt`

Important: the signal itself is read-only. The queueing handler may keep the patient in check-in when strict policy requires vitals, but the signal row does not block or disable anything by itself.

### 5.6 Dedupe and Sorting

1. Build candidate signals.
2. Drop candidates disabled by `signalPolicy`.
3. Apply weight override if present.
4. Dedupe by `dedupeKey`; keep the highest-weight signal, then newest `emittedAt`.
5. Apply special miss overlap: suppress `miss_strikes` at count 1.
6. Sort by `weight` descending, then `emittedAt` descending, then `id` alphabetically.

---

## 6. Emission Rules

Everything flows through `signalsFor`. No component computes signal semantics directly.

| Signal | Inputs read |
|---|---|
| `returning_about_prior_visit` | `patient.returningAboutPriorVisit`, `patient.lifecycle` |
| `prior_visit_today` | `patient.patientProfileId`, `patient.lifecycle`, `sameDayClosedTokensForPatient` |
| `requeued_from_completed` | audit/event row or `patient.requeuedFromCompletedAt`, `patient.lifecycle` |
| `miss_strikes` | `patient.missCount`, `patient.lifecycle`, `patient.lifecycleSince` |
| `vitals_required` | clinic vitals policy, `patient.vitals`, `patient.vitalsRequiredAttemptedAt`, `patient.lifecycle` |

### 6.1 Reducer Additions

- On requeue from `closed` or `skipped_no_show`, stamp `requeuedFromCompletedAt` for preview and transition to `buffer_doctor_recall`.
- On transition out of `buffer_doctor_recall`, clear `requeuedFromCompletedAt`.
- On strict-vitals queue attempt without vitals, set `vitalsRequiredAttemptedAt = Date.now()` and keep the patient in check-in/vitals mode.
- When any vital is entered, clear `vitalsRequiredAttemptedAt`.
- Drop all references to `pharmacy_hold`.

### 6.2 Check-in Data Flow

Prior visits require two pieces of identity:

1. Phone number
2. Selected patient profile (`patientProfileId`)

Flow:

1. Patient enters phone on QR check-in page.
2. Lookup returns household/matching patient profiles for that phone in the current clinic.
3. Patient selects the correct profile. If creating a new patient profile, no prior visits are shown.
4. After profile selection, fetch prior visits for that exact `patientProfileId` and clinic.
5. Patient can select a prior visit and a fixed returning reason.
6. Token creation receives `returningAboutPriorTokenId` and `returningReason`.

Do not show prior visits from phone alone.

### 6.3 Seed Fixtures

Update `src/components/reception/workspace/seed-fixtures.ts` to:

- default new patient fields
- add `patientProfileId`
- add at least one fixture for `returning_about_prior_visit`
- add at least one fixture for `prior_visit_today`
- add at least one fixture for `requeued_from_completed`
- add at least one fixture for `miss_strikes >= 2`
- add one fixture for `vitals_required` only if strict vitals policy is enabled

---

## 7. UI Rules

### 7.1 Where Signals Render

Add `ContextBlock` to `src/components/reception/workspace/the-desk.tsx`.

Render below the header and above the primary action in:

- `vitals`
- `checkout`
- `handoff` pre-commit only
- `detail`

Do not render in:

- `idle`
- `handoff` after call commit (`patient.lifecycle === "handoff_ready"`)

### 7.2 Density Rules

- **Zero signals** -> render nothing.
- **Exactly one weight-1 signal** -> render as a compact chip appended to `PatientBadges`, no block.
- **One weight-2 signal** -> render `ContextBlock`.
- **Two or more signals** -> render `ContextBlock`, up to three visible rows.
- **More than three signals** -> render three rows plus inline `+N more` expansion.

### 7.3 Row Structure

Each `ContextBlock` row:

```text
[icon]  Title                  muted meta/time
        Detail line
```

Rules:

- Icons come from a fixed `SignalId` map using `lucide-react`.
- Title weight 600.
- Detail muted and one line with ellipsis.
- Weight-2 rows get a subtle 2px left accent.
- No buttons, chevrons, row clicks, or modals in MVP.

### 7.4 Inbox Row Preview

The highest-weight active signal can preview on inbox rows:

- If a weight-2 signal exists, show one chip with that signal title.
- If only weight-1 signals exist, show no extra chip.
- Existing `RE-ENTRY` chip is superseded by `returning_about_prior_visit` or `prior_visit_today`.

### 7.5 Handoff Commit Rule

When the receptionist has pressed `Start calling`, hide context until the patient changes state.

Rationale: during active calling, the decision is binary:

- Patient in room
- No response

Context returns after state changes, for example on `missed_first_strike`.

### 7.6 Anti-Rules

- Do not show an empty Context shell.
- Do not show vitals values.
- Do not show allergies, complaint, or language preference in Context.
- Do not repeat the lane name as Context.
- Do not let context reflow or shrink the primary action button.
- Do not add receptionist-typed free-text context.

---

## 8. Clinic Configurability

MVP includes config, not a full settings UI.

### 8.1 Required Config

Add or derive:

```ts
ClinicCapabilities.signalPolicy: SignalPolicy;
ClinicCapabilities.vitalsRequirement: VitalsRequirement;
```

Default:

- all five signals enabled
- default weights from §5
- `vitalsRequirement = "optional"` unless a clinic explicitly requires vitals before queueing

### 8.2 Why Config Exists in MVP

Clinics vary. The product should not hardcode one clinic's operating style as universal.

MVP can ship with defaults, but implementation must allow:

- disabling a signal
- changing a signal weight
- strict vs optional vitals workflow

### 8.3 Deferred Config

Not in MVP:

- clinic-authored custom signals
- arbitrary rule builder
- AI-authored policies
- per-doctor signal policies

---

## 9. Patient-App and Persistence

### 9.1 Patient-App Flow

1. Patient enters phone.
2. App shows matching patient profiles/household members for this clinic.
3. Patient selects the correct profile or creates a new profile.
4. If an existing profile is selected, app fetches that profile's prior visits for this clinic.
5. If prior visits exist, show a compact surface:
   - title: `"Coming back about an earlier visit?"`
   - rows: date, doctor, outcome label
6. If patient selects a prior visit, require a fixed reason:
   - reports
   - follow-up
   - prescription question
   - referral
   - symptoms unresolved
   - other
7. Patient can choose `"New issue, unrelated"` to create a normal token.

### 9.2 Lookup API Shape

Initial phone lookup:

```ts
{
  household: Array<{
    id: string;
    name: string;
  }>;
}
```

Prior-visit lookup after selecting patient profile:

```ts
{
  priorVisits: Array<{
    tokenId: string;
    date: string;
    doctorName: string;
    outcome: DoctorOutcomeKind | null;
    outcomeLabel: string;
  }>;
}
```

Both queries are hard-scoped to current clinic. No cross-clinic history.

### 9.3 Check-in Payload

Extend `/api/checkin` payload:

```ts
{
  patientProfileId?: string;
  returningAboutPriorTokenId?: string;
  returningReason?: ReturningReason;
}
```

Validation:

- `returningAboutPriorTokenId` is only accepted when it belongs to the selected `patientProfileId`.
- prior token must belong to the same clinic.
- `returningReason` is required when `returningAboutPriorTokenId` is present.

### 9.4 Database Persistence

Add nullable columns to `tokens`:

```sql
returning_about_prior_token_id uuid references public.tokens(id),
returning_reason text check (
  returning_reason is null or returning_reason in (
    'reports',
    'follow_up',
    'prescription_question',
    'referral',
    'symptoms_unresolved',
    'other'
  )
)
```

Do not backfill historical tokens.

### 9.5 RPC Update

The check-in API currently creates tokens through the Supabase RPC `assign_next_token`. Update that function rather than patching the token after creation.

Add optional parameters:

```sql
p_returning_about_prior_token_id uuid default null,
p_returning_reason text default null
```

Insert those values in the same `tokens` insert.

Reasoning:

- token creation stays atomic
- no partial token exists if a post-insert update fails
- validation can live close to token creation

---

## 10. Non-Goals

- AI recommendations or suggested next actions.
- Custom clinic-authored signals.
- Cross-clinic patient history.
- Doctor-initiated recall.
- VIP/priority as a signal.
- Language/allergies/complaint as Context.
- External-lab vs in-house preference until a clinic with both routes asks for it.
- Outside-pharmacy preference, printed referral required, prior unpaid balance.
- Signal rows that block actions or contain action buttons.

---

## 11. Decisions Log

- `returning_with_reports` renamed to `returning_about_prior_visit`.
- Prior-visit lookup requires phone + selected patient profile.
- Add `patientProfileId` to workspace `Patient`.
- Prior-visit context remains visible in normal doctor queue.
- `signalsFor` receives `now` and never calls `Date.now()`.
- `requeued_from_completed` should be event-derived in production.
- `vitals_required` is an operational requirement, not queue history.
- `vitals_required` appears only after attempted queue without vitals under strict policy.
- MVP includes `signalPolicy` config.
- `assign_next_token` RPC should be updated atomically for prior-visit fields.
- `pharmacy_hold` is dropped from `RequeueReason`.

---

## 12. Summary of Files Touched

Implementation should be contained mostly to:

- `src/components/reception/workspace/types.ts`
- `src/components/reception/workspace/signals.ts`
- `src/components/reception/workspace/the-desk.tsx`
- `src/components/reception/workspace/inbox.tsx`
- `src/components/reception/workspace/use-workspace-state.ts`
- `src/components/reception/workspace/seed-fixtures.ts`
- `src/components/checkin/checkin-form.tsx`
- `src/app/api/checkin/lookup/route.ts`
- `src/app/api/checkin/route.ts`
- Supabase migration for token columns and `assign_next_token` RPC update

If implementation needs to touch more files, re-check whether it is adding product surface outside this MVP.
