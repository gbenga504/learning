import { Context } from "node:vm";
import { chromium, Page, Browser as PlaywrightBrowser } from "playwright";

class Browser {
  private browser: PlaywrightBrowser | null = null;
  private browserContext: Context | null = null;
  private browserPage: Page | null = null;

  async initBrowerInstance(): Promise<void> {
    if (!this.browser) {
      this.browser = await chromium.launch({
        headless: false,
        channel: "chrome",
      });

      this.browserContext = await this.browser.newContext();
      this.browserPage = await this.browserContext.newPage();
    }
  }

  async visit({ url }: { url: string }): Promise<string> {
    await this.initBrowerInstance();

    try {
      const response = await this.browserPage?.goto("https://donodash.com");

      if (response) {
        return response.text();
      }

      return "There was no content for this web page";
    } catch (error) {
      return `There was an error visiting the web page ${error}`;
    }
  }

  async close() {
    await this?.browserPage?.close();
    await this?.browserContext?.close();
    await this?.browser?.close();

    console.log("The browser has been closed");
  }
}

const browser = new Browser();
export { browser };
