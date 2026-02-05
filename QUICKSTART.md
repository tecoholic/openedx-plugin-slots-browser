# Quick Start Guide

## Prerequisites

- Node.js 18+
- npm or yarn
- GitHub account (for deployment)

## Local Development

### 1. Install Dependencies
```bash
npm install
```

### 2. Run Development Server
```bash
npm run dev
```

Visit http://localhost:3000/openedx-plugins-browser/ to see the site.

### 3. Make Changes
- Edit pages in `src/pages/`
- Edit layouts in `src/layouts/`
- Styles are in `<style>` tags in components
- Data comes from `src/data/plugins.json`

## Building & Testing

### Build Static Site
```bash
npm run build
```

Output goes to `dist/` directory.

### Preview Build
```bash
npm run preview
```

### Test Data Collection
```bash
# Real data collection (requires GitHub token)
export GITHUB_TOKEN=your_github_token
npm run collect

# This updates data/plugins.json with real data from GitHub.

# Or use test modes (no API calls needed):
npm run collect -- --dry-run    # Test without any output
npm run collect -- --test       # Test with test message
```

The collection script now extracts:
- Plugin slot metadata
- TypeScript interface definitions
- JSDoc comments
- Example code
- With automatic retry logic for reliability

## GitHub Pages Deployment

### 1. Enable GitHub Pages
1. Go to repository **Settings** → **Pages**
2. Select **GitHub Actions** as deployment source
3. Save

### 2. Push to Main Branch
```bash
git add .
git commit -m "Initial commit"
git push origin main
```

GitHub Actions will automatically:
1. Run `npm run build`
2. Deploy to GitHub Pages
3. Your site will be live at: `https://tecoholic.github.io/openedx-plugins-browser/`

## Automated Data Collection

### Setup Daily Updates
1. Collection runs automatically every day at 2 AM UTC
2. Updated data is committed to the repository
3. Site rebuilds and redeploys automatically

### Manual Data Update
```bash
# Trigger the collection workflow from GitHub Actions tab
# Or run locally:
export GITHUB_TOKEN=your_github_token
npm run collect
git add data/plugins.json
git commit -m "docs: update plugin data"
git push
```

## Project Scripts

```bash
npm run dev              # Start dev server on port 3000
npm run build            # Build static site to dist/
npm run preview          # Preview built site locally
npm run collect          # Fetch plugin data from GitHub
npm run test:collect     # Test collection without API calls
npm run sync:data        # Copy data/plugins.json to src/data/
```

## File Structure Explained

```
src/
├── pages/              # Astro page routes
│   ├── index.astro    # Home page (/)
│   ├── about.astro    # About page (/about)
│   └── mfes/
│       ├── index.astro          # MFE list (/mfes)
│       └── [mfe].astro          # MFE detail (/mfes/[id])
├── layouts/
│   └── BaseLayout.astro         # Base HTML layout
└── data/
    └── plugins.json             # Plugin data (auto-synced)

data/
└── plugins.json                 # Source data file
                                # (updated by collect script)

scripts/
└── collect-plugins.ts           # GitHub API data collector
```

## Understanding the Data

`plugins.json` structure:

```json
{
  "lastUpdated": "2025-02-05T...",
  "mfes": [
    {
      "id": "frontend-app-name",
      "name": "Display Name",
      "description": "...",
      "repository": "https://github.com/...",
      "pluginSlotsCount": 5
    }
  ],
  "pluginSlots": [
    {
      "id": "SlotName",
      "mfeId": "parent-mfe-id",
      "mfeName": "Parent MFE Name",
      "description": "What this slot does",
      "operations": ["insert", "replace", "wrap"],
      "sourceUrl": "Link to GitHub"
    }
  ]
}
```

## Customization

### Change GitHub Pages Path
Edit `astro.config.mjs`:
```javascript
export default defineConfig({
  site: 'https://your-domain.com/',
  base: '/your-path',  // Change this
  // ...
});
```

### Change Data Collection Schedule
Edit `.github/workflows/collect-data.yml`:
```yaml
on:
  schedule:
    - cron: '0 2 * * *'  # Change this (cron expression)
```

### Customize Colors
Edit styling in individual `.astro` files or in `BaseLayout.astro`:
```css
:root {
  --color-primary: #0066cc;      /* Primary blue */
  --color-secondary: #f0f0f0;    /* Light gray */
  --color-text: #333;            /* Dark text */
  --color-border: #ddd;          /* Light border */
}
```

## Troubleshooting

### Build Fails
```bash
# Clean install
rm -rf node_modules package-lock.json
npm install
npm run build
```

### Data Collection Returns No Results
```bash
# Check your GitHub token is valid
echo $GITHUB_TOKEN

# Verify API access
npm run test:collect
```

### Site Shows Blank Page
1. Check browser console for errors
2. Verify `src/data/plugins.json` exists and has content
3. Run `npm run sync:data` to ensure data is synced

## Getting Help

- **Astro Docs**: https://docs.astro.build
- **GitHub Issues**: Open issue in this repository
- **Open edX Docs**: https://docs.openedx.org

## Next Steps

1. ✅ Phase 1: Initial setup (DONE)
2. 🔜 Phase 2: Enhanced data collection & parsing
3. 🔜 Phase 3: Search functionality & UX improvements
