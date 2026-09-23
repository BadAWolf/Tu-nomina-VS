-- Owner-only operational check. No email addresses or secret values.
select
 (select enabled from private.brevo_schedule_state where singleton) as automatic_sync,
 (select last_http_status from private.brevo_schedule_state where singleton) as last_http_status,
 (select last_run_at from private.brevo_schedule_state where singleton) as last_run_at,
 count(*) filter(where generation>applied_generation) as pending,
 count(*) filter(where lease_token is not null) as in_progress_or_review,
 count(*) filter(where last_error_code is not null) as failed,
 count(*) filter(where generation=applied_generation and lease_token is null) as synchronized
from private.brevo_outbox;

select last_error_code,count(*) from private.brevo_outbox
 where last_error_code is not null group by last_error_code;

-- Canonical current eligible choices; does not read/print their email addresses.
select count(*) as subscribers,
 count(*) filter(where own_news) as own_news,
 count(*) filter(where partner_offers) as partner_offers,
 count(*) filter(where own_news and partner_offers) as both
from private.marketing_audience;

-- Do not send a campaign with pending work, unresolved leases, suppression or
-- erasure requests. A zero queue alone does not approve content or recipients.
