// Renders every marketing image from template.html into marketing/out/.
// Needs playwright-core (npm i -D playwright-core) and a Chromium from `npx playwright install chromium`.
// Refresh the app screenshots in marketing/assets first if the UI changed (pnpm dev, then capture).
import { chromium } from "playwright-core";

const exe = process.env.LOCALAPPDATA + "/ms-playwright/chromium-1248/chrome-win64/chrome.exe";
const here = new URL(".", import.meta.url);
const tpl = new URL("template.html", here).href;
const sizes = { og: [1200, 630], x: [1500, 500], li: [1584, 396], avatar: [1024, 1024], square: [1080, 1080], story: [1080, 1920], mrec: [300, 250], leader: [728, 90], sky: [160, 600] };
const names = { og: "browser-share-1200x630", x: "x-header-1500x500", li: "linkedin-banner-1584x396", avatar: "profile-1024", square: "post-square-1080", story: "story-1080x1920", mrec: "ad-300x250", leader: "ad-728x90", sky: "ad-160x600" };
const b = await chromium.launch({ executablePath: exe, args: ["--allow-file-access-from-files"] });
for (const [f, [w, h]] of Object.entries(sizes)) {
  const p = await (await b.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 1 })).newPage();
  await p.goto(`${tpl}?f=${f}`); await p.evaluate(() => document.fonts.ready); await p.waitForTimeout(400);
  await p.screenshot({ path: new URL(`out/${names[f]}.png`, here).pathname.replace(/^/(w:)/, "$1") }); await p.close();
}
await b.close(); console.log("rendered", Object.keys(sizes).length);
