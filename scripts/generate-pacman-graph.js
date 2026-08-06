// scripts/generate-pacman-graph.js
//
// Original, from-scratch generator for a "Pac-Man eats my commits" SVG.
// It fetches the requesting user's PUBLIC GitHub contribution calendar and
// renders a brand new animated SVG (grid + Pac-Man + ghosts) using plain
// SVG/SMIL animation that this script builds itself. No third-party
// contribution-graph or Pac-Man rendering library is used anywhere here.

const https = require('node:https');
const fs = require('node:fs');
const path = require('node:path');

const USERNAME = process.argv[2] || process.env.GITHUB_USER_NAME;

if (!USERNAME) {
    console.error('Usage: node generate-pacman-graph.js <github-username>');
    process.exit(1);
}

function fetchText(url) {
    return new Promise((resolve, reject) => {
          https
            .get(url, { headers: { 'User-Agent': 'pacman-graph-generator' } }, (res) => {
                      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
                                  resolve(fetchText(res.headers.location));
                                  return;
                      }
                      if (res.statusCode !== 200) {
                                  reject(new Error('Request failed with status ' + res.statusCode + ' for ' + url));
                                  return;
                      }
                      let data = '';
                      res.on('data', (chunk) => (data += chunk));
                      res.on('end', () => resolve(data));
            })
            .on('error', reject);
    });
}

async function getContributionDays(username) {
    const html = await fetchText('https://github.com/users/' + username + '/contributions');
    const tdRegex = /<td[^>]*>/g;
    const days = [];
    let match;
    while ((match = tdRegex.exec(html))) {
          const tag = match[0];
          const dateMatch = tag.match(/data-date="(\d{4}-\d{2}-\d{2})"/);
          const levelMatch = tag.match(/data-level="(\d)"/);
          if (dateMatch && levelMatch) {
                  days.push({ date: dateMatch[1], level: Number(levelMatch[1]) });
          }
    }
    if (days.length === 0) {
          throw new Error('Could not parse contribution data from GitHub response');
    }
    days.sort((a, b) => (a.date < b.date ? -1 : 1));
    return days;
}

function buildWeeks(days) {
    const weeks = [];
    let currentWeek = [];
    for (const day of days) {
          const dow = new Date(day.date + 'T00:00:00Z').getUTCDay();
          if (dow === 0 && currentWeek.length > 0) {
                  weeks.push(currentWeek);
                  currentWeek = [];
          }
          currentWeek.push(day);
    }
    if (currentWeek.length > 0) weeks.push(currentWeek);
    return weeks;
}

// Boustrophedon traversal: sweep down a column, then up the next column, so
// Pac-Man visits every cell exactly once via a single continuous path.
function buildTraversal(weeks, cell, gap) {
    const points = [];
    const cellAt = [];
    weeks.forEach((week, colIndex) => {
          const rowOrder = [...week.keys()];
          const order = colIndex % 2 === 0 ? rowOrder : rowOrder.slice().reverse();
          for (const rowIndex of order) {
                  const day = week[rowIndex];
                  const x = colIndex * (cell + gap) + gap + cell / 2;
                  const y = rowIndex * (cell + gap) + gap + cell / 2;
                  points.push({ x, y });
                  cellAt.push({ day, x, y });
          }
    });
    return { points, cellAt };
}

const PALETTES = {
    light: { bg: '#ffffff', eaten: '#d0d7de', levels: ['#ebedf0', '#9be9a8', '#40c463', '#30a14e', '#216e39'] },
    dark: { bg: '#0d1117', eaten: '#30363d', levels: ['#161b22', '#0e4429', '#006d32', '#26a641', '#39d353'] },
};

function buildSvg(weeks, cellAt, points, theme) {
    const cell = 11;
    const gap = 3;
    const maxRows = Math.max.apply(null, weeks.map((w) => w.length));
    const width = weeks.length * (cell + gap) + gap;
    const height = maxRows * (cell + gap) + gap;
    const palette = PALETTES[theme];
    const totalCells = Math.max(cellAt.length, 1);
    const secondsPerCell = 0.12;
    const duration = Math.max(totalCells * secondsPerCell, 8).toFixed(2);
    const pathData = 'M' + points.map((p) => p.x.toFixed(2) + ',' + p.y.toFixed(2)).join(' L');

  let svg = '<svg xmlns="http://www.w3.org/2000/svg" width="' + width + '" height="' + height + '" viewBox="0 0 ' + width + ' ' + height + '">';
    svg += '<rect width="' + width + '" height="' + height + '" fill="' + palette.bg + '"/>';

  cellAt.forEach((c, i) => {
        const color = palette.levels[Math.min(c.day.level, 4)];
        const x = (c.x - cell / 2).toFixed(2);
        const y = (c.y - cell / 2).toFixed(2);
        if (c.day.level > 0) {
                const t = Math.min(Math.max(i / totalCells, 0.0001), 0.9999).toFixed(4);
                svg += '<rect x="' + x + '" y="' + y + '" width="' + cell + '" height="' + cell + '" rx="2" fill="' + color + '">';
                svg += '<animate attributeName="fill" calcMode="discrete" dur="' + duration + 's" repeatCount="indefinite" keyTimes="0;' + t + ';1" values="' + color + ';' + color + ';' + palette.eaten + '"/>';
                svg += '</rect>';
        } else {
                svg += '<rect x="' + x + '" y="' + y + '" width="' + cell + '" height="' + cell + '" rx="2" fill="' + color + '"/>';
        }
  });

  const ghostColors = theme === 'dark' ? ['#ff6b6b', '#7ad1ff', '#ffd166'] : ['#e8555f', '#4ba3e6', '#e6ac1f'];
    ghostColors.forEach((color, i) => {
          const lag = (-(i + 1) * Number(duration) * 0.07).toFixed(2);
          svg += '<path d="M-5,-1 A5,5 0 1 1 5,-1 L5,5 L2.5,2 L0,5 L-2.5,2 L-5,5 Z" fill="' + color + '">';
          svg += '<animateMotion path="' + pathData + '" dur="' + duration + 's" begin="' + lag + 's" repeatCount="indefinite" rotate="auto"/>';
          svg += '</path>';
    });

  const pacColor = '#ffcc4d';
    svg += '<path fill="' + pacColor + '">';
    svg += '<animate attributeName="d" dur="0.24s" repeatCount="indefinite" values="M0,0 L5.8,-1.55 A6,6 0 1 0 5.8,1.55 Z;M0,0 L4.24,-4.24 A6,6 0 1 0 4.24,4.24 Z;M0,0 L5.8,-1.55 A6,6 0 1 0 5.8,1.55 Z"/>';
    svg += '<animateMotion path="' + pathData + '" dur="' + duration + 's" repeatCount="indefinite" rotate="auto"/>';
    svg += '</path>';

  svg += '</svg>';
    return svg;
}

async function main() {
    const days = await getContributionDays(USERNAME);
    const weeks = buildWeeks(days);
    const traversal = buildTraversal(weeks, 11, 3);
    const points = traversal.points;
    const cellAt = traversal.cellAt;

  const outDir = path.join(process.cwd(), 'dist');
    fs.mkdirSync(outDir, { recursive: true });

  fs.writeFileSync(path.join(outDir, 'pacman-contribution-graph.svg'), buildSvg(weeks, cellAt, points, 'light'));
    fs.writeFileSync(path.join(outDir, 'pacman-contribution-graph-dark.svg'), buildSvg(weeks, cellAt, points, 'dark'));

  console.log('Generated Pac-Man contribution graph for ' + USERNAME + ': ' + cellAt.length + ' days across ' + weeks.length + ' weeks.');
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
