import crypto from 'node:crypto';
import prisma from '@/lib/prisma';

export const dynamic = 'force-dynamic';

const MAX_WINDOW_MS = 31 * 24 * 60 * 60 * 1000;
const CAMPAIGN_RE = /^[a-z0-9][a-z0-9_-]{0,79}$/;
const DEFAULT_DOMAIN = 'truecrewllc.com';

function authorized(request: Request) {
  const expected = process.env.TRUECREW_ANALYTICS_READ_TOKEN ?? '';
  const supplied = request.headers.get('authorization')?.replace(/^Bearer\s+/i, '') ?? '';
  if (!expected || !supplied) return false;
  const a = Buffer.from(expected);
  const b = Buffer.from(supplied);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function parseWindow(url: URL) {
  const campaign = url.searchParams.get('campaign')?.trim().toLowerCase() ?? '';
  const start = new Date(url.searchParams.get('start') ?? '');
  const end = new Date(url.searchParams.get('end') ?? '');
  if (!CAMPAIGN_RE.test(campaign)) return null;
  if (!Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime())) return null;
  const duration = end.getTime() - start.getTime();
  if (duration <= 0 || duration > MAX_WINDOW_MS) return null;
  return { campaign, start, end };
}

export async function GET(request: Request) {
  if (!authorized(request)) {
    return Response.json({ error: 'Unauthorized.' }, { status: 401 });
  }

  const window = parseWindow(new URL(request.url));
  if (!window) {
    return Response.json({ error: 'Invalid campaign or time window.' }, { status: 400 });
  }

  const domain = process.env.TRUECREW_ANALYTICS_SITE_DOMAIN ?? DEFAULT_DOMAIN;
  const rows = await prisma.client.$queryRaw<Array<Record<string, unknown>>>`
    with campaign_touch as (
      select distinct on (we.session_id)
        we.website_id,
        we.session_id,
        we.utm_source,
        we.utm_medium,
        we.utm_campaign,
        we.utm_content,
        we.created_at as first_touch_at
      from website_event we
      join website w on w.website_id = we.website_id
      where w.domain = ${domain}
        and we.utm_campaign = ${window.campaign}
        and we.created_at >= ${window.start}
        and we.created_at < ${window.end}
      order by we.session_id, we.created_at asc
    ), session_events as (
      select
        e.*,
        t.utm_source as first_source,
        t.utm_medium as first_medium,
        t.utm_campaign as first_campaign,
        t.utm_content as first_content,
        t.first_touch_at
      from website_event e
      join campaign_touch t
        on t.website_id = e.website_id
       and t.session_id = e.session_id
      where e.created_at >= ${window.start}
        and e.created_at < ${window.end}
    ), totals as (
      select
        count(distinct session_id)::int as sessions,
        count(*) filter (where event_name is null)::int as pageviews,
        count(*) filter (where event_name is not null)::int as events,
        count(*) filter (where event_name = 'resource_view')::int as resource_views,
        count(*) filter (where event_name = 'product_view')::int as product_views,
        count(*) filter (where event_name = 'cta_click')::int as cta_clicks,
        count(*) filter (where event_name = 'demo_form_start')::int as demo_form_starts,
        count(*) filter (where event_name = 'demo_form_submit')::int as demo_form_submits,
        count(*) filter (where event_name = 'demo_form_success')::int as demo_form_successes
      from session_events
    ), sources as (
      select coalesce(first_source, 'unknown') as source,
        coalesce(first_medium, 'unknown') as medium,
        count(distinct session_id)::int as sessions
      from session_events
      group by 1, 2
    ), contents as (
      select coalesce(first_content, 'unknown') as content,
        count(distinct session_id)::int as sessions
      from session_events
      group by 1
    ), paths as (
      select url_path as path,
        count(*) filter (where event_name is null)::int as pageviews,
        count(distinct session_id)::int as sessions
      from session_events
      where event_name is null
      group by url_path
      order by pageviews desc, path asc
      limit 25
    )
    select json_build_object(
      'totals', (select row_to_json(totals) from totals),
      'sources', coalesce((select json_agg(sources order by sessions desc, source asc) from sources), '[]'::json),
      'contents', coalesce((select json_agg(contents order by sessions desc, content asc) from contents), '[]'::json),
      'paths', coalesce((select json_agg(paths) from paths), '[]'::json)
    ) as summary;
  `;

  const summary = rows[0]?.summary ?? { totals: {}, sources: [], contents: [], paths: [] };
  return Response.json(
    {
      campaign: window.campaign,
      window: { start: window.start.toISOString(), end: window.end.toISOString() },
      domain,
      summary,
      observedAt: new Date().toISOString(),
    },
    {
      headers: { 'Cache-Control': 'private, no-store' },
    },
  );
}
