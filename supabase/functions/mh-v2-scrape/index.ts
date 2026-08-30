import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { handleScrapeRequest } from "./scrape.ts";

// Accepts POST /mh-v2-scrape and /mh-v2-scrape/ (dashboard callFn uses a trailing slash).
serve((req) =>
  handleScrapeRequest(req, {
    fetchFn: globalThis.fetch.bind(globalThis),
    deepseekKey: Deno.env.get("DEEPSEEK_API_KEY") || "",
  }),
);
