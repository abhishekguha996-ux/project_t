alter table public.staff_invites
  alter column invitee_email set not null;

alter table public.staff_invites
  add column if not exists delivery_status text not null default 'pending'
    check (delivery_status in ('pending', 'sent', 'failed')),
  add column if not exists delivery_error text,
  add column if not exists sent_at timestamptz;

create index if not exists idx_staff_invites_delivery_status
  on public.staff_invites(clinic_id, delivery_status, created_at desc);
