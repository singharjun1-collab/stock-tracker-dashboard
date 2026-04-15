-- Flags so we only send each notification email once per user.
--   signup_notified_at      — timestamp when the admin was emailed about
--                             this pending user (null = not yet emailed).
--   approved_email_sent_at  — timestamp when the user was emailed that
--                             they were approved (null = not yet emailed).

ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS signup_notified_at timestamptz;

ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS approved_email_sent_at timestamptz;
