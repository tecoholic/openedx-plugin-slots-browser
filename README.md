# Open edX Plugins Browser

An automatically-updated catalog of frontend plugin slots available in the Open edX ecosystem.

## About

This project discovers and documents all plugin slots available across Open edX's Micro-Frontend Applications (MFEs). It uses the GitHub API to automatically collect plugin metadata and generates a static website hosted on GitHub Pages.

## Features

- 🔄 **Automated data collection** via GitHub Actions (daily)
- 📦 **Catalog of all frontend plugin slots** across Open edX MFEs
- 🌐 **Static site** built with Astro
- ⚡ **Fast & performant** with client-side search

## Tech Stack

- **Static Site Generator**: Astro
- **Data Collection**: Node.js + Octokit (GitHub API)
- **CI/CD**: GitHub Actions
- **Hosting**: GitHub Pages
- **Search**: Fuse.js (client-side)

## Development

### Prerequisites

- Node.js 24
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

## Contributing

Contributions are welcome! Please visit the [GitHub repository](https://github.com/tecoholic/openedx-plugin-slots-browser) to report issues, suggest features, or submit pull requests.

## Learn More

- [Open edX Documentation](https://docs.openedx.org)
- [Frontend Plugin Framework](https://github.com/openedx/frontend-plugin-framework)
- [Astro Documentation](https://docs.astro.build)
