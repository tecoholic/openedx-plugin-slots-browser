# Open edX Plugins Browser

An automatically-updated catalog of frontend plugin slots available in the Open edX ecosystem.

## About

This project discovers and documents all plugin slots available across Open edX's Micro-Frontend Applications (MFEs). It uses the GitHub API to automatically collect plugin metadata and generates a static website hosted on GitHub Pages.

## Features

- 🔄 **Automated data collection** via GitHub Actions (daily)
- 📦 **Catalog of all frontend plugin slots** across Open edX MFEs
- 🌐 **Static site** built with Astro
- ⚡ **Fast & performant** with client-side search
- 🎨 **Beautiful UI** for browsing and discovering plugins

## Tech Stack

- **Static Site Generator**: Astro
- **Data Collection**: Node.js + Octokit (GitHub API)
- **CI/CD**: GitHub Actions
- **Hosting**: GitHub Pages
- **Search**: Fuse.js (client-side)

## Development

### Prerequisites

- Node.js 18+
- npm or yarn
- GitHub token (for real data collection)

### Setup

```bash
# Install dependencies
npm install

# Run development server
npm run dev

# Build static site
npm run build

# Preview build
npm run preview
```

### Collecting Data

To manually run the plugin collection script:

```bash
# With real GitHub API (requires GITHUB_TOKEN)
export GITHUB_TOKEN=your_github_token
npm run collect

# Or test modes (no API calls required)
npm run collect -- --dry-run    # Test mode - outputs nothing
npm run collect -- --test       # Test mode - outputs test message
```

The script features:
- Automatic retry logic (3 attempts with exponential backoff)
- TypeScript interface extraction from `index.ts` files
- JSDoc comment parsing for prop descriptions
- Example code extraction from `example.jsx` files
- Error handling and detailed logging
- Test modes for development (`--dry-run`, `--test`)

### File Structure

```
.
├── .github/workflows/       # GitHub Actions
│   ├── collect-data.yml    # Daily data collection
│   └── deploy.yml          # Build & deploy
├── scripts/                # Data collection scripts
│   └── collect-plugins.ts  # Main collection script
├── data/                   # Generated data
│   └── plugins.json        # Auto-generated plugin data
├── src/
│   ├── pages/             # Astro pages
│   ├── layouts/           # Astro layouts
│   └── data/              # Data for templates
└── astro.config.mjs       # Astro configuration
```

## How It Works

1. **GitHub Actions** runs a scheduled cron job every day at 2 AM UTC
2. **Collection Script** queries GitHub API for openedx org repositories
3. For each `frontend-app-*` or `frontend-component-*` repository:
   - Checks for `/src/plugin-slots` directory
   - Extracts metadata from README files
   - Parses TypeScript/JSDoc comments
4. **Data** is written to `data/plugins.json` and committed
5. **Astro** builds static HTML pages from the data
6. **Site** is deployed to GitHub Pages

## Automation

The project includes two GitHub Actions workflows:

### collect-data.yml
- **Trigger**: Daily at 2 AM UTC (configurable with cron syntax)
- **Actions**: Collects plugin data from GitHub and commits changes
- **Schedule**: `0 2 * * *` (cron expression)

### deploy.yml
- **Trigger**: On push to `main` branch
- **Actions**: Builds site and deploys to GitHub Pages

To manually trigger either workflow:
1. Go to **Actions** tab in your GitHub repository
2. Select the workflow
3. Click **Run workflow**

## Data Schema

The `plugins.json` file contains:

```json
{
  "lastUpdated": "2025-02-05T10:30:00Z",
  "mfes": [
    {
      "id": "frontend-app-learner-dashboard",
      "name": "Learner Dashboard",
      "description": "...",
      "repository": "https://github.com/openedx/...",
      "owner": "openedx",
      "topics": [],
      "pluginSlotsCount": 3
    }
  ],
  "pluginSlots": [
    {
      "id": "SlotId",
      "mfeId": "mfe-id",
      "mfeName": "MFE Name",
      "filePath": "src/plugin-slots/SlotId/README.md",
      "description": "...",
      "operations": ["insert", "replace", "wrap"],
      "sourceUrl": "https://github.com/...",
      "lastUpdated": "2025-02-05T10:30:00Z"
    }
  ]
}
```

## Deployment

This site is automatically deployed to GitHub Pages. To enable:

1. Go to **Settings** → **Pages**
2. Select **GitHub Actions** as source
3. The `deploy.yml` workflow will automatically deploy on push

## Issues & Contributing

- **Data issues**: Check that plugin slots are properly documented in the MFE's `/src/plugin-slots` directory
- **Site issues**: Open an issue in this repository
- **MFE issues**: Open an issue in the relevant [openedx](https://github.com/openedx) repository

## License

This project is part of the Open edX ecosystem and follows the same licensing.

## Learn More

- [Open edX Documentation](https://docs.openedx.org)
- [Frontend Plugin Framework](https://github.com/openedx/frontend-plugin-framework)
- [Astro Documentation](https://docs.astro.build)
