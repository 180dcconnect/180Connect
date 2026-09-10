import assert from "node:assert/strict";
import test from "node:test";
import {
  buildNewsQuery,
  lookupLiveNewsHook,
  MAX_HOOK_CHARS,
  resolveNewsProvider,
  selectNewsHook,
} from "./news-hook.ts";

function isoDaysAgo(days: number): string {
  const date = new Date(Date.now() - days * 86_400_000);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`;
}

function stubExa(
  results: unknown,
  status = 200,
  capture?: { url?: string; init?: RequestInit },
): typeof fetch {
  return (async (input: unknown, init?: RequestInit) => {
    if (capture) {
      capture.url = String(input);
      capture.init = init;
    }
    return new Response(JSON.stringify({ results, costDollars: { total: 0.007 } }), {
      status,
    });
  }) as typeof fetch;
}

/** Runs `run` with `process.env` overridden, restoring afterwards. */
async function withEnv(
  vars: Record<string, string | undefined>,
  run: () => Promise<void>,
): Promise<void> {
  const saved: Record<string, string | undefined> = {};
  for (const key of Object.keys(vars)) {
    saved[key] = process.env[key];
    if (vars[key] === undefined) delete process.env[key];
    else process.env[key] = vars[key];
  }
  try {
    await run();
  } finally {
    for (const key of Object.keys(vars)) {
      if (saved[key] === undefined) delete process.env[key];
      else process.env[key] = saved[key];
    }
  }
}

const EXA_ENV = { NEWS_HOOK_PROVIDER: "exa", EXA_API_KEY: "exa_test_key" };

const INPUT = {
  organisationId: "org-1",
  organisationName: "Snowdrop Project",
  tradingName: null,
  website: "https://www.snowdropproject.co.uk",
};

test("resolveNewsProvider fails closed to none", () => {
  assert.equal(resolveNewsProvider({}), "none");
  assert.equal(resolveNewsProvider({ NEWS_HOOK_PROVIDER: "exa" }), "exa");
  assert.equal(resolveNewsProvider({ NEWS_HOOK_PROVIDER: "gdelt" }), "none");
  assert.equal(resolveNewsProvider({ NEWS_HOOK_PROVIDER: "  exa  " }), "exa");
});

test("buildNewsQuery shapes the phrase for Exa's neural search", () => {
  assert.equal(buildNewsQuery("Roundabout"), '"Roundabout" charity');
  assert.equal(buildNewsQuery("Snowdrop Project"), '"Snowdrop Project" charity');
  assert.equal(
    buildNewsQuery("SHEFFIELD AFRICAN CARIBBEAN MENTAL HEALTH ASSOCIATION LIMITED"),
    '"SHEFFIELD AFRICAN CARIBBEAN MENTAL HEALTH ASSOCIATION" charity',
  );
  assert.equal(buildNewsQuery("   "), null);
  assert.equal(buildNewsQuery("Ltd"), null);
});

test("lookup runs the shaped query and the bare name together", async () => {
  await withEnv(EXA_ENV, async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const fetchFn = (async (input: unknown, init?: RequestInit) => {
      calls.push({ url: String(input), init });
      return new Response(JSON.stringify({ results: [] }));
    }) as typeof fetch;
    await lookupLiveNewsHook(
      {
        organisationId: "org-2",
        organisationName: "Sheffield Hospitals Charity",
        tradingName: null,
        website: null,
      },
      fetchFn,
    );
    assert.equal(calls.length, 2);
    const bodies = calls.map((call) => JSON.parse(String(call.init?.body)));
    assert.equal(bodies[0].query, '"Sheffield Hospitals Charity" charity');
    assert.equal(bodies[1].query, "Sheffield Hospitals Charity");
    for (const [i, body] of bodies.entries()) {
      assert.equal(calls[i].url, "https://api.exa.ai/search");
      assert.equal(body.type, "fast");
      assert.equal(body.category, "news");
      assert.equal(body.numResults, 5);
      assert.match(body.startPublishedDate, /^\d{4}-\d{2}-\d{2}$/);
      assert.ok(!("contents" in body), "title/url/date is everything the gate needs");
    }
    assert.deepEqual(calls[0].init?.headers, {
      "Content-Type": "application/json",
      Authorization: "Bearer exa_test_key",
    });
  });
});

test("single-token names skip the bare query: unshaped evidence is inadmissible", async () => {
  await withEnv(EXA_ENV, async () => {
    const seen: string[] = [];
    const fetchFn = (async (_input: unknown, init?: RequestInit) => {
      const body = JSON.parse(String((init as { body?: string }).body));
      seen.push(body.query);
      const traffic = body.query === "Roundabout";
      return new Response(
        JSON.stringify({
          results: traffic
            ? [
                {
                  title: "How to Signal Correctly in a Roundabout",
                  url: "https://www.familyhandyman.com/roundabout",
                  publishedDate: isoDaysAgo(5),
                  author: "Handy Sam",
                },
              ]
            : [
                {
                  title: "Roundabout youth homelessness services receive national praise",
                  url: "https://www.thestar.co.uk/roundabout-praise",
                  publishedDate: isoDaysAgo(9),
                  author: "Jane Reporter",
                },
              ],
        }),
      );
    }) as typeof fetch;
    const result = await lookupLiveNewsHook(
      { organisationId: "org-9", organisationName: "Roundabout", website: null },
      fetchFn,
    );
    assert.deepEqual(seen, ['"Roundabout" charity']);
    assert.ok(result);
    assert.match(result.text, /national praise/);
  });
});

test("lookup gates surviving results when one query fails", async () => {
  await withEnv(EXA_ENV, async () => {
    const fetchFn = (async (_input: unknown, init?: RequestInit) => {
      const body = JSON.parse(String((init as { body?: string }).body));
      if (String(body.query).startsWith('"')) {
        return new Response(
          JSON.stringify({
            results: [
              {
                title: "Sheffield Hospitals Charity affected by cyber attack",
                url: "https://www.bbc.co.uk/news/cyber",
                publishedDate: isoDaysAgo(6),
                author: "BBC News",
              },
            ],
          }),
        );
      }
      return new Response(JSON.stringify({ error: "boom" }), { status: 500 });
    }) as typeof fetch;
    const result = await lookupLiveNewsHook(
      {
        organisationId: "org-2",
        organisationName: "Sheffield Hospitals Charity",
        tradingName: null,
        website: null,
      },
      fetchFn,
    );
    assert.ok(result);
    assert.match(result.text, /cyber attack/);
  });
});

test("lookup skips the provider entirely when disabled", async () => {
  await withEnv({ NEWS_HOOK_PROVIDER: "none", EXA_API_KEY: undefined }, async () => {
    let called = false;
    const spy = (async () => {
      called = true;
      return new Response("{}");
    }) as typeof fetch;
    assert.equal(await lookupLiveNewsHook(INPUT, spy), null);
    assert.equal(called, false);
  });
});

test("lookup returns null without a key rather than calling Exa keyless", async () => {
  await withEnv({ NEWS_HOOK_PROVIDER: "exa", EXA_API_KEY: undefined }, async () => {
    let called = false;
    const spy = (async () => {
      called = true;
      return new Response("{}");
    }) as typeof fetch;
    assert.equal(await lookupLiveNewsHook(INPUT, spy), null);
    assert.equal(called, false);
  });
});

test("lookup prefers third-party coverage over the org's own site", async () => {
  await withEnv(EXA_ENV, async () => {
    const result = await lookupLiveNewsHook(
      {
        organisationId: "org-2",
        organisationName: "Sheffield Hospitals Charity",
        tradingName: null,
        website: "https://www.sheffieldhospitalscharity.org.uk",
      },
      stubExa([
        {
          title: "Sheffield Hospitals Charity - Employees, Jobs, Stock & Culture",
          url: "https://uk.linkedin.com/company/sheffield-hospitals-charity",
          publishedDate: isoDaysAgo(30),
          author: null,
        },
        {
          title: "Sheffield Hospitals Charity affected by cyber attack",
          url: "https://www.bbc.co.uk/news/articles/c123",
          publishedDate: isoDaysAgo(30),
          author: "BBC News",
        },
      ]),
    );
    assert.ok(result);
    assert.match(result.text, /cyber attack/);
    assert.match(result.text, /bbc\.co\.uk/);
    assert.equal(result.url, "https://www.bbc.co.uk/news/articles/c123");
  });
});

test("lookup prefers a bylined match over an unattributed one", async () => {
  await withEnv(EXA_ENV, async () => {
    const result = await lookupLiveNewsHook(
      INPUT,
      stubExa([
        {
          title: "Snowdrop Project",
          url: "https://www.snowdropproject.co.uk/about",
          publishedDate: isoDaysAgo(9),
          author: null,
        },
        {
          title: "Snowdrop Project wins funding for survivor services",
          url: "https://www.thestar.co.uk/news/snowdrop-funding",
          publishedDate: isoDaysAgo(4),
          author: "Jane Reporter",
        },
      ]),
    );
    assert.ok(result);
    assert.match(result.text, /wins funding/);
  });
});

test("lookup rejects substring matches: assistant is not Assist", async () => {
  await withEnv(EXA_ENV, async () => {
    const result = await lookupLiveNewsHook(
      {
        organisationId: "org-3",
        organisationName: "Assist Sheffield",
        tradingName: null,
        website: null,
      },
      stubExa([
        {
          title: "Assistant Clinic Manager - Sheffield at Thérapie Clinic",
          url: "https://therapieclinic.teamtailor.com/jobs/1",
          publishedDate: isoDaysAgo(5),
          author: null,
        },
        {
          title: "Assistant Housing Support Worker - Ashberry Recruitment",
          url: "https://www.ashberryrecruitment.com/jobs/2",
          publishedDate: isoDaysAgo(8),
          author: null,
        },
      ]),
    );
    assert.equal(result, null);
  });
});

test("lookup returns null when nothing mentions the organisation", async () => {
  await withEnv(EXA_ENV, async () => {
    const result = await lookupLiveNewsHook(
      INPUT,
      stubExa([
        {
          title: "National trust reports record volunteering",
          url: "https://other.test/volunteering",
          publishedDate: isoDaysAgo(2),
          author: "Someone",
        },
      ]),
    );
    assert.equal(result, null);
  });
});

test("lookup skips stale items for a recent one in the same tier", async () => {
  await withEnv(EXA_ENV, async () => {
    const result = await lookupLiveNewsHook(
      INPUT,
      stubExa([
        {
          title: "Snowdrop Project celebrates tenth anniversary",
          url: "https://example-news.test/anniversary",
          publishedDate: isoDaysAgo(120),
          author: "Jane Reporter",
        },
        {
          title: "Snowdrop Project launches helpline",
          url: "https://example-news.test/helpline",
          publishedDate: isoDaysAgo(3),
          author: "Jane Reporter",
        },
      ]),
    );
    assert.ok(result);
    assert.match(result.text, /launches helpline/);
  });
});

test("lookup returns null — never throws — on provider failure", async () => {
  await withEnv(EXA_ENV, async () => {
    assert.equal(await lookupLiveNewsHook(INPUT, stubExa([], 500)), null);
    assert.equal(await lookupLiveNewsHook(INPUT, stubExa([], 429)), null);
    // 402 is Exa's documented NO_MORE_CREDITS: blocked, never billed.
    assert.equal(await lookupLiveNewsHook(INPUT, stubExa([], 402)), null);
    const failing = (async () => {
      throw new Error("socket hang up");
    }) as typeof fetch;
    assert.equal(await lookupLiveNewsHook(INPUT, failing), null);
    const timingOut = (async () => {
      throw new DOMException("The operation timed out.", "TimeoutError");
    }) as typeof fetch;
    assert.equal(await lookupLiveNewsHook(INPUT, timingOut), null);
  });
});

test("lookup returns null on malformed payloads", async () => {
  await withEnv(EXA_ENV, async () => {
    const badJson = (async () => new Response("not json", { status: 200 })) as typeof fetch;
    assert.equal(await lookupLiveNewsHook(INPUT, badJson), null);
    assert.equal(await lookupLiveNewsHook(INPUT, stubExa(null)), null);
    assert.equal(await lookupLiveNewsHook(INPUT, stubExa([{ title: 42 }])), null);
    assert.equal(await lookupLiveNewsHook(INPUT, stubExa([])), null);
  });
});

test("selectNewsHook rejects a different entity's acronym", () => {
  const result = selectNewsHook(
    [
      {
        title:
          "Canvas & Voice: Paint Your Poetry — SADACCA (Sheffield And District African Caribbean Community Association)",
        url: "https://eventslist.co.uk/sheffield/canvas-voice",
        publishedDate: isoDaysAgo(20),
        author: "Events Team",
      },
    ],
    ["Sheffield African Caribbean Mental Health Association"],
  );
  assert.equal(result, null);
});

test("selectNewsHook keeps real-news caps like COVID in play", () => {
  const result = selectNewsHook(
    [
      {
        title: "Sheffield hospitals face COVID winter pressures",
        url: "https://www.thestar.co.uk/news/covid-pressures",
        publishedDate: isoDaysAgo(12),
        author: "Jane Reporter",
      },
    ],
    ["Sheffield Hospitals Charity"],
  );
  assert.ok(result);
  assert.match(result.text, /COVID winter pressures/);
});

test("deprioritised items can only win on a full-phrase match", () => {
  const names = ["St Luke's Hospice Sheffield"];
  const website = "https://www.stlukeshospice.org.uk";
  const supplierSpam = {
    title:
      "We're delighted St Luke's - Sheffield's Hospice selected a Line 6000 Flatwork Ironer for its laundry",
    url: "https://www.linkedin.com/posts/electrolux-ironer",
    publishedDate: isoDaysAgo(4),
    author: "Supplier Marketing",
  };
  assert.equal(selectNewsHook([supplierSpam], names, { website }), null);

  const ownAnnouncement = {
    title: "Elf Dash | Bluebell Wood Children's Hospice",
    url: "https://www.bluebellwood.org/elf-dash",
    publishedDate: isoDaysAgo(9),
    author: null,
  };
  const kept = selectNewsHook(
    [ownAnnouncement],
    ["Bluebell Wood Children's Hospice"],
    { website: "https://www.bluebellwood.org" },
  );
  assert.ok(kept);
  assert.match(kept.text, /Elf Dash/);
});

test("selectNewsHook truncates very long headlines to the hook budget", () => {
  const result = selectNewsHook(
    [
      {
        title: `Snowdrop Project ${"announces a major expansion of its services ".repeat(10)}today`,
        url: "https://example-news.test/long",
        publishedDate: isoDaysAgo(1),
        author: "Jane Reporter",
      },
    ],
    ["Snowdrop Project"],
  );
  assert.ok(result);
  assert.ok(result.text.length <= MAX_HOOK_CHARS);
  assert.match(result.text, /Snowdrop Project/);
});

test("selectNewsHook skips articles whose url cannot be verified", () => {
  // A hook without a working URL cannot be checked by the CAM, so the
  // article is dropped in favour of fallback content rather than kept blind.
  const result = selectNewsHook(
    [
      {
        title: "Snowdrop Project launches helpline",
        url: "ftp://example-news.test/helpline",
        publishedDate: isoDaysAgo(1),
        author: "Jane Reporter",
      },
    ],
    ["Snowdrop Project"],
  );
  assert.equal(result, null);
});
