import { describe, expect, it, vi } from "vitest";

import { StructuredWebJobReader } from "../src/index.js";

const jobPage = `<!doctype html><html><head>
<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "JobPosting",
  "title": "Platform Engineer",
  "datePosted": "2026-08-19",
  "hiringOrganization": { "@type": "Organization", "name": "Acme Systems" },
  "jobLocationType": "TELECOMMUTE",
  "applicantLocationRequirements": { "@type": "Country", "name": "European Union" },
  "description": "<p>Build and operate a reliable cloud platform for a distributed engineering team.</p><p>You must have strong TypeScript and infrastructure automation experience.</p>",
  "qualifications": "Strong TypeScript and infrastructure automation experience"
}
</script></head><body>External page</body></html>`;

describe("structured public web job reader", () => {
  it("extracts a JobPosting and returns bounded evidence", async () => {
    const fetchImpl = vi.fn(
      async () =>
        new Response(jobPage, {
          status: 200,
          headers: { "content-type": "text/html; charset=utf-8" },
        }),
    );
    const reader = new StructuredWebJobReader(
      fetchImpl as typeof fetch,
      () => new Date("2026-08-20T10:00:00.000Z"),
      async () => ["203.0.113.10"],
    );

    const job = await reader.readUrl("https://jobs.example.com/platform");
    expect(job).toMatchObject({
      source: "jobs.example.com",
      fetchMethod: "http-json-ld",
      structured: {
        title: "Platform Engineer",
        company: "Acme Systems",
        location: "European Union",
        remoteType: "remote",
        postedAt: "2026-08-19T00:00:00.000Z",
      },
    });
    expect(job?.structured?.jdText).toContain("Build and operate");
    expect(job?.structured?.requirements[0]).toContain("TypeScript");
  });

  it("returns bounded visible evidence when a job page has no JSON-LD", async () => {
    const genericPage = `<!doctype html><html><head><title>Backend Engineer at Example Cloud</title></head><body>
      <main><h1>Backend Engineer</h1><p>Example Cloud</p><p>Remote within the European Union</p>
      <h2>About the role</h2><p>${"Build reliable Python services and APIs for our distributed cloud platform. ".repeat(8)}</p>
      <h2>Responsibilities</h2><p>Own backend services, tests, observability, and production operations.</p>
      <h2>Requirements</h2><p>Three years of Python experience, strong SQL, and professional English.</p>
      <button>Apply now</button></main></body></html>`;
    const reader = new StructuredWebJobReader(
      vi.fn(
        async () =>
          new Response(genericPage, {
            status: 200,
            headers: { "content-type": "text/html; charset=utf-8" },
          }),
      ) as typeof fetch,
      () => new Date("2026-08-20T10:00:00.000Z"),
      async () => ["203.0.113.10"],
    );

    const evidence = await reader.readUrl(
      "https://careers.example.com/backend",
    );
    expect(evidence).toMatchObject({
      source: "careers.example.com",
      fetchMethod: "http-html",
      structured: undefined,
    });
    expect(evidence?.pageText).toContain("Three years of Python experience");
  });

  it("rejects a hostname resolving to a private address before fetch", async () => {
    const fetchImpl = vi.fn<typeof fetch>();
    const reader = new StructuredWebJobReader(
      fetchImpl,
      () => new Date(),
      async () => ["127.0.0.1"],
    );
    await expect(
      reader.readUrl("https://jobs.example.com/private"),
    ).rejects.toThrow("public addresses");
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
