import { Injectable } from '@nestjs/common';

// The only outbound HTTP this application makes. Kept behind a class of its own
// so `IngestService` can be tested against the saved fixture without a network
// stack, and so the politeness settings below live in one readable place.
//
// ⚠️ gravina82.com is a third party's server. One request per scheduled run,
// with a timeout and an identifying User-Agent — never a crawl.

// Identifies the client and points at the public repository, so whoever reads
// that server's logs can tell what this is. No site hostname here: this string
// travels to a machine nobody in this project controls.
const USER_AGENT = 'gravindex-ingest/2.0 (+https://github.com/dicren/gravindex)';

@Injectable()
export class FeedClient {
  async fetchFeed(url: string, timeoutMs: number): Promise<string> {
    const response = await fetch(url, {
      // ⚠️ `AbortSignal.timeout` covers the whole exchange, headers AND body.
      // A plain `setTimeout` around the promise would leave the socket open.
      signal: AbortSignal.timeout(timeoutMs),
      redirect: 'follow',
      headers: {
        accept: 'application/rss+xml, application/xml;q=0.9, text/xml;q=0.8',
        'user-agent': USER_AGENT,
      },
    });

    if (!response.ok) {
      throw new Error(`feed request failed with HTTP ${response.status} ${response.statusText}`);
    }

    return response.text();
  }
}
