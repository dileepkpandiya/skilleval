# Contributing to skilleval

Issues and PRs welcome.

## Bug reports
Include a SKILL.md + tasks.yaml that reproduces the issue.
This helps verify that any fix actually works.

## Development setup
```bash
git clone https://github.com/yourusername/skilleval
cd skilleval
npm install
cp .env.example .env
# Add your API keys to .env
npm run dev -- ./samples/api-design
```

## Adding sample skills
Sample skills live in ./samples/. Each needs a SKILL.md and tasks.yaml.
Good samples cover a clearly defined domain and have 5+ tasks.
