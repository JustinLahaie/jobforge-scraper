const express = require('express');
const { chromium } = require('playwright');
const cors = require('cors');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3001;

app.use(cors());
app.use(express.json({ limit: '50mb' }));

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ status: 'healthy', service: 'JobForge Scraper Service' });
});

// Main scraping endpoint
app.post('/api/scrape', async (req, res) => {
  console.log('Received scrape request:', {
    url: req.body.url,
    hasCredentials: !!req.body.credentials,
    supplierName: req.body.credentials?.supplierName,
    username: req.body.credentials?.username,
    hasPassword: !!req.body.credentials?.password,
    passwordLength: req.body.credentials?.password?.length || 0,
    loginUrl: req.body.credentials?.loginUrl
  });

  const { url, credentials } = req.body;

  // Validate request
  if (!url) {
    return res.status(400).json({ error: 'URL is required' });
  }

  // Validate secret token
  const authHeader = req.headers.authorization;
  const expectedToken = process.env.RAILWAY_SCRAPER_SECRET || 'default-secret';

  if (!authHeader || authHeader !== `Bearer ${expectedToken}`) {
    console.error('Unauthorized request - invalid token');
    return res.status(401).json({ error: 'Unauthorized' });
  }

  let browser;
  try {
    console.log(`Starting scrape for: ${url}`);

    // Launch browser with proper configuration for Railway
    browser = await chromium.launch({
      headless: true,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-gpu',
        '--no-zygote',
        '--single-process'
      ]
    });

    const context = await browser.newContext({
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
    });

    const page = await context.newPage();

    // Login FIRST if credentials provided, THEN navigate to product
    if (credentials && credentials.username && credentials.password) {
      console.log(`Logging into ${credentials.supplierName}...`);

      try {
        if (credentials.supplierName && credentials.supplierName.toLowerCase().includes('richelieu')) {
          await loginToRichelieu(page, credentials);
        } else if (credentials.loginUrl) {
          await genericLogin(page, credentials);
        }
        console.log('Login complete, now navigating to product page...');
      } catch (loginError) {
        console.error('Login failed:', loginError);
        // Continue without login - will get public pricing
      }
    }

    // Navigate to product page (session should be active from login)
    console.log(`Navigating to product: ${url}`);
    await page.goto(url, {
      waitUntil: 'domcontentloaded',
      timeout: 30000
    });

    // Wait for content to load (increased for dynamic content)
    await page.waitForTimeout(3000);

    // Detect supplier and extract data
    const supplierName = detectSupplier(url);
    console.log(`Detected supplier: ${supplierName}`);

    let productData;
    switch (supplierName) {
      case 'Richelieu':
        productData = await scrapeRichelieu(page);
        break;
      case 'Home Depot':
        productData = await scrapeHomeDepot(page);
        break;
      case 'Lowe\'s':
        productData = await scrapeLowes(page);
        break;
      case 'Amazon':
        productData = await scrapeAmazon(page);
        break;
      default:
        productData = await scrapeGeneric(page);
    }

    // Take screenshot for debugging (optional)
    const screenshot = await page.screenshot({
      fullPage: false,
      type: 'jpeg',
      quality: 80
    });

    await browser.close();

    console.log('Scrape successful:', {
      name: productData.name,
      sku: productData.sku,
      price: productData.price
    });

    res.json({
      success: true,
      data: productData,
      screenshot: screenshot.toString('base64'),
      supplierName
    });

  } catch (error) {
    console.error('Scraping error:', error);

    if (browser) {
      await browser.close();
    }

    res.status(500).json({
      error: 'Failed to scrape product',
      details: error.message
    });
  }
});

// Supplier detection
function detectSupplier(url) {
  if (url.includes('richelieu.com')) return 'Richelieu';
  if (url.includes('homedepot.com') || url.includes('homedepot.ca')) return 'Home Depot';
  if (url.includes('lowes.com') || url.includes('lowes.ca')) return 'Lowe\'s';
  if (url.includes('amazon.com') || url.includes('amazon.ca')) return 'Amazon';
  return 'Generic';
}

// Richelieu login
async function loginToRichelieu(page, credentials) {
  console.log('Navigating to Richelieu login page...');
  const loginUrl = credentials.loginUrl || 'https://www.richelieu.com/ca/en/user/login';
  await page.goto(loginUrl, {
    waitUntil: 'domcontentloaded',
    timeout: 30000
  });

  // Wait for page to be ready
  await page.waitForTimeout(2000);

  // Check if there's a "Sign In" button that opens the login modal
  try {
    const signInButton = await page.$('button:has-text("Sign In"), a:has-text("Sign In"), button:has-text("Log In")');
    if (signInButton) {
      console.log('Clicking sign in button to open login form...');
      await signInButton.click();
      await page.waitForTimeout(1000);
    }
  } catch (e) {
    console.log('No sign in button found, proceeding to fill form...');
  }

  // Wait for email field to be visible
  try {
    await page.waitForSelector('input[type="email"], input[name="email"], input#email', {
      state: 'visible',
      timeout: 5000
    });
  } catch (e) {
    console.log('Email field not visible, trying alternative selectors...');
  }

  // Enter credentials
  await page.fill('input[type="email"], input[name="email"], input#email', credentials.username, {
    timeout: 5000
  });
  await page.fill('input[type="password"], input[name="password"], input#password', credentials.password, {
    timeout: 5000
  });

  // Click login button
  await page.click('button[type="submit"], button:has-text("Sign In"), button:has-text("Log In"), input[type="submit"]');

  // Wait for login to complete
  await page.waitForTimeout(3000);
  console.log('Richelieu login completed');
}

// Generic login
async function genericLogin(page, credentials) {
  console.log(`Navigating to login page: ${credentials.loginUrl}`);
  await page.goto(credentials.loginUrl, {
    waitUntil: 'networkidle',
    timeout: 30000
  });

  // Try common selectors
  await page.fill('input[type="email"], input[name="email"], input[name="username"]', credentials.username);
  await page.fill('input[type="password"], input[name="password"]', credentials.password);

  await page.click('button[type="submit"], button:has-text("Sign In"), button:has-text("Log In")');
  await page.waitForTimeout(3000);
}

// Richelieu scraper
async function scrapeRichelieu(page) {
  console.log('Scraping Richelieu product...');

  const data = await page.evaluate(() => {
    const getTextContent = (selector) => {
      const element = document.querySelector(selector);
      return element ? element.textContent.trim() : null;
    };

    const getElementHTML = (selector) => {
      const element = document.querySelector(selector);
      return element ? element.outerHTML : null;
    };

    // Product name
    const name = getTextContent('h1.product-name, h1[itemprop="name"], .product-title h1, h1');

    // SKU - try multiple selectors (prioritize Richelieu-specific .pms-PartNumber)
    let sku = getTextContent('.pms-PartNumber, [itemprop="sku"], .product-sku, .product-code, .sku-number');

    // Price - Richelieu authenticated pricing selectors (prioritize 2025 selectors)
    let price = getTextContent('.pms-Price, [itemprop="price"], .product-price, .pms-PriceBlock_Main .pms-PriceBlock_BreaksPrice');

    // Fallback to public pricing if not logged in
    if (!price) {
      price = getTextContent('.your-price, .price-now, .price, [class*="price"]');
    }

    // MSRP - Check Richelieu price block first, then fallback
    let msrp = null;
    const priceBlockItems = document.querySelectorAll('.pms-PriceBlock li');
    if (priceBlockItems.length > 0) {
      // MSRP is typically in one of the list items
      for (const item of priceBlockItems) {
        const text = item.textContent.toLowerCase();
        if (text.includes('msrp') || text.includes('list') || text.includes('retail')) {
          msrp = item.textContent.trim();
          break;
        }
      }
    }

    // Fallback MSRP selectors
    if (!msrp) {
      msrp = getTextContent('.list-price, .price-was, .msrp-price, .retail-price');
    }

    // Description
    const description = getTextContent('.product-description, .product-details, [itemprop="description"]');

    // Brand
    const brand = getTextContent('.product-brand, .brand-name, [itemprop="brand"]');

    // Image
    const imageElement = document.querySelector('.product-image img, .main-image img, img[itemprop="image"]');
    const imageUrl = imageElement ? imageElement.src : null;

    // Category
    const categoryElements = document.querySelectorAll('.breadcrumb a, nav.breadcrumb a');
    const categoryPath = Array.from(categoryElements).map(el => el.textContent.trim()).join(' > ');

    // DEBUG: Get HTML snippets for price-related elements (use same selectors as extraction)
    const priceHTML = getElementHTML('.pms-Price, [itemprop="price"], .product-price, .your-price, .price-now');
    const skuHTML = getElementHTML('.pms-PartNumber, [itemprop="sku"], .product-sku');

    return {
      name,
      sku,
      price,
      msrp,
      description,
      brand,
      imageUrl,
      categoryPath,
      url: window.location.href,
      // Debug info
      debug: {
        priceHTML: priceHTML ? priceHTML.substring(0, 500) : 'No price element found',
        skuHTML: skuHTML ? skuHTML.substring(0, 500) : 'No SKU element found'
      }
    };
  });

  console.log('Richelieu scrape complete:', {
    name: data.name,
    sku: data.sku,
    price: data.price
  });

  // Log debug info to help identify selectors
  if (!data.price || !data.sku) {
    console.log('DEBUG - Missing data. HTML snippets:');
    console.log('Price HTML:', data.debug?.priceHTML);
    console.log('SKU HTML:', data.debug?.skuHTML);
  }

  return data;
}

// Home Depot scraper
async function scrapeHomeDepot(page) {
  console.log('Scraping Home Depot product...');

  const data = await page.evaluate(() => {
    const getTextContent = (selector) => {
      const element = document.querySelector(selector);
      return element ? element.textContent.trim() : null;
    };

    const name = getTextContent('h1.product-details__title, h1[data-testid="product-title"]');
    const sku = getTextContent('.product-info-bar__detail--sku, [data-testid="product-sku"]');
    const price = getTextContent('[data-testid="product-price"], .price__dollars');
    const brand = getTextContent('.product-details__brand, [data-testid="product-brand"]');

    const imageElement = document.querySelector('.mediagallery__mainimage img, [data-testid="product-image"] img');
    const imageUrl = imageElement ? imageElement.src : null;

    return {
      name,
      sku,
      price,
      brand,
      imageUrl,
      url: window.location.href
    };
  });

  return data;
}

// Lowe's scraper
async function scrapeLowes(page) {
  console.log('Scraping Lowe\'s product...');

  const data = await page.evaluate(() => {
    const getTextContent = (selector) => {
      const element = document.querySelector(selector);
      return element ? element.textContent.trim() : null;
    };

    const name = getTextContent('h1.pdp-header, h1[itemprop="name"]');
    const sku = getTextContent('.product-code, [itemprop="productID"]');
    const price = getTextContent('.item-price, .price-format__main-price');
    const brand = getTextContent('.pdp-brand, [itemprop="brand"]');

    const imageElement = document.querySelector('.main-image img, .pdp-image img');
    const imageUrl = imageElement ? imageElement.src : null;

    return {
      name,
      sku,
      price,
      brand,
      imageUrl,
      url: window.location.href
    };
  });

  return data;
}

// Amazon scraper
async function scrapeAmazon(page) {
  console.log('Scraping Amazon product...');

  const data = await page.evaluate(() => {
    const getTextContent = (selector) => {
      const element = document.querySelector(selector);
      return element ? element.textContent.trim() : null;
    };

    const name = getTextContent('#productTitle, h1.a-size-large');
    const price = getTextContent('.a-price-whole, .a-price.a-text-price.a-size-medium');
    const brand = getTextContent('#bylineInfo, .po-brand .po-break-word');

    const imageElement = document.querySelector('#landingImage, #imgTagWrapperId img');
    const imageUrl = imageElement ? imageElement.src : null;

    // Amazon doesn't typically show SKU
    const sku = null;

    return {
      name,
      sku,
      price,
      brand,
      imageUrl,
      url: window.location.href
    };
  });

  return data;
}

// Generic scraper (fallback)
async function scrapeGeneric(page) {
  console.log('Using generic scraper...');

  const data = await page.evaluate(() => {
    const getTextContent = (selector) => {
      const element = document.querySelector(selector);
      return element ? element.textContent.trim() : null;
    };

    // Try common selectors
    const name = getTextContent('h1, .product-title, .product-name, [itemprop="name"]');
    const sku = getTextContent('.sku, .product-code, .item-number, [itemprop="sku"]');
    const price = getTextContent('.price, .product-price, .sale-price, [itemprop="price"]');
    const description = getTextContent('.description, .product-description, [itemprop="description"]');

    const imageElement = document.querySelector('img.product-image, img.main-image, [itemprop="image"]');
    const imageUrl = imageElement ? imageElement.src : null;

    return {
      name,
      sku,
      price,
      description,
      imageUrl,
      url: window.location.href
    };
  });

  return data;
}

app.listen(PORT, () => {
  console.log(`JobForge Scraper Service running on port ${PORT}`);
  console.log(`Health check: http://localhost:${PORT}/health`);
  console.log(`Environment: ${process.env.NODE_ENV || 'development'}`);
});