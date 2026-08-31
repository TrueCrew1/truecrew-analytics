import crypto from 'node:crypto';
import prisma from '@/lib/prisma';

export const dynamic = 'force-dynamic';

const MAX_WINDOW_MS = 31 * 24 * 60 * 60 * 1000;
const CAMPAIGN_RE = /^[a-z0-9][a-z0-9_-]{0,79}$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const HOSTNAME_RE = /^[a-z0-9](?:[a-z0-9.-]{0,251}[a-z0-9])?$/;
const RFC3339_RE =
  /^(\d{4})-(\d{2})-(\d{2})T([01]\d|2[0-3]):([0-5]\d):([0-5]\d)(?:\.(\d{3}))?(Z|[+-](?:0\d|1[0-4]):[0-5]\d)$/;
const DEFAULT_HOSTNAME = 'www.truecrewllc.com';

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
  const campaign = url.searchParams.get('campaign')?.trim().toLowerCase() ?? '';
  const start = parseTimestamp(url.searchParams.get('start'));
  const end = parseTimestamp(url.searchParams.get('end'));
  if (!CAMPAIGN_RE.test(campaign) || !start || !end) return null;
  const duration = end.getTime() - start.getTime();
  if (duration <= 0 || duration > MAX_WINDOW_MS) return null;
  return { campaign, start, end };
}

function readScope() {
  const websiteId = process.env.TRUECREW_ANALYTICS_WEBSITE_ID?.trim() ?? '';
  const hostname = (process.env.TRUECREW_ANALYTICS_SITE_HOSTNAME?.trim() || DEFAULT_HOSTNAME)
    .toLowerCase()
    .replace(/\.$/, '');
  if (!UUID_RE.test(websiteId) || !HOSTNAME_RE.test(hostname)) return null;
  return { websiteId, hostname };
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

  const rows = await prisma.client.$queryRaw<Array<Record<string, unknown>>>`
    with first_campaign_touch as (
      select distinct on (we.session_id)
        we.website_id,
        we.session_id,
        we.utm_source,
        we.utm_medium,
        we.utm_campaign,
        we.utm_content,
        we.created_at as first_touch_at
      from website_event we
      where we.website_id = ${scope.websiteId}::uuid
        and lower(trim(trailing '.' from we.hostname)) = ${scope.hostname}
        and coalesce(we.utm_campaign, '') <> ''
        and we.created_at < ${window.end}
      order by we.session_id, we.created_at asc
    ), campaign_touch as (
      select *
      from first_campaign_touch
      where utm_campaign = ${window.campaign}
        and first_touch_at >= ${window.start}
        and first_touch_at < ${window.end}
    ), session_events as (
      select
        e.*,
        t.utm_source as first_source,
        t.utm_medium as first_medium,
        t.utm_content as first_content,
        t.first_touch_at
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
    ), content_groups as (
      select
        ('content-' || left(md5(coalesce(utm_content, 'unknown')), 12)) as content,
        count(*)::int as sessions
      from campaign_touch
      group by 1
      having count(*) >= 2
      order by sessions desc, content asc
      limit 20
    ), path_groups as (
      select
        case
          when url_path = '/' then '/'
          when url_path = '/resources' then '/resources'
          when url_path like '/resources/%' then '/resources/:resource'
          when url_path in ('/coatops', '/products/coatops', '/request-demo', '/pricing', '/thank-you') then url_path
          else '/other'
        end as path,
        count(*)::int as pageviews,
        count(distinct session_id)::int as sessions
      from session_events
      where event_type = 1
      group by 1
      having count(distinct session_id) >= 2
      order by pageviews desc, path asc
      limit 25
    )
    select json_build_object(
      'totals', (select row_to_json(totals) from totals),
      'sources', coalesce((select json_agg(source_groups) from source_groups), '[]'::json),
      'contents', coalesce((select json_agg(content_groups) from content_groups), '[]'::json),
      'paths', coalesce((select json_agg(path_groups) from path_groups), '[]'::json)
    ) as summary;
  `;

  const summary = rows[0]?.summary ?? { totals: {}, sources: [], contents: [], paths: [] };
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
