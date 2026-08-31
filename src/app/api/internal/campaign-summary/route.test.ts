import { beforeEach, describe, expect, test, vi } from 'vitest';

const { queryRaw } = vi.hoisted(() => ({ queryRaw: vi.fn() }));
vi.mock('@/lib/prisma', () => ({
  default: { client: { $queryRaw: queryRaw } },
}));

import { GET } from './route';

const WEBSITE_ID = '2077e1de-53c8-4887-83fe-127a44d9287c';
const UUID_V7 = '0198f4e1-8c4b-7abc-8def-1234567890ab';
const request = (
  query = 'campaign=completed-documented&start=2026-08-24T07:00:00.000Z&end=2026-08-31T07:00:00.000Z',
  token = 'test-token',
) =>
  new Request(`https://analytics.truecrewllc.com/api/internal/campaign-summary?${query}`, {
    headers: { authorization: `Bearer ${token}` },
  });

function sqlText() {
  const strings = queryRaw.mock.calls[0]?.[0] as TemplateStringsArray | undefined;
  return strings ? strings.join('?') : '';
}

function sqlValues() {
  return queryRaw.mock.calls[0]?.slice(1) ?? [];
}

describe('internal campaign summary', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.CLICKHOUSE_URL;
    delete process.env.SALT_ROTATION;
    process.env.TRUECREW_ANALYTICS_READ_TOKEN = 'test-token';
    process.env.TRUECREW_ANALYTICS_WEBSITE_ID = WEBSITE_ID;
    process.env.TRUECREW_ANALYTICS_SITE_HOSTNAME = 'www.truecrewllc.com';
  });

  test('fails closed without the server-only token', async () => {
    const response = await GET(request(undefined, 'wrong-token'));
    expect(response.status).toBe(401);
    expect(queryRaw).not.toHaveBeenCalled();
  });

  test('rejects malformed, nonexistent, or excessive query windows', async () => {
    const badCampaign = await GET(
      request(
        'campaign=BAD%20CAMPAIGN!&start=2026-08-24T07:00:00.000Z&end=2026-08-31T07:00:00.000Z',
      ),
    );
    expect(badCampaign.status).toBe(400);
    const nonexistentDate = await GET(
      request(
        'campaign=completed-documented&start=2026-02-30T00:00:00.000Z&end=2026-03-03T00:00:00.000Z',
      ),
    );
    expect(nonexistentDate.status).toBe(400);
    const tooWide = await GET(
      request(
        'campaign=completed-documented&start=2026-01-01T00:00:00.000Z&end=2026-08-31T00:00:00.000Z',
      ),
    );
    expect(tooWide.status).toBe(400);
    expect(queryRaw).not.toHaveBeenCalled();
  });

  test('fails closed without unique website scope or on ClickHouse', async () => {
    delete process.env.TRUECREW_ANALYTICS_WEBSITE_ID;
    expect((await GET(request())).status).toBe(503);
    process.env.TRUECREW_ANALYTICS_WEBSITE_ID = WEBSITE_ID;
    process.env.CLICKHOUSE_URL = 'https://clickhouse.example.test';
    expect((await GET(request())).status).toBe(503);
    expect(queryRaw).not.toHaveBeenCalled();
  });

  test('accepts a configured UUIDv7 website identifier', async () => {
    process.env.TRUECREW_ANALYTICS_WEBSITE_ID = UUID_V7;
    queryRaw.mockResolvedValueOnce([{ summary: null }]);
    expect((await GET(request())).status).toBe(200);
    expect(queryRaw).toHaveBeenCalledTimes(1);
  });

  test('preserves the requested campaign casing used by ingestion', async () => {
    queryRaw.mockResolvedValueOnce([{ summary: null }]);
    const response = await GET(
      request(
        'campaign=Completed-Documented&start=2026-08-24T07:00:00.000Z&end=2026-08-31T07:00:00.000Z',
      ),
    );
    expect(response.status).toBe(200);
    expect((await response.json()).campaign).toBe('Completed-Documented');
    expect(sqlValues()).toContain('Completed-Documented');
  });

  test('returns bounded privacy-safe aggregate campaign data', async () => {
    queryRaw.mockResolvedValueOnce([
      {
        summary: {
          totals: { sessions: 4, pageviews: 14, events: 67, resource_views: 1, product_views: 2 },
          sources: [{ source: 'linkedin', medium: 'organic-social', sessions: 3 }],
          paths: [{ path: '/resources', pageviews: 6, sessions: 4 }],
        },
      },
    ]);
    const response = await GET(request());
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    const body = await response.json();
    expect(body.campaign).toBe('completed-documented');
    expect(body.hostname).toBe('www.truecrewllc.com');
    expect(body.summary.totals.sessions).toBe(4);
    expect(body.summary).not.toHaveProperty('contents');
    expect(JSON.stringify(body)).not.toMatch(/email|phone|company/i);
    expect(queryRaw).toHaveBeenCalledTimes(1);

    const sql = sqlText();
    expect(sql).toContain('with first_campaign_touch as');
    expect(sql).toContain('from first_campaign_touch');
    expect(sql.indexOf("coalesce(we.utm_campaign, '') <> ''")).toBeLessThan(
      sql.indexOf('where utm_campaign ='),
    );
    expect(sql).toContain('we.website_id = ?::uuid');
    expect(sql).toContain("lower(trim(trailing '.' from we.hostname)) = ?");
    expect(sql).toContain('we.created_at >= ?');
    expect(sql).toContain('e.created_at >= t.first_touch_at');
    expect(sql).toContain('event_type = 1');
    expect(sql).toContain('event_type = 2');
    expect(sql).not.toContain('md5(');
    expect(sql).not.toContain('utm_content');
    expect(sql).toContain("split_part(coalesce(url_path, ''), '#', 1)");
    expect(sql).toContain("regexp_replace(split_part(url_path, '#', 1), '/+$', '')");
    expect(sql).toContain("then '/resources/:resource'");
    expect(sql).toContain('having count(*) >= 2');
    expect(sql).toContain('limit 20');
    expect(sql).toContain('limit 25');

    const dates = sqlValues().filter((value): value is Date => value instanceof Date);
    expect(dates.some(value => value.getTime() < Date.parse('2026-08-24T07:00:00.000Z'))).toBe(
      true,
    );
  });
});
