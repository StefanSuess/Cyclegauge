# Cost Advisor and cost engine

In 0.5.2 the Cost Advisor replaces the standalone Cost Optimizer UI. Open **Cyclegauge: Open Cost Advisor** in the Command Palette, the lightbulb title action, or the **Cost Advisor** status item shown while the budget panel is visible.

A nominal reported limit can suggest a plan with moderate confidence, but never identifies it uniquely. Your explicit selection wins. Native questions ask about the plan, billing and purchased add-ons; cancellation changes nothing. **Clear my answers** forgets the session answers. Account changes, ambiguity and reload clear them too. Nothing is persisted (SC5 open).

The card can show a **modelled estimate** when the current plan and an alternative can be priced over the same full future billing cycles. It names the period, USD, pre-tax list prices and assumptions. It compares keeping the plan with changes at the next UTC reset. It never claims guaranteed savings, an invoice or a global minimum. Unknown add-ons, Enterprise inputs, mismatched limits and unqualified forecasts can prevent figures. A hypothetical absence of add-ons is explicitly labelled. Unpriced sensitivity levels are not converted to zero or a complete bound.

Expandable details show 1/3/6-cycle comparisons, 75/100/125% demand sensitivity, conditions and engine calculations. “Supported estimate”, “no action needed” and “potential savings” require explicit inputs and a supported engine result; the current bundled catalog keeps production comparisons conditional.

The independent exact cost engine, catalog and pricing algorithms remain. Ordinary extension interactions use `optimizeCosts()`; exhaustive `findBreakEven()` stays engine-only. No purchases, network requests, telemetry or authenticated access. See [Advisor specification](cost-advisor-spec.md) and [integration validation](cost-advisor-integration-validation.md).
