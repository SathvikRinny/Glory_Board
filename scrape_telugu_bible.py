import urllib.request, re, json, time, os, sys

BASE = 'https://www.telugubibleonline.com'
OUT  = os.path.join(os.path.dirname(__file__), 'renderer', 'telugu_bible.json')
PROG = os.path.join(os.path.dirname(__file__), 'telugu_scrape_progress.json')

HEADERS = {'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'}

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

def get_books():
    html = get(BASE + '/all-books/')
    # Extract book links and Telugu names
    pattern = r'<li><a title="\[(\d+)\] ([^"]+)" href="(/[^"]+?-1)"[^>]*>([^<]+)</a></li>'
    books = []
    for m in re.finditer(pattern, html):
        book_id   = int(m.group(1))
        eng_name  = m.group(2)
        slug_base = m.group(3)[1:-2]  # remove leading / and trailing -1 → e.g. "genesis"
        tel_name  = m.group(4).strip().replace('\xa0', ' ')
        books.append({'id': book_id, 'name_english': eng_name,
                      'name_telugu': tel_name, 'slug': slug_base})
    return books

def get_chapter_count(slug):
    html = get(BASE + '/' + slug + '-1')
    # Chapter links look like: href="/genesis-2" class="chap"
    nums = re.findall(r'href="/' + re.escape(slug) + r'-(\d+)"', html)
    if not nums:
        return 1
    return max(int(n) for n in nums)

def parse_verses(html, slug, ch):
    # Find the main verse paragraph — id="slug-ch"
    anchor = f'id="{slug}-{ch}"'
    idx = html.find(anchor)
    if idx == -1:
        # fallback: find first <p><sup>
        idx = html.find('<p><sup>')
        if idx == -1:
            return []
    chunk = html[idx:idx + 30000]
    # Find the <p> containing <sup>
    p_match = re.search(r'<p>(<sup>\d+</sup>.+?)</p>', chunk, re.DOTALL)
    if not p_match:
        return []
    inner = p_match.group(1)
    # Split by <br />
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

def load_progress():
    if os.path.exists(PROG):
        with open(PROG, 'r', encoding='utf-8') as f:
            return json.load(f)
    return {}

def save_progress(prog):
    with open(PROG, 'w', encoding='utf-8') as f:
        json.dump(prog, f, ensure_ascii=False)

def main():
    print('Fetching book list...')
    books = get_books()
    if not books:
        print('ERROR: Could not get book list')
        sys.exit(1)
    print(f'Found {len(books)} books')

    progress = load_progress()
    result = {'books': []}

    for book in books:
        slug = book['slug']
        bkey = str(book['id'])

        if bkey in progress and progress[bkey].get('done'):
            print(f"  [{book['id']:2d}] {book['name_english']} — already done, loading from progress")
            result['books'].append(progress[bkey]['data'])
            continue

        print(f"  [{book['id']:2d}] {book['name_english']}")
        ch_count = get_chapter_count(slug)
        print(f"        {ch_count} chapters")
        time.sleep(0.3)

        chapters = []
        for ch in range(1, ch_count + 1):
            url  = BASE + '/' + slug + '-' + str(ch)
            html = get(url)
            verses = parse_verses(html, slug, ch)
            if not verses:
                print(f'        WARNING: no verses found for ch {ch}')
            chapters.append({'chapter': ch, 'verses': verses})
            sys.stdout.write(f'\r        chapter {ch}/{ch_count}   ')
            sys.stdout.flush()
            time.sleep(0.35)

        print()
        book_data = {
            'id':           book['id'],
            'name_english': book['name_english'],
            'name_telugu':  book['name_telugu'],
            'chapters':     chapters,
        }
        result['books'].append(book_data)
        progress[bkey] = {'done': True, 'data': book_data}
        save_progress(progress)

    print(f'\nSaving to {OUT} ...')
    with open(OUT, 'w', encoding='utf-8') as f:
        json.dump(result, f, ensure_ascii=False, indent=2)
    print('Done!')

    # Cleanup progress file
    if os.path.exists(PROG):
        os.remove(PROG)

if __name__ == '__main__':
    main()
