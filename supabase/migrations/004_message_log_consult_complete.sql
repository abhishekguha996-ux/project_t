alter table public.message_log
  drop constraint if exists message_log_message_type_check;

alter table public.message_log
  add constraint message_log_message_type_check
  check (
    message_type in (
      'checkin_confirm',
      'three_ahead',
      'your_turn',
      'consult_complete',
      'doctor_break',
      'emergency_delay',
      'skipped_noshow',
      'stepped_out_check'
    )
  );
