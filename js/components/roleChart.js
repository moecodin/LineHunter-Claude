// LineHunter - js/components/roleChart.js
// The small "Role" line chart on player.html: minutes or usage % for each game, oldest to newest,
// with a faint dashed line at the season average.
//   const role = createRoleChart(document.getElementById("roleChart"), { height: 160 });
//   role.draw(points, { metric: "minutes", average: 34.2 });  // points: [{ row, minutes, usage }] oldest first
//   role.clear("No usage data for these games.");
//
// row = one game from calculateHitRate (opponent, homeAway, date). minutes / usage = numbers, or null (no data).
// Needs Chart.js, and js/components/propChart.js (shortDate, monthDayDate).

const ROLE_METRICS = {
  minutes: { label: "Minutes", unit: " min", decimals: 0 },
  usage: { label: "Usage %", unit: "% USG", decimals: 1 },
};

function createRoleChart(container, { height = 160 } = {}) {
  container.innerHTML = `
    <div class="lh-role-box" style="position: relative; height: ${height}px"><canvas role="img" aria-label="Line chart of minutes or usage per game"></canvas></div>
    <div class="lh-role-message text-muted small" hidden></div>`;
  const box = container.querySelector(".lh-role-box");
  const message = container.querySelector(".lh-role-message");
  const canvas = container.querySelector("canvas");

  let chart = null;
  let points = [];   // the games behind the dots (oldest first), for the tooltip
  let current = { metric: "minutes", average: null };

  // Colors come from the CSS variables each time the chart draws, so a theme change just needs a redraw.
  const palette = () => ({
    accent: cssVar("--lh-accent"),
    muted: cssVar("--lh-muted"),
    lineRgb: cssVar("--lh-line-rgb"),
  });
  let lastArgs = null; // the last draw() arguments, so a theme change can redraw

  // "@BOS · Oct 22 · 36 min" or "vs BOS · Oct 22 · 28.4% USG"
  function tooltipText(index) {
    const point = points[index];
    const info = ROLE_METRICS[current.metric];
    const value = point[current.metric];
    const opponent = `${point.row.homeAway === "away" ? "@" : "vs "}${point.row.opponent}`;
    const valueText = value === null ? "no data" : `${value.toFixed(info.decimals)}${info.unit}`;
    return `${opponent} · ${monthDayDate(point.row.date)} · ${valueText}`;
  }

  // Writes "Avg 34.2" above the right end of the dashed line.
  const averageLabelPlugin = {
    id: "lhRoleAverage",
    afterDatasetsDraw(c) {
      if (current.average === null) return;
      const meta = c.getDatasetMeta(1);
      if (!meta.data.length) return;
      const y = meta.data[0].y;
      const { ctx, chartArea } = c;
      ctx.save();
      ctx.fillStyle = palette().muted;
      ctx.font = "10px Satoshi, sans-serif";
      ctx.textAlign = "right";
      ctx.textBaseline = "bottom";
      ctx.fillText(`Avg ${current.average.toFixed(1)}`, chartArea.right, y - 3);
      ctx.restore();
    },
  };

  function build() {
    chart = new Chart(canvas, {
      type: "line",
      data: {
        labels: [],
        datasets: [
          { // the games
            data: [],
            borderColor: palette().accent,
            backgroundColor: palette().accent,
            borderWidth: 2,
            pointRadius: 3,
            pointHoverRadius: 5,
            tension: 0.25,
            spanGaps: false, // a game with no data leaves a gap instead of a made-up number
          },
          { // the faint dashed season average
            data: [],
            borderColor: `rgba(${palette().lineRgb}, 0.55)`,
            borderWidth: 1,
            borderDash: [6, 4],
            pointRadius: 0,
            pointHoverRadius: 0,
            tension: 0,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        animation: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? false : { duration: 250 },
        interaction: { mode: "index", intersect: false },
        layout: { padding: { top: 6 } },
        plugins: {
          legend: { display: false },
          tooltip: {
            displayColors: false,
            filter: (item) => item.datasetIndex === 0, // the average line has no tooltip
            callbacks: { title: () => "", label: (item) => tooltipText(item.dataIndex) },
          },
        },
        scales: {
          x: {
            grid: { display: false },
            ticks: { color: palette().muted, maxRotation: 0, autoSkip: true, maxTicksLimit: 10, font: { family: "Satoshi, sans-serif", size: 10 } },
          },
          y: {
            grace: "10%",
            grid: { color: `rgba(${palette().lineRgb}, 0.12)` },
            ticks: { color: palette().muted, maxTicksLimit: 5 },
          },
        },
      },
      plugins: [averageLabelPlugin],
    });
  }

  const api = {
    // gamesOldestFirst: [{ row, minutes, usage }]. average: the season average for this metric, or null.
    draw(gamesOldestFirst, { metric, average }) {
      points = gamesOldestFirst;
      current = { metric, average };
      lastArgs = [gamesOldestFirst, { metric, average }];
      const values = points.map((point) => point[metric]);
      if (values.every((value) => value === null)) {
        this.clear("No usage data for these games.");
        return;
      }

      message.hidden = true;
      box.hidden = false;
      if (!chart) build();
      const colors = palette();
      chart.data.labels = points.map((point) => shortDate(point.row.date));
      chart.data.datasets[0].data = values;
      chart.data.datasets[0].borderColor = colors.accent;
      chart.data.datasets[0].backgroundColor = colors.accent;
      chart.data.datasets[1].data = average === null ? [] : values.map(() => average);
      chart.data.datasets[1].borderColor = `rgba(${colors.lineRgb}, 0.55)`;     // the dashed average line
      chart.options.scales.x.ticks.color = colors.muted;                        // axis labels and grid follow the theme
      chart.options.scales.y.ticks.color = colors.muted;
      chart.options.scales.y.grid.color = `rgba(${colors.lineRgb}, 0.12)`;
      chart.update();
    },

    // Nothing to draw: hide the chart and say why.
    clear(text = "No games for these filters.") {
      points = [];
      lastArgs = null;
      box.hidden = true;
      message.textContent = text;
      message.hidden = false;
    },
  };

  document.addEventListener("lh-theme-change", () => {
    if (lastArgs && chart) api.draw(...lastArgs); // new colors for the line, dots, average line, axes and grid
  });

  return api;
}
