/* eslint-disable no-await-in-loop */
/* eslint-disable no-restricted-syntax */
import fs from 'fs';
import path from 'path';
import { Readable } from 'stream';
import { pipeline } from 'stream/promises';
import { PDFDocument } from 'pdf-lib';
import { type APIRequestContext, chromium, devices } from 'playwright';
import { fetch } from 'undici';
import { DEFAULT_CATECHISM_OUTPUT_DIR } from '@/constants';
import { type GetPageContentParams } from '@/lib/crawler/crawler';
import { type Metadata } from '@/lib/crawler/schema';
import { type WorkerHandlerFn } from '@/lib/crawler/worker';
import { logger } from '@/logger/logger';

const BASE = 'https://tgpsaigon.net';

function ensureDir(dirPath: string) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function sanitizeName(name: string) {
  return String(name || '')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[<>:"/\\|?*]+/g, '_')
    .substring(0, 140);
}

function safeFileSegment(segment: string) {
  const normalized = String(segment || '')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\//g, '_')
    .replace(/\\/g, '_')
    .trim();

  return Array.from(normalized)
    .filter((ch) => {
      const code = ch.codePointAt(0) ?? 0;
      return code >= 0x20 && code !== 0x7f;
    })
    .join('');
}

function buildLessonFileBase(gradeNum: number, lessonName: string) {
  const gradeAbbrev = `HT${gradeNum}`;
  const lesson = safeFileSegment(lessonName);
  return `[${gradeAbbrev}]_[${lesson}]`;
}

function isProbablyImageFileUrl(url: string) {
  try {
    const u = new URL(url);
    const pathname = u.pathname || '';
    if (!pathname || pathname.endsWith('/')) return false;
    const ext = path.extname(pathname).toLowerCase();
    return ['.jpg', '.jpeg', '.png', '.webp', '.gif'].includes(ext);
  } catch {
    return false;
  }
}

function countSupportedImages(imageFilePaths: string[]) {
  let supported = 0;
  let unsupported = 0;
  for (const p of imageFilePaths) {
    try {
      const bytes = fs.readFileSync(p);
      const isPng =
        bytes.length >= 4 &&
        bytes[0] === 0x89 &&
        bytes[1] === 0x50 &&
        bytes[2] === 0x4e &&
        bytes[3] === 0x47;
      const isJpg = bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xd8;
      if (isPng || isJpg) supported += 1;
      else unsupported += 1;
    } catch {
      unsupported += 1;
    }
  }
  return { supported, unsupported };
}

async function createPdfFromImages(imageFilePaths: string[], pdfPath: string) {
  if (imageFilePaths.length === 0) return;
  if (fs.existsSync(pdfPath)) return;

  const doc = await PDFDocument.create();
  const margin = 20;
  const a4Portrait = { width: 595.28, height: 841.89 };
  const a4Landscape = { width: 841.89, height: 595.28 };

  for (const imagePath of imageFilePaths) {
    const bytes = fs.readFileSync(imagePath);

    let embedded:
      | Awaited<ReturnType<typeof doc.embedPng>>
      | Awaited<ReturnType<typeof doc.embedJpg>>
      | null = null;

    const isPng =
      bytes.length >= 4 &&
      bytes[0] === 0x89 &&
      bytes[1] === 0x50 &&
      bytes[2] === 0x4e &&
      bytes[3] === 0x47;
    const isJpg = bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xd8;

    if (isPng) embedded = await doc.embedPng(bytes);
    else if (isJpg) embedded = await doc.embedJpg(bytes);
    else {
      logger.warn('Skipping unsupported image type for PDF', { imagePath });
    }

    if (!embedded) {
      // eslint-disable-next-line no-continue
      continue;
    }

    const { width: imgW, height: imgH } = embedded.scale(1);
    const pageSize = imgW > imgH ? a4Landscape : a4Portrait;
    const page = doc.addPage([pageSize.width, pageSize.height]);

    const maxW = pageSize.width - margin * 2;
    const maxH = pageSize.height - margin * 2;
    const scale = Math.min(maxW / imgW, maxH / imgH, 1);
    const drawW = imgW * scale;
    const drawH = imgH * scale;
    const x = (pageSize.width - drawW) / 2;
    const y = (pageSize.height - drawH) / 2;

    page.drawImage(embedded, { x, y, width: drawW, height: drawH });
  }

  const pdfBytes = await doc.save();
  fs.writeFileSync(pdfPath, pdfBytes);
}

function getMeetNumberFromTitle(title: string) {
  const m = String(title || '').match(/gặp\s*gỡ\s*(\d+)/i);
  if (!m?.[1]) return null;
  const n = Number(m[1]);
  return Number.isFinite(n) ? n : null;
}

function buildLessonFolderName(title: string) {
  const meetNumber = getMeetNumberFromTitle(title);
  if (meetNumber != null) return sanitizeName(`Gặp gỡ ${meetNumber}`);
  return sanitizeName(title);
}

function getSectionsForGrade(gradeNum: number) {
  return [
    {
      title: 'Hướng dẫn sử dụng',
      url: `${BASE}/giao-ly/huong-dan-su-dung-${gradeNum}-1`,
    },
    {
      title: 'GLV',
      url: `${BASE}/giao-ly/danh-cho-giao-ly-vien-${gradeNum}-2`,
    },
    {
      title: 'Học viên',
      url: `${BASE}/giao-ly/danh-cho-hoc-vien-${gradeNum}-3`,
    },
  ];
}

async function downloadUrlWithContext(params: {
  url: string;
  dest: string;
  referer?: string;
  request?: APIRequestContext;
}) {
  const { url, dest, referer, request } = params;

  if (fs.existsSync(dest)) return;

  const headers = {
    'User-Agent': 'tgpsaigon-crawler/1.0',
    Accept: 'image/avif,image/webp,image/apng,image/*,*/*;q=0.8',
    'Accept-Language': 'vi-VN,vi;q=0.9,en-US;q=0.8,en;q=0.7',
    ...(referer ? { Referer: referer } : {}),
  };

  try {
    const res = await fetch(url, { headers, redirect: 'follow' });

    if (res.status === 403 && request) {
      const pwRes = await request.get(url, {
        headers: referer ? { Referer: referer } : undefined,
      });
      if (!pwRes.ok()) throw new Error(`Failed to download: ${pwRes.status()}`);
      const buf = await pwRes.body();
      fs.writeFileSync(dest, buf);
      return;
    }

    if (!res.ok) throw new Error(`Failed to download: ${res.status}`);
    if (!res.body) throw new Error('No response body');

    const nodeReadable =
      typeof (res.body as unknown as { getReader?: unknown }).getReader ===
      'function'
        ? Readable.fromWeb(res.body)
        : (res.body as unknown as NodeJS.ReadableStream);

    await pipeline(nodeReadable, fs.createWriteStream(dest));
  } catch (error) {
    if (request) {
      const pwRes = await request.get(url, {
        headers: referer ? { Referer: referer } : undefined,
      });
      if (!pwRes.ok()) throw new Error(`Failed to download: ${pwRes.status()}`);
      const buf = await pwRes.body();
      fs.writeFileSync(dest, buf);
      return;
    }

    throw error;
  }
}

async function collectLessonLinks(
  page: import('playwright').Page,
  sectionUrl: string,
) {
  const visited = new Set<string>();
  const pending: string[] = [sectionUrl];
  const lessons = new Map<string, { title: string; href: string }>();

  while (pending.length > 0) {
    const url = pending.shift();
    if (!url || visited.has(url)) {
      // eslint-disable-next-line no-continue
      continue;
    }
    visited.add(url);

    await page.goto(url, { waitUntil: 'domcontentloaded' });

    const linkLocators = await page
      .locator('a[href*="/noi-dung-giao-ly/"]')
      .all();
    const found: Array<{ href: string; title: string }> = [];
    for (const locator of linkLocators) {
      const href = (await locator.getAttribute('href')) || '';
      const title = (await locator.textContent()) || '';
      const trimmedTitle = title.trim();
      if (href && trimmedTitle) {
        found.push({ href, title: trimmedTitle });
      }
    }

    for (const l of found) {
      const { href } = new URL(l.href, url);
      lessons.set(href, { title: l.title, href });
    }

    const pageLocators = await page.locator('.pagination a').all();
    const hrefs: string[] = [];
    for (const locator of pageLocators) {
      const href = (await locator.getAttribute('href')) || '';
      if (href) hrefs.push(href);
    }
    const extraPages = Array.from(new Set(hrefs));

    for (const href of extraPages) {
      const nextUrl = new URL(href, url).href;
      if (!visited.has(nextUrl)) pending.push(nextUrl);
    }
  }

  return Array.from(lessons.values());
}

function toAbsoluteUrl(raw: string, baseUrl: string) {
  if (!raw || raw.startsWith('data:')) return null;
  try {
    return new URL(raw, baseUrl).href;
  } catch {
    return null;
  }
}

function parseSrcset(srcset: string | null) {
  if (!srcset) return '';
  const first = String(srcset)
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)[0];
  if (!first) return '';
  return first.split(/\s+/)[0] || '';
}

async function extractLessonImageCandidates(
  page: import('playwright').Page,
  lessonUrl: string,
) {
  await page.goto(lessonUrl, { waitUntil: 'domcontentloaded' });

  const heroCandidates: string[] = [];

  const heroLocator = page.locator('.article_page_detail_inner_1 img');
  if ((await heroLocator.count()) > 0) {
    const firstHero = heroLocator.first();
    const heroSrcset = await firstHero.getAttribute('srcset');
    const heroRaw =
      (await firstHero.getAttribute('src')) ||
      (await firstHero.getAttribute('data-src')) ||
      (await firstHero.getAttribute('data-lazy-src')) ||
      (await firstHero.getAttribute('data-original')) ||
      (await firstHero.getAttribute('data-lazy')) ||
      parseSrcset(heroSrcset) ||
      '';
    const heroUrl = toAbsoluteUrl(heroRaw, lessonUrl);
    if (heroUrl) heroCandidates.push(heroUrl);
  }

  const metaSelectors = [
    'meta[property="og:image"]',
    'meta[name="twitter:image"]',
    'meta[property="og:image:secure_url"]',
  ];

  for (const selector of metaSelectors) {
    const metaLocator = page.locator(selector);
    if ((await metaLocator.count()) > 0) {
      let content: string | null = null;
      try {
        content = await metaLocator
          .first()
          .getAttribute('content', { timeout: 1000 });
      } catch {
        content = null;
      }
      const metaUrl = toAbsoluteUrl(content || '', lessonUrl);
      if (metaUrl) heroCandidates.push(metaUrl);
    }
  }

  const containerLocator = page.locator(
    '.article_page_detail_inner_1, article',
  );
  if ((await containerLocator.count()) > 0) {
    let containerStyle: string | null = null;
    try {
      containerStyle = await containerLocator
        .first()
        .getAttribute('style', { timeout: 1000 });
    } catch {
      containerStyle = null;
    }
    if (containerStyle) {
      const match = containerStyle.match(
        /background-image\s*:\s*url\((['"]?)(.*?)\1\)/i,
      );
      const raw = match?.[2] || '';
      const cssUrl = toAbsoluteUrl(raw, lessonUrl);
      if (cssUrl) heroCandidates.push(cssUrl);
    }
  }

  const imgLocators = await page
    .locator('article img, .article_page_detail_left_inner img')
    .all();
  const urls: string[] = [];
  for (const locator of imgLocators) {
    const srcset = await locator.getAttribute('srcset');
    const raw =
      (await locator.getAttribute('src')) ||
      (await locator.getAttribute('data-src')) ||
      (await locator.getAttribute('data-lazy-src')) ||
      (await locator.getAttribute('data-original')) ||
      (await locator.getAttribute('data-lazy')) ||
      parseSrcset(srcset) ||
      '';
    const url = toAbsoluteUrl(raw, lessonUrl);
    if (url) urls.push(url);
  }

  const uniqueUrls = Array.from(new Set(urls));

  const detailUrls = uniqueUrls.filter((u) =>
    u.includes('/Images/Doctrines/Details/'),
  );

  const doctrineUrls = uniqueUrls
    .filter((u) => u.includes('/Images/Doctrines/'))
    .filter((u) => !u.includes('/Images/Doctrines/Details/'))
    .filter((u) => !u.includes('/Images/Doctrines/SmallImages/'))
    .filter((u) => !u.includes('/Images/Doctrines/LargeImages/'));

  return {
    heroCandidates: Array.from(new Set(heroCandidates)),
    urls: uniqueUrls,
    detailUrls: Array.from(new Set(detailUrls)),
    doctrineUrls: Array.from(new Set(doctrineUrls)),
  };
}

async function downloadLessonImages(params: {
  page: import('playwright').Page;
  lessonUrl: string;
  imagesDir: string;
  lessonFileBase: string;
}) {
  const { page, lessonUrl, imagesDir, lessonFileBase } = params;

  const { heroCandidates, detailUrls, doctrineUrls, urls } =
    await extractLessonImageCandidates(page, lessonUrl);

  const heroUrl = [...heroCandidates, ...urls].find((u) =>
    isProbablyImageFileUrl(u),
  );

  let heroFilePath: string | null = null;
  if (heroUrl) {
    const heroExt = (
      path.extname(new URL(heroUrl).pathname) || '.jpg'
    ).toLowerCase();
    const heroDest = path.join(imagesDir, `${lessonFileBase}_hero${heroExt}`);

    await downloadUrlWithContext({
      url: heroUrl,
      dest: heroDest,
      referer: lessonUrl,
      request: page.request,
    });

    if (fs.existsSync(heroDest)) heroFilePath = heroDest;
  }

  const preferredDetails = detailUrls.length > 0 ? detailUrls : doctrineUrls;
  const uniqueDetails = Array.from(new Set(preferredDetails));
  const detailsNoHero = heroUrl
    ? uniqueDetails.filter((u) => u !== heroUrl)
    : uniqueDetails;
  const finalDetailUrls =
    detailsNoHero.length > 0 ? detailsNoHero : uniqueDetails;

  const detailFilePaths: string[] = [];
  let idx = 1;
  for (const url of finalDetailUrls) {
    const ext = (path.extname(new URL(url).pathname) || '.jpg').toLowerCase();
    const filename = `${lessonFileBase}_${String(idx).padStart(2, '0')}${ext}`;
    const dest = path.join(imagesDir, filename);

    await downloadUrlWithContext({
      url,
      dest,
      referer: lessonUrl,
      request: page.request,
    });

    if (fs.existsSync(dest)) {
      detailFilePaths.push(dest);
      idx += 1;
    }
  }

  return { heroFilePath, detailFilePaths };
}

export const getCatechismBook: WorkerHandlerFn<
  GetPageContentParams,
  void,
  Metadata
> = async ({ chapterParams }) => {
  const gradeNum = chapterParams.chapterNumber;
  const gradeTitle = `Hiệp thông ${gradeNum}`;

  const outputDir = DEFAULT_CATECHISM_OUTPUT_DIR;
  const gradeDir = path.join(outputDir, sanitizeName(gradeTitle));
  ensureDir(gradeDir);

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext(devices['Desktop Chrome']);
  const page = await context.newPage();

  try {
    logger.info('Crawling catechism grade images', {
      gradeNum,
      gradeTitle,
      outputDir,
    });

    const sections = getSectionsForGrade(gradeNum);

    const gradeDetailImagePaths: string[] = [];

    for (const section of sections) {
      const sectionDir = path.join(gradeDir, sanitizeName(section.title));
      ensureDir(sectionDir);

      const lessonLinks = await collectLessonLinks(page, section.url);
      lessonLinks.sort((a, b) => {
        const an = getMeetNumberFromTitle(a.title);
        const bn = getMeetNumberFromTitle(b.title);
        if (an != null && bn != null) return an - bn;
        if (an != null) return -1;
        if (bn != null) return 1;
        return a.title.localeCompare(b.title);
      });

      const effectiveLessons =
        section.title === 'Hướng dẫn sử dụng'
          ? lessonLinks.slice(0, 1)
          : lessonLinks;

      for (const lesson of effectiveLessons) {
        const isGuideSection = section.title === 'Hướng dẫn sử dụng';
        const lessonFolderName = isGuideSection
          ? sanitizeName('Hướng dẫn sử dụng')
          : buildLessonFolderName(lesson.title);
        const lessonDir = path.join(sectionDir, lessonFolderName);
        ensureDir(lessonDir);

        const imagesDir = path.join(lessonDir, 'images');
        ensureDir(imagesDir);

        const lessonFileBase = buildLessonFileBase(gradeNum, lessonFolderName);

        const { detailFilePaths } = await downloadLessonImages({
          page,
          lessonUrl: lesson.href,
          imagesDir,
          lessonFileBase,
        });

        for (const pth of detailFilePaths) gradeDetailImagePaths.push(pth);

        const lessonPdfPath = path.join(lessonDir, `${lessonFileBase}.pdf`);
        await createPdfFromImages(detailFilePaths, lessonPdfPath);

        const { supported, unsupported } =
          countSupportedImages(detailFilePaths);

        logger.info('Downloaded lesson images', {
          gradeNum,
          gradeTitle,
          sectionTitle: section.title,
          lessonTitle: lessonFolderName,
          lessonUrl: lesson.href,
          detailImages: detailFilePaths.length,
          supportedImages: supported,
          unsupportedImages: unsupported,
          lessonPdfPath,
        });
      }
    }

    const gradePdfPath = path.join(gradeDir, `${gradeTitle}.pdf`);
    await createPdfFromImages(gradeDetailImagePaths, gradePdfPath);

    logger.info('Catechism grade finished', {
      gradeNum,
      gradeTitle,
      outputDir,
      gradePdfPath,
    });
  } finally {
    await context.close();
    await browser.close();
  }
};
