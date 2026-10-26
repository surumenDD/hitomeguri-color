#!/usr/bin/env bash
# Starts one supervised dsh worker on a chosen model, then makes sure the prompt was submitted.
# Usage: tools/orca/dsh-launch.sh <model-id> <spec-file> <task-title> [run-id]
# Example: tools/orca/dsh-launch.sh deepseek/deepseek-v4.1-flash spec.txt "fix: x" run_abc
#
# Why this exists (ADR-0001):
# - Orca cannot pass --model to dsh; dsh-tui starts on ~/.dsh-tui/model.json, which is machine-wide.
#   A lock serialises launches so two coordinators never race on that file.
# - Orca sometimes leaves the prompt in dsh's input box. Enter is only accepted once the TUI has
#   finished loading ("Full access" appears on the model line).
set -u
MODEL="$1"; SPEC="$2"; TITLE="$3"
RUN=(); [ -n "${4:-}" ] && RUN=(--run "$4")
CONF="$HOME/.dsh-tui/model.json"
LOCK="$HOME/.dsh-tui/launch.lock"

until mkdir "$LOCK" 2>/dev/null; do sleep 2; done
trap 'rmdir "$LOCK"' EXIT
ORIGINAL="$(cat "$CONF")"

handles() { orca orchestration worker-list --json "${RUN[@]}" 2>/dev/null | python -X utf8 -I -c "import json,sys; print(' '.join(w['agentTerminalHandle'] for w in json.load(sys.stdin)['result']['workers']))"; }
screen() { orca terminal read --terminal "$1" --screen --json 2>/dev/null | python -X utf8 -I -c "
import json,sys; d=json.load(sys.stdin); r=d.get('result',d)
t=r.get('screen') or r.get('text') or r.get('lines') or (r.get('terminal') or {}).get('tail') or ''
print('\n'.join(t) if isinstance(t,list) else t)"; }

printf '{\n  "provider": "commandcode",\n  "model": "%s"\n}\n' "$MODEL" > "$CONF"
before="$(handles "${RUN[@]}")"
orca orchestration worker-start --spec "$(cat "$SPEC")" --task-title "$TITLE" --worktree current --agent dsh "${RUN[@]}" --json \
  | python -X utf8 -I -c "import json,sys; d=json.load(sys.stdin); r=d.get('result',d); print('start ok=',d.get('ok'),'stage=',r.get('stage'),'failed=',r.get('failedStage'))"
H="$(orca orchestration worker-list --json "${RUN[@]}" 2>/dev/null | python -X utf8 -I -c "
import json,sys; before=set(sys.argv[1].split())
new=[w['agentTerminalHandle'] for w in json.load(sys.stdin)['result']['workers'] if w['agentTerminalHandle'] not in before]
print(new[0] if new else '')" "$before")"
echo "handle=$H"
for _ in $(seq 1 30); do screen "$H" | grep -q 'Full access' && break; sleep 2; done
for attempt in 1 2 3; do
  orca terminal send --terminal "$H" --enter --json >/dev/null 2>&1; sleep 6
  if screen "$H" | grep -q 'esc to interrupt'; then echo "submitted (attempt $attempt)"; break; fi
done
screen "$H" | grep -E ' · (max|Max) ' | head -1 | sed 's/^ *//'
printf '%s\n' "$ORIGINAL" > "$CONF"
