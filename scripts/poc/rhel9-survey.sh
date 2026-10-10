#!/bin/sh
# EasyKiroGauge Milestone 6, Task 1B: read-only environment survey for RHEL 9 (plan section 4, R0).
#
#   sh rhel9-survey.sh                        # run as the ordinary, non-root user that runs Kiro
#   EKG_KIRO_DIR=<extracted tarball dir> sh rhel9-survey.sh
#
# What it does: reads a handful of system facts and prints `key=value` lines of FIXED TOKENS.
# What it never does: write a file, change a setting, start a service, run a Kiro command, read a
# Kiro log/database/credential store, send anything over the network, or print a path, user name,
# host name or identifier. Every printed value passes through emit(), which replaces anything
# outside [A-Za-z0-9_.:+,-] (so: any path) with "invalid"; user-derived text is only ever
# classified, never printed.
#
# Optional inputs (all classified, never echoed):
#   EKG_KIRO_DIR             absolute directory of the extracted Kiro tarball (program files only)
#   EKG_SURVEY_EXTRA_DIR     one extra absolute candidate storage location to classify
#   EKG_SURVEY_NO_LDD=1      skip `ldd` (it runs the dynamic loader in trace mode on vendor binaries)
#   EKG_SURVEY_MOUNTINFO     alternative mountinfo file (test hook; default /proc/self/mountinfo)
set -u
set -f
LC_ALL=C
export LC_ALL
PATH="${PATH:-/usr/bin:/bin}:/usr/sbin:/sbin"
export PATH

MOUNTINFO=${EKG_SURVEY_MOUNTINFO:-/proc/self/mountinfo}

emit() {
 _v=$2
 case $_v in
  '') _v=none ;;
  *[!A-Za-z0-9_.:+,-]*) _v=invalid ;;
 esac
 [ "${#_v}" -le 64 ] || _v=invalid
 printf '%s=%s\n' "$1" "$_v"
}
first_line() { sed -n '1p'; }
have() { command -v "$1" >/dev/null 2>&1; }
yes_no() { if "$@" 2>/dev/null; then echo yes; else echo no; fi; }
read_small() { [ -r "$1" ] && first_line <"$1" 2>/dev/null || true; }
# Highest dotted version in a newline list (sort by up to three numeric components).
max_version() { sort -t. -k1,1n -k2,2n -k3,3n | tail -n 1; }

emit survey_schema ekg-rhel9-survey.1
emit run_as_root "$( [ "$(id -u 2>/dev/null || echo 1)" = 0 ] && echo yes || echo no )"
emit container "$( [ -e /.dockerenv ] || [ -e /run/.containerenv ] && echo yes || echo no )"
emit umask "$(umask)"

# --- operating system -------------------------------------------------------------------------
os_field() { [ -r /etc/os-release ] && sed -n "s/^$1=\"\{0,1\}\([^\"]*\)\"\{0,1\}\$/\1/p" /etc/os-release | first_line; }
case "$(os_field ID)" in
 rhel|centos|rocky|almalinux|ol|fedora|ubuntu|debian) emit os_id "$(os_field ID)" ;;
 '') emit os_id unavailable ;;
 *) emit os_id other ;;
esac
case "$(os_field VERSION_ID)" in
 [0-9]|[0-9].[0-9]|[0-9][0-9].[0-9]|[0-9][0-9]|[0-9].[0-9][0-9]) emit os_version_id "$(os_field VERSION_ID)" ;;
 '') emit os_version_id unavailable ;;
 *) emit os_version_id other ;;
esac
case "$(uname -m 2>/dev/null)" in
 x86_64|aarch64|ppc64le|s390x|arm64) emit arch "$(uname -m)" ;;
 *) emit arch other ;;
esac
_k=$(uname -r 2>/dev/null | sed -n 's/^\([0-9]*\.[0-9]*\.[0-9]*\).*/\1/p' | first_line)
emit kernel "${_k:-unavailable}"
_g=$(getconf GNU_LIBC_VERSION 2>/dev/null | sed -n 's/^glibc \([0-9][0-9.]*\)$/\1/p')
emit glibc "${_g:-unavailable}"

# --- security framework -----------------------------------------------------------------------
if have getenforce; then
 case "$(getenforce 2>/dev/null)" in
  Enforcing) emit selinux enforcing ;;
  Permissive) emit selinux permissive ;;
  Disabled) emit selinux disabled ;;
  *) emit selinux unavailable ;;
 esac
elif [ -r /sys/fs/selinux/enforce ]; then
 case "$(read_small /sys/fs/selinux/enforce)" in 1) emit selinux enforcing ;; 0) emit selinux permissive ;; *) emit selinux unavailable ;; esac
else
 emit selinux unavailable
fi
ctx=$(id -Z 2>/dev/null || true)
se_user=$(printf '%s' "$ctx" | cut -d: -f1)
se_type=$(printf '%s' "$ctx" | cut -d: -f3)
case $se_user in
 unconfined_u|user_u|staff_u|sysadm_u|system_u|guest_u|xguest_u) emit selinux_user "$se_user" ;;
 '') emit selinux_user unavailable ;;
 *) emit selinux_user other ;;
esac
case $se_type in
 unconfined_t|user_t|staff_t|sysadm_t|guest_t|xguest_t|container_t|init_t) emit selinux_domain "$se_type" ;;
 '') emit selinux_domain unavailable ;;
 *) emit selinux_domain other ;;
esac
if have systemctl; then
 case "$(systemctl is-active fapolicyd 2>/dev/null | first_line)" in
  active) emit fapolicyd active ;;
  inactive) emit fapolicyd inactive ;;
  failed) emit fapolicyd failed ;;
  *) emit fapolicyd not_installed_or_unknown ;;
 esac
else
 emit fapolicyd unavailable
fi
case "$(read_small /proc/sys/crypto/fips_enabled)" in 1) emit fips enabled ;; 0) emit fips disabled ;; *) emit fips unavailable ;; esac

# --- environment classification (values are never printed) ------------------------------------
classify_env() {
 eval "_val=\${$1+set}"
 if [ -z "$_val" ]; then echo unset; return; fi
 eval "_val=\${$1}"
 case $_val in
  '') echo empty ;;
  /*) echo absolute ;;
  *) echo relative ;;
 esac
}
for name in HOME XDG_CONFIG_HOME XDG_DATA_HOME XDG_STATE_HOME XDG_CACHE_HOME XDG_RUNTIME_DIR; do
 emit "env_$(printf '%s' "$name" | tr 'A-Z' 'a-z')" "$(classify_env "$name")"
done

# --- candidate storage locations --------------------------------------------------------------
nearest_existing() {
 _p=$1
 while [ ! -d "$_p" ]; do
  _q=$(dirname -- "$_p")
  [ "$_q" = "$_p" ] && break
  _p=$_q
 done
 (cd -P -- "$_p" 2>/dev/null && pwd -P)
}
mount_of() {
 [ -r "$MOUNTINFO" ] || return 1
 awk -v p="$1" '
  { mp = $5; gsub(/\\040/, " ", mp)
    if (!(mp == "/" || p == mp || index(p, mp "/") == 1)) next
    if (length(mp) >= best) { best = length(mp); sel = $0 } }
  END { if (sel == "") exit 1
        n = split(sel, f, " "); for (i = 1; i <= n; i++) if (f[i] == "-") break
        print f[i + 1] "|" f[6] "|" f[i + 3] }' "$MOUNTINFO"
}
fs_class() {
 case $1 in
  ext2|ext3|ext4|xfs|btrfs|f2fs|jfs|reiserfs) echo local_posix ;;
  tmpfs|ramfs|devtmpfs) echo volatile ;;
  overlay|overlayfs) echo container_overlay ;;
  nfs|nfs4|cifs|smb3|smbfs|ceph|lustre|gpfs|afs|9p|glusterfs|beegfs|ocfs2|gfs2|orangefs) echo network_or_cluster ;;
  fuse|fuse.*) echo fuse ;;
  autofs) echo autofs ;;
  vfat|exfat|ntfs|ntfs3|msdos) echo no_posix_modes ;;
  '') echo unavailable ;;
  *) echo other ;;
 esac
}
filter_opts() {
 _out=; _other=0; _ifs=$IFS; IFS=,
 for _o in $1; do
  case $_o in
   rw|ro|nosuid|nodev|noexec|relatime|noatime|nodiratime|lazytime|strictatime|seclabel|sync|dirsync) _out="$_out${_out:+,}$_o" ;;
   *) _other=$((_other + 1)) ;;
  esac
 done
 IFS=$_ifs
 printf '%s %s' "${_out:-none}" "$_other"
}
tmpfiles_cat=
if have systemd-tmpfiles; then tmpfiles_cat=$(systemd-tmpfiles --cat-config 2>/dev/null || true); fi
# Age field of the cleanup rule for one fixed system directory, or "none"/"unavailable".
tmpfiles_age() {
 [ -n "$tmpfiles_cat" ] || { echo unavailable; return; }
 _age=$(printf '%s\n' "$tmpfiles_cat" | awk -v d="$1" '$1 ~ /^[qQdD]$/ && $2 == d { a = $6 } END { print a }')
 case $_age in
  '') echo none ;;
  -) echo none ;;
  [0-9]*[a-z]|[0-9]*) case $_age in *[!0-9a-z]*) echo other ;; *) echo "$_age" ;; esac ;;
  *) echo other ;;
 esac
}
probe_location() {
 _name=$1; _path=$2
 case $_path in
  /*) ;;
  *) emit "loc_${_name}_state" not_absolute_or_unset; return ;;
 esac
 [ -e "$_path" ] && emit "loc_${_name}_exists" yes || emit "loc_${_name}_exists" no
 [ -L "$_path" ] && emit "loc_${_name}_is_symlink" yes || emit "loc_${_name}_is_symlink" no
 _anc=$(nearest_existing "$_path")
 if [ -z "$_anc" ]; then emit "loc_${_name}_state" unresolvable; return; fi
 emit "loc_${_name}_creatable_by_me" "$(yes_no test -w "$_anc" -a -x "$_anc")"
 emit "loc_${_name}_nearest_dir_owned_by_me" "$(yes_no test -O "$_anc")"
 _m=$(mount_of "$_anc" || true)
 if [ -n "$_m" ]; then
  _fst=${_m%%|*}; _rest=${_m#*|}; _mo=${_rest%%|*}; _so=${_rest#*|}
  case $_fst in
   ext2|ext3|ext4|xfs|btrfs|f2fs|jfs|reiserfs|tmpfs|ramfs|devtmpfs|overlay|nfs|nfs4|cifs|smb3|smbfs|ceph|lustre|gpfs|afs|9p|glusterfs|beegfs|ocfs2|gfs2|orangefs|autofs|vfat|exfat|ntfs|ntfs3|msdos) emit "loc_${_name}_fstype" "$_fst" ;;
   fuse|fuse.*) emit "loc_${_name}_fstype" fuse ;;
   *) emit "loc_${_name}_fstype" other ;;
  esac
  emit "loc_${_name}_class" "$(fs_class "$_fst")"
  _f=$(filter_opts "$_mo")
  emit "loc_${_name}_mount_opts" "${_f% *}"
  emit "loc_${_name}_mount_opts_unlisted" "${_f#* }"
  case $_fst in
   nfs|nfs4)
    _v=$(printf '%s' "$_so" | tr ',' '\n' | sed -n 's/^vers=\([0-9.]*\)$/\1/p' | first_line)
    emit "loc_${_name}_nfs_vers" "${_v:-unknown}"
    case "$(printf '%s' "$_so" | tr ',' '\n' | sed -n 's/^sec=\(.*\)$/\1/p' | first_line)" in
     sys|krb5|krb5i|krb5p) emit "loc_${_name}_nfs_sec" "$(printf '%s' "$_so" | tr ',' '\n' | sed -n 's/^sec=\(.*\)$/\1/p' | first_line)" ;;
     '') emit "loc_${_name}_nfs_sec" unknown ;;
     *) emit "loc_${_name}_nfs_sec" other ;;
    esac ;;
  esac
 else
  emit "loc_${_name}_fstype" unavailable
  emit "loc_${_name}_class" unavailable
 fi
 if have ls; then
  _t=$(ls -dZ -- "$_anc" 2>/dev/null | awk '{ n = split($0, a, ":"); if (n >= 3) print a[3] }' | first_line)
  case $_t in
   [a-z]*_t) case $_t in *[!a-z0-9_]*) emit "loc_${_name}_selinux_type" other ;; *) emit "loc_${_name}_selinux_type" "$_t" ;; esac ;;
   '') emit "loc_${_name}_selinux_type" unavailable ;;
   *) emit "loc_${_name}_selinux_type" other ;;
  esac
 fi
}
HOME_DIR=${HOME:-}
CONFIG_DIR=${XDG_CONFIG_HOME:-${HOME_DIR:+$HOME_DIR/.config}}
DATA_DIR=${XDG_DATA_HOME:-${HOME_DIR:+$HOME_DIR/.local/share}}
STATE_DIR=${XDG_STATE_HOME:-${HOME_DIR:+$HOME_DIR/.local/state}}
probe_location home "$HOME_DIR"
probe_location config "$CONFIG_DIR"
probe_location data "$DATA_DIR"
probe_location state "$STATE_DIR"
probe_location runtime "${XDG_RUNTIME_DIR:-}"
probe_location tmp /tmp
probe_location vartmp /var/tmp
probe_location shm /dev/shm
[ -n "${EKG_SURVEY_EXTRA_DIR:-}" ] && probe_location extra "$EKG_SURVEY_EXTRA_DIR"
emit tmpfiles_age_tmp "$(tmpfiles_age /tmp)"
emit tmpfiles_age_vartmp "$(tmpfiles_age /var/tmp)"
if have systemctl; then
 case "$(systemctl is-enabled systemd-tmpfiles-clean.timer 2>/dev/null | first_line)" in
  enabled|static|disabled|masked) emit tmpfiles_clean_timer "$(systemctl is-enabled systemd-tmpfiles-clean.timer 2>/dev/null | first_line)" ;;
  *) emit tmpfiles_clean_timer unavailable ;;
 esac
fi
# Does any age-based tmpfiles rule cover the home, config or data directory?
if [ -n "$tmpfiles_cat" ] && [ -n "$HOME_DIR" ]; then
 covered=no
 for d in "$HOME_DIR" "$CONFIG_DIR" "$DATA_DIR"; do
  [ -n "$d" ] || continue
  if printf '%s\n' "$tmpfiles_cat" | awk -v d="$d" '$1 ~ /^[qQdD]$/ && $6 != "-" && $6 != "" && (d == $2 || index(d, $2 "/") == 1) { f = 1 } END { exit !f }'; then covered=yes; fi
 done
 emit tmpfiles_rule_covers_home_config_or_data "$covered"
else
 emit tmpfiles_rule_covers_home_config_or_data unavailable
fi

# --- kernel limits ----------------------------------------------------------------------------
for k in max_user_watches max_user_instances max_queued_events; do
 v=$(read_small "/proc/sys/fs/inotify/$k")
 case $v in ''|*[!0-9]*) emit "inotify_$k" unavailable ;; *) emit "inotify_$k" "$v" ;; esac
done

# --- Kiro program files (optional; classification and version tokens only) ---------------------
scan_kiro_dir() {
 _dir=$1
 _home_prefix=${HOME_DIR:-/nonexistent-synthetic-home}
 case $_dir in
  "$_home_prefix"/*) emit kiro_location_class under_home ;;
  /opt/*) emit kiro_location_class under_opt ;;
  /usr/*) emit kiro_location_class under_usr ;;
  /tmp/*|/var/tmp/*) emit kiro_location_class under_tmp ;;
  /*) emit kiro_location_class other ;;
  *) emit kiro_location_class not_absolute; return ;;
 esac
 [ -d "$_dir" ] || { emit kiro_dir_exists no; return; }
 emit kiro_dir_exists yes
 emit kiro_portable_data_dir "$(yes_no test -d "$_dir/data")"
 _list=$({
  find "$_dir" -maxdepth 2 -type f -perm -u+x 2>/dev/null | head -n 200
  find "$_dir" -type f -name '*.node' 2>/dev/null | head -n 200
  find "$_dir" -type f \( -name '*.so' -o -name '*.so.*' \) 2>/dev/null | head -n 200
 } | sort -u)
 printf '%s\n' "$_list" | {
  elf=0; node_mods=0; missing=; glibc=; glibcxx=
  while IFS= read -r f; do
   [ -n "$f" ] && [ -f "$f" ] && [ -r "$f" ] || continue
   [ "$(od -An -tx1 -N4 -- "$f" 2>/dev/null | tr -d ' \n')" = 7f454c46 ] || continue
   elf=$((elf + 1))
   case $f in *.node) node_mods=$((node_mods + 1)) ;; esac
   glibc="$glibc
$(grep -a -o 'GLIBC_[0-9][0-9.]*' -- "$f" 2>/dev/null | sed 's/^GLIBC_//' | sort -u)"
   glibcxx="$glibcxx
$(grep -a -o 'GLIBCXX_[0-9][0-9.]*' -- "$f" 2>/dev/null | sed 's/^GLIBCXX_//' | sort -u)"
   if [ "${EKG_SURVEY_NO_LDD:-0}" != 1 ] && have ldd; then
    missing="$missing
$(ldd -- "$f" 2>/dev/null | awk '/not found/ { print $1 }')"
   fi
  done
  emit kiro_elf_files "$elf"
  emit kiro_node_modules "$node_mods"
  if [ "${EKG_SURVEY_NO_LDD:-0}" = 1 ]; then emit kiro_unresolved_libraries skipped
  elif have ldd; then
   _m=$(printf '%s\n' "$missing" | sed '/^$/d' | sort -u)
   emit kiro_unresolved_libraries "$(printf '%s\n' "$_m" | sed '/^$/d' | wc -l | tr -d ' ')"
   emit kiro_unresolved_names "$(printf '%s\n' "$_m" | sed -n '/^lib[A-Za-z0-9_.+-]*\.so\(\.[0-9]*\)*$/p' | head -n 20 | tr '\n' ',' | sed 's/,$//')"
  else emit kiro_unresolved_libraries unavailable
  fi
  _g=$(printf '%s\n' "$glibc" | sed '/^$/d' | max_version)
  _x=$(printf '%s\n' "$glibcxx" | sed '/^$/d' | max_version)
  emit kiro_max_glibc_required "${_g:-none}"
  emit kiro_max_glibcxx_required "${_x:-none}"
  emit kiro_glibc_required_within_system "$(
   _sys=$(getconf GNU_LIBC_VERSION 2>/dev/null | sed -n 's/^glibc \([0-9][0-9.]*\)$/\1/p')
   if [ -n "$_g" ] && [ -n "$_sys" ]; then
    [ "$(printf '%s\n%s\n' "$_g" "$_sys" | max_version)" = "$_sys" ] && echo yes || echo no
   else echo unavailable; fi)"
 }
}
if [ -n "${EKG_KIRO_DIR:-}" ]; then scan_kiro_dir "$EKG_KIRO_DIR"; else emit kiro_dir not_supplied; fi
for lib in /usr/lib64/libstdc++.so.6 /lib64/libstdc++.so.6 /usr/lib/libstdc++.so.6; do
 if [ -r "$lib" ]; then
  emit system_glibcxx_provided "$(grep -a -o 'GLIBCXX_[0-9][0-9.]*' -- "$lib" 2>/dev/null | sed 's/^GLIBCXX_//' | max_version)"
  break
 fi
done
emit survey_complete yes
