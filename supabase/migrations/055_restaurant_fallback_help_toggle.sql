-- REPLY-003: per-restaurant toggle for the "Help" option in the no-keyword
-- fallback reply menu. Unlike REWARDS (data-gated) and CONTACT (config-gated),
-- the Help option was always shown to members; this makes it configurable too.
--
-- Default true => unchanged behaviour for every existing tenant (Help still
-- shown). Setting it false hides only the Help MENU BUTTON; the typed
-- HELP / 幫助 command keeps working (handleHelp is not gated by this column).
-- No RLS change: the new column inherits the existing row-level restaurants
-- policies.

ALTER TABLE restaurants
  ADD COLUMN fallback_help_enabled BOOLEAN NOT NULL DEFAULT true;
