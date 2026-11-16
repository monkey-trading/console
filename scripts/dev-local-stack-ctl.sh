#!/usr/bin/env bash
# Drives the two-engine option of `dev-local-stack.sh` (SECOND_ENGINE=1), its parameter votes
# (GOVERNANCE=1) and its rotation (ROTATION=1), from a second terminal, on the running stack's Anvil chain.
# Development only: it moves the local chain's clock and sends transactions from the stack's published test
# keys. `status` and `fund-house` also work on one engine under either genesis, where a stack with
# LAUNCH_VALUES=1 (the default for production-genesis.toml) writes its info file by default.
#
#   status            the genesis the node runs and, with two engines, the registry's election, the vault's release,
#                     both engines, the chain's clock; with ROTATION=1, the turns, the operator in effect, the vault's
#                     signer and each engine
#   elect             closes the election epoch once it has ended (the registry's epoch is a minute);
#                     the candidate with the most delegated stake wins if it is eligible, has the
#                     quorum, and is not the operator in effect already
#   handover          passes the seven-day notice of a pending election (closing the epoch first
#                     when none is) by moving the chain's clock to its effective time, which makes
#                     the vault name the elected release; the stack then starts the second engine,
#                     which takes the first one's keys and log
#   fund-house [USDC] adds mock USDC (default 100000) to the house's capital in the vault, so the
#                     next MONKEY epoch that closes with a stake pays it out above the floor
#   propose MEMBER normal|fast JSON
#                     with GOVERNANCE=1, proposes the admin command JSON (its canonical form, as the
#                     engine serialises it) as MEMBER (operator, second or third), which votes yes
#   vote MEMBER ID    with GOVERNANCE=1, votes yes on proposal ID as MEMBER
#   stop-operator     with ROTATION=1, stops the operator in effect's engine, waits for the other members to promote
#                     the next member's standby key, then has the stack start the stopped engine again, as a member
#
# What `handover` leaves alone and what it does not is in the README's walkthrough: the chain's
# clock moves, the engine's does not. Withdrawal authorizations expire on the chain's clock, so none
# pays until real time has caught up with the chain; claim any before running `handover`.
#
# Environment:
#   STACK_INFO_FILE  the stack's JSON (default `monkey-local-stack.json` in the temporary directory)
set -euo pipefail

info="${STACK_INFO_FILE:-${TMPDIR:-/tmp}/monkey-local-stack.json}"
die() {
  echo "FAIL: $*" >&2
  exit 1
}
[[ -f "$info" ]] || die "no running stack: $info is missing (start the stack with SECOND_ENGINE=1 or LAUNCH_VALUES=1, or give both the same STACK_INFO_FILE)"
field() { jq -r ".$1 // empty" "$info"; }
rpc="$(field rpcUrl)"
vault="$(field vault)"
usdc="$(field usdc)"
registry="$(field registry)"
staking="$(field staking)"
house_key="$(field houseKey)"
deployer_key="$(field deployerKey)"
first_api="$(field apiOrigin)"
second_api="$(field secondApiOrigin)"
payer_key="$(field payerKey)"
first_release="$(field firstRelease)"
second_release="$(field secondRelease)"
first_candidate="$(field operator)"
second_candidate="$(field secondCandidate)"
third_candidate="$(field thirdCandidate)"
vote_contract="$(field vote)"
schedule="$(field schedule)"
third_api="$(field thirdApiOrigin)"
work_dir="$(field workDir)"
usdc_units=1000000

two_engines() {
  [[ -n "$second_api" ]] || die "this stack runs one engine; start it with SECOND_ENGINE=1"
}
call() { cast call --rpc-url "$rpc" "$@"; }
# The first value of a `cast call` answer, without its scientific-notation gloss.
first_of() { awk 'NR == 1 {print $1}'; }
lower() { tr '[:upper:]' '[:lower:]' <<<"$1"; }
send() { cast send --rpc-url "$rpc" "$@" >/dev/null; }
chain_time() { cast block latest --field timestamp --rpc-url "$rpc"; }
stamp() { date -u -r "$1" '+%Y-%m-%d %H:%M:%S UTC'; }
monkey_units() { awk -v n="$1" 'BEGIN {printf "%.2f", n / 1e18}'; }
health() { [[ "$(curl -sk --max-time 2 "$1/v1/health" 2>/dev/null)" == ok ]] && echo serving || echo "not serving"; }
# The election the registry is holding, as `effectiveAt` (0 when none): the same field the console reads.
pending_effective_at() { call "$registry" 'pendingElection()(uint64,address,address,bytes32,uint64)' | sed -n 5p | first_of; }
who() {
  case "$(lower "$1")" in
    "$(lower "$first_candidate")") echo "first engine ($1)" ;;
    "$(lower "$second_candidate")") echo "second engine ($1)" ;;
    *) echo "$1" ;;
  esac
}

status() {
  echo "Genesis            $(field genesisFile)"
  echo "                   $(field genesisSummary)"
  if [[ -n "$third_api" ]]; then
    rotation_status
    return
  fi
  [[ -n "$second_api" ]] || {
    echo "Engine             $(health "$first_api") at $first_api (one engine; SECOND_ENGINE=1 adds the election and the handover)"
    return
  }
  local now wall rotation named total votes_first votes_second current pending
  now="$(chain_time)"
  wall="$(date -u +%s)"
  rotation="$(call "$registry" 'rotationEnabled()(bool)')"
  named="$(call "$registry" 'namedOperator()((address,address,bytes32,uint64))' | tr -d '()' | cut -d, -f1 | tr -d ' ')"
  total="$(call "$staking" 'totalStaked()(uint256)' | first_of)"
  votes_first="$(call "$staking" 'votes(address)(uint256)' "$first_candidate" | first_of)"
  votes_second="$(call "$staking" 'votes(address)(uint256)' "$second_candidate" | first_of)"
  current="$(lower "$(call "$vault" 'currentRelease()(bytes32)')")"
  pending="$(pending_effective_at)"
  echo "Chain clock        $(stamp "$now") ($((now - wall)) s ahead of this machine's clock)"
  echo "Rotation           $rotation"
  echo "Operator named     $(who "$named")"
  local release="$current"
  if [[ "$current" == "$(lower "$first_release")" ]]; then release="the first engine's"; fi
  if [[ "$current" == "$(lower "$second_release")" ]]; then release="the second engine's"; fi
  echo "Vault's release    $release"
  echo "Staked             $(monkey_units "$total") MONKEY in all"
  echo "First engine       $(monkey_units "$votes_first") MONKEY delegated, $(health "$first_api") at $first_api"
  echo "Second engine      $(monkey_units "$votes_second") MONKEY delegated, $(health "$second_api") at $second_api"
  local epoch_start epoch_length
  epoch_start="$(call "$registry" 'openEpochStart()(uint64)' | first_of)"
  epoch_length="$(call "$registry" 'parameters()(uint64,uint64,uint16,uint16,uint16,uint256,uint64)' | first_of)"
  if [[ "$pending" != 0 ]]; then
    echo "Election           pending, effective $(stamp "$pending"): run \`handover\` to pass its notice"
  elif ((epoch_start + epoch_length > now)); then
    echo "Election           none pending; the epoch closes in $((epoch_start + epoch_length - now)) s"
  else
    echo "Election           none pending; the epoch has ended: run \`elect\` to close it"
  fi
}

elect() {
  two_engines
  [[ "$(call "$registry" 'rotationEnabled()(bool)')" == true ]] || die "rotation is off"
  [[ "$(pending_effective_at)" == 0 ]] || die "an election is already pending: run \`handover\`"
  local ends now
  ends=$(($(call "$registry" 'openEpochStart()(uint64)' | first_of) + $(call "$registry" 'parameters()(uint64,uint64,uint16,uint16,uint16,uint256,uint64)' | first_of)))
  while now="$(chain_time)" && ((now < ends)); do
    echo "The election epoch ends in $((ends - now)) s"
    sleep $((ends - now > 5 ? 5 : ends - now))
  done
  send "$registry" 'closeEpoch()' --private-key "$payer_key"
  local effective
  effective="$(pending_effective_at)"
  if [[ "$effective" == 0 ]]; then
    echo "The epoch closed and elected nobody. The winner needs a delegated share to be eligible (5% of the stake), 20% of all stake delegated, and not to be the operator in effect already."
    status
    return
  fi
  local elected
  elected="$(call "$registry" 'pendingElection()(uint64,address,address,bytes32,uint64)' | sed -n 2p | awk '{print $1}')"
  echo "Elected $(who "$elected"), effective $(stamp "$effective"). Run \`handover\` to pass the notice."
}

handover() {
  two_engines
  local effective now
  effective="$(pending_effective_at)"
  if [[ "$effective" == 0 ]]; then
    elect
    effective="$(pending_effective_at)"
    [[ "$effective" != 0 ]] || die "no election is pending, so there is no handover"
  fi
  now="$(chain_time)"
  if ((now <= effective)); then
    echo "Moving the chain's clock from $(stamp "$now") to $(stamp "$((effective + 1))"). Withdrawal authorizations stop paying until real time catches up."
    cast rpc evm_setNextBlockTimestamp "$((effective + 1))" --rpc-url "$rpc" >/dev/null
    cast rpc evm_mine --rpc-url "$rpc" >/dev/null
  fi
  send "$vault" 'syncRelease()' --private-key "$payer_key"
  # A node reads the vault's release at a finalized block, which trails the head by a few seconds.
  local named_at_finalized="" release_deadline=$((SECONDS + 120))
  until [[ -n "$named_at_finalized" ]]; do
    ((SECONDS < release_deadline)) || die "the vault does not name the second engine's release at a finalized block after two minutes"
    if [[ "$(lower "$(call "$vault" 'currentRelease()(bytes32)' --block finalized)")" == "$(lower "$second_release")" &&
      "$(lower "$(call "$vault" 'syncedRelease()(bytes32)' --block finalized)")" == "$(lower "$second_release")" ]]; then
      named_at_finalized=yes
    else
      sleep 2
    fi
  done
  touch "$(field workDir)/start-second-engine"
  echo "The vault names the elected release. Waiting for the second engine to take over (the stack starts it)."
  local deadline=$((SECONDS + 600))
  until [[ "$(health "$second_api")" == serving ]]; do
    ((SECONDS < deadline)) || die "the second engine is not serving after ten minutes; see $(field secondNodeLog)"
    sleep 3
  done
  echo "The second engine serves at $second_api. Open $second_api/v1/health once in your browser and accept its certificate if the console has not moved."
}

parameter_votes() {
  [[ -n "$vote_contract" ]] || die "this stack has no vote contract; start it with GOVERNANCE=1 SECOND_ENGINE=1"
}
# The rotation set member a name stands for.
member() {
  case "$1" in
    operator) echo "$first_candidate" ;;
    second) echo "$second_candidate" ;;
    third) echo "$third_candidate" ;;
    *) die "a member is operator, second or third: $1" ;;
  esac
}
# Sends as `$1`, which the chain lets the stack act for: the members' keys are test keys, and one is no Anvil account.
send_as() {
  local from="$1"
  shift
  cast rpc anvil_impersonateAccount "$from" --rpc-url "$rpc" >/dev/null
  send "$@" --unlocked --from "$from"
  cast rpc anvil_stopImpersonatingAccount "$from" --rpc-url "$rpc" >/dev/null
}

propose() {
  parameter_votes
  local from fast
  from="$(member "$1")"
  case "$2" in
    normal) fast=false ;;
    fast) fast=true ;;
    *) die "a proposal is normal or fast: $2" ;;
  esac
  [[ -n "${3:-}" ]] || die "propose needs the admin command's JSON"
  send_as "$from" "$vote_contract" 'propose(bytes,bool)' "$(cast from-utf8 "$3")" "$fast"
  echo "Proposal $(call "$vote_contract" 'proposalCount()(uint256)' | first_of) is open, proposed by $1 with its yes vote."
}

vote() {
  parameter_votes
  [[ "${2:-}" =~ ^[1-9][0-9]*$ ]] || die "vote needs a proposal number"
  local from
  from="$(member "$1")"
  send_as "$from" "$vote_contract" 'vote(uint256)' "$2"
  echo "$1 voted yes on proposal $2."
}

rotating() {
  [[ -n "$third_api" ]] || die "this stack runs no engine per rotation-set member; start it with ROTATION=1"
}
# The rotation-set members' engines, by index, as the stack names them.
member_names=(first second third)
member_candidates=("$first_candidate" "$second_candidate" "$third_candidate")
member_apis=("$first_api" "$second_api" "$third_api")
member_metrics=("$(field metricsUrl)" "$(field secondMetricsUrl)" "$(field thirdMetricsUrl)")
# The member whose candidate is `$1`, by index.
member_of() {
  local i
  for i in 0 1 2; do
    if [[ "$(lower "${member_candidates[$i]}")" == "$(lower "$1")" ]]; then
      echo "$i"
      return 0
    fi
  done
  return 1
}
# The candidate the registry names as the operator in effect.
named_operator() { call "$registry" 'namedOperator()((address,address,bytes32,uint64))' | tr -d '()' | cut -d, -f1 | tr -d ' '; }
signer_epoch() { call "$vault" 'signerEpoch()(uint64)' | first_of; }
# Whether member `$1`'s engine serves its API, follows the operator in effect (its metrics answer), or is stopped.
engine_state() {
  if [[ "$(health "${member_apis[$1]}")" == serving ]]; then
    echo "serving at ${member_apis[$1]}"
  elif curl -s --max-time 2 -o /dev/null "${member_metrics[$1]}"; then
    echo "following the operator in effect"
  else
    echo "stopped"
  fi
}

rotation_status() {
  local now wall length offset current turn drawn candidate reason i line named
  now="$(chain_time)"
  wall="$(date -u +%s)"
  length="$(call "$schedule" 'turnLength()(uint64)' | first_of)"
  offset="$(call "$schedule" 'boundary(uint64)(uint64)' 0 | first_of)"
  current=$(((now - offset) / length))
  named="$(named_operator)"
  echo "Chain clock        $(stamp "$now") ($((now - wall)) s ahead of this machine's clock)"
  if i="$(member_of "$named")"; then
    echo "Operator in effect the ${member_names[$i]} engine, at ${member_apis[$i]}"
  else
    echo "Operator in effect $named"
  fi
  echo "Vault's signer     $(call "$vault" 'checkpointSigner()(address)') (signer epoch $(signer_epoch))"
  echo "Turns              $((length / 60)) minutes each; the stack draws each one a turn before it begins"
  for ((turn = current - 1; turn <= current + 2; turn++)); do
    drawn="$(call "$schedule" 'turnOf(uint64)((address,uint16,uint8,uint32,uint64,uint64,bytes32,address))' "$turn" | tr -d '( )')"
    candidate="$(cut -d, -f1 <<<"$drawn")"
    reason="$(cut -d, -f3 <<<"$drawn")"
    if i="$(member_of "$candidate")"; then
      line="the ${member_names[$i]} engine"
      case "$reason" in
        1) line="$line, by a skip past a member that did not take it" ;;
        2) line="$line, by a promotion of its standby key" ;;
      esac
    elif ((turn > current)); then
      line="not drawn yet"
    else
      line="not drawn, so the member of the turn drawn before it holds on"
    fi
    if ((turn == current)); then line="$line (now)"; fi
    printf '  Turn %-12s from %s: %s\n' "$turn" "$(stamp "$((turn * length + offset))")" "$line"
  done
  echo "First engine       $(engine_state 0)"
  echo "Second engine      $(engine_state 1)"
  echo "Third engine       $(engine_state 2)"
}

stop_operator() {
  rotating
  local named i epoch current interval tolerance misses window now length offset next next_member deadline promoted p started=$SECONDS
  named="$(named_operator)"
  i="$(member_of "$named")" || die "the operator in effect, $named, runs no engine of this stack"
  epoch="$(signer_epoch)"
  [[ "$epoch" =~ ^[0-9]+$ ]] || die "the vault's signer epoch read as \"$epoch\""
  read -r interval tolerance misses _ <<<"$(call "$schedule" 'liveness()(uint64,uint64,uint16,uint16)' | awk '{print $1}' | tr '\n' ' ')"
  window=$((interval * (misses + 1) + tolerance))
  # A turn that passes to another member before a promotion could would leave the stop on an engine no longer in office.
  now="$(chain_time)"
  length="$(call "$schedule" 'turnLength()(uint64)' | first_of)"
  offset="$(call "$schedule" 'boundary(uint64)(uint64)' 0 | first_of)"
  next=$((((now - offset) / length + 1) * length + offset))
  next_member="$(call "$schedule" 'turnOf(uint64)((address,uint16,uint8,uint32,uint64,uint64,bytes32,address))' $(((now - offset) / length + 1)) | tr -d '( )' | cut -d, -f1)"
  if [[ "$(lower "$next_member")" != "$(lower "$named")" && "$next_member" != 0x0000000000000000000000000000000000000000 ]] &&
    ((next - now < window + 60)); then
    die "the turn passes to another engine in $((next - now)) s, before a promotion could: run stop-operator again after $(stamp "$next")"
  fi
  touch "$work_dir/stop-${member_names[$i]}"
  # However this command ends, the stack then starts the stopped engine again.
  # shellcheck disable=SC2064 # The engine to start again is fixed here.
  trap "touch '$work_dir/start-${member_names[$i]}'" EXIT
  trap 'exit 130' INT
  trap 'exit 143' TERM
  echo "Stopping the ${member_names[$i]} engine, the operator in effect. The other members record each heartbeat it misses, and"
  echo "once it has missed $misses in a row they promote the next member's standby key to the vault's signer, within about $window s."
  deadline=$((SECONDS + window + 240))
  # A read that fails is no promotion: it is tried again until the deadline.
  while ! current="$(signer_epoch)" || [[ ! "$current" =~ ^[0-9]+$ ]] || ((current == epoch)); do
    ((SECONDS < deadline)) || die "no promotion within $((window + 240)) s, so the stack starts the ${member_names[$i]} engine again; see the members' logs in $work_dir"
    sleep 5
  done
  promoted="$(named_operator)"
  p="$(member_of "$promoted")" || die "the operator the registry names after the promotion, $promoted, runs no engine of this stack"
  echo "After $((SECONDS - started)) s, the vault installed the ${member_names[$p]} engine's standby key in signer epoch $(signer_epoch): that engine"
  echo "serves the turn from its copy of the log, at ${member_apis[$p]}."
  echo "The ${member_names[$i]} engine starts again and follows the ${member_names[$p]} engine until its next turn."
}

fund_house() {
  local amount="${1:-100000}" house
  [[ "$amount" =~ ^[0-9]+$ ]] || die "the amount is whole USDC: $amount"
  house="$(cast wallet address --private-key "$house_key")"
  send "$usdc" 'mint(address,uint256)' "$house" "$((amount * usdc_units))" --private-key "$deployer_key"
  send "$usdc" 'approve(address,uint256)' "$vault" "$((amount * usdc_units))" --private-key "$house_key"
  send "$vault" 'depositToHouse(uint256)' "$((amount * usdc_units))" --private-key "$house_key"
  echo "Added $amount USDC to the house's capital. The next epoch that closes with a stake pays what is above the floor."
}

case "${1:-}" in
  status) status ;;
  elect) elect ;;
  handover) handover ;;
  fund-house) fund_house "${2:-}" ;;
  propose) propose "${2:-}" "${3:-}" "${4:-}" ;;
  vote) vote "${2:-}" "${3:-}" ;;
  stop-operator) stop_operator ;;
  *) die "usage: $0 status | elect | handover | fund-house [USDC] | propose MEMBER normal|fast JSON | vote MEMBER ID | stop-operator" ;;
esac
