# Sourced by the hooks. Reads tool_input.file_path from stdin and sets:
#   file  the path as given     root  the toplevel of the file's own repo (not the cwd's)
#   rel   the path inside that repo
# Returns 1 when there is no path or the file is in no repo. The repo is taken from the
# file's directory so a worktree file is judged against its own worktree.
locate() {
  file=$(jq -r '.tool_input.file_path // empty' 2>/dev/null) || return 1
  [ -n "$file" ] || return 1
  case "$file" in /*) ;; *) file="$PWD/$file" ;; esac
  # nearest existing ancestor, resolved physically (macOS /tmp is a symlink), plus the rest
  local anc; anc=$(dirname "$file")
  while [ ! -d "$anc" ] && [ "$anc" != "/" ]; do anc=$(dirname "$anc"); done
  local phys; phys=$(cd "$anc" 2>/dev/null && pwd -P) || return 1
  root=$(git -C "$phys" rev-parse --show-toplevel 2>/dev/null) || return 1
  file="$phys${file#"$anc"}"
  rel=${file#"$root"/}
}
