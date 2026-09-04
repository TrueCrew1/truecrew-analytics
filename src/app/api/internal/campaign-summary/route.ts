import crypto from 'node:crypto';
import { startOfDay, startOfMonth, startOfWeek } from 'date-fns';
import { validate as validateUuid } from 'uuid';
import prisma from '@/lib/prisma';

export const dynamic = 'force-dynamic';

const MAX_WINDOW_MS = 31 * 24 * 60 * 60 * 1000;
const CAMPAIGN_RE = /^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$/;
const HOSTNAME_RE = /^[a-z0-9](?:[a-z0-9.-]{0,251}[a-z0-9])?$/;
const TARGET_EVENT_NAMES = [
  'high_intent_touchpoint',
  'icp_conversation',
  'job_control_audit_start',
  'job_control_audit_complete',
  'job_control_report_delivered',
  'teardown_confirmed',
  'qualified_coatops_walkthrough',
] as const;
const RFC3339_RE =
  /^(\d{4})-(\d{2})-(\d{2})T([01]\d|2[0-3]):([0-5]\d):([0-5]\d)(?:\.(\d{3}))?(Z|[+-](?:0\d|1[0-4]):[0-5]\d)$/;

function authorized(request: Request) {
  const expected = process.env.TRUECREW_ANALYTICS_READ_TOKEN ?? '';
  const supplied = request.headers.get('authorization')?.replace(/^Bearer\s+/i, '') ?? '';
  if (!expected || !supplied) return false;
  const a = Buffer.from(expected);
  const b = Buffer.from(supplied);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function parseTimestamp(raw: string | null) {
  if (!raw) return null;
  const match = RFC3339_RE.exec(raw);
  if (!match) return null;
  const [, yearText, monthText, dayText, , , , , zone] = match;
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  if (zone.startsWith('14:') || zone.startsWith('+14:') || zone.startsWith('-14:')) {
    if (!zone.endsWith(':00')) return null;
  }
  const calendar = new Date(Date.UTC(year, month - 1, day));
  if (
    calendar.getUTCFullYear() !== year ||
    calendar.getUTCMonth() + 1 !== month ||
    calendar.getUTCDate() !== day
  ) {
    return null;
  }
  const timestamp = Date.parse(raw);
  return Number.isFinite(timestamp) ? new Date(timestamp) : null;
}

function parseWindow(url: URL) {
  const campaign = url.searchParams.get('campaign')?.trim() ?? '';
  const start = parseTimestamp(url.searchParams.get('start'));
  const end = parseTimestamp(url.searchParams.get('end'));
  if (!CAMPAIGN_RE.test(campaign) || !start || !end) return null;
  const duration = end.getTime() - start.getTime();
  if (duration <= 0 || duration > MAX_WINDOW_MS) return null;
  return { campaign, start, end };
}

function readScope() {
  const websiteId = process.env.TRUECREW_ANALYTICS_WEBSITE_ID?.trim() ?? '';
  const hostname =
    process.env.TRUECREW_ANALYTICS_SITE_HOSTNAME?.trim().toLowerCase().replace(/\.$/, '') ?? '';
  if (!validateUuid(websiteId) || !hostname || !HOSTNAME_RE.test(hostname)) return null;
  return { websiteId, hostname };
}

function firstTouchScanStart(start: Date) {
  const rotation = process.env.SALT_ROTATION || 'month';
  if (rotation === 'day') return startOfDay(start);
  if (rotation === 'week') return startOfWeek(start);
  return startOfMonth(start);
}

export async function GET(request: Request) {
  if (!authorized(request)) {
    return Response.json({ error: 'Unauthorized.' }, { status: 401 });
  }

  const window = parseWindow(new URL(request.url));
  if (!window) {
    return Response.json({ error: 'Invalid campaign or time window.' }, { status: 400 });
  }

  const scope = readScope();
  if (!scope) {
    return Response.json({ error: 'Analytics website scope is not configured.' }, { status: 503 });
  }
  if (process.env.CLICKHOUSE_URL?.trim()) {
    return Response.json(
      { error: 'Campaign summary does not support the configured analytics backend.' },
      { status: 503 },
    );
  }

  const scanStart = firstTouchScanStart(window.start);
  const rows = await prisma.client.$queryRaw<Array<Record<string, unknown>>>`
    with first_campaign_touch as (
      select distinct on (we.session_id)
        we.website_id,
        we.session_id,
        we.utm_source,
        we.utm_medium,
        we.utm_campaign,
        we.created_at as first_touch_at
      from website_event we
      where we.website_id = ${scope.websiteId}::uuid
        and lower(trim(trailing '.' from we.hostname)) = ${scope.hostname}
        and coalesce(we.utm_campaign, '') <> ''
        and we.created_at >= ${scanStart}
        and we.created_at < ${window.end}
      order by we.session_id, we.created_at asc, we.event_id asc
    ), campaign_touch as (
      select *
      from first_campaign_touch
      where utm_campaign = ${window.campaign}
        and first_touch_at >= ${window.start}
        and first_touch_at < ${window.end}
    ), session_events as (
      select
        e.session_id,
        e.event_type,
        e.event_name,
        e.url_path
      from website_event e
      join campaign_touch t
        on t.website_id = e.website_id
       and t.session_id = e.session_id
      where e.website_id = ${scope.websiteId}::uuid
        and lower(trim(trailing '.' from e.hostname)) = ${scope.hostname}
        and e.created_at >= t.first_touch_at
        and e.created_at < ${window.end}
    ), totals as (
      select
        count(distinct session_id)::int as sessions,
        count(*) filter (where event_type = 1)::int as pageviews,
        count(*) filter (where event_type = 2)::int as events,
        count(*) filter (where event_type = 2 and event_name = 'resource_view')::int as resource_views,
        count(*) filter (where event_type = 2 and event_name = 'product_view')::int as product_views,
        count(*) filter (where event_type = 2 and event_name = 'cta_click')::int as cta_clicks,
        count(*) filter (where event_type = 2 and event_name = 'demo_form_start')::int as demo_form_starts,
        count(*) filter (where event_type = 2 and event_name = 'demo_form_submit')::int as demo_form_submits,
        count(*) filter (where event_type = 2 and event_name = 'demo_form_success')::int as demo_form_successes
      from session_events
    ), target_event_counts as (
      select event_name, count(*)::int as count
      from session_events
      where event_type = 2
        and event_name = any(${TARGET_EVENT_NAMES}::text[])
      group by event_name
    ), source_groups as (
      select
        case
          when lower(coalesce(utm_source, '')) in ('linkedin', 'x', 'instagram', 'facebook', 'tiktok', 'youtube', 'beehiiv', 'reddit-pro', 'website', 'direct')
            then lower(utm_source)
          else 'other'
        end as source,
        case
          when lower(coalesce(utm_medium, '')) in ('organic-social', 'newsletter', 'video', 'referral', 'direct', 'other')
            then lower(utm_medium)
          else 'other'
        end as medium,
        count(*)::int as sessions
      from campaign_touch
      group by 1, 2
      having count(*) >= 2
      order by sessions desc, source asc, medium asc
      limit 20
    ), normalized_pageviews as (
      select
        session_id,
        case
          when split_part(coalesce(url_path, ''), '#', 1) in ('', '/') then '/'
          else regexp_replace(split_part(url_path, '#', 1), '/+$', '')
        end as normalized_path
      from session_events
      where event_type = 1
    ), path_groups as (
      select
        case
          when normalized_path = '/' then '/'
          when normalized_path = '/resources' then '/resources'
          when normalized_path like '/resources/%' then '/resources/:resource'
          when normalized_path in ('/coatops', '/products/coatops', '/request-demo', '/pricing', '/thank-you') then normalized_path
          else '/other'
        end as path,
        count(*)::int as pageviews,
        count(distinct session_id)::int as sessions
      from normalized_pageviews
      group by 1
      having count(distinct session_id) >= 2
      order by pageviews desc, path asc
      limit 25
    )
    select json_build_object(
      'totals', (select row_to_json(totals) from totals),
      'target_events', coalesce((select json_object_agg(event_name, count) from target_event_counts), '{}'::json),
      'sources', coalesce((select json_agg(source_groups) from source_groups), '[]'::json),
      'paths', coalesce((select json_agg(path_groups) from path_groups), '[]'::json)
    ) as summary;
  `;

  const summary = rows[0]?.summary ?? { totals: {}, sources: [], paths: [] };
  return Response.json(
    {
      campaign: window.campaign,
      window: { start: window.start.toISOString(), end: window.end.toISOString() },
      hostname: scope.hostname,
      summary,
      observedAt: new Date().toISOString(),
    },
    { headers: { 'Cache-Control': 'private, no-store' } },
  );
}
