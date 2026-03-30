# Topology Verification Skill

Run Clawstrap topology migration and verification using the autonomous safety gates.

## One-command ideal flow

```bash
python tools/topology/verify_clawstrap_topology_options.py --repo-root . --output-dir reviews/topology-verification --governor-url http://127.0.0.1:3001
```

This generates:
- `candidate-options.json`
- option specs
- strict reports for each option
- `option-verification-summary.md` and `.json`

## Default workflow

```bash
python tools/topology/migrate_topology_spec.py \
  --input reviews/topology-verification/clawstrap-topology-spec.json \
  --output reviews/topology-verification/clawstrap-topology-spec.migrated.json

python tools/topology/build_experience_topology.py \
  --input reviews/topology-verification/clawstrap-topology-spec.migrated.json \
  --output reviews/topology-verification/clawstrap-topology-report.strict.md \
  --strict
```

## Option comparison workflow

```bash
cat reviews/topology-verification/option-verification-summary.md
```

Artifacts are written under `reviews/topology-verification/`.
