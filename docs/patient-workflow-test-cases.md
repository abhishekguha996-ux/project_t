# QCare Patient Workflow Test Cases (Dev)

This suite validates patient-facing check-in behavior using the current Phase 2 slice.

## Test environment

- App URL: `http://localhost:3000` (or your active local port)
- Seed clinic id: `11111111-1111-4111-8111-111111111111`
- Public patient check-in page: `/checkin/11111111-1111-4111-8111-111111111111`
- Patient tracking page: `/track/<tokenId>`
- Reception quick-add page: `/reception`
- Doctor workflow page: `/doctor`

## Preconditions

- Local Supabase running and recently reset with seed data.
- At least one doctor active in clinic (`Dr. Meera Shah` by default).
- Browser session available for:
  - public patient view (signed out)
  - reception view (signed in as `clinic_admin` or `receptionist`)

## Core patient path tests

### TC-PAT-001 New patient QR check-in

1. Open public page `/checkin/11111111-1111-4111-8111-111111111111`.
2. Select doctor.
3. Enter a new phone and name not present in seed.
4. Enter complaint and submit.
5. Verify success card shows token number and doctor.

Expected:
- New patient row created.
- Token created with status `waiting`.
- `checkin_channel` is `qr`.

### TC-PAT-002 Returning household lookup

1. On public check-in page, enter phone `9998887771`.
2. Blur phone field.
3. Verify household chips show `Ravi Kumar` and `Aarav Kumar`.
4. Click one chip and submit complaint.

Expected:
- Existing patient reused (same `clinic_id + phone + name`).
- New token assigned (no duplicate patient row for same name).

### TC-PAT-003 Household new member on shared phone

1. Enter existing phone `9998887771`.
2. Enter a new name not in household, e.g. `Kiran Kumar`.
3. Submit complaint.

Expected:
- New patient row created with same phone and clinic.
- Household now contains old members + new member.

### TC-PAT-004 Sequential token assignment

1. Submit 3 check-ins for same doctor.
2. Note token numbers.

Expected:
- Token numbers strictly increase by 1 for that doctor and date.

### TC-PAT-005 Complaint required validation

1. Leave complaint empty.
2. Submit.

Expected:
- UI or API blocks submission with validation error.
- No token created.

### TC-PAT-006 Doctor required validation

1. Force no doctor selected (if possible via UI/devtools).
2. Submit form.

Expected:
- Submission blocked.
- Error message shown.

### TC-PAT-007 Optional profile fields update

1. Check in an existing patient.
2. Change age/gender/language/allergies and submit.
3. Re-open lookup for same patient.

Expected:
- Existing patient profile updates with new optional values.

### TC-PAT-008 Allergy normalization

1. Enter allergies as `Dust, dust,  Dust`.
2. Submit.

Expected:
- Stored allergies deduplicated and trimmed.

### TC-PAT-009 Invalid clinic slug

1. Open `/checkin/00000000-0000-4000-8000-000000000000`.

Expected:
- Not-found page, no crash.

### TC-PAT-009A Resume tracking from same device

1. Complete QR check-in and open tracking link.
2. Close tracking tab.
3. Go back to `/checkin/<clinicId>`.
4. Click `Resume live status` in `Already checked in? Track status`.

Expected:
- Patient returns to `/track/<tokenId>` without re-entering details.

### TC-PAT-009B Token lookup recovery

1. Complete QR check-in and note phone + token number.
2. Open `/checkin/<clinicId>` in a fresh/private browser.
3. Use `Find my status` with same phone + token code.

Expected:
- API resolves latest matching token.
- Browser redirects to `/track/<tokenId>`.

## Reception + queue consistency tests

### TC-PAT-010 Reception quick-add token creation

1. Sign in as staff and open `/reception`.
2. Submit check-in from reception form.

Expected:
- Success card appears.
- Queue table refreshes and shows new token row.
- `checkin_channel` shown as `reception`.

### TC-PAT-011 Queue auto refresh

1. Keep `/reception` open.
2. From another tab, create a new check-in (public or reception).

Expected:
- Queue table updates automatically within ~5 seconds.

### TC-PAT-012 Queue filter by doctor

1. In queue board, switch doctor filter.

Expected:
- List and counts reflect selected doctor only.

### TC-PAT-013 Queue status summary accuracy

1. After several check-ins, note number of rows.
2. Compare with summary pills (`total`, `waiting`, etc.).

Expected:
- Summary counts match table rows/statuses.

## Doctor transition + patient sync tests

### TC-PAT-014 Waiting -> Serving sync

1. Create a patient check-in from public page.
2. Open patient tracking page from success card.
3. In doctor view, click `Start now` for that token.
4. Observe reception queue and patient tracking page.

Expected:
- Doctor queue shows token as `serving`.
- Reception queue row updates to `serving` within refresh window.
- Patient tracking status updates to `serving` with queue position no longer shown as waiting.

### TC-PAT-015 Serving -> Complete sync

1. Start a token in doctor view.
2. Click `Mark done` (or `Done + call next`).
3. Observe reception queue and patient tracking page.

Expected:
- Token status becomes `complete`.
- Reception view shows `complete`.
- Patient tracking page shows completed message.

### TC-PAT-016 Skip transition visibility

1. Create a waiting token.
2. In doctor view, click `Skip`.
3. Refresh patient tracking page.

Expected:
- Reception queue marks token as `skipped`.
- Patient tracking page shows skipped guidance text.

### TC-PAT-017 Step-out transition visibility

1. Create a waiting token.
2. In doctor view, click `Step out`.
3. Refresh patient tracking page.

Expected:
- Reception queue marks token as `stepped_out`.
- Patient tracking page shows stepped-out guidance text.

### TC-PAT-018 Done + call next behavior

1. Ensure one token is `serving` and at least one token is `waiting`.
2. Click `Done + call next` in doctor view.

Expected:
- Previously serving token becomes `complete`.
- Next waiting token becomes `serving`.
- Reception queue and both tracking pages reflect both updates.

## Security and boundary tests

### TC-PAT-019 Reception-only endpoint protection

1. Attempt `checkinChannel = reception` from signed-out context.

Expected:
- API returns unauthorized/forbidden.

### TC-PAT-020 Public QR endpoint without clinic id

1. Call `/api/checkin` from signed-out state without `clinicId`.

Expected:
- API returns bad request (`Clinic context is required.`).

### TC-PAT-021 Email-bound invite still enforced

1. Create invite for one email.
2. Accept while signed in with different email.

Expected:
- Invite rejected with mismatch message.

### TC-PAT-022 Doctor access setup state

1. Sign in as clinic admin with no linked doctor profile.
2. Open `/doctor`.
3. Link a doctor profile from setup panel.

Expected:
- `/doctor` shows inline setup (no forced redirect to `/admin`).
- After linking and refresh, doctor workflow console appears.

### TC-PAT-023 Queue mutation auth protection

1. Call `/api/queue/status` without signing in.
2. Call `/api/queue/next` without signing in.

Expected:
- Both return `401 Unauthorized`.

## Stress and resiliency tests

### TC-PAT-024 Burst check-ins

1. Submit 10+ quick check-ins for same doctor.

Expected:
- No duplicate token numbers.
- Queue remains stable.

### TC-PAT-025 Browser refresh during submit

1. Submit check-in and immediately refresh.

Expected:
- At most one token created per submit action.
- UI recovers and queue remains readable.

### TC-PAT-026 Session mismatch on reception page

1. Sign out while on `/reception`, then refresh.

Expected:
- Redirect to sign-in, no server crash.

### TC-PAT-027 Data reset reproducibility

1. Run `supabase db reset`.
2. Repeat TC-PAT-001 and TC-PAT-002.

Expected:
- Same predictable baseline behavior after reset.

## Reception board and checkout tests

### TC-PAT-028 Hold slot note is mandatory for receptionist

1. Sign in as receptionist and open `/reception/board`.
2. Drag a waiting token into `Hold slot`.
3. Try confirming without note.

Expected:
- Submission blocked with validation error.
- Token does not move to Hold slot until note is provided.

### TC-PAT-029 Doctor queue pause blocks start

1. On `/reception/board`, pause queue for selected doctor.
2. Attempt `Start consultation` for waiting token.

Expected:
- Action is blocked while pause is active.
- Resume queue allows start again.

### TC-PAT-030 Checkout stage transitions

1. Move a serving token to `Consultation done`.
2. Drag that token across checkout lanes:
   `Awaiting payment` -> `Payment done` -> `Pharmacy pickup` -> `Referred for lab` -> `Visit closed`.

Expected:
- Each transition persists and is visible on refresh.
- Recent queue events include checkout transitions.

## Suggested evidence capture

- Screenshot each success/error state.
- Keep a table of: input -> token number -> expected status.
- For failures, capture browser console + network response payload.
