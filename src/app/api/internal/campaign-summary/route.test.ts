import { beforeEach, describe, expect, test, vi } from 'vitest';

const { queryRaw } = vi.hoisted(() => ({ queryRaw: vi.fn() }));
vi.mock('@/lib/prisma', () => ({
  default: { client: { $queryRaw: queryRaw } },
}));

import { GET } from './route';

const request = (
  query = 'campaign=completed-documented&start=2026-08-24T07:00:00.000Z&end=2026-08-31T07:00:00.000Z',
  token = 'test-token',
) =>
  new Request(`https://analytics.truecrewllc.com/api/internal/campaign-summary?${query}`, {
    headers: { authorization: `Bearer ${token}` },
  });

describe('internal campaign summary', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.TRUECREW_ANALYTICS_READ_TOKEN = 'test-token';
    process.env.TRUECREW_ANALYTICS_SITE_DOMAIN = 'truecrewllc.com';
  });

  test('fails closed without the server-only token', async () => {
    const response = await GET(request(undefined, 'wrong-token'));
    expect(response.status).toBe(401);
    expect(queryRaw).not.toHaveBeenCalled();
  });

  test('rejects malformed or excessive query windows', async () => {
    const badCampaign = await GET(
      request(
        'campaign=BAD%20CAMPAIGN&start=2026-08-24T07:00:00.000Z&end=2026-08-31T07:00:00.000Z',
      ),
    );
    expect(badCampaign.status).toBe(400);
    const tooWide = await GET(
      request(
        'campaign=completed-documented&start=2026-01-01T00:00:00.000Z&end=2026-08-31T00:00:00.000Z',
      ),
    );
    expect(tooWide.status).toBe(400);
    expect(queryRaw).not.toHaveBeenCalled();
  });

  test('returns only bounded aggregate campaign data', async () => {
    queryRaw.mockResolvedValueOnce([
      {
        summary: {
          totals: { sessions: 4, pageviews: 18, events: 78, resource_views: 1, product_views: 3 },
          sources: [{ source: 'linkedin', medium: 'organic-social', sessions: 3 }],
          contents: [{ content: 'mon-complete-vs-record', sessions: 4 }],
          paths: [{ path: '/resources', pageviews: 7, sessions: 4 }],
        },
      },
    ]);
    const response = await GET(request());
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    const body = await response.json();
    expect(body.campaign).toBe('completed-documented');
    expect(body.domain).toBe('truecrewllc.com');
    expect(body.summary.totals.sessions).toBe(4);
    expect(JSON.stringify(body)).not.toMatch(/email|phone|company|name/i);
    expect(queryRaw).toHaveBeenCalledTimes(1);
  });
});
