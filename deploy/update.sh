#!/usr/bin/env bash
#
# REBOOT CLUB — Mise a jour du backend deja deploye par install.sh.
#
# Sequence : sauvegarde base + version -> recuperation du code -> dependances
# -> migrations -> fichiers statiques -> redemarrage -> controle de sante.
# En cas d'echec, le code precedent est restaure automatiquement et le service
# est relance sur l'ancienne version.
#
# Usage :
#   sudo reboot-club-update                  mise a jour sur la branche configuree
#   sudo reboot-club-update --branch dev     mise a jour depuis une autre branche
#   sudo reboot-club-update --ref a1b2c3d    deploiement d'un commit precis
#   sudo reboot-club-update --check          affiche les changements sans rien appliquer
#   sudo reboot-club-update --rollback       revient a la version precedente
#   sudo reboot-club-update --yes            sans confirmation (pour un cron)
#
set -euo pipefail

if [[ -t 1 ]]; then
    BOLD=$'\e[1m'; DIM=$'\e[2m'; RED=$'\e[31m'; GREEN=$'\e[32m'
    YELLOW=$'\e[33m'; BLUE=$'\e[36m'; RESET=$'\e[0m'
else
    BOLD=""; DIM=""; RED=""; GREEN=""; YELLOW=""; BLUE=""; RESET=""
fi
step()  { printf "\n%s==> %s%s\n" "$BOLD$BLUE" "$*" "$RESET"; }
ok()    { printf "  %s✓%s %s\n" "$GREEN" "$RESET" "$*"; }
warn()  { printf "  %s!%s %s\n" "$YELLOW" "$RESET" "$*"; }
info()  { printf "  %s·%s %s\n" "$DIM" "$RESET" "$*"; }
die()   { printf "\n%sERREUR :%s %s\n\n" "$BOLD$RED" "$RESET" "$*" >&2; exit 1; }

[[ $EUID -eq 0 ]] || die "Lancez ce script avec sudo."

# ---------------------------------------------------------------- config
CONF=""
for candidate in /etc/*/deploy.conf; do
    [[ -f "$candidate" ]] && grep -q '^APP_SLUG=' "$candidate" 2>/dev/null && CONF="$candidate" && break
done
[[ -n "${DEPLOY_CONF:-}" ]] && CONF="$DEPLOY_CONF"
[[ -f "$CONF" ]] || die "Configuration de deploiement introuvable. Lancez d'abord install.sh."
# shellcheck disable=SC1090
source "$CONF"

TARGET_BRANCH="$GIT_BRANCH"
TARGET_REF=""
ASSUME_YES=false
CHECK_ONLY=false
DO_ROLLBACK=false
while [[ $# -gt 0 ]]; do
    case "$1" in
        --branch)   TARGET_BRANCH="${2:?branche manquante}"; shift 2 ;;
        --ref)      TARGET_REF="${2:?reference manquante}"; shift 2 ;;
        --yes|-y)   ASSUME_YES=true; shift ;;
        --check)    CHECK_ONLY=true; shift ;;
        --rollback) DO_ROLLBACK=true; shift ;;
        -h|--help)  sed -n '2,20p' "$0"; exit 0 ;;
        *)          die "Option inconnue : $1" ;;
    esac
done

run_as_app() { sudo -u "$APP_USER" -H env HOME="$DATA_DIR" "$@"; }
manage() { run_as_app env DJANGO_SETTINGS_MODULE=config.settings_prod \
    "${VENV}/bin/python" "${BACKEND_DIR}/manage.py" "$@"; }

STAMP="$(date +%Y%m%d-%H%M%S)"
BACKUP_DIR="${DATA_DIR}/backups"
mkdir -p "$BACKUP_DIR"

printf "\n%sREBOOT CLUB — mise a jour de %s%s\n" "$BOLD" "$APP_SLUG" "$RESET"
info "Domaine ${DOMAIN} · service ${SERVICE}"

# ---------------------------------------------------------------- rollback
if [[ "$DO_ROLLBACK" == true ]]; then
    step "Retour a la version precedente"
    PREVIOUS_FILE="${BACKUP_DIR}/previous-commit"
    [[ -f "$PREVIOUS_FILE" ]] || die "Aucune version precedente enregistree."
    PREVIOUS="$(cat "$PREVIOUS_FILE")"
    info "Restauration du commit ${PREVIOUS}"
    run_as_app git -C "$APP_DIR" reset --hard "$PREVIOUS"
    run_as_app "${VENV}/bin/pip" install --quiet -r "${BACKEND_DIR}/requirements.txt"
    manage collectstatic --noinput >/dev/null
    systemctl restart "$SERVICE"
    sleep 3
    systemctl is-active --quiet "$SERVICE" || die "Le service n'a pas redemarre."
    ok "Version ${PREVIOUS} restauree"
    warn "Les migrations de base NE SONT PAS annulees automatiquement."
    warn "Sauvegardes disponibles : ls -lh ${BACKUP_DIR}"
    exit 0
fi

# ---------------------------------------------------------------- diff
step "Recuperation des nouveautes"
CURRENT="$(run_as_app git -C "$APP_DIR" rev-parse HEAD)"
run_as_app git -C "$APP_DIR" fetch --prune --tags origin
if [[ -n "$TARGET_REF" ]]; then
    TARGET="$(run_as_app git -C "$APP_DIR" rev-parse "$TARGET_REF")"
else
    TARGET="$(run_as_app git -C "$APP_DIR" rev-parse "origin/${TARGET_BRANCH}")"
fi

if [[ "$CURRENT" == "$TARGET" ]]; then
    ok "Deja a jour sur ${TARGET_BRANCH} (${CURRENT:0:7})"
    [[ "$CHECK_ONLY" == true ]] && exit 0
    if [[ "$ASSUME_YES" == false ]]; then
        read -r -p "  Forcer quand meme le redeploiement (dependances, migrations, statiques) ? [o/N] : " reply || true
        [[ "${reply:-n}" =~ ^[oOyY] ]] || exit 0
    else
        exit 0
    fi
fi

COMMIT_COUNT="$(run_as_app git -C "$APP_DIR" rev-list --count "${CURRENT}..${TARGET}" 2>/dev/null || echo "?")"
printf "\n  %sChangements a deployer (%s commit(s))%s\n" "$BOLD" "$COMMIT_COUNT" "$RESET"
run_as_app git -C "$APP_DIR" log --oneline --no-decorate "${CURRENT}..${TARGET}" 2>/dev/null | head -25 | sed 's/^/    /'

CHANGED="$(run_as_app git -C "$APP_DIR" diff --name-only "${CURRENT}" "${TARGET}" 2>/dev/null || true)"
NEW_MIGRATIONS="$(printf '%s\n' "$CHANGED" | grep -c "${BACKEND_SUBDIR}/.*/migrations/.*\.py$" || true)"
REQUIREMENTS_CHANGED=false
printf '%s\n' "$CHANGED" | grep -q "${BACKEND_SUBDIR}/requirements.txt" && REQUIREMENTS_CHANGED=true

printf "\n"
[[ "$NEW_MIGRATIONS" -gt 0 ]] && warn "${NEW_MIGRATIONS} fichier(s) de migration modifie(s) : la base sera sauvegardee avant application."
[[ "$REQUIREMENTS_CHANGED" == true ]] && info "requirements.txt a change : les dependances seront reinstallees."

if [[ "$CHECK_ONLY" == true ]]; then
    ok "Mode --check : aucune modification appliquee."
    exit 0
fi
if [[ "$ASSUME_YES" == false ]]; then
    read -r -p "  Appliquer cette mise a jour ? [O/n] : " reply || true
    [[ "${reply:-o}" =~ ^[oOyY] ]] || { warn "Mise a jour annulee."; exit 0; }
fi

# ---------------------------------------------------------------- sauvegarde
step "Sauvegarde avant mise a jour"
echo "$CURRENT" > "${BACKUP_DIR}/previous-commit"
DUMP="${BACKUP_DIR}/${DB_NAME}-${STAMP}.sql.gz"
if sudo -u postgres pg_dump -Fp "$DB_NAME" | gzip -9 > "$DUMP"; then
    chmod 600 "$DUMP"
    ok "Base sauvegardee : ${DUMP} ($(du -h "$DUMP" | cut -f1))"
else
    die "La sauvegarde de la base a echoue : mise a jour interrompue."
fi
# On ne garde que les 10 dernieres sauvegardes.
ls -1t "${BACKUP_DIR}"/*.sql.gz 2>/dev/null | tail -n +11 | xargs -r rm -f
ok "Version precedente memorisee : ${CURRENT:0:7}"

# ---------------------------------------------------------------- rollback auto
rollback_code() {
    warn "Echec detecte : restauration du code ${CURRENT:0:7}"
    run_as_app git -C "$APP_DIR" reset --hard "$CURRENT" >/dev/null 2>&1 || true
    run_as_app "${VENV}/bin/pip" install --quiet -r "${BACKEND_DIR}/requirements.txt" >/dev/null 2>&1 || true
    manage collectstatic --noinput >/dev/null 2>&1 || true
    systemctl restart "$SERVICE" >/dev/null 2>&1 || true
    printf "\n%sLa mise a jour a echoue et le code precedent a ete restaure.%s\n" "$BOLD$RED" "$RESET"
    printf "  Sauvegarde de la base : %s\n" "$DUMP"
    printf "  Restauration manuelle : gunzip -c %s | sudo -u postgres psql %s\n" "$DUMP" "$DB_NAME"
    printf "  Journaux              : journalctl -u %s -n 50\n\n" "$SERVICE"
    exit 1
}
trap rollback_code ERR

# ---------------------------------------------------------------- deploiement
step "Deploiement du code"
if [[ -n "$TARGET_REF" ]]; then
    run_as_app git -C "$APP_DIR" checkout --detach "$TARGET"
else
    run_as_app git -C "$APP_DIR" checkout -B "$TARGET_BRANCH" "origin/${TARGET_BRANCH}"
    run_as_app git -C "$APP_DIR" reset --hard "$TARGET"
fi
ok "Code positionne sur ${TARGET:0:7}"

step "Dependances Python"
run_as_app "${VENV}/bin/pip" install --quiet --upgrade pip >/dev/null
run_as_app "${VENV}/bin/pip" install --quiet -r "${BACKEND_DIR}/requirements.txt"
run_as_app "${VENV}/bin/pip" install --quiet gunicorn
ok "Dependances a jour"

step "Migrations de base de donnees"
PENDING="$(manage showmigrations --plan 2>/dev/null | grep -c '^\[ \]' || true)"
if [[ "${PENDING:-0}" -gt 0 ]]; then
    info "${PENDING} migration(s) a appliquer"
    manage migrate --noinput | sed 's/^/    /'
    ok "Migrations appliquees"
else
    ok "Aucune migration en attente"
fi

step "Fichiers statiques"
manage collectstatic --noinput >/dev/null
# Les fichiers fraichement collectes doivent rester lisibles par Nginx.
NGINX_USER="$(awk '$1=="user" {gsub(/;/,"",$2); print $2; exit}' /etc/nginx/nginx.conf 2>/dev/null || true)"
NGINX_GROUP="$(id -gn "${NGINX_USER:-www-data}" 2>/dev/null || echo www-data)"
chown -R "$APP_USER:$NGINX_GROUP" "${DATA_DIR}/staticfiles"
chmod -R g+rX "${DATA_DIR}/staticfiles"
ok "Fichiers statiques collectes"

step "Redemarrage du service"
manage check --deploy >/dev/null 2>&1 || warn "django check --deploy signale des avertissements (voir plus bas)."
systemctl restart "$SERVICE"
sleep 4
systemctl is-active --quiet "$SERVICE" || { journalctl -u "$SERVICE" -n 40 --no-pager; false; }
ok "Service ${SERVICE} redemarre"

step "Controle de sante"
HEALTHY=false
for attempt in 1 2 3 4 5; do
    if curl -fsS --max-time 10 --unix-socket "/run/${APP_SLUG}/gunicorn.sock" \
            "http://localhost/api/v1/health/" >/dev/null 2>&1; then
        HEALTHY=true; break
    fi
    info "Tentative ${attempt}/5..."
    sleep 3
done
[[ "$HEALTHY" == true ]] || false
ok "L'application repond correctement"

if curl -fsS --max-time 10 "https://${DOMAIN}/api/v1/health/" >/dev/null 2>&1; then
    ok "API accessible sur https://${DOMAIN}/api/v1/"
elif curl -fsS --max-time 10 "http://${DOMAIN}/api/v1/health/" >/dev/null 2>&1; then
    ok "API accessible sur http://${DOMAIN}/api/v1/"
else
    warn "L'application est saine en local mais injoignable via ${DOMAIN} : verifiez Nginx et le DNS."
fi

trap - ERR

# ---------------------------------------------------------------- fin
NEW_COMMIT="$(run_as_app git -C "$APP_DIR" rev-parse --short HEAD)"
cat <<FIN

${BOLD}${GREEN}Mise a jour terminee.${RESET}

  Version ............ ${CURRENT:0:7}  ->  ${NEW_COMMIT}
  Sauvegarde base .... ${DUMP}
  Retour arriere ..... sudo ${APP_SLUG}-update --rollback

${DIM}Aucune autre application du serveur n'a ete touchee.${RESET}

FIN
