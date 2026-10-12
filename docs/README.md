# Documentation

Start with the [project README](../README.md). Everything below is the detail behind it.

## Using Cyclegauge

| Page | What it covers |
| --- | --- |
| [usage.md](usage.md) | Install a VSIX, settings, command-line tool, default file locations |
| [how-values-are-calculated.md](how-values-are-calculated.md) | What "used", "remaining" and "available per day" mean, and what stays unknown |
| [forecasting.md](forecasting.md) | History, provisional and regular forecasts, status-bar wording |
| [usage-chart.md](usage-chart.md) | The usage trajectory chart and its accessibility text |
| [privacy-and-storage.md](privacy-and-storage.md) | What is read, what is stored, permissions, limits |
| [platform-support.md](platform-support.md) | Verified and unverified platforms, known limitations |

## Contributing and project background

| Page | What it covers |
| --- | --- |
| [development.md](development.md) | Build, test, package, naming and identifiers |
| [version-history.md](version-history.md) | Release summary and milestone notes |
| [../CONTRIBUTING.md](../CONTRIBUTING.md) | How to report bugs and propose changes |
| [../SECURITY.md](../SECURITY.md) | Reporting a vulnerability |
| [../SPEC.md](../SPEC.md), [../ARCHITECTURE.md](../ARCHITECTURE.md), [../ROADMAP.md](../ROADMAP.md) | Specification, architecture and roadmap |
| [../AGENTS.md](../AGENTS.md) | Contributor and coding-agent rules (privacy and scope); applies to humans too |

## Evidence and design records

Internal engineering records kept for traceability. They describe how each milestone was built and checked, not how to use the extension.

- [kiro-data-format.md](kiro-data-format.md): findings about Kiro's local data (macOS, Kiro 1.2.37)
- [multi-application-usage-investigation.md](multi-application-usage-investigation.md): passive usage sources across Kiro applications
- [cost-advisor-spec.md](cost-advisor-spec.md): current Cost Advisor behavior, assumptions and phases
- [cost-optimizer.md](cost-optimizer.md): historical standalone Cost Optimizer UI design
- [cost-optimizer-roadmap.md](cost-optimizer-roadmap.md): Milestone 4 design and billing-evidence register
- [milestone-5-visual-dashboard.md](milestone-5-visual-dashboard.md): chart proposal
- Validation reports: [3](milestone-3-validation.md), [4A](milestone-4a-validation.md), [4B](milestone-4b-validation.md), [4C](milestone-4c-validation.md), [5](milestone-5-validation.md), [5.1](milestone-5-1-validation.md)
- [superpowers/](superpowers/): implementation plans and design notes
- `validation/`: rendered synthetic-data screenshots from milestones 4B and 5. They show **earlier UI versions** (before the 0.5.1 simplification), were rendered with stubbed theme colors rather than inside Kiro, and are kept as evidence only. They are not current screenshots.
