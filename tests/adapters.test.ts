// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import { extractCandidates, isPrivatePage, platformForUrl } from '../src/content/adapters';

const extract = (html: string, page = 'https://www.youtube.com/results?search_query=woodworking', paragraphs = true) => {
  document.body.innerHTML = html;
  return extractCandidates(document, new URL(page), paragraphs);
};

beforeEach(() => { document.body.innerHTML = ''; });

describe('native content units', () => {
  it('extracts a whole YouTube card, real title and description without images or popularity metadata', () => {
    const [item] = extract(`<ytd-video-renderer><ytd-thumbnail><a href="/watch?v=abcdefghijk&amp;si=track"><img src="https://i.ytimg.com/vi/abcdefghijk/hqdefault.jpg"></a></ytd-thumbnail><h3><a id="video-title" title="Making a mortise by hand">Making a mortise by hand</a></h3><div class="metadata-snippet-text">Measured hand-cut joints with a sharpened chisel.</div><span>100 million views</span><button>More</button></ytd-video-renderer>`);
    expect(item.element.tagName).toBe('YTD-VIDEO-RENDERER');
    expect(item.item.title).toBe('Making a mortise by hand');
    expect(item.item.text).toContain('Measured hand-cut');
    expect(item.item.text).not.toContain('million views');
    expect(item.item.url).toBe('https://www.youtube.com/watch?v=abcdefghijk');
    expect(item.item.thumbnailUrl).toBeUndefined();
  });

  it('deduplicates rich-card wrappers and supports current YouTube Shorts markup', () => {
    const items = extract(`<ytd-rich-item-renderer><ytd-rich-grid-media><a id="video-title" href="/watch?v=abcdefghijk">How I restored a hand plane</a></ytd-rich-grid-media></ytd-rich-item-renderer><ytm-shorts-lockup-view-model><h3><a href="/shorts/zyxwvutsrqp">A tiny dovetail joint tutorial</a></h3></ytm-shorts-lockup-view-model>`);
    expect(items).toHaveLength(2);
    expect(items[0].element.tagName).toBe('YTD-RICH-ITEM-RENDERER');
    expect(items[1].item.thumbnailUrl).toBeUndefined();
  });

  it('uses a full comment and keeps replies as contextual content', () => {
    const [item] = extract(`<ytd-comment-thread-renderer><ytd-comment-view-model><a>Some author</a><img src="https://example.com/avatar.jpg"><div id="content-text">Excellent demonstration, thank you for sharing the measurements.</div><button>Like</button></ytd-comment-view-model><ytd-comment-replies-renderer><span>Helpful replies</span></ytd-comment-replies-renderer></ytd-comment-thread-renderer>`);
    expect(item.item.kind).toBe('comment');
    expect(item.item.text).toBe('Excellent demonstration, thank you for sharing the measurements.');
    expect(item.item.thumbnailUrl).toBeUndefined();
    expect(item.preserveContext).toBe(true);
  });

  it('also analyzes each loaded YouTube reply as a complete comment', () => {
    const items = extract(`<ytd-comment-thread-renderer><ytd-comment-view-model><div id="content-text">The original comment explains the measurements.</div></ytd-comment-view-model><ytd-comment-replies-renderer><ytd-comment-view-model><a>A second author</a><div id="content-text">An independent reply adds more useful context.</div><button>Like</button></ytd-comment-view-model></ytd-comment-replies-renderer></ytd-comment-thread-renderer>`);
    expect(items).toHaveLength(2);
    expect(items[0].item.text).toBe('The original comment explains the measurements.');
    expect(items[1].item.text).toBe('An independent reply adds more useful context.');
    expect(items[1].element.tagName).toBe('YTD-COMMENT-VIEW-MODEL');
  });

  it('selects complete modern Google results and leaves multi-result groups alone', () => {
    const items = extract(`<main id="search"><div id="rso"><div class="MjjYud"><div class="tF2Cxc"><a href="https://example.com/tutorial?utm_source=google&amp;token=secret"><h3>How to sharpen a chisel</h3></a><div>A detailed guide with measured angles and original photographs.</div></div></div><div class="MjjYud"><h3>Other questions</h3><h3>More questions</h3></div></div></main>`, 'https://www.google.co.uk/search?q=chisel');
    expect(items).toHaveLength(1);
    expect(items[0].element.className).toBe('tF2Cxc');
    expect(items[0].item.kind).toBe('search');
    expect(items[0].item.text).toContain('original photographs');
    expect(items[0].item.url).toBe('https://example.com/tutorial');
  });

  it('still assesses Google snippets when a result link uses an opaque redirect', () => {
    const [item] = extract(`<div id="search"><div class="tF2Cxc"><a href="/goto?url=CAESmAEB6zsw"><h3>Measured moisture reference</h3></a><cite>https://www.wagnermeters.com</cite><p>A practical reference for woodworkers.</p></div></div>`, 'https://www.google.com/search?q=moisture');
    expect(item.item.text).toContain('wagnermeters.com');
    expect(item.item.url).toBe('https://www.google.com/goto?url=CAESmAEB6zsw'); // Background sends this token only when destination inspection is enabled.
  });

  it('takes the whole X tweet including its surrounding action row', () => {
    const [item] = extract(`<main><article data-testid="tweet"><a href="/maker/status/123">Maker</a><div data-testid="tweetText">Here are the plans and measurements from my latest project.</div><div role="group"><button>Reply</button><button>Like</button></div></article></main>`, 'https://x.com/home');
    expect(item.element.querySelector('[role="group"]')).not.toBeNull();
    expect(item.item.text).not.toContain('ReplyLike');
    expect(item.item.url).toBe('https://x.com/maker/status/123');
  });

  it('keeps Reddit parent/reply boundaries and does not attribute reply text to the parent', () => {
    const items = extract(`<shreddit-post post-title="An experiment with hand tools"><p>This is the original post.</p><shreddit-comment><p>A carefully reasoned reply about the technique.</p><shreddit-comment><p>Another thoughtful response with useful measurements.</p></shreddit-comment></shreddit-comment></shreddit-post>`, 'https://www.reddit.com/r/woodworking/comments/abc');
    expect(items).toHaveLength(3);
    expect(items[0].preserveContext).toBe(true);
    expect(items[0].item.text).not.toContain('reasoned reply');
    expect(items[1].preserveContext).toBe(true);
    expect(items[2].preserveContext).toBe(false);
  });

  it('recognizes Facebook nested comments without deleting the discussion', () => {
    const items = extract(`<div role="feed"><div role="article"><p>Here is my original post describing a woodworking project.</p><div role="article">A helpful comment below the project.</div></div></div>`, 'https://www.facebook.com/');
    expect(items).toHaveLength(2);
    expect(items[0].preserveContext).toBe(true);
    expect(items[0].item.text).not.toContain('A helpful comment');
    expect(items[1].item.kind).toBe('comment');
  });

  it('recognizes Instagram posts and timestamped comments, excluding ordinary list rows', () => {
    const items = extract(`<article><p>A caption explaining the work behind the finished piece.</p><ul><li><ul><li><a>Author</a><span>An insightful comment about the result.</span><time>1h</time></li><li>Explore suggested accounts</li></ul></li></ul></article>`, 'https://www.instagram.com/p/abc/');
    expect(items).toHaveLength(2);
    expect(items[0].item.text).not.toContain('insightful comment');
    expect(items[1].item.kind).toBe('comment');
  });

  it('supports TikTok video and comment units without duplicate inner wrappers', () => {
    const items = extract(`<div data-e2e="user-post-item"><a href="/maker/video/123">A practical tutorial on shaping a bowl</a></div><div data-e2e="comment-item"><div data-e2e="comment-level-1">Helpful details about the tools used in this tutorial.</div></div>`, 'https://www.tiktok.com/@maker');
    expect(items).toHaveLength(2);
    expect(items.map(item => item.item.kind)).toEqual(['video', 'comment']);
  });

  it('recognizes Discourse and preserves the entire comment chrome', () => {
    const [item] = extract(`<main><div class="topic-post"><header>A contributor</header><div class="cooked"><p>These are my test measurements and observations.</p></div><button>Reply</button></div></main>`, 'https://forum.example.com/t/measurements/123');
    expect(item.item.platform).toBe('forum');
    expect(item.element.className).toBe('topic-post');
    expect(item.item.text).toBe('These are my test measurements and observations.');
  });

  it('takes the whole WordPress comment including author and reply controls', () => {
    const [item] = extract(`<ol class="comment-list"><li class="comment"><div class="comment-author">A contributor</div><div class="comment-body"><p>Detailed practical information and measurements from my experiment.</p></div><a class="comment-reply-link">Reply</a></li></ol>`, 'https://example.com/discussion');
    expect(item.element.tagName).toBe('LI');
    expect(item.element.querySelector('.comment-author')).not.toBeNull();
    expect(item.element.querySelector('.comment-reply-link')).not.toBeNull();
    expect(item.item.text).toBe('Detailed practical information and measurements from my experiment.');
  });
});

describe('conservative fallback and privacy', () => {
  it('only annotates prose in a standalone article and never treats its body as one removable card', () => {
    const paragraph = 'A well researched article uses references and detailed explanations to help the reader understand the underlying issue. '.repeat(3);
    const items = extract(`<main><article><h1>A long editorial</h1><p>${paragraph}</p><p>${paragraph}A second point.</p></article></main>`, 'https://example.com/editorial');
    expect(items).toHaveLength(2);
    expect(items.every(item => item.item.kind === 'paragraph' && item.preserveContext)).toBe(true);
    expect(extractCandidates(document, new URL('https://example.com/editorial'), false)).toHaveLength(0);
  });

  it('finds independent generic article cards and excludes navigation or forms', () => {
    const card = '<article><h2><a href="/guide">A detailed practical guide</a></h2><p>Original photographs and careful measurements.</p></article>';
    const items = extract(`<nav>${card}</nav><form>${card}</form><main>${card}${card}</main>`, 'https://example.com/');
    expect(items).toHaveLength(2);
    expect(items.every(item => item.element.parentElement?.tagName === 'MAIN')).toBe(true);
  });

  it('does not process private routes, mail, local networks or editable drafts', () => {
    for (const url of ['https://x.com/messages', 'https://www.instagram.com/direct/inbox/', 'https://mail.google.com/mail/u/0/', 'https://example.com/account/profile', 'http://192.168.1.1/feed', 'https://docs.google.com/document/abc']) expect(isPrivatePage(new URL(url))).toBe(true);
    expect(extract(`<article data-testid="tweet"><p>Private message or draft content</p></article>`, 'https://x.com/messages')).toHaveLength(0);
    expect(extract(`<article data-testid="tweet"><p>A publicly readable post with a private unfinished draft.</p><textarea>My private reply</textarea></article>`, 'https://x.com/home')).toHaveLength(0);
    expect(extract(`<article data-testid="tweet"><p>A publicly readable post with a private unfinished draft.</p><div contenteditable>My private reply</div></article>`, 'https://x.com/home')).toHaveLength(0);
  });

  it('does not mistake lookalike domains for native services', () => {
    expect(platformForUrl(new URL('https://youtube.com.evil.example/'))).toBe('generic');
    expect(platformForUrl(new URL('https://notyoutube.com/'))).toBe('generic');
    expect(platformForUrl(new URL('https://google.evil.example/'))).toBe('generic');
  });

  it('changes fingerprints when a virtualized node receives different content, not new view counts', () => {
    const [initial] = extract('<ytd-video-renderer><a id="video-title" href="/watch?v=abcdefghijk">Original woodworking demonstration</a><span>1 view</span></ytd-video-renderer>');
    initial.element.querySelector('span')!.textContent = '1 million views';
    const [same] = extractCandidates(document, new URL('https://www.youtube.com/'));
    expect(same.fingerprint).toBe(initial.fingerprint);
    initial.element.querySelector('a')!.textContent = 'An entirely different video demonstration';
    const [different] = extractCandidates(document, new URL('https://www.youtube.com/'));
    expect(different.fingerprint).not.toBe(initial.fingerprint);
  });

  it('does not rescan unchanged text when a thumbnail or preview changes', () => {
    const [initial] = extract('<ytd-video-renderer><a id="video-title" href="/watch?v=abcdefghijk">A practical woodworking demonstration</a><img src="https://i.ytimg.com/vi/abcdefghijk/hqdefault.jpg"></ytd-video-renderer>');
    initial.element.querySelector('img')!.src = 'https://i.ytimg.com/vi/abcdefghijk/sddefault.jpg';
    const [updated] = extractCandidates(document, new URL('https://www.youtube.com/'));
    expect(updated.fingerprint).toBe(initial.fingerprint);
    expect(updated.item.thumbnailUrl).toBeUndefined();
  });

  it('bounds output and can skip offscreen units before reading their content', () => {
    extract('<ytd-video-renderer><a id="video-title">First original demonstration</a></ytd-video-renderer><ytd-video-renderer><a id="video-title">Second original demonstration</a></ytd-video-renderer>');
    expect(extractCandidates(document, new URL('https://www.youtube.com/'), true, 1)).toHaveLength(1);
    expect(extractCandidates(document, new URL('https://www.youtube.com/'), true, 10, element => element.textContent!.startsWith('Second'))[0].item.title).toBe('Second original demonstration');
  });
});
