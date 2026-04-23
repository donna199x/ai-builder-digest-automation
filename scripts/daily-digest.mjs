const FEEDS = {
  x: 'https://raw.githubusercontent.com/zarazhangrui/follow-builders/main/feed-x.json',
  podcasts: 'https://raw.githubusercontent.com/zarazhangrui/follow-builders/main/feed-podcasts.json',
  blogs: 'https://raw.githubusercontent.com/zarazhangrui/follow-builders/main/feed-blogs.json'
};

const NOTION_VERSION = '2022-06-28';

function requireEnv(name) {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

function localDateParts(timeZone) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false
  }).formatToParts(new Date());
  const map = Object.fromEntries(parts.map((p) => [p.type, p.value]));
  return {
    date: `${map.year}-${map.month}-${map.day}`,
    time: `${map.hour}:${map.minute}`
  };
}

async function fetchJson(url) {
  const res = await fetch(url, { headers: { 'User-Agent': 'ai-builder-digest-automation' } });
  if (!res.ok) throw new Error(`Failed to fetch ${url}: ${res.status} ${res.statusText}`);
  return res.json();
}

function compactFeed(feedX, feedPodcasts, feedBlogs) {
  return {
    feedGeneratedAt: feedX.generatedAt || feedPodcasts.generatedAt || feedBlogs.generatedAt || null,
    stats: {
      xBuilders: (feedX.x || []).length,
      totalTweets: (feedX.x || []).reduce((sum, builder) => sum + (builder.tweets || []).length, 0),
      podcastEpisodes: (feedPodcasts.podcasts || []).length,
      blogPosts: (feedBlogs.blogs || []).reduce((sum, blog) => sum + (blog.posts || []).length, 0)
    },
    x: (feedX.x || []).map((builder) => ({
      name: builder.name,
      role: builder.role,
      tweets: (builder.tweets || []).slice(0, 4).map((tweet) => ({
        text: tweet.text,
        url: tweet.url,
        date: tweet.date
      }))
    })),
    podcasts: (feedPodcasts.podcasts || []).map((podcast) => ({
      name: podcast.name,
      title: podcast.title,
      url: podcast.url,
      publishedAt: podcast.publishedAt,
      transcript: podcast.transcript ? podcast.transcript.slice(0, 9000) : undefined,
      summary: podcast.summary || podcast.description
    })),
    blogs: (feedBlogs.blogs || []).map((blog) => ({
      name: blog.name || blog.source,
      posts: (blog.posts || []).slice(0, 6).map((post) => ({
        title: post.title,
        url: post.url,
        author: post.author,
        date: post.date || post.publishedAt,
        summary: post.summary || post.text
      }))
    }))
  };
}

async function generateDigest(feed, today, timeZone) {
  const apiKey = requireEnv('GEMINI_API_KEY');
  const models = (process.env.GEMINI_MODEL || 'gemini-2.5-flash,gemini-2.0-flash,gemini-2.0-flash-lite')
    .split(',')
    .map((m) => m.trim())
    .filter(Boolean);
  const prompt = `You are writing a concise bilingual AI Builders Digest for ${today} (${timeZone}).

Rules:
- Ground the digest only in the JSON feed below.
- Do not fabricate facts, quotes, links, dates, companies, or claims.
- Include original source links for every item you mention.
- If a source has no link, omit it.
- Keep it concise and useful.
- Write Chinese first, then English.
- Use Markdown with these headings exactly:
  # AI Builders Digest | ${today}
  ## 中文摘要
  ### 今日重点
  ### X / Twitter
  ### Official Blogs
  ### Podcasts
  ## English Digest
  ### Main Signals
  ### X / Twitter
  ### Official Blogs
  ### Podcasts
- If a section has no source items, write one short line saying there were no linked items in the feed.
- End with: Generated through the Follow Builders skill: https://github.com/zarazhangrui/follow-builders

Feed JSON:
${JSON.stringify(feed)}`;

  let lastError = null;
  for (const model of models) {
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`;
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ role: 'user', parts: [{ text: prompt }] }],
          generationConfig: {
            temperature: 0.3,
            maxOutputTokens: 5000
          }
        })
      });

      if (res.ok) {
        const data = await res.json();
        const outputText = (data.candidates || [])
          .flatMap((candidate) => candidate.content?.parts || [])
          .map((part) => part.text || '')
          .join('\n')
          .trim();
        if (!outputText) throw new Error('Gemini API returned empty digest text');
        return outputText;
      }

      const body = await res.text();
      lastError = new Error(`Gemini API error using ${model}: ${res.status} ${body}`);
      if (![429, 500, 502, 503, 504].includes(res.status)) throw lastError;
      const delayMs = attempt * 5000;
      console.warn(`Gemini model ${model} attempt ${attempt} failed with ${res.status}; retrying in ${delayMs}ms`);
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }

  throw lastError || new Error('Gemini API failed for all configured models');
}

function markdownToNotionBlocks(markdown) {
  const lines = markdown.split(/\r?\n/);
  const blocks = [];
  let paragraph = [];
  let bullets = [];

  const rich = (text) => [{ type: 'text', text: { content: text.slice(0, 1900) } }];
  const flushParagraph = () => {
    if (paragraph.length) {
      blocks.push({ object: 'block', type: 'paragraph', paragraph: { rich_text: rich(paragraph.join(' ')) } });
      paragraph = [];
    }
  };
  const flushBullets = () => {
    for (const item of bullets) {
      blocks.push({ object: 'block', type: 'bulleted_list_item', bulleted_list_item: { rich_text: rich(item) } });
    }
    bullets = [];
  };

  for (const raw of lines) {
    const line = raw.trim();
    if (!line) {
      flushParagraph();
      flushBullets();
      continue;
    }
    const heading = line.match(/^(#{1,3})\s+(.+)$/);
    if (heading) {
      flushParagraph();
      flushBullets();
      const level = heading[1].length;
      const type = level === 1 ? 'heading_1' : level === 2 ? 'heading_2' : 'heading_3';
      blocks.push({ object: 'block', type, [type]: { rich_text: rich(heading[2]) } });
      continue;
    }
    const bullet = line.match(/^[-*]\s+(.+)$/);
    if (bullet) {
      flushParagraph();
      bullets.push(bullet[1]);
      continue;
    }
    paragraph.push(line);
  }
  flushParagraph();
  flushBullets();
  return blocks;
}

async function notionFetch(path, options = {}) {
  const token = requireEnv('NOTION_TOKEN');
  const res = await fetch(`https://api.notion.com/v1${path}`, {
    ...options,
    headers: {
      'Authorization': `Bearer ${token}`,
      'Notion-Version': NOTION_VERSION,
      'Content-Type': 'application/json',
      ...(options.headers || {})
    }
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Notion API error ${res.status}: ${body}`);
  }
  return res.json();
}

async function findDigestPage(databaseId, title) {
  const data = await notionFetch(`/databases/${databaseId}/query`, {
    method: 'POST',
    body: JSON.stringify({
      filter: { property: 'Name', title: { equals: title } },
      page_size: 1
    })
  });
  return data.results?.[0] || null;
}

async function archiveExistingChildren(pageId) {
  let cursor;
  do {
    const query = cursor ? `?start_cursor=${encodeURIComponent(cursor)}` : '';
    const data = await notionFetch(`/blocks/${pageId}/children${query}`, { method: 'GET' });
    for (const block of data.results || []) {
      await notionFetch(`/blocks/${block.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ archived: true })
      });
    }
    cursor = data.has_more ? data.next_cursor : null;
  } while (cursor);
}

async function appendBlocks(pageId, blocks) {
  for (let i = 0; i < blocks.length; i += 90) {
    await notionFetch(`/blocks/${pageId}/children`, {
      method: 'PATCH',
      body: JSON.stringify({ children: blocks.slice(i, i + 90) })
    });
  }
}

async function upsertDigestPage(markdown, today) {
  const databaseId = requireEnv('NOTION_DATABASE_ID').replace(/-/g, '');
  const title = `AI Builders Digest - ${today}`;
  const existing = await findDigestPage(databaseId, title);
  const blocks = markdownToNotionBlocks(markdown);

  if (existing) {
    await archiveExistingChildren(existing.id);
    await appendBlocks(existing.id, blocks);
    console.log(`Updated existing Notion page: ${existing.url}`);
    return existing.url;
  }

  const page = await notionFetch('/pages', {
    method: 'POST',
    body: JSON.stringify({
      parent: { database_id: databaseId },
      icon: { type: 'emoji', emoji: '🧠' },
      properties: {
        Name: { title: [{ type: 'text', text: { content: title } }] },
        Date: { date: { start: today } },
        '归档': { checkbox: false }
      },
      children: blocks.slice(0, 90)
    })
  });
  if (blocks.length > 90) await appendBlocks(page.id, blocks.slice(90));
  console.log(`Created Notion page: ${page.url}`);
  return page.url;
}

async function main() {
  const timeZone = process.env.TIMEZONE || 'Asia/Shanghai';
  const { date: today, time } = localDateParts(timeZone);
  const [feedX, feedPodcasts, feedBlogs] = await Promise.all([
    fetchJson(FEEDS.x),
    fetchJson(FEEDS.podcasts),
    fetchJson(FEEDS.blogs)
  ]);
  const feed = compactFeed(feedX, feedPodcasts, feedBlogs);
  const digest = await generateDigest(feed, today, timeZone);
  const note = `Generated at: ${today} ${time} ${timeZone}\nFeed updated at: ${feed.feedGeneratedAt || 'unknown'}\n\n`;
  await upsertDigestPage(`${note}${digest}`, today);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
