import { useEffect, useRef, useMemo } from "react";
import * as d3 from "d3";
import type { SimulationResult } from "../types";
import type { Account, Scenario } from "../types";
import { formatCurrency } from "../utils/formatting";

interface ChartProps {
  result: SimulationResult;
  accounts: Account[];
  scenario: Scenario;
  visibleAccounts: Set<string>;
  viewportStart: number; // index into months array
  viewportEnd: number;
}

export function Chart({ result, accounts, scenario, visibleAccounts, viewportStart, viewportEnd }: ChartProps) {
  const svgRef = useRef<SVGSVGElement>(null);
  const tooltipRef = useRef<HTMLDivElement>(null);

  const visibleMonths = useMemo(
    () => result.months.slice(viewportStart, viewportEnd + 1),
    [result.months, viewportStart, viewportEnd]
  );

  useEffect(() => {
    if (!svgRef.current) return;
    const svg = d3.select(svgRef.current);
    svg.selectAll("*").remove();

    const container = svgRef.current.parentElement!;
    const totalWidth = container.clientWidth || 800;
    const totalHeight = container.clientHeight || 400;
    const margin = { top: 20, right: 20, bottom: 40, left: 70 };
    const width = totalWidth - margin.left - margin.right;
    const height = totalHeight - margin.top - margin.bottom;

    svg.attr("width", totalWidth).attr("height", totalHeight);

    const g = svg.append("g").attr("transform", `translate(${margin.left},${margin.top})`);

    const months = result.months.slice(viewportStart, viewportEnd + 1);
    const visibleAccList = accounts.filter(a => visibleAccounts.has(a.id));

    // Build data array: one entry per month
    const data = months.map((m, i) => {
      const idx = viewportStart + i;
      const entry: Record<string, number | string> = { month: m };
      for (const acc of visibleAccList) {
        const val = result.balances[acc.id]?.[idx];
        entry[acc.id] = val ?? 0;
      }
      return entry;
    });

    // X scale
    const xScale = d3.scalePoint<string>()
      .domain(months)
      .range([0, width]);

    // Compute Y domain
    let yMin = 0;
    let yMax = 0;
    for (const d of data) {
      let posSum = 0;
      let negSum = 0;
      for (const acc of visibleAccList) {
        const v = (d[acc.id] as number) || 0;
        if (v >= 0) posSum += v;
        else negSum += v;
      }
      yMax = Math.max(yMax, posSum);
      yMin = Math.min(yMin, negSum);
    }

    // Add padding
    const range = yMax - yMin || 1;
    yMax += range * 0.05;
    yMin -= range * 0.05;

    const yScale = d3.scaleLinear()
      .domain([yMin, yMax])
      .range([height, 0]);

    // Draw gridlines
    g.append("g")
      .attr("class", "grid")
      .call(
        d3.axisLeft(yScale)
          .tickSize(-width)
          .tickFormat(() => "")
      )
      .call(g => g.select(".domain").remove())
      .call(g => g.selectAll(".tick line")
        .attr("stroke", "currentColor")
        .attr("stroke-opacity", 0.1));

    // Zero line
    g.append("line")
      .attr("x1", 0).attr("x2", width)
      .attr("y1", yScale(0)).attr("y2", yScale(0))
      .attr("stroke", "currentColor")
      .attr("stroke-opacity", 0.4)
      .attr("stroke-width", 1);

    // Draw stacked areas
    const posStack = d3.stack<Record<string, number | string>>()
      .keys(visibleAccList.map(a => a.id))
      .value((d, key) => {
        const v = (d[key] as number) || 0;
        return v >= 0 ? v : 0;
      })
      .order(d3.stackOrderNone)
      .offset(d3.stackOffsetNone);

    const negStack = d3.stack<Record<string, number | string>>()
      .keys(visibleAccList.map(a => a.id))
      .value((d, key) => {
        const v = (d[key] as number) || 0;
        return v < 0 ? v : 0;
      })
      .order(d3.stackOrderNone)
      .offset(d3.stackOffsetNone);

    const posLayers = posStack(data as Record<string, number | string>[]);
    const negLayers = negStack(data as Record<string, number | string>[]);

    const area = d3.area<d3.SeriesPoint<Record<string, number | string>>>()
      .x((_, i) => xScale(months[i]) ?? 0)
      .y0(d => yScale(d[0]))
      .y1(d => yScale(d[1]))
      .curve(d3.curveMonotoneX);

    const colorMap = Object.fromEntries(accounts.map(a => [a.id, a.color]));

    // Draw positive layers
    for (const layer of posLayers) {
      const accId = layer.key;
      g.append("path")
        .datum(layer)
        .attr("fill", colorMap[accId] ?? "#999")
        .attr("fill-opacity", 0.7)
        .attr("d", area);
    }

    // Draw negative layers
    for (const layer of negLayers) {
      const accId = layer.key;
      g.append("path")
        .datum(layer)
        .attr("fill", colorMap[accId] ?? "#999")
        .attr("fill-opacity", 0.7)
        .attr("d", area);
    }

    // Net worth line
    const netLine = d3.line<Record<string, number | string>>()
      .x((_, i) => xScale(months[i]) ?? 0)
      .y(d => {
        let total = 0;
        for (const acc of visibleAccList) total += (d[acc.id] as number) || 0;
        return yScale(total);
      })
      .curve(d3.curveMonotoneX);

    g.append("path")
      .datum(data)
      .attr("fill", "none")
      .attr("stroke", "currentColor")
      .attr("stroke-width", 2)
      .attr("stroke-dasharray", "4,2")
      .attr("d", netLine);

    // Today marker
    const todayStr = (() => {
      const now = new Date();
      return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
    })();
    if (months.includes(todayStr)) {
      const tx = xScale(todayStr) ?? 0;
      g.append("line")
        .attr("x1", tx).attr("x2", tx)
        .attr("y1", 0).attr("y2", height)
        .attr("stroke", "#f59e0b")
        .attr("stroke-width", 1.5)
        .attr("stroke-dasharray", "4,2");
      g.append("text")
        .attr("x", tx + 4)
        .attr("y", 12)
        .attr("font-size", 10)
        .attr("fill", "#f59e0b")
        .text("Today");
    }

    // X axis — show year labels
    const yearMonths = months.filter(m => m.endsWith("-01"));
    const xAxisTicks = g.append("g")
      .attr("transform", `translate(0,${height})`);

    xAxisTicks.call(
      d3.axisBottom(xScale)
        .tickValues(yearMonths)
        .tickFormat(m => (m as string).slice(0, 4))
    );

    // Y axis
    g.append("g").call(
      d3.axisLeft(yScale)
        .tickFormat(d => formatCurrency(d as number, scenario.currencyLocale, scenario.currencySymbol))
    );

    // Tooltip overlay
    const overlay = g.append("rect")
      .attr("width", width)
      .attr("height", height)
      .attr("fill", "none")
      .attr("pointer-events", "all");

    const tooltip = d3.select(tooltipRef.current);
    const crosshair = g.append("line")
      .attr("y1", 0).attr("y2", height)
      .attr("stroke", "currentColor")
      .attr("stroke-width", 1)
      .attr("stroke-dasharray", "4,2")
      .style("display", "none");

    overlay.on("mousemove", (event: MouseEvent) => {
      const [mx] = d3.pointer(event);
      // Find nearest month
      const domain = xScale.domain();
      const step = width / (domain.length - 1 || 1);
      const idx = Math.round(mx / step);
      const clampedIdx = Math.max(0, Math.min(idx, domain.length - 1));
      const month = domain[clampedIdx];
      const cx = xScale(month) ?? 0;

      crosshair.attr("x1", cx).attr("x2", cx).style("display", null);

      const monthIdx = viewportStart + clampedIdx;
      let total = 0;
      let html = `<div class="font-semibold mb-1">${month}</div>`;
      for (const acc of visibleAccList) {
        const v = result.balances[acc.id]?.[monthIdx];
        if (v !== null && v !== undefined) {
          total += v;
          html += `<div class="flex items-center gap-1">
            <span style="background:${colorMap[acc.id]}" class="inline-block w-2 h-2 rounded-full"></span>
            <span>${acc.name}:</span>
            <span class="font-medium">${formatCurrency(v, scenario.currencyLocale, scenario.currencySymbol)}</span>
          </div>`;
        }
      }
      html += `<div class="border-t mt-1 pt-1 font-semibold">Net: ${formatCurrency(total, scenario.currencyLocale, scenario.currencySymbol)}</div>`;

      tooltip.style("display", "block")
        .style("left", `${event.offsetX + margin.left + 10}px`)
        .style("top", `${event.offsetY}px`)
        .html(html);
    });

    overlay.on("mouseleave", () => {
      crosshair.style("display", "none");
      tooltip.style("display", "none");
    });

  }, [result, accounts, visibleAccounts, viewportStart, viewportEnd, scenario]);

  // visibleMonths is used to trigger re-render when viewport changes
  void visibleMonths;

  return (
    <div className="relative w-full h-full">
      <svg ref={svgRef} className="w-full h-full" />
      <div
        ref={tooltipRef}
        className="absolute pointer-events-none bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded shadow-lg p-2 text-xs z-10"
        style={{ display: "none" }}
      />
    </div>
  );
}
