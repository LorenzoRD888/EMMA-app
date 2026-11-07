// ═══════════════════════════════════════════════════
// Competitor Intelligence — downloadable report (.docx).
//
// Reuses the `docx` npm library the exact same way services/
// documentTemplate.js's buildTdsDocx already does (dynamic import,
// Document/Paragraph/TextRun/HeadingLevel/Table) — no new dependency, no
// parallel document-generation system. Genuinely simpler than TDS
// generation though: there's no user-uploaded template to learn fonts/
// tables from here, so styling is fixed/hardcoded rather than captured.
//
// No DOCUMENTED/INFERRED/VERIFY tags — audited and confirmed this schema
// never produces an "inferred" fact at all (every populated field is
// validator-enforced to carry a real source_url; see schemas.js's
// requireSourceIfValued). Facts are rendered as a bold value with a small
// grey source citation beneath it; missing categories keep their field
// label visible with "Not available" in grey, rather than being omitted —
// so a reader can see what was actually looked for, not just what was
// found.
// ═══════════════════════════════════════════════════

function formatCurrencyAmount(amount, unit, currency) {
  const CURRENCY_SYMBOLS = { EUR: "€", USD: "$", GBP: "£", JPY: "¥" };
  const REVENUE_UNIT_LABELS = { thousand: "thousand", million: "million", billion: "billion", actual: "" };
  const symbol = CURRENCY_SYMBOLS[currency] || `${currency} `;
  const unitLabel = REVENUE_UNIT_LABELS[unit] ?? "";
  return `${symbol}${amount.toLocaleString("en-US")}${unitLabel ? " " + unitLabel : ""}`;
}
function formatRevenueValue(v) {
  if (!v) return null;
  return `${formatCurrencyAmount(v.amount, v.unit, v.currency)} (FY ${v.year})`;
}

export async function buildCompetitorReportDocx(schema, meta = {}) {
  const { Document, Packer, Paragraph, TextRun, HeadingLevel } = await import("docx");

  const GREY = "888888";
  const LABEL_GREY = "666666";
  const MISSING_GREY = "999999";

  // One fact = label (small, grey, uppercase-by-convention) + bold value
  // (or "Not available" in grey) + an optional small source line. Always
  // renders the label even when the value is missing — the whole point of
  // this format is that a reader sees what was searched for, not just what
  // was found.
  const factParagraphs = (label, value, sourceName, sourceUrl) => {
    const hasValue = value !== null && value !== undefined && value !== "";
    const paras = [
      new Paragraph({
        children: [new TextRun({ text: label.toUpperCase(), bold: true, size: 16, color: LABEL_GREY })],
        spacing: { before: 200, after: 40 },
      }),
      new Paragraph({
        children: [hasValue
          ? new TextRun({ text: String(value), bold: true, size: 22 })
          : new TextRun({ text: "Not available", italics: true, size: 22, color: MISSING_GREY })],
        spacing: { after: hasValue && (sourceName || sourceUrl) ? 20 : 100 },
      }),
    ];
    if (hasValue && (sourceName || sourceUrl)) {
      const citation = [sourceName, sourceUrl].filter(Boolean).join(" — ");
      paras.push(new Paragraph({
        children: [new TextRun({ text: `Source: ${citation}`, italics: true, size: 17, color: GREY })],
        spacing: { after: 100 },
      }));
    }
    return paras;
  };

  // A sourced list category (products, technologies, patents, acquisitions,
  // open positions, recent news) — each item gets its own bold title +
  // optional body line + small source line; an empty/null category still
  // shows the label with "Not available", same rule as factParagraphs.
  const listParagraphs = (label, items, renderTitle, renderBody, urlKey = "source_url") => {
    const paras = [
      new Paragraph({
        children: [new TextRun({ text: label.toUpperCase(), bold: true, size: 16, color: LABEL_GREY })],
        spacing: { before: 200, after: 40 },
      }),
    ];
    if (!items?.length) {
      paras.push(new Paragraph({
        children: [new TextRun({ text: "Not available", italics: true, size: 22, color: MISSING_GREY })],
        spacing: { after: 100 },
      }));
      return paras;
    }
    for (const item of items) {
      paras.push(new Paragraph({
        children: [new TextRun({ text: renderTitle(item), bold: true, size: 22 })],
        spacing: { before: 80, after: 20 },
      }));
      const body = renderBody?.(item);
      if (body) {
        paras.push(new Paragraph({ children: [new TextRun({ text: body, size: 20 })], spacing: { after: 20 } }));
      }
      if (item[urlKey]) {
        paras.push(new Paragraph({
          children: [new TextRun({ text: `Source: ${item[urlKey]}`, italics: true, size: 17, color: GREY })],
          spacing: { after: 100 },
        }));
      }
    }
    return paras;
  };

  const sectionHeading = (text) => new Paragraph({
    children: [new TextRun({ text, bold: true })],
    heading: HeadingLevel.HEADING_1,
    spacing: { before: 400, after: 160 },
  });

  const children = [
    new Paragraph({
      children: [new TextRun({ text: schema.company_name || meta.companyName || "Unknown Company", bold: true })],
      heading: HeadingLevel.TITLE,
    }),
    new Paragraph({
      children: [new TextRun({ text: `Confidence: ${schema.confidence_score ?? 0}% of tracked categories found and sourced`, size: 20, color: GREY })],
      spacing: { after: 40 },
    }),
    ...(meta.url ? [new Paragraph({ children: [new TextRun({ text: meta.url, size: 20, color: GREY })], spacing: { after: 40 } })] : []),
    new Paragraph({
      children: [new TextRun({ text: `Generated: ${new Date().toISOString().slice(0, 16).replace("T", " ")}`, size: 18, italics: true, color: GREY })],
      spacing: { after: 200 },
    }),
  ];

  // Same as the consistency-check warning below — an advisory disclosure
  // (orange, not the consistency check's red), since the aggregator page
  // was successfully resolved to a real identity where possible.
  if (schema.aggregator_warning) {
    children.push(new Paragraph({
      children: [new TextRun({ text: `⚠ ${schema.aggregator_warning}`, bold: true, color: "B36B00" })],
      spacing: { after: 160 },
    }));
  }

  // Carried into the downloaded document itself, not just the on-screen
  // dashboard — a standalone file is exactly where this warning matters
  // most, since the reader has no other indication anything might be off.
  if (schema.consistency_check?.consistent === false) {
    children.push(new Paragraph({
      children: [new TextRun({ text: "⚠ Data consistency check failed — results may mix multiple companies with similar names. Review each source link before relying on this report.", bold: true, color: "C0392B" })],
      spacing: { after: schema.consistency_check.reasoning ? 40 : 200 },
    }));
    if (schema.consistency_check.reasoning) {
      children.push(new Paragraph({
        children: [new TextRun({ text: schema.consistency_check.reasoning, italics: true, size: 19, color: GREY })],
        spacing: { after: 200 },
      }));
    }
  }

  // ── Overview — the same summary counts already shown on the dashboard's
  // Overview tab, so the report opens with what the reader already saw.
  const MATURITY_LABELS = { established: "Established (5+ years)", growth_stage: "Growth stage (1-5 years)", early_stage: "Early stage (< 1 year)", unverified: "Unverified" };
  const maturity = schema.company_maturity;
  const maturityLabel = MATURITY_LABELS[maturity?.classification] || "Unverified";
  const maturitySource = maturity?.earliest_signal_date
    ? `Earliest signal: ${maturity.earliest_signal_type} dated ${maturity.earliest_signal_date}`
    : null;
  children.push(sectionHeading("Overview"));
  // Always shown, even as "Unverified" — the value itself is the answer
  // here (no signal found), not an absent field, so it's rendered as a
  // real value rather than through the "Not available" missing-field path.
  children.push(...factParagraphs("Company maturity", maturityLabel, maturitySource, maturity?.earliest_signal_source));
  children.push(...factParagraphs("Revenue", formatRevenueValue(schema.revenue?.value), schema.revenue?.source_name, schema.revenue?.source_url));
  children.push(...factParagraphs("Employees", schema.employee_count?.value, schema.employee_count?.source_name, schema.employee_count?.source_url));
  children.push(...factParagraphs("Hiring trend", schema.hiring_activity?.trend, null, schema.hiring_activity?.source_url));
  children.push(...factParagraphs("Open positions found", schema.hiring_activity?.open_positions?.length || null, null, null));
  children.push(...factParagraphs("Acquisitions found", schema.acquisitions?.length || null, null, null));
  children.push(...factParagraphs("Patents found", schema.patents?.length || null, null, null));

  // ── Financial ──
  children.push(sectionHeading("Financial"));
  children.push(...factParagraphs("Revenue", formatRevenueValue(schema.revenue?.value), schema.revenue?.source_name, schema.revenue?.source_url));
  children.push(...factParagraphs("Employees", schema.employee_count?.value, schema.employee_count?.source_name, schema.employee_count?.source_url));
  children.push(...listParagraphs("Acquisitions", schema.acquisitions,
    a => `${a.company_name}${a.amount ? ` — ${a.amount}` : ""}`,
    a => a.date));

  // ── Technical ──
  children.push(sectionHeading("Technical"));
  children.push(...listParagraphs("Key products", schema.key_products, p => p.name, p => p.description));
  children.push(...listParagraphs("Technologies", schema.technologies, x => x.name));

  // ── IP & Patents — same disclaimer shown on the dashboard's IP tab, since
  // a standalone document reader won't otherwise see it.
  children.push(sectionHeading("IP & Patents"));
  children.push(new Paragraph({
    children: [new TextRun({ text: "Found by name search, not verified against the official assignee record — confirm ownership via the source link before relying on this.", italics: true, size: 18, color: GREY })],
    spacing: { after: 120 },
  }));
  children.push(...listParagraphs("Patents", schema.patents, p => p.title || "Untitled", p => p.number ? `Patent no. ${p.number}` : null));

  // ── News & Hiring ──
  children.push(sectionHeading("News & Hiring"));
  children.push(...factParagraphs("Hiring trend", schema.hiring_activity?.trend, null, schema.hiring_activity?.source_url));
  children.push(...factParagraphs("Hiring role pattern", schema.hiring_activity?.role_pattern_summary, null, schema.hiring_activity?.source_url));
  children.push(...listParagraphs("Open positions", schema.hiring_activity?.open_positions, p => p.title || "Untitled role", p => p.department, "url"));
  children.push(...listParagraphs("Recent news (last 5 months)", schema.recent_news, n => n.title, n => n.summary, "url"));

  // ── Public Presence — enrichment categories, scored separately
  // (enrichment_score) from the core confidence_score above. Sourced
  // entirely from public search-engine-indexed content, never a direct
  // fetch of any authenticated page.
  children.push(sectionHeading("Public Presence"));
  if (schema.enrichment_score != null) {
    children.push(new Paragraph({
      children: [new TextRun({ text: `Public presence coverage: ${schema.enrichment_score}% of tracked enrichment categories found`, size: 20, color: GREY })],
      spacing: { after: 160 },
    }));
  }
  children.push(...listParagraphs("People mentioned", schema.people_mentioned, p => p.name, p => p.role));
  children.push(...listParagraphs("GitHub / tech presence", schema.github_presence, g => g.repository_name, g => g.description));
  children.push(...factParagraphs("Registry — founding date", schema.registry_info?.founding_date, schema.registry_info?.registry_name, schema.registry_info?.source_url));
  children.push(...factParagraphs("Registry — directors", schema.registry_info?.directors?.length ? schema.registry_info.directors.join(", ") : null, schema.registry_info?.registry_name, schema.registry_info?.source_url));
  children.push(...factParagraphs("Registry — capital", schema.registry_info?.capital, schema.registry_info?.registry_name, schema.registry_info?.source_url));
  children.push(...listParagraphs("Academic / research mentions", schema.academic_mentions, a => a.title, a => a.authors?.length ? `Authors: ${a.authors.join(", ")}` : null));
  children.push(...listParagraphs("Community mentions", schema.community_mentions, c => c.title, c => c.summary));

  const document = new Document({ sections: [{ children }] });
  return await Packer.toBuffer(document);
}
