#!/usr/bin/env bash
# Drives the two-engine option of `dev-local-stack.sh` (SECOND_ENGINE=1), and its parameter votes
# (GOVERNANCE=1), from a second terminal, on the running stack's Anvil chain. Development only: it
# moves the local chain's clock and sends transactions from the stack's published test keys.
#
#   status            the registry's election, the vault's release, both engines, the chain's clock
#   elect             closes the election epoch once it has ended (the registry's epoch is a minute);
#                     the candidate with the most delegated stake wins if it leads the operator in
#                     effect by the margin, has the quorum, and is eligible
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
[[ -f "$info" ]] || die "no running stack: $info is missing (start it with SECOND_ENGINE=1 ./scripts/dev-local-stack.sh)"
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
  two_engines
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
  epoch_length="$(call "$registry" 'parameters()(uint64,uint64,uint64,uint16,uint16,uint16,uint16,uint256,uint64)' | first_of)"
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
  ends=$(($(call "$registry" 'openEpochStart()(uint64)' | first_of) + $(call "$registry" 'parameters()(uint64,uint64,uint64,uint16,uint16,uint16,uint16,uint256,uint64)' | first_of)))
  while now="$(chain_time)" && ((now < ends)); do
    echo "The election epoch ends in $((ends - now)) s"
    sleep $((ends - now > 5 ? 5 : ends - now))
  done
  send "$registry" 'closeEpoch()' --private-key "$payer_key"
  local effective
  effective="$(pending_effective_at)"
  if [[ "$effective" == 0 ]]; then
    echo "The epoch closed and elected nobody. The winner needs a delegated share to be eligible (5% of the stake), 20% of all stake delegated, and 10% more votes than the operator in effect."
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
  send_as "$(member "$1")" "$vote_contract" 'vote(uint256)' "$2"
  echo "$1 voted yes on proposal $2."
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
  *) die "usage: $0 status | elect | handover | fund-house [USDC] | propose MEMBER normal|fast JSON | vote MEMBER ID" ;;
esac
