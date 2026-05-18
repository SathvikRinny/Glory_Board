import urllib.request, re, json, time, os, sys

BASE    = 'https://www.telugubibleonline.com'
OUT     = os.path.join(os.path.dirname(__file__), 'renderer', 'telugu_bible.json')
HEADERS = {'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)'}

# Correct slugs for all failed books (URL-encode spaces, fix typos)
SLUG_FIXES = {
    '1 Samuel':        '1%20samuel',
    '2 Samuel':        '2%20samuel',
    '1 Kings':         '1%20kings',
    '2 Kings':         '2%20kings',
    '1 Chronicles':    '1%20chronicles',
    '2 Chronicles':    '2%20chronicales',  # website typo
    'Song of Songs':   'songs%20of%20solomon',
    'Zephaniah':       'zephaniah',
    '1 Corinthians':   '1%20corinthians',
    '2 Corinthians':   '2%20corinthians',
    '1 Thessalonians': '1%20thessalonians',
    '2 Thessalonians': '2%20thessalonians',
    '1 Timothy':       '1%20timothy',
    '2 Timothy':       '2%20timothy',
    '1 Peter':         '1%20peter',
    '2 Peter':         '2%20peter',
    '1 John':          '1%20john',
    '2 John':          '2%20john',
    '3 John':          '3%20john',
}

def get(url, retries=3):
    for i in range(retries):
        try:
            req = urllib.request.Request(url, headers=HEADERS)
            return urllib.request.urlopen(req, timeout=15).read().decode('utf-8')
        except Exception as e:
            if i == retries - 1:
                print(f'  FAILED {url}: {e}')
                return ''
            time.sleep(2)

def get_chapter_count(slug):
    html = get(BASE + '/' + slug + '-1')
    slug_plain = slug.replace('%20', ' ')
    nums = re.findall(r'href="/' + re.escape(slug_plain) + r'-(\d+)"', html)
    if not nums:
        # try encoded version
        nums = re.findall(r'href="/' + re.escape(slug) + r'-(\d+)"', html)
    if not nums:
        # fallback: find any chap links
        nums = re.findall(r'class="chap">(\d+)<', html)
    return max((int(n) for n in nums), default=1)

def parse_verses(html, slug, ch):
    slug_plain = slug.replace('%20', ' ')
    anchor = f'id="{slug_plain}-{ch}"'
    idx = html.find(anchor)
    if idx == -1:
        idx = html.find('<p><sup>')
    if idx == -1:
        return []
    chunk = html[idx:idx+30000]
    p_match = re.search(r'<p>(<sup>\d+</sup>.+?)</p>', chunk, re.DOTALL)
    if not p_match:
        return []
    inner = p_match.group(1)
    parts = re.split(r'<br\s*/?>', inner)
    verses = []
    for part in parts:
        part = part.strip()
        if not part:
            continue
        v_match = re.match(r'<sup>(\d+)</sup>(.*)', part, re.DOTALL)
        if not v_match:
            continue
        v_num = int(v_match.group(1))
        text  = re.sub(r'<[^>]+>', '', v_match.group(2)).strip()
        text  = text.replace('\xa0', ' ').replace('  ', ' ')
        if text:
            verses.append({'verse': v_num, 'text_telugu': text})
    return verses

def main():
    with open(OUT, 'r', encoding='utf-8') as f:
        data = json.load(f)

    book_map = {b['name_english']: i for i, b in enumerate(data['books'])}

    for eng_name, slug in SLUG_FIXES.items():
        if eng_name not in book_map:
            print(f'  SKIP (not in JSON): {eng_name}')
            continue
        idx = book_map[eng_name]
        book = data['books'][idx]
        existing_verses = sum(len(c['verses']) for c in book['chapters'])
        if existing_verses > 0:
            print(f'  SKIP (already has verses): {eng_name}')
            continue

        print(f'  Fixing: {eng_name}')
        ch_count = get_chapter_count(slug)
        print(f'    {ch_count} chapters')
        time.sleep(0.3)

        chapters = []
        for ch in range(1, ch_count + 1):
            url    = BASE + '/' + slug + '-' + str(ch)
            html   = get(url)
            verses = parse_verses(html, slug, ch)
            if not verses:
                print(f'    WARNING: no verses ch {ch}')
            chapters.append({'chapter': ch, 'verses': verses})
            sys.stdout.write(f'\r    chapter {ch}/{ch_count}   ')
            sys.stdout.flush()
            time.sleep(0.35)
        print()

        book['chapters'] = chapters

    print(f'\nSaving {OUT}...')
    with open(OUT, 'w', encoding='utf-8') as f:
        json.dump(data, f, ensure_ascii=False, indent=2)

    total = sum(len(c['verses']) for b in data['books'] for c in b['chapters'])
    print(f'Done! Total verses: {total}')

if __name__ == '__main__':
    main()
